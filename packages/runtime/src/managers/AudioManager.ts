import { debug, lerp } from "../utils"

interface AudioTrack {
  source: AudioBufferSourceNode | null
  gainNode: GainNode
  buffer: AudioBuffer | null
  compressedData: ArrayBuffer | null
  duration?: number
  isPlaying: boolean
  startTime?: number
  pauseTime?: number
  isPausable: boolean
  active: boolean
  eventHandlers: Map<TrackEventType, Set<TrackEventHandler>>
  isTemp?: boolean
  instanceId?: string
  groupId?: string
  lowPassFilter?: BiquadFilterNode
  fadeIn?: {
    duration: number
    startVolume: number
    targetVolume: number
  }
  fadeOut?: {
    duration: number
    startVolume: number
    targetVolume: number
  }
  updateProgressIntervalId?: number
  isDecoded: boolean
  keepDecoded: boolean
}

interface AudioGroup {
  name: string
  gainNode: GainNode
  volume: number
}

interface AudioTrackAvailabilityOptions {
  onNotFound?: () => Promise<void> | void
  attemptReload?: boolean
}

interface AudioManagerOptions {
  groups?: string[]
  initialGroupVolumes?: { [key: string]: number }
  onTrackNotFound?: (trackName: string) => Promise<void> | void
}

interface PlayTrackOptions {
  loop?: boolean
  startTime?: number
  volume?: number
  createInstance?: boolean
  fadeIn?: {
    duration: number
    startVolume?: number
    targetVolume?: number
  }
  fadeOut?: {
    duration: number
    startVolume?: number
    targetVolume?: number
  }
}

interface FadeOptions {
  duration: number
  targetVolume: number
  stopAtEnd?: boolean
  onComplete?: () => void
}

interface LoadTrackOptions {
  isPausable?: boolean
  onLoaded?: () => void
  active?: boolean
  decodeImmediately?: boolean
  keepDecoded?: boolean
}

type TrackEventType = "complete"
type TrackEventHandler = () => void

export class AudioManager {
  private audioContext: AudioContext
  private masterGainNode: GainNode
  private _isMuted: boolean = false
  private tracks: Map<string, AudioTrack> = new Map()
  private groups: Map<string, AudioGroup> = new Map()
  private instanceCounter: number = 0
  private onTrackNotFound?: (trackName: string) => Promise<void> | void
  private fadeTimeouts: Map<string, number> = new Map()
  private initialised: boolean = false
  private readonly progressUpdateInterval: number = 50

  constructor(options: AudioManagerOptions = {}) {
    this.audioContext = new (window.AudioContext ||
      (window as any).webkitAudioContext)()
    this.masterGainNode = this.audioContext.createGain()
    this.masterGainNode.connect(this.audioContext.destination)

    this.onTrackNotFound = options.onTrackNotFound

    if (options.groups) {
      options.groups.forEach((groupName) => {
        this.createGroup(
          groupName,
          options.initialGroupVolumes?.[groupName] ?? 1
        )
      })
    }
  }

  public getAudioContext(): AudioContext {
    return this.audioContext
  }

  public getMasterGainNode(): GainNode {
    return this.masterGainNode
  }

  public toggleMute(): boolean {
    this._isMuted = !this._isMuted
    this.masterGainNode.gain.setValueAtTime(
      this._isMuted ? 0 : 1,
      this.audioContext.currentTime
    )
    return this.isMuted
  }

  public get isMuted(): boolean {
    return this._isMuted
  }

  public loadTrack(
    name: string,
    source: string | ArrayBuffer,
    options: LoadTrackOptions & { group?: string } = {}
  ): Promise<void> {
    const {
      isPausable = true,
      onLoaded,
      active = false,
      group,
      decodeImmediately = false,
      keepDecoded = false,
    } = options

    const processBuffer = async (arrayBuffer: ArrayBuffer): Promise<void> => {
      try {
        const gainNode = this.audioContext.createGain()
        const targetNode = group
          ? this.groups.get(group)?.gainNode ?? this.masterGainNode
          : this.masterGainNode

        gainNode.connect(targetNode)

        let audioBuffer: AudioBuffer | null = null

        if (decodeImmediately) {
          audioBuffer = await this.audioContext.decodeAudioData(
            arrayBuffer.slice()
          )
        }

        const track: AudioTrack = {
          source: null,
          gainNode,
          buffer: audioBuffer,
          compressedData: arrayBuffer,
          isPlaying: false,
          isPausable,
          active,
          eventHandlers: new Map(),
          groupId: group,
          isDecoded: !!audioBuffer,
          keepDecoded,
        }

        this.initialiseEventHandlers(track)
        this.tracks.set(name, track)

        debug(
          `Audio track loaded - ${name}${group ? ` (group: ${group})` : ""} ${
            audioBuffer ? "(pre-decoded)" : "(compressed only)"
          }`
        )
        if (onLoaded) onLoaded()
      } catch (error) {
        throw error
      }
    }

    return new Promise((resolve, reject) => {
      if (typeof source === "string") {
        fetch(source)
          .then((response) => response.arrayBuffer())
          .then(processBuffer)
          .then(resolve)
          .catch(reject)
      } else {
        processBuffer(source).then(resolve).catch(reject)
      }
    })
  }

