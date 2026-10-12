/**
 * LoadQueueManager handles the queuing, processing and cleanup of asset load groups.
 * It manages prioritised loading of asset groups with progress tracking.
 *
 * Features:
 * - Priority-based queue management (higher numbers = higher priority)
 * - Parallel group loading
 * - Progress tracking per group and overall
 * - Resource cleanup for completed groups
 */
import LoadGroup, { type LoadGroupConfig, type LoadProgress } from "./LoadGroup"
import { debug } from "@vitrine/debug"

export default class LoadQueueManager {
  // CORE PROPERTIES
  private readonly queue: LoadGroup[] = []
  private readonly completedGroups: Map<string, LoadGroup> = new Map()
  private loading: boolean = false

  constructor() {}

  //===============================
  //     QUEUE MANAGEMENT
  //===============================

  /**
   * Adds a new load group to the queue and immediately starts processing
   * Note: Groups are processed in order of priority (higher numbers processed first)
   */
  public addGroup: (config: LoadGroupConfig) => void = (config) => {
    const group = new LoadGroup(config)
    this.queue.push(group)
    this.queue.sort((a, b) => b.getPriority() - a.getPriority())
    this.processQueue()
  }

  /**
   * Recursively processes groups in the queue until empty
   */
  private processQueue: () => Promise<void> = async () => {
    if (this.loading || this.queue.length === 0) return
    this.loading = true
    const group = this.queue.shift()
    if (group) {
      try {
        await group.load()
        this.completedGroups.set(group.getName(), group)
      } catch (error) {
        console.error(`Error loading group ${group.getName()}:`, error)
      }
    }
    this.loading = false
    this.processQueue()
  }

  //===============================
  //     PROGRESS TRACKING
  //===============================

  /**
   * Retrieves progress for a specific group in the queue
   * Note: Returns undefined if group is not found
   */
  public getGroupProgress: (groupName: string) => LoadProgress | undefined = (
    groupName
  ) => {
    const group = this.queue.find((g) => g.getName() === groupName)
    return group?.getProgress()
  }

  /**
   * Creates a progress snapshot for all groups currently in the queue
   */
  public getAllProgress: () => { [groupName: string]: LoadProgress } = () => {
    const progress: { [groupName: string]: LoadProgress } = {}
    this.queue.forEach((group) => {
      progress[group.getName()] = group.getProgress()
    })
    return progress
  }

  //===============================
  //     RESOURCE MANAGEMENT
  //===============================

  /**
   * Releases resources for a completed group and removes it from tracking
   */
  public cleanupGroup: (
    groupName: string,
    retryCount?: number,
    delay?: number
  ) => void = (groupName, retryCount = 3, delay = 5000) => {
    const group = this.completedGroups.get(groupName)

    if (!group) {
      if (retryCount > 0) {
        debug(
          `Group "${groupName}" not found in completedGroups. Retrying... (${retryCount} attempts remaining)`,
          "warning"
        )
        setTimeout(
          () => this.cleanupGroup(groupName, retryCount - 1, delay),
          100
        )
      } else {
        debug(
          `Failed to cleanup group "${groupName}" after maximum retries.`,
          "warning"
        )
      }
      return
    }

    group.cleanup(delay)
    this.completedGroups.delete(groupName)
  }

  /**
   * Performs cleanup on all completed groups and clears the completion registry
   */
  public cleanupAllGroups: (delay?: number) => void = (delay = 5000) => {
    this.completedGroups.forEach((group) => {
      group.cleanup(delay)
    })
    this.completedGroups.clear()
  }
}
