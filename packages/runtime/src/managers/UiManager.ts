import { Catalyst, nextTick } from "@vitrine/catalyst"
import { mapRange } from "../utils"
import { Modal } from "./Modal"
import BaseManager from "./BaseManager"
import type { LoadedManifest, Presentation } from "../manifest"

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

export interface ProgressPoi {
  percentage: number
  id?: number
  onHover?: (poi: ProgressPoi, el: HTMLElement) => void
  onBlur?: (poi: ProgressPoi, el: HTMLElement) => void
  onClick?: (poi: ProgressPoi, el: HTMLElement) => void
}

interface PoiInternal {
  config: ProgressPoi
  dotEl: HTMLElement
  percentage: number
}

interface SegmentInternal {
  el: HTMLElement
  fillEl: HTMLElement
  start: number
  end: number
  fillStart: number
}

const POI_LEAD_IN_RANGE = 4
const SEGMENT_DOT_PADDING = 1.5

export default class UiManager extends BaseManager {
  public landingCard!: HTMLElement
  public footerCard!: HTMLElement
  public footerContent!: HTMLElement
  public hud!: HTMLElement
  public fpch!: HTMLElement
  private overlayBlur!: HTMLElement
  /** The elements that show presentation copy, so edits can be applied live. */
  private copy: Partial<Record<string, HTMLElement>> = {}
  public poiDiv!: HTMLElement
  public footerReadStart: number = 1.0
  public footerReadEnd: number = 1.1

  public progressWrapperElement!: HTMLElement
  public progressElement!: HTMLElement

  public progressInner!: HTMLElement
  private progressTrack!: HTMLElement

  private pois: PoiInternal[] = []
  private segments: SegmentInternal[] = []

  private readonly manifest: LoadedManifest

  constructor(manifest: LoadedManifest) {
    super()
    this.manifest = manifest
    this.initialiseUi()
  }

  private initialiseUi(): void {
    this.initialiseLandingCard()
    this.initialiseFirstPersonCrosshair()
    this.initialiseHud()
    this.initialiseFooterCard()
    this.registerListeners()
  }

  private registerListeners(): void {
    nextTick(() => {
      Catalyst._.signals.game.onAudioMuteChange.subscribe(
        (data: { muted: boolean }) => {
          data?.muted
            ? document.body.classList.add("muted")
            : document.body.classList.remove("muted")
        },
      )
    })
  }

  private get presentation(): Presentation {
    return this.manifest.presentation ?? {}
  }