  private async ensureTrackDecoded(
    trackOrName: AudioTrack | string
  ): Promise<AudioTrack | null> {
    let track: AudioTrack | undefined

    if (typeof trackOrName === "string") {
      track = this.tracks.get(trackOrName)
      if (!track) {
        debug(`Track ${trackOrName} not found for decoding`)
        this.handleTrackNotFound(trackOrName)
        return null
      }
    } else {
      track = trackOrName
    }

    if (track.isDecoded && track.buffer) {
      return track // Already decoded
    }

    if (!track.compressedData) {
      throw new Error("No compressed data available for decoding")
    }

    debug("Decoding audio on-demand...")
    try {
      // Create a copy of the ArrayBuffer for decoding to avoid detaching the original
      const bufferCopy = track.compressedData.slice()
      track.buffer = await this.audioContext.decodeAudioData(bufferCopy)
      track.isDecoded = true

      // Store duration for future reference
      track.duration = track.buffer.duration

      debug(`Audio decoded successfully, duration: ${track.duration}s`)
      return track
    } catch (error) {
      console.error("Failed to decode audio:", error)
      throw error
    }
  }

  public async decodeTrack(name: string): Promise<boolean> {
    try {
      const result = await this.ensureTrackDecoded(name)
      return result !== null
    } catch (error) {
      console.error(`Failed to decode track ${name}:`, error)
      return false
    }
  }

  public async reloadTrack(
    name: string,
    source: string | ArrayBuffer
  ): Promise<void> {
    const existingTrack = this.tracks.get(name)

    if (existingTrack) {
      // Save properties we want to keep
      const wasPlaying = existingTrack.isPlaying
      const pauseTime = existingTrack.pauseTime || 0
      const groupId = existingTrack.groupId
      const isPausable = existingTrack.isPausable
      const active = existingTrack.active

      // Remove existing track
      if (wasPlaying) {
        this.stopTrack(name)
      }

      // Load the track again with the same parameters
      await this.loadTrack(name, source, {
        isPausable,
        active,
        group: groupId,
      })

      // If it was playing, resume from where it left off
      if (wasPlaying) {
        this.playTrack(name, { startTime: pauseTime })
      }

      debug(`Track ${name} reloaded successfully`)
    } else {
      // If track doesn't exist, just load it
      await this.loadTrack(name, source)
    }
  }

  private initialiseEventHandlers(track: AudioTrack): void {
    track.eventHandlers = new Map()
    track.eventHandlers.set("complete", new Set())
  }

  public addEventListener(
    trackName: string,
    event: TrackEventType,
    handler: TrackEventHandler
  ): void {
    const track = this.tracks.get(trackName)
    if (track) {
      const handlers = track.eventHandlers.get(event)
      if (handlers) {
        handlers.add(handler)
      }
    } else {
      this.handleTrackNotFound(trackName)
    }
  }

  public removeEventListener(
    trackName: string,
    event: TrackEventType,
    handler: TrackEventHandler
  ): void {
    const track = this.tracks.get(trackName)
    if (track) {
      const handlers = track.eventHandlers.get(event)
      if (handlers) {
        handlers.delete(handler)
      }
    }
  }

  private emitTrackEvent(trackName: string, event: TrackEventType): void {
    const track = this.tracks.get(trackName)
    if (track) {
      const handlers = track.eventHandlers.get(event)
      if (handlers) {
        handlers.forEach((handler) => handler())
      }
    }
  }

  public isTrackAvailable(
    name: string,
    options: AudioTrackAvailabilityOptions = {}
  ): boolean {
    const track = this.tracks.get(name)

    if (!track) {
      debug(`Track ${name} not found in isTrackAvailable check`)

      if (options.onNotFound) {
        options.onNotFound()
      } else if (this.onTrackNotFound) {
        this.onTrackNotFound(name)
      }

      return false
    }

    const hasAudioData = !!(track.buffer || track.compressedData)

    if (!hasAudioData) {
      debug(
        `Track ${name} found but has no audio data (neither buffer nor compressed data)`
      )

      if (options.onNotFound) {
        options.onNotFound()
      } else if (this.onTrackNotFound) {
        this.onTrackNotFound(name)
      }

      return false
    }

    debug(
      `Track ${name} is available ${
        track.buffer ? "(decoded)" : "(compressed only)"
      }`
    )
    return true
  }

  public unloadTrack(name: string, keepMetadata: boolean = false): boolean {
    const track = this.tracks.get(name)
    if (!track) {
      debug(`Cannot unload track ${name}: track not found`)
      return false
    }

    // Stop the track if it's playing
    if (track.isPlaying) {
      this.stopTrack(name)
    }

    if (keepMetadata) {
      // Just clear the buffer but keep the track in the system
      debug(`Unloading buffer for track ${name} but keeping metadata`)

      // Create a dummy empty buffer to replace the real one
      // This simulates a situation where the buffer was cleared but track entry remains
      const emptyBuffer = this.audioContext.createBuffer(
        2, // channels
        1, // length
        this.audioContext.sampleRate
      )
      track.buffer = emptyBuffer
      return true
    } else {
      // Completely remove the track but don't run full cleanup
      debug(`Completely unloading track ${name}`)

      // Clear connections but don't remove from the track map
      if (track.source) {
        track.source.onended = null
        try {
          track.source.stop()
          track.source.disconnect()
        } catch (e) {
          // Ignore errors when stopping/disconnecting
        }
        track.source = null
      }

      // Clear the buffer reference to simulate memory being freed
      // @ts-ignore - deliberately setting to null for testing
      track.buffer = null

      return true
    }
  }

  private initAudio(): void {
    this.initialised = true
    const audioElement = document.getElementById(
      "audio-element"
    ) as HTMLAudioElement | null
    if (audioElement) audioElement.play()
  }

  public async playTrack(
    name: string,
    options: PlayTrackOptions = {}
  ): Promise<string> {
    if (!this.initialised) this.initAudio()

    debug([`playTrack called for ${name} with options:`, options])

    const track = this.tracks.get(name)
    let trackToPlay: AudioTrack | null = null
    let trackId = name

    if (track) {
      // Ensure the track is decoded before playing
      try {
        await this.ensureTrackDecoded(track)
      } catch (error) {
        console.error(`Failed to decode track ${name}:`, error)
        return name
      }

      if (options.createInstance) {
        trackId = `${name}_instance_${this.instanceCounter++}`
        trackToPlay = this.createTrackInstance(track, trackId)
        this.tracks.set(trackId, trackToPlay)
      } else {
        trackToPlay = track
        if (track.source) {
          this.stopExistingSource(track, name)
        }
      }

      if (trackToPlay && trackToPlay.buffer) {
        // Rest of your existing playTrack logic...
        if (options.fadeIn) {
          trackToPlay.fadeIn = {
            duration: options.fadeIn.duration / 1000,
            startVolume: options.fadeIn.startVolume ?? 0,
            targetVolume: options.fadeIn.targetVolume ?? options.volume ?? 1,
          }
        }

        if (options.fadeOut) {
          trackToPlay.fadeOut = {
            duration: options.fadeOut.duration / 1000,
            startVolume: options.fadeOut.startVolume ?? 1,
            targetVolume: options.fadeOut.targetVolume ?? 0,
          }
        }

        const newSource = this.audioContext.createBufferSource()
        newSource.buffer = trackToPlay.buffer
        if (trackToPlay.lowPassFilter) {
          newSource.connect(trackToPlay.lowPassFilter)
        } else {
          newSource.connect(trackToPlay.gainNode)
        }
        newSource.loop = options.loop ?? false

        const startTime = options.startTime ?? trackToPlay.pauseTime ?? 0
        debug(`Starting new source for track ${trackId} at time ${startTime}`)
        newSource.start(0, startTime)

        trackToPlay.source = newSource
        trackToPlay.isPlaying = true
        trackToPlay.active = true
        trackToPlay.startTime = this.audioContext.currentTime - startTime
        trackToPlay.pauseTime = undefined

        const baseVolume = options.volume ?? 1
        const initialVolume = this.calculateFadeVolume(
          trackToPlay,
          startTime,
          baseVolume
        )
        trackToPlay.gainNode.gain.setValueAtTime(
          initialVolume,
          this.audioContext.currentTime
        )

        if (trackToPlay.fadeIn || trackToPlay.fadeOut) {
          this.startProgressMonitoring(trackId, trackToPlay)
        }

        const currentSource = newSource
        newSource.onended = () => {
          if (trackToPlay && trackToPlay.source === currentSource) {
            debug(`Source ended for track ${trackId}`)
            this.stopProgressMonitoring(trackToPlay)
            trackToPlay.isPlaying = false
            trackToPlay.source = null

            // Clear decoded buffer if not keeping it
            if (!trackToPlay.keepDecoded && !trackToPlay.isTemp) {
              this.clearTrackBuffer(trackId)
            }

            this.emitTrackEvent(trackId, "complete")

            if (trackToPlay.isTemp) {
              this.cleanupTrack(trackId)
            }
          }
        }

        debug(["Track after play: ", trackToPlay])
      }
    } else {
      debug(`Track ${name} not found during playTrack`)
      if (this.onTrackNotFound) {
        this.onTrackNotFound(name)
      }
      return name
    }

    return trackId
  }