  private initialiseLandingCard(): void {
    const icons = this.presentation.icons ?? {}
    const landing = this.presentation.landing ?? {}

    this.landingCard = document.createElement("div")
    this.landingCard.setAttribute("id", "landing-card")

    // Header

    const header = document.createElement("div")
    header.setAttribute("id", "landing-card-header")
    this.landingCard.appendChild(header)

    const headerInner = document.createElement("div")
    headerInner.setAttribute("id", "landing-card-header-inner")
    header.appendChild(headerInner)

    const headerLeft = document.createElement("div")
    headerLeft.setAttribute("id", "landing-card-header-left")
    headerInner.appendChild(headerLeft)

    const settingButton = document.createElement("img")
    settingButton.setAttribute("id", "landing-card-header-settings")
    settingButton.classList.add("button")
    if (icons.settings) settingButton.setAttribute("src", icons.settings)
    headerLeft.appendChild(settingButton)

    settingButton.addEventListener("pointerup", () => {
      Modal._.openWithTemplate(this.managers.content.pause)
    })

    const soundButton = document.createElement("div")

    soundButton.setAttribute("id", "landing-card-header-toggle-sound")
    soundButton.classList.add("button")

    soundButton.addEventListener("pointerup", () => {
      this.managers.state.toggleMute()
    })

    headerLeft.appendChild(soundButton)

    const soundIconActive = document.createElement("img")
    soundIconActive.classList.add("sound-icon-active")
    if (icons.soundOn) soundIconActive.setAttribute("src", icons.soundOn)
    soundButton.appendChild(soundIconActive)

    const soundIconInactive = document.createElement("img")
    soundIconInactive.classList.add("sound-icon-inactive")
    if (icons.soundOff) soundIconInactive.setAttribute("src", icons.soundOff)
    soundButton.appendChild(soundIconInactive)

    // Content

    const content = document.createElement("div")
    content.setAttribute("id", "landing-card-content")
    this.landingCard.appendChild(content)

    const contentInner = document.createElement("div")
    contentInner.setAttribute("id", "landing-card-content-inner")
    content.appendChild(contentInner)

    if (landing.logo) {
      const logo = document.createElement("img")
      logo.setAttribute("id", "landing-card-beruk-logo")
      logo.setAttribute("src", landing.logo)
      logo.setAttribute("alt", landing.logoAlt ?? "")
      contentInner.appendChild(logo)
    }

    const contentTagline = document.createElement("div")
    contentTagline.setAttribute("id", "landing-card-content-tagline")
    contentTagline.innerText = landing.tagline ?? ""
    this.copy.tagline = contentTagline
    contentInner.appendChild(contentTagline)

    const contentDescription = document.createElement("div")
    contentDescription.setAttribute("id", "landing-card-content-description")
    contentDescription.innerText = landing.description ?? ""
    this.copy.description = contentDescription
    contentInner.appendChild(contentDescription)

    const contentHeadphones = document.createElement("div")
    contentHeadphones.setAttribute("id", "landing-card-content-headphones")
    contentInner.appendChild(contentHeadphones)

    const contentHeadphonesImage = document.createElement("img")
    contentHeadphonesImage.setAttribute(
      "id",
      "landing-card-content-headphones-image",
    )
    if (icons.headphones)
      contentHeadphonesImage.setAttribute("src", icons.headphones)
    contentHeadphonesImage.setAttribute("alt", "headphone icon")
    contentHeadphones.appendChild(contentHeadphonesImage)

    const contentHeadphonesLabel = document.createElement("div")
    contentHeadphonesLabel.setAttribute(
      "id",
      "landing-card-content-headphones-label",
    )
    contentHeadphonesLabel.innerText = landing.headphonesNote ?? ""
    this.copy.headphonesNote = contentHeadphonesLabel
    contentHeadphones.appendChild(contentHeadphonesLabel)

    const progressBarWrapper = document.createElement("div")
    progressBarWrapper.setAttribute("id", "landing-card-content-progress")
    contentInner.appendChild(progressBarWrapper)

    const progressBarWrapperInner = document.createElement("div")
    progressBarWrapperInner.setAttribute(
      "id",
      "landing-card-content-progress-inner",
    )
    progressBarWrapperInner.style.width = "192px"
    progressBarWrapperInner.style.height = "5px"
    progressBarWrapper.appendChild(progressBarWrapperInner)
    this.progressWrapperElement = progressBarWrapperInner

    const progressBarTrack = document.createElement("div")
    progressBarTrack.setAttribute("id", "landing-card-content-progress-track")
    progressBarWrapperInner.appendChild(progressBarTrack)

    const progressBarProgress = document.createElement("div")
    progressBarProgress.setAttribute(
      "id",
      "landing-card-content-progress-progress",
    )

    this.progressElement = progressBarProgress
    progressBarTrack.appendChild(progressBarProgress)

    const scrollContent = document.createElement("div")
    scrollContent.setAttribute("id", "landing-card-scroll-content")
    progressBarWrapper.appendChild(scrollContent)

    const scrollContentLabel = document.createElement("div")
    scrollContentLabel.setAttribute("id", "landing-card-scroll-label")
    scrollContentLabel.innerText = landing.scrollPrompt ?? ""
    this.copy.scrollPrompt = scrollContentLabel
    scrollContent.appendChild(scrollContentLabel)

    const scrollContentImage = document.createElement("img")
    scrollContentImage.setAttribute("id", "landing-card-scroll-arrow")
    if (icons.scrollArrow)
      scrollContentImage.setAttribute("src", icons.scrollArrow)
    scrollContentImage.setAttribute("alt", "down arrow")
    scrollContentImage.classList.add("animation-scroll")
    scrollContent.appendChild(scrollContentImage)

    // Footer

    const footer = document.createElement("div")
    footer.setAttribute("id", "landing-card-footer")
    this.landingCard.appendChild(footer)

    const footerLeft = this.logoBlock("landing-card-header")
    footer.appendChild(footerLeft)

    Catalyst._.ui?.canvas.appendChild(this.landingCard)
  }