  private calculateFadeVolume(
    track: AudioTrack,
    currentTime: number,
    baseVolume: number = 1
  ): number {
    if (!track.buffer) return baseVolume

    const trackDuration = track.buffer.duration
    let volume = baseVolume

    // Apply fade-in if applicable
    if (track.fadeIn && currentTime < track.fadeIn.duration) {
      const fadeProgress = currentTime / track.fadeIn.duration
      volume = lerp(
        track.fadeIn.startVolume,
        track.fadeIn.targetVolume,
        this.easeFadeProgress(fadeProgress)
      )
    }

    // Apply fade-out if applicable
    if (track.fadeOut) {
      const fadeOutStartTime = trackDuration - track.fadeOut.duration
      if (currentTime >= fadeOutStartTime) {
        const fadeProgress =
          (currentTime - fadeOutStartTime) / track.fadeOut.duration
        volume = lerp(
          track.fadeOut.startVolume,
          track.fadeOut.targetVolume,
          this.easeFadeProgress(fadeProgress)
        )
      }
    }

    return volume
  }

  private easeFadeProgress(progress: number): number {
    // Using a smooth ease-in-out curve for fades
    return progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2
  }

  private startProgressMonitoring(trackId: string, track: AudioTrack): void {
    // Clear any existing monitoring
    this.stopProgressMonitoring(track)

    track.updateProgressIntervalId = setInterval(() => {
      if (!track.isPlaying || !track.source) {
        this.stopProgressMonitoring(track)
        return
      }

      const currentTime = this.getCurrentTrackTime(track)
      const volume = this.calculateFadeVolume(track, currentTime)

      // Only update if the volume has changed significantly
      const currentVolume = track.gainNode.gain.value
      if (Math.abs(currentVolume - volume) > 0.001) {
        track.gainNode.gain.linearRampToValueAtTime(
          volume,
          this.audioContext.currentTime + this.progressUpdateInterval / 2000
        )
      }

      // Check if we should stop the track after fade-out
      if (track.fadeOut && track.buffer) {
        if (
          currentTime >= track.buffer.duration - 0.05 &&
          track.fadeOut.targetVolume === 0
        ) {
          this.stopTrack(trackId)
        }
      }
    }, this.progressUpdateInterval) as unknown as number
  }

  private stopProgressMonitoring(track: AudioTrack): void {
    if (track.updateProgressIntervalId) {
      clearInterval(track.updateProgressIntervalId)
      track.updateProgressIntervalId = undefined
    }
  }

  private handleTrackNotFound(name: string): void {
    debug(`Track ${name} not found`)
    if (this.onTrackNotFound) {
      this.onTrackNotFound(name)
    }
  }

  private createTrackInstance(
    originalTrack: AudioTrack,
    instanceId: string
  ): AudioTrack {
    const gainNode = this.audioContext.createGain()
    const targetNode = originalTrack.groupId
      ? this.groups.get(originalTrack.groupId)?.gainNode ?? this.masterGainNode
      : this.masterGainNode

    gainNode.connect(targetNode)

    let lowPassFilter = undefined
    if (originalTrack.lowPassFilter) {
      lowPassFilter = this.audioContext.createBiquadFilter()
      lowPassFilter.type = "lowpass"
      lowPassFilter.frequency.value =
        originalTrack.lowPassFilter.frequency.value
      lowPassFilter.Q.value = originalTrack.lowPassFilter.Q.value
      lowPassFilter.connect(gainNode)
    }

    return {
      source: null,
      gainNode,
      buffer: originalTrack.buffer,
      compressedData: originalTrack.compressedData,
      isPlaying: false,
      isPausable: originalTrack.isPausable,
      active: true,
      eventHandlers: new Map(),
      isTemp: true,
      instanceId,
      groupId: originalTrack.groupId,
      isDecoded: originalTrack.isDecoded,
      keepDecoded: false,
    }
  }

  public async preloadTrack(name: string): Promise<void> {
    const track = this.tracks.get(name)
    if (track && !track.isDecoded) {
      await this.ensureTrackDecoded(track)
      debug(`Track ${name} preloaded (decoded)`)
    }
  }