  private logoBlock(name: string): HTMLElement {
    const logoBlock = document.createElement("div")
    logoBlock.setAttribute("id", `${name}-right`)
    logoBlock.classList.add("logo-block")

    this.presentation.logos?.forEach((logo) => {
      const img = document.createElement("img")
      img.setAttribute("id", `${name}-${logo.id}-logo`)
      if (logo.class) img.classList.add(logo.class)
      img.setAttribute("src", logo.src)
      if (logo.alt) img.setAttribute("alt", logo.alt)

      if (logo.href) {
        const link = document.createElement("a")
        link.setAttribute("id", `${name}-${logo.id}`)
        link.setAttribute("href", logo.href)
        link.setAttribute("target", "_blank")
        link.appendChild(img)
        logoBlock.appendChild(link)
      } else {
        logoBlock.appendChild(img)
      }
    })

    return logoBlock
  }

  private initialiseFooterCard(): void {
    const footerCopy = this.presentation.footer ?? {}

    this.footerCard = document.createElement("div")
    this.footerCard.setAttribute("id", "footer-card")

    // Overlay

    const overlayBlur = document.createElement("div")
    overlayBlur.setAttribute("id", "footer-card-overlay-blur")
    Catalyst._.ui?.canvas.appendChild(overlayBlur)
    this.overlayBlur = overlayBlur

    const overlay = document.createElement("div")
    overlay.setAttribute("id", "footer-card-overlay")
    this.footerCard.appendChild(overlay)

    // body

    const body = document.createElement("div")
    body.setAttribute("id", "footer-card-body")
    this.footerCard.appendChild(body)

    // Content

    const content = document.createElement("div")
    content.setAttribute("id", "footer-card-content")
    body.appendChild(content)

    this.footerContent = document.createElement("div")
    this.footerContent.setAttribute("id", "footer-card-content-inner")
    content.appendChild(this.footerContent)

    const copy = document.createElement("div")
    copy.setAttribute("id", "footer-card-content-copy")
    this.footerContent.appendChild(copy)

    const copyInner = document.createElement("div")
    copyInner.setAttribute("id", "footer-card-content-copy-inner")
    copy.appendChild(copyInner)

    const title = document.createElement("div")
    title.classList.add("heading")
    title.innerText = footerCopy.title ?? ""
    this.copy.footerTitle = title
    copyInner.appendChild(title)

    const description = document.createElement("div")
    description.classList.add("copy")
    description.innerText = footerCopy.copy ?? ""
    this.copy.footerCopy = description

    copyInner.appendChild(description)

    const creditsTitle = document.createElement("div")
    creditsTitle.classList.add("heading")
    creditsTitle.innerText = footerCopy.creditsTitle ?? ""
    this.copy.creditsTitle = creditsTitle
    copyInner.appendChild(creditsTitle)

    const creditsCopy = document.createElement("div")
    creditsCopy.classList.add("copy")
    creditsCopy.innerHTML = (footerCopy.credits ?? [])
      .map((line) => escapeHtml(line))
      .join("<br/>")
    this.copy.credits = creditsCopy

    copyInner.appendChild(creditsCopy)

    const logoContainer = document.createElement("div")
    logoContainer.classList.add("logo-container")

    copy.appendChild(logoContainer)

    const logoSrc = footerCopy.logo ?? this.presentation.landing?.logo
    if (logoSrc) {
      const logoImg = document.createElement("img")
      logoImg.setAttribute("id", "footer-card-beruk-logo")
      logoImg.setAttribute("src", logoSrc)
      logoImg.setAttribute(
        "alt",
        footerCopy.logoAlt ?? this.presentation.landing?.logoAlt ?? "",
      )
      logoContainer.appendChild(logoImg)
    }

    const restartExperienceButton = document.createElement("div")
    restartExperienceButton.setAttribute("id", "footer-card-restart")
    restartExperienceButton.innerText =
      footerCopy.restartLabel ?? "Restart experience"
    this.copy.restartLabel = restartExperienceButton

    restartExperienceButton.addEventListener("pointerup", () => {
      this.managers.scene.restart()
    })

    logoContainer.appendChild(restartExperienceButton)

    // Footer

    const footer = document.createElement("div")
    footer.setAttribute("id", "footer-card-footer")
    copy.appendChild(footer)

    const footerInner = document.createElement("div")
    footerInner.setAttribute("id", "footer-card-footer-inner")
    footer.appendChild(footerInner)

    const footerRight = this.logoBlock("footer-card-footer")
    footerInner.appendChild(footerRight)

    Catalyst._.ui?.canvas.appendChild(this.footerCard)
  }

  private initialiseHud(): void {
    this.hud = document.createElement("div")
    this.hud.setAttribute("id", "hud")

    const header = this.initialiseHudHeader()
    this.hud.appendChild(header)

    const footer = this.initialiseHudFooter()
    this.hud.appendChild(footer)

    const progress = this.initialiseHudProgress([
      {
        percentage: 0.0,
        id: 0,
        onClick: () => this.managers.scene.restart(),
      },

      { percentage: 100.0, id: 10 },
    ])
    this.hud.appendChild(progress)

    Catalyst._.ui?.canvas.appendChild(this.hud)
  }

  private initialiseHudHeader(): HTMLElement {
    const header = document.createElement("div")
    header.setAttribute("id", "hud-header")

    const headerActions = document.createElement("div")
    headerActions.setAttribute("id", "hud-header-actions")
    header.appendChild(headerActions)

    const menuButton = document.createElement("div")
    menuButton.setAttribute("id", "hud-header-menu-btn")
    menuButton.classList.add("key")
    headerActions.appendChild(menuButton)

    menuButton.addEventListener("pointerup", () => {
      Modal._.openWithTemplate(this.managers.content.pause)
    })

    const menuButtonKey = document.createElement("div")
    menuButtonKey.classList.add("key-button")
    menuButtonKey.innerText = "menu"
    menuButton.appendChild(menuButtonKey)

    const menuButtonLabel = document.createElement("div")
    menuButtonLabel.classList.add("key-label", "fp-mode")
    menuButtonLabel.innerText = "menu"
    menuButton.appendChild(menuButtonLabel)

    header.appendChild(headerActions)

    nextTick(() => {
      Catalyst._.signals.game.onFPCameraActivated.subscribe(() => {
        if (!menuButtonKey) return
        menuButtonKey.innerText = "esc"
      })

      Catalyst._.signals.game.onGuidedActivated.subscribe(() => {
        if (!menuButtonKey) return
        menuButtonKey.innerText = "Menu"
      })
    })

    // onFPCameraActivated: new Signal<void>(),
    // onGuidedActivated: new Signal<void>(),

    return header
  }

  private initialiseHudFooter(): HTMLElement {
    const footer = document.createElement("div")
    footer.setAttribute("id", "hud-footer")

    const footerOverlay = document.createElement("div")
    footerOverlay.setAttribute("id", "hud-footer-overlay")
    footer.appendChild(footerOverlay)

    const footerMessage = document.createElement("div")
    footerMessage.setAttribute("id", "hud-footer-message")
    footer.appendChild(footerMessage)

    const footerMessageCopy = document.createElement("div")
    footerMessageCopy.setAttribute("id", "hud-footer-message-copy")
    footerMessageCopy.innerText = this.presentation.hud?.moveHint ?? ""
    this.copy.moveHint = footerMessageCopy
    footerMessage.appendChild(footerMessageCopy)

    footer.appendChild(footerMessage)

    return footer
  }

  private initialiseHudProgress(pois: ProgressPoi[] = []): HTMLElement {
    const progress = document.createElement("div")
    progress.setAttribute("id", "hud-footer-progress")

    this.progressTrack = document.createElement("div")
    this.progressTrack.setAttribute("id", "hud-footer-progress-track")
    progress.appendChild(this.progressTrack)

    this.progressInner = document.createElement("div")
    this.progressInner.setAttribute("id", "hud-footer-progress-inner")

    this.buildSegmentsAndDots(pois)

    return progress
  }