  public clearAllDecodedBuffers(): void {
    let clearedCount = 0
    this.tracks.forEach((track, name) => {
      if (!track.isPlaying && track.buffer && !track.keepDecoded) {
        this.clearTrackBuffer(name)
        clearedCount++
      }
    })
    debug(`Cleared ${clearedCount} decoded buffers to free memory`)
  }

  private stopExistingSource(track: AudioTrack, name: string): void {
    debug(`Stopping existing source for track ${name}`)
    try {
      if (track.source) {
        track.source.onended = null
        track.source.stop()
        track.source.disconnect()
        debug(`Source stopped and disconnected for track ${name}`)
      }
    } catch (e) {
      console.warn(`Error stopping source for track ${name}:`, e)
    }
    track.source = null
    track.isPlaying = false
  }

  public stopTrack(trackId: string, clearBuffer: boolean = false): void {
    debug(
      `stopTrack called for ${trackId}${
        clearBuffer ? " (clearing buffer)" : ""
      }`
    )
    const track = this.tracks.get(trackId)

    if (track) {
      this.stopProgressMonitoring(track)
    }

    if (track && track.source) {
      debug(`Stopping source for track ${trackId}`)
      try {
        track.source.onended = null
        track.source.stop()
        debug(`Source stopped for track ${trackId}`)
      } catch (e) {
        console.warn(`Error stopping source for track ${trackId}:`, e)
      }
      try {
        track.source.disconnect()
        debug(`Source disconnected for track ${trackId}`)
      } catch (e) {
        console.warn(`Error disconnecting source for track ${trackId}:`, e)
      }
      track.source = null
      track.isPlaying = false
      track.active = false
      track.pauseTime = 0

      if (clearBuffer) {
        this.clearTrackBuffer(trackId)
      }

      if (track.isTemp) {
        this.cleanupTrack(trackId)
      }
    } else {
      debug(`No source to stop for track ${trackId}`)
    }
  }

  public pauseTrack(name: string): void {
    debug(`pauseTrack called for ${name}`)
    const track = this.tracks.get(name)
    if (track && track.source && track.isPausable) {
      debug(`Pausing source for track ${name}`)

      const currentTime = this.getCurrentTrackTime(track)
      this.stopProgressMonitoring(track)

      try {
        track.source.onended = null
        track.source.stop()
        debug(`Source stopped for track ${name}`)
      } catch (e) {
        console.warn(`Error stopping source for track ${name}:`, e)
      }
      try {
        track.source.disconnect()
        debug(`Source disconnected for track ${name}`)
      } catch (e) {
        console.warn(`Error disconnecting source for track ${name}:`, e)
      }

      track.pauseTime = currentTime
      debug(`Paused at time ${track.pauseTime} for track ${name}`)
      track.source = null
      track.isPlaying = false
    } else if (track && !track.isPausable) {
      debug(`Track ${name} is not pausable`)
    } else {
      this.handleTrackNotFound(name)
    }
  }

  public clearTrackBuffer(name: string): void {
    const track = this.tracks.get(name)
    if (track && track.buffer && !track.isPlaying) {
      debug(`Clearing decoded buffer for track ${name} to free memory`)
      track.buffer = null
      track.isDecoded = false
    }
  }

  public fadeTrack(name: string, options: FadeOptions): void {
    const track = this.tracks.get(name)
    if (track) {
      const currentTime = this.audioContext.currentTime

      // Cancel any previously scheduled ramps
      track.gainNode.gain.cancelScheduledValues(currentTime)

      // Set the current value at the current time
      track.gainNode.gain.setValueAtTime(track.gainNode.gain.value, currentTime)

      // Schedule the new ramp
      track.gainNode.gain.linearRampToValueAtTime(
        options.targetVolume,
        currentTime + options.duration / 1000
      )

      // Clear any existing timeout for this track
      const existingTimeout = this.fadeTimeouts.get(name)
      if (existingTimeout) {
        clearTimeout(existingTimeout)
      }

      // Set the new timeout
      const timeoutId = setTimeout(() => {
        this.fadeTimeouts.delete(name)
        if (options.stopAtEnd && options.targetVolume === 0) {
          this.stopTrack(name)
        }
        if (options.onComplete) {
          options.onComplete()
        }
      }, options.duration) as unknown as number

      this.fadeTimeouts.set(name, timeoutId)
    } else {
      this.handleTrackNotFound(name)
      if (options.onComplete) {
        options.onComplete()
      }
    }
  }