  private buildSegmentsAndDots(pois: ProgressPoi[]): void {
    this.progressTrack.innerHTML = ""
    this.pois = []
    this.segments = []

    const sorted = [...pois].sort((a, b) => a.percentage - b.percentage)

    const hasStartDot = sorted.length > 0 && sorted[0].percentage <= 0
    const hasEndDot =
      sorted.length > 0 && sorted[sorted.length - 1].percentage >= 100

    const anchors: number[] = [
      ...(hasStartDot ? [] : [0]),
      ...sorted.map((p) => p.percentage),
      ...(hasEndDot ? [] : [100]),
    ]

    for (let i = 0; i < anchors.length - 1; i++) {
      const rawStart = anchors[i]
      const rawEnd = anchors[i + 1]

      const startAbutsDot = rawStart > 0 || hasStartDot
      const endAbutsDot = rawEnd < 100 || hasEndDot

      const start = startAbutsDot ? rawStart + SEGMENT_DOT_PADDING : rawStart
      const end = endAbutsDot ? rawEnd - SEGMENT_DOT_PADDING : rawEnd

      if (end <= start) continue

      const segEl = this.createSegmentEl(start, end - start)
      this.progressTrack.appendChild(segEl)

      this.segments.push({
        el: segEl,
        fillEl: segEl.querySelector(".hud-footer-progress-segment-fill")!,
        start,
        end,
        fillStart: this.segments.length === 0 ? 0 : start,
      })
    }

    // Dots
    for (let i = 0; i < sorted.length; i++) {
      const config = sorted[i]
      const dotEl = this.createDotEl(config)

      if (i === 0) {
        dotEl.style.setProperty("--poi-t", "1")
        dotEl.style.setProperty("--poi-reached", "1")
        dotEl.style.setProperty("--poi-passed", "1")
        dotEl.classList.add("reached", "passed")
      }

      this.progressTrack.appendChild(dotEl)
      this.pois.push({ config, dotEl, percentage: config.percentage })
    }
  }

  private easeLeadIn(t: number): number {
    // Clamp
    if (t <= 0) return 0
    if (t >= 1) return 1
    const eased = t * t * (3 - 2 * t)

    return eased < 0.85 ? eased * (0.95 / 0.85) : 0.95 + (eased - 0.85) * 0.33
  }

  public updateProgress(progress: number): void {
    for (const seg of this.segments) {
      const span = seg.end - seg.fillStart
      if (span <= 0) continue
      let pct: number
      if (progress <= seg.fillStart) pct = 0
      else if (progress >= seg.end) pct = 100
      else pct = ((progress - seg.fillStart) / span) * 100
      seg.fillEl.style.height = `${pct}%`
    }

    for (let i = 0; i < this.pois.length; i++) {
      const poi = this.pois[i]

      if (i === 0) continue

      const distance = poi.percentage - progress
      let t: number
      if (distance <= 0) {
        t = 1
      } else if (distance >= POI_LEAD_IN_RANGE) {
        t = 0
      } else {
        t = 1 - distance / POI_LEAD_IN_RANGE
      }

      const eased = this.easeLeadIn(t)
      poi.dotEl.style.setProperty("--poi-t", eased.toFixed(4))

      const passed = progress >= poi.percentage ? 1 : 0
      const prevPassed = poi.dotEl.style.getPropertyValue("--poi-passed")
      if (prevPassed !== String(passed)) {
        poi.dotEl.style.setProperty("--poi-passed", String(passed))
        poi.dotEl.classList.toggle("passed", passed === 1)
      }

      if (passed === 1 && !poi.dotEl.classList.contains("reached")) {
        poi.dotEl.style.setProperty("--poi-reached", "1")
        poi.dotEl.classList.add("reached")
      }
    }
  }

  public setProgressPois(pois: ProgressPoi[]): void {
    this.buildSegmentsAndDots(pois)
  }

  public addProgressPoi(poi: ProgressPoi): void {
    if (this.pois.some((p) => p.percentage === poi.percentage)) return

    const hostIdx = this.segments.findIndex(
      (s) => poi.percentage >= s.start && poi.percentage <= s.end,
    )

    if (hostIdx === -1) {
      const merged = [...this.pois.map((p) => p.config), poi]
      this.buildSegmentsAndDots(merged)
      return
    }

    const host = this.segments[hostIdx]

    const upperStart = host.start
    const upperEnd = poi.percentage - SEGMENT_DOT_PADDING
    const lowerStart = poi.percentage + SEGMENT_DOT_PADDING
    const lowerEnd = host.end

    const upperPreHeight = poi.percentage - upperStart
    const lowerPreTop = poi.percentage
    const lowerPreHeight = lowerEnd - poi.percentage

    const upperEl = this.createSegmentEl(upperStart, upperPreHeight)
    upperEl.classList.add("split-top")

    const lowerEl = this.createSegmentEl(lowerPreTop, lowerPreHeight)
    lowerEl.classList.add("split-bottom")

    host.el.replaceWith(upperEl)
    this.progressTrack.appendChild(lowerEl)

    void upperEl.offsetHeight
    void lowerEl.offsetHeight

    upperEl.style.top = `${upperStart}%`
    upperEl.style.height = `${upperEnd - upperStart}%`
    upperEl.classList.remove("split-top")

    lowerEl.style.top = `${lowerStart}%`
    lowerEl.style.height = `${lowerEnd - lowerStart}%`
    lowerEl.classList.remove("split-bottom")

    const upperSeg: SegmentInternal = {
      el: upperEl,
      fillEl: upperEl.querySelector(".hud-footer-progress-segment-fill")!,
      start: upperStart,
      end: upperEnd,
      fillStart: host.fillStart,
    }
    const lowerSeg: SegmentInternal = {
      el: lowerEl,
      fillEl: lowerEl.querySelector(".hud-footer-progress-segment-fill")!,
      start: lowerStart,
      end: lowerEnd,
      fillStart: lowerStart,
    }
    this.segments.splice(hostIdx, 1, upperSeg, lowerSeg)

    const dotEl = this.createDotEl(poi)
    dotEl.classList.add("entering")
    this.progressTrack.appendChild(dotEl)

    const insertIdx = this.pois.findIndex((p) => p.percentage > poi.percentage)
    const internal: PoiInternal = {
      config: poi,
      dotEl,
      percentage: poi.percentage,
    }
    if (insertIdx === -1) this.pois.push(internal)
    else this.pois.splice(insertIdx, 0, internal)

    dotEl.addEventListener(
      "animationend",
      () => dotEl.classList.remove("entering"),
      { once: true },
    )
  }

  private createSegmentEl(topPct: number, heightPct: number): HTMLElement {
    const segEl = document.createElement("div")
    segEl.classList.add("hud-footer-progress-segment")
    segEl.style.position = "absolute"
    segEl.style.top = `${topPct}%`
    segEl.style.height = `${heightPct}%`

    const fillEl = document.createElement("div")
    fillEl.classList.add("hud-footer-progress-segment-fill")
    fillEl.style.height = "0%"
    segEl.appendChild(fillEl)

    return segEl
  }

  private createDotEl(config: ProgressPoi): HTMLElement {
    const dotEl = document.createElement("div")
    dotEl.classList.add("hud-footer-progress-dot")
    dotEl.style.position = "absolute"
    dotEl.style.top = `${config.percentage}%`
    dotEl.style.setProperty("--poi-t", "0")
    dotEl.style.setProperty("--poi-reached", "0")
    dotEl.style.setProperty("--poi-passed", "0")

    if (config.onHover) {
      dotEl.addEventListener("pointerenter", () =>
        config.onHover!(config, dotEl),
      )
    }
    if (config.onBlur) {
      dotEl.addEventListener("pointerleave", () =>
        config.onBlur!(config, dotEl),
      )
    }
    if (config.onClick) {
      dotEl.addEventListener("pointerup", () => config.onClick!(config, dotEl))
    }

    return dotEl
  }

  private initialiseFirstPersonCrosshair(): void {
    this.fpch = document.createElement("div")
    this.fpch.classList.add("fp-mode")
    const fpchdot = document.createElement("div")

    this.fpch.setAttribute("id", "fpch")
    fpchdot.setAttribute("id", "fpch-dot")

    this.fpch.appendChild(fpchdot)

    const fpchlabel = document.createElement("div")
    fpchlabel.setAttribute("id", "fpch-label")

    fpchlabel.innerHTML = "View"

    this.fpch.appendChild(fpchlabel)

    Catalyst._.ui?.canvas.appendChild(this.fpch)
  }