  public setTrackVolume(name: string, volume: number): void {
    const track = this.tracks.get(name)
    if (track) {
      track.gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime)
    }
  }

  public isTrackPlaying(name: string): boolean {
    const track = this.tracks.get(name)
    return track ? track.isPlaying : false
  }

  public getAllPlayingTracks(): string[] {
    return Array.from(this.tracks.entries())
      .filter(([_, track]) => track.isPlaying)
      .map(([name, _]) => name)
  }

  public async getTrackDuration(name: string): Promise<number> {
    const track = this.tracks.get(name)

    if (!track) {
      this.handleTrackNotFound(name)
      return 0
    }

    // Return stored duration if present
    if (track.duration !== undefined) {
      return track.duration
    }

    // If we have a decoded buffer, get duration from it and store
    if (track.buffer && track.isDecoded) {
      track.duration = track.buffer.duration
      return track.duration
    }

    // Need to decode to get duration
    if (!track.compressedData) {
      debug(`Track ${name} has no audio data available`)
      return 0
    }

    try {
      const wasDecoded = track.isDecoded
      await this.ensureTrackDecoded(track)

      const duration = track.duration!

      // If track wasn't previously decoded and shouldn't keep decoded, clean up
      if (!wasDecoded && !track.keepDecoded && !track.isPlaying) {
        debug(`Cleaning up buffer for ${name} after duration check`)
        this.clearTrackBuffer(name)
      }

      return duration
    } catch (error) {
      console.error(`Failed to get duration for track ${name}:`, error)
      return 0
    }
  }

  public getCurrentTime(): number {
    return this.audioContext.currentTime
  }

  private getCurrentTrackTime(track: AudioTrack): number {
    if (!track.startTime || !track.isPlaying) return 0
    return this.audioContext.currentTime - track.startTime
  }

  public setTrackTime(name: string, time: number): void {
    debug(`setTrackTime called for ${name} to time ${time}`)

    if (time < 0) time = 0.0
    const track = this.tracks.get(name)
    if (track) {
      const wasPlaying = track.isPlaying

      debug(["Track set track start: ", track])

      if (track.source) {
        debug(`Stopping existing source for track ${name}`)
        try {
          track.source.onended = null
          track.source.stop()
          debug(`Source stopped for track ${name}`)
        } catch (e) {
          console.warn(`Error stopping source for track ${name}:`, e)
        }
        try {
          track.source.disconnect()
          debug(`Source disconnected for track ${name}`)
        } catch (e) {
          console.warn(`Error disconnecting source for track ${name}:`, e)
        }
        track.source = null
        track.isPlaying = false
      }

      debug(["Track set track after stop: ", track])

      // Update pauseTime to the new position
      track.pauseTime = time
      debug(`Track ${name} pauseTime set to ${track.pauseTime}`)

      this.stopProgressMonitoring(track)

      // If the track was playing, start playback from the new time
      if (wasPlaying) {
        this.playTrack(name, { startTime: time })
      } else {
        const baseVolume = track.gainNode.gain.value
        const adjustedVolume = this.calculateFadeVolume(track, time, baseVolume)
        track.gainNode.gain.setValueAtTime(
          adjustedVolume,
          this.audioContext.currentTime
        )
      }
    } else {
      this.handleTrackNotFound(name)
    }
  }

  public pauseAllTracks(): void {
    this.tracks.forEach((track, name) => {
      if (track.isPlaying && track.isPausable) {
        this.pauseTrack(name)
      }
    })
  }

  public setTrackPausable(name: string, isPausable: boolean): void {
    const track = this.tracks.get(name)
    if (track) {
      track.isPausable = isPausable
    } else {
      this.handleTrackNotFound(name)
    }
  }

  public togglePlay(name: string): void {
    const track = this.tracks.get(name)
    if (track) {
      if (track.isPlaying) {
        this.pauseTrack(name)
      } else {
        this.playTrack(name, { startTime: track.pauseTime })
      }
    } else {
      this.handleTrackNotFound(name)
    }
  }

  public togglePlayAll(): void {
    this.tracks.forEach((track, name) => {
      if (track.active) {
        this.togglePlay(name)
      }
    })
  }

  public removeTrack(name: string): void {
    const track = this.tracks.get(name)
    if (track) {
      if (track.isPlaying) {
        this.stopTrack(name)
      }
      track.gainNode.disconnect()
      track.eventHandlers.clear()
      this.tracks.delete(name)
    } else {
      this.handleTrackNotFound(name)
    }
  }

  public resetTrack(name: string): void {
    const track = this.tracks.get(name)
    if (track) {
      if (track.isPlaying) {
        this.stopTrack(name)
      }
      // track.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime)
      track.pauseTime = 0
      track.isPlaying = false
    } else {
      this.handleTrackNotFound(name)
    }
  }

  private cleanupTrack(trackId: string): void {
    const track = this.tracks.get(trackId)
    if (track) {
      track.gainNode.disconnect()
      if (track.lowPassFilter) {
        track.lowPassFilter.disconnect()
      }
      track.eventHandlers.clear()
      this.tracks.delete(trackId)
      debug(`Cleaned up temporary track ${trackId}`)
    }
  }

  public createGroup(name: string, initialVolume: number = 1): void {
    if (this.groups.has(name)) {
      debug(`Group ${name} already exists`)
      return
    }

    const gainNode = this.audioContext.createGain()
    gainNode.connect(this.masterGainNode)
    gainNode.gain.value = initialVolume

    this.groups.set(name, {
      name,
      gainNode,
      volume: initialVolume,
    })

    debug(`Created audio group: ${name}`)
  }

  public setMasterVolume(volume: number): void {
    this.masterGainNode.gain.setValueAtTime(
      volume,
      this.audioContext.currentTime
    )
  }

  public getMasterVolume(): number {
    return this.masterGainNode.gain.value
  }

  public setGroupVolume(groupName: string, volume: number): void {
    const group = this.groups.get(groupName)
    if (group) {
      group.volume = volume
      group.gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime)
      debug(`Set ${groupName} group volume to ${volume}`)
    }
  }

  public getGroupVolume(groupName: string): number {
    return this.groups.get(groupName)?.volume ?? 1
  }

  public getTracksInGroup(groupName: string): string[] {
    return Array.from(this.tracks.entries())
      .filter(([_, track]) => track.groupId === groupName)
      .map(([name, _]) => name)
  }

  public setGroupMuted(groupName: string, muted: boolean): void {
    const group = this.groups.get(groupName)
    if (group) {
      const volume = muted ? 0 : group.volume
      group.gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime)
      debug(`${muted ? "Muted" : "Unmuted"} group: ${groupName}`)
    }
  }

  public getGroupGainNode(groupName: string): GainNode | null {
    const group = this.groups.get(groupName)
    return group?.gainNode || null
  }

  public setPitch(name: string, pitchFactor: number): void {
    const track = this.tracks.get(name)
    if (!track) {
      this.handleTrackNotFound(name)
      return
    }

    if (track.source) {
      // Method 1: Using detune (measured in cents, 100 cents = 1 semitone)
      // This maintains better quality than playbackRate
      // Log scale: 2^(detune/1200) = pitch factor
      // So: detune = 1200 * log2(pitchFactor)
      const detuneValue = 1200 * Math.log2(pitchFactor)

      // Make sure the detune property exists and is an AudioParam
      if (track.source.detune) {
        track.source.detune.setValueAtTime(
          detuneValue,
          this.audioContext.currentTime
        )
        debug(
          `Set pitch for track ${name} to ${pitchFactor} (detune: ${detuneValue} cents)`
        )
      } else {
        // Fallback to playbackRate if detune is not available
        // This affects both pitch and speed, but we'll use it as fallback
        track.source.playbackRate.setValueAtTime(
          pitchFactor,
          this.audioContext.currentTime
        )
        debug(
          `Set pitch for track ${name} to ${pitchFactor} (using playbackRate fallback)`
        )
      }
    } else {
      debug(`Cannot set pitch for track ${name}: no active source`)
    }
  }

  public animatePitch(
    name: string,
    targetPitch: number,
    duration: number,
    onComplete?: () => void
  ): void {
    const track = this.tracks.get(name)
    if (!track || !track.source) {
      debug(`Cannot animate pitch for track ${name}: no active source`)
      if (onComplete) onComplete()
      return
    }

    const currentTime = this.audioContext.currentTime

    // Prefer detune if available
    if (track.source.detune) {
      const currentDetune = track.source.detune.value
      const targetDetune = 1200 * Math.log2(targetPitch)

      // Set current value
      track.source.detune.setValueAtTime(currentDetune, currentTime)

      // Linear ramp to target
      track.source.detune.linearRampToValueAtTime(
        targetDetune,
        currentTime + duration / 1000
      )

      debug(
        `Animating pitch for track ${name} to ${targetPitch} (detune: ${targetDetune} cents) over ${duration}ms`
      )
    } else {
      // Fallback to playbackRate
      const currentRate = track.source.playbackRate.value

      // Set current value
      track.source.playbackRate.setValueAtTime(currentRate, currentTime)

      // Linear ramp to target
      track.source.playbackRate.linearRampToValueAtTime(
        targetPitch,
        currentTime + duration / 1000
      )

      debug(
        `Animating pitch for track ${name} to ${targetPitch} (using playbackRate) over ${duration}ms`
      )
    }

    if (onComplete) {
      setTimeout(onComplete, duration)
    }
  }

  public hasLowPassFilter(name: string): boolean {
    const track = this.tracks.get(name)
    if (!track) {
      this.handleTrackNotFound(name)
      return false
    }

    return !!track.lowPassFilter
  }

  public addLowPassFilter(
    name: string,
    initialFrequency?: number,
    Q: number = 1
  ): void {
    const track = this.tracks.get(name)
    if (!track) {
      this.handleTrackNotFound(name)
      return
    }

    if (!track.lowPassFilter) {
      const filter = this.audioContext.createBiquadFilter()
      filter.type = "lowpass"

      const maxFrequency = 20000
      filter.frequency.value =
        initialFrequency !== undefined ? initialFrequency : maxFrequency
      filter.Q.value = Q

      if (track.source) {
        track.source.disconnect()
        track.source.connect(filter)
      }

      filter.connect(track.gainNode)
      track.lowPassFilter = filter

      debug(
        `Added low-pass filter to track ${name} (initial freq: ${filter.frequency.value}Hz, Q: ${Q})`
      )
      return
    }

    // If filter already exists, optionally update settings
    if (initialFrequency !== undefined) {
      this.setLowPassFrequency(name, initialFrequency)
    }
    this.setLowPassQ(name, Q)
  }

  public setLowPassFrequency(name: string, frequency: number): void {
    const track = this.tracks.get(name)
    if (track && track.lowPassFilter) {
      track.lowPassFilter.frequency.setValueAtTime(
        frequency,
        this.audioContext.currentTime
      )
      debug(`Set low-pass frequency to ${frequency} for track ${name}`)
    }
  }

  public setLowPassQ(name: string, Q: number): void {
    const track = this.tracks.get(name)
    if (track && track.lowPassFilter) {
      track.lowPassFilter.Q.setValueAtTime(Q, this.audioContext.currentTime)
      debug(`Set low-pass Q to ${Q} for track ${name}`)
    }
  }

  public removeLowPassFilter(name: string): void {
    const track = this.tracks.get(name)
    if (!track || !track.lowPassFilter) {
      return
    }

    if (track.source) {
      track.source.disconnect()
      track.source.connect(track.gainNode)
    }

    track.lowPassFilter.disconnect()
    track.lowPassFilter = undefined

    debug(`Removed low-pass filter from track ${name}`)
  }

  public animateLowPassFrequency(
    name: string,
    targetFrequency: number,
    duration: number,
    onComplete?: () => void
  ): void {
    const track = this.tracks.get(name)
    if (!track || !track.lowPassFilter) {
      console.warn(`Track ${name} not found or has no low-pass filter`)
      if (onComplete) onComplete()
      return
    }

    const currentTime = this.audioContext.currentTime
    const currentFrequency = track.lowPassFilter.frequency.value

    const safeCurrentFreq = Math.max(currentFrequency, 0.1)
    const safeTargetFreq = Math.max(targetFrequency, 0.1)

    track.lowPassFilter.frequency.setValueAtTime(safeCurrentFreq, currentTime)

    track.lowPassFilter.frequency.exponentialRampToValueAtTime(
      safeTargetFreq,
      currentTime + duration / 1000
    )

    debug(
      `Animating low-pass filter from ${safeCurrentFreq}Hz to ${safeTargetFreq}Hz (exponential) over ${duration}ms for track ${name}`
    )

    if (onComplete) {
      setTimeout(onComplete, duration)
    }
  }

  public getMemoryStats(): {
    totalTracks: number
    decodedTracks: number
    playingTracks: number
    compressedSize: number
  } {
    let decodedTracks = 0
    let playingTracks = 0
    let compressedSize = 0

    this.tracks.forEach((track) => {
      if (track.isDecoded && track.buffer) decodedTracks++
      if (track.isPlaying) playingTracks++
      if (track.compressedData)
        compressedSize += track.compressedData.byteLength
    })

    return {
      totalTracks: this.tracks.size,
      decodedTracks,
      playingTracks,
      compressedSize,
    }
  }

  public cleanup(): void {
    // Clean up tracks
    this.tracks.forEach((track, name) => {
      if (track.isPlaying) {
        this.stopTrack(name)
      }
      track.gainNode.disconnect()
      track.eventHandlers.clear()
    })
    this.tracks.clear()

    // Clean up groups
    this.groups.forEach((group) => {
      group.gainNode.disconnect()
    })
    this.groups.clear()

    debug("Audio manager cleaned up")
  }

  public cleanupInstances(): void {
    const tracksToRemove: string[] = []

    this.tracks.forEach((track, trackId) => {
      if (track.isTemp && !track.isPlaying) {
        tracksToRemove.push(trackId)
      }
    })

    tracksToRemove.forEach((trackId) => {
      this.cleanupTrack(trackId)
    })

    debug(`Cleaned up ${tracksToRemove.length} inactive instance tracks`)
  }
}

export default AudioManager