  public setInteractionLabel(label: string): void {
    const fpchlabel = document.getElementById("fpch-label")
    if (!fpchlabel) return

    fpchlabel.innerHTML = label
  }

  public activateCrosshair(): void {
    this.fpch.classList.add("active")
  }

  public deactivateCrosshair(): void {
    this.fpch.classList.remove("active")
  }

  public enableGuidedMode(): void {
    document.body.classList.add("guided-mode")
    document.body.classList.remove("interactive-mode")
  }

  public disableGuidedMode(): void {
    document.body.classList.remove("guided-mode")
    document.body.classList.add("interactive-mode")
  }

  public showHeader(): void {
    document.body.classList.add("header-visible")
  }

  public hideHeader(): void {
    document.body.classList.remove("header-visible")
  }

  public showMessage(): void {
    document.body.classList.add("message-visible")
  }

  public hideMessage(): void {
    document.body.classList.remove("message-visible")
  }

  public updateLandingCardOffset(offset: number) {
    this.landingCard.style.top = `-${offset}vh`
  }

  public updateFooterCardOffset(offset: number) {
    this.footerCard.style.top = `${offset}%`
  }

  public updateLoadingProgress(percentage: number) {
    if (!this.progressElement) return

    this.progressElement.style.width = `${percentage}%`
  }

  public completeLoading() {
    if (!this.landingCard) return

    this.landingCard.classList.add("complete")
  }

  public updateFooterCopyOffset(pathProgress: number) {
    const scrollablePx = this.footerContent.scrollHeight - window.innerHeight
    const offset = mapRange(
      pathProgress,
      this.footerReadStart,
      this.footerReadEnd,
      0,
      -scrollablePx,
      true,
    )
    this.footerContent.style.translate = `0 ${offset}px`
  }

  public calculateFooterEnd(): number {
    const scrollableHeight =
      this.footerContent.scrollHeight - window.innerHeight
    this.footerReadEnd =
      this.footerReadStart + scrollableHeight * (this.presentation.footer?.scrollFeel ?? 0)
    return this.footerReadEnd
  }

  /** Re-apply the presentation strings to the live UI (tooling edits copy in place). */
  public applyPresentation(presentation: Presentation): void {
    const set = (key: string, text: string | undefined) => {
      const el = this.copy[key]
      if (el) el.innerText = text ?? ""
    }
    set("tagline", presentation.landing?.tagline)
    set("description", presentation.landing?.description)
    set("headphonesNote", presentation.landing?.headphonesNote)
    set("scrollPrompt", presentation.landing?.scrollPrompt)
    set("footerTitle", presentation.footer?.title)
    set("footerCopy", presentation.footer?.copy)
    set("creditsTitle", presentation.footer?.creditsTitle)
    set("restartLabel", presentation.footer?.restartLabel ?? "Restart experience")
    set("moveHint", presentation.hud?.moveHint)
    if (this.copy.credits) {
      this.copy.credits.innerHTML = (presentation.footer?.credits ?? [])
        .map((line) => escapeHtml(line))
        .join("<br/>")
    }
    this.calculateFooterEnd()
  }

  public dispose(): void {
    ;[
      this.landingCard,
      this.footerCard,
      this.overlayBlur,
      this.hud,
      this.fpch,
    ].forEach((el) => el?.remove())
    document.body.classList.remove(
      "guided-mode",
      "header-visible",
      "message-visible",
      "muted"
    )
    document.body.classList.add("interactive-mode")
    document.body.style.removeProperty("--fc-blur")
  }

  public playUISound(soundType: string): void {
    switch (soundType) {
      case "click":
        this.managers.audio.playTrack(this.presentation.sounds?.click ?? "ui-click", {
          createInstance: true,
        })
        break
      case "clack":
        this.managers.audio.playTrack(this.presentation.sounds?.clack ?? "ui-clack", {
          createInstance: true,
        })
        break
    }
  }
}
