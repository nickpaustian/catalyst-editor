import { Signal } from "../signals"

interface GetNodesByTagOptions {
  matchMode?: "all" | "any"
}

/**
 * Node - Base class for the hierarchical node system.
 */
export class Node {
  protected _parent: Node | null = null
  public children: Map<string, Node> = new Map()
  public childCounters: Map<string, number> = new Map()
  protected _name: string
  private _tags: Set<string> = new Set()

  protected _root: Node | null = null
  private rootSubscriptionCleanup: (() => void) | null = null
  private cleanups: (() => void)[] = []
  private _disposed: boolean = false

  // Signals
  protected _signals: Record<string, Signal<any>> = {
    onAttached: new Signal<{ parent: Node }>(),
    onDetached: new Signal<{ parent: Node }>(),
    onChildAdded: new Signal<{ child: Node }>(),
    onChildRemoved: new Signal<{ child: Node }>(),
    onWorldTransformChanged: new Signal<{}>(),
  }

  constructor(name: string = this.constructor.name) {
    this._name = name
  }

  public get signals(): Record<string, Signal<any>> {
    return this._signals
  }

  public get root(): Node {
    if (!this._root) {
      this._root = this.findRoot()
    }
    return this._root
  }

  private findRoot(): Node {
    let root: Node = this
    while (root.parent) {
      root = root.parent
    }
    return root
  }

  /**
   * Add a child node.
   * @param node Node to add
   * @param customName Optional custom name for this node. If not provided, uses auto-naming.
   * @returns The added node
   */
  public addNode<T extends Node>(node: T, customName?: string): T {
    let key: string

    if (customName) {
      key = customName
    } else {
      // Use the node's own name property
      const nodeName = node.name

      // Check if this name already exists
      const count = this.childCounters.get(nodeName) ?? 0
      key = count === 0 ? nodeName : `${nodeName}${count + 1}`
      this.childCounters.set(nodeName, count + 1)
    }

    this.children.set(key, node)
    node.setParent(this)
    node.onAttach?.()

    return node
  }

  /**
   * Remove a child node by key.
   */
  public removeNode(key: string): boolean {
    const node = this.children.get(key)
    if (node) {
      node.onDetach?.()
      node.setParent(null)
      this.children.delete(key)
      return true
    }
    return false
  }

  public getNode<T extends Node>(key: string): T | undefined {
    return this.children.get(key) as T | undefined
  }

  public getChildren(): Node[] {
    return Array.from(this.children.values())
  }

  /** This node and every descendant, depth first. */
  public walk(): Node[] {
    return [this, ...this.getChildren().flatMap((child) => child.walk())]
  }

  public getChildrenOfType<T extends Node>(
    type: new (...args: any[]) => T
  ): T[] {
    return this.getChildren().filter((child) => child instanceof type) as T[]
  }

  /**
   * Set the parent of this node (internal use).
   */
  protected setParent(parent: Node | null): void {
    const hadParent = this._parent !== null
    this._parent = parent

    if (parent) {
      // Attaching to a parent
      this.signals.onAttached.emit({ parent })
      this.onAttach?.()
    } else if (hadParent) {
      // Detaching from parent
      this.signals.onDetached.emit({ parent: this._parent! })
      this.onDetach?.()
    }
    // Notify all children that hierarchy changed
    this.broadcastHierarchyChanged()
  }

  /**
   * Get the parent node.
   */
  public get parent(): Node | null {
    return this._parent
  }

  /**
   * Get the node name.
   */
  public get name(): string {
    return this._name
  }

  /**
   * Rename the node, re-keying it in its parent so `getNode(newName)` finds it.
   * Returns false when a sibling already has that name.
   */
  public rename(name: string): boolean {
    if (!name || name === this._name) return name === this._name
    const parent = this._parent
    if (parent) {
      if (parent.children.has(name)) return false
      let currentKey: string | null = null
      parent.children.forEach((child, key) => {
        if (child === this) currentKey = key
      })
      if (currentKey !== null) parent.children.delete(currentKey)
      parent.children.set(name, this)
    }
    this._name = name
    return true
  }

  /**
   * Create a Proxy for magic property access to child nodes.
   */

  public get direct(): Node {
    return this.createProxy()
  }

  public get _(): Node {
    return this.createProxy()
  }

  protected createProxy<T extends Node>(this: T): T {
    return new Proxy(this, {
      get: (target: any, prop: string | symbol) => {
        // Handle symbol properties
        if (typeof prop === "symbol") {
          return target[prop]
        }

        // ALWAYS allow access to core properties
        if (
          prop === "children" ||
          prop === "childCounters" ||
          prop === "parent" ||
          prop === "name"
        ) {
          return target[prop]
        }

        // Check if it's an actual property or method on the node
        if (prop in target) {
          return target[prop]
        }

        // Check if it's a method
        if (typeof target[prop] === "function") {
          return target[prop]
        }

        // Fall back to child node lookup
        return target.getNode(prop)
      },
    }) as T
  }

  /**
   * Notify all children that hierarchy changed.
   */
  private broadcastHierarchyChanged(): void {
    // Check our own root
    this.updateRootSubscription()

    // Tell all children to check theirs
    this.children.forEach((child) => {
      child.broadcastHierarchyChanged()
    })
  }

  protected updateRootSubscription(): void {
    const newRoot = this.findRoot()

    // Only update if root actually changed
    if (this._root !== newRoot) {
      this._root = newRoot

      // Unsubscribe from old root
      if (this.rootSubscriptionCleanup) {
        this.rootSubscriptionCleanup()
      }

      // Subscribe to new root
      this.rootSubscriptionCleanup =
        newRoot.signals.onWorldTransformChanged.subscribe(() =>
          this.onWorldTransformChanged()
        )
    }
  }

  /**
   * Lifecycle hook - called when node is attached to parent.
   */
  public onAttach?(): void

  /**
   * Lifecycle hook - called when node is detached from parent.
   */
  public onDetach?(): void

  /**
   * Lifecycle hook - called each frame for updates.
   * @param deltaTime Time since last frame in milliseconds
   */
  public onUpdate?(deltaTime: number): void

  /**
   * Lifecycle hook - called before rendering.
   */
  public onRender?(deltaTime: number): void

  /**
   * Override in subclasses to handle transform dirty notifications.
   */
  protected onWorldTransformChanged(): void {}

  /**
   * Register a cleanup (typically a signal unsubscribe) to run on dispose.
   */
  protected track(cleanup: () => void): void {
    this.cleanups.push(cleanup)
  }

  public get isDisposed(): boolean {
    return this._disposed
  }

  /**
   * Override in subclasses to release scene objects, DOM and physics state.
   * Children are disposed before this runs.
   */
  protected onDispose(): void {}

  /**
   * Dispose this node and its whole subtree: children first, then tracked
   * cleanups, then onDispose, then detach from the parent.
   */
  public dispose(): void {
    if (this._disposed) return
    this._disposed = true

    Array.from(this.children.values()).forEach((child) => child.dispose())
    this.children.clear()
    this.childCounters.clear()

    this.cleanups.forEach((cleanup) => cleanup())
    this.cleanups = []

    this.rootSubscriptionCleanup?.()
    this.rootSubscriptionCleanup = null

    this.onDispose()

    if (this._parent) {
      const parent = this._parent
      parent.children.forEach((child, key) => {
        if (child === this) parent.children.delete(key)
      })
      this._parent = null
    }
  }

  //=========================
  // Tags
  //=========================

  /**
   * Add one or more tags to this node.
   */
  public addTag(tags: string | string[]): void {
    const tagArray = Array.isArray(tags) ? tags : [tags]
    tagArray.forEach((tag) => this._tags.add(tag))
  }

  /**
   * Remove one or more tags from this node.
   */
  public removeTag(tags: string | string[]): void {
    const tagArray = Array.isArray(tags) ? tags : [tags]
    tagArray.forEach((tag) => this._tags.delete(tag))
  }

  /**
   * Check if node has tag(s).
   * If array is passed, checks that ALL tags are present (&&).
   */
  public hasTag(tags: string | string[]): boolean {
    if (typeof tags === "string") {
      return this._tags.has(tags)
    }
    // Array: check all tags are present
    return tags.every((tag) => this._tags.has(tag))
  }

  /**
   * Get all tags on this node.
   */
  public get tags(): string[] {
    return Array.from(this._tags)
  }

  /**
   * Clear all tags.
   */
  public clearTags(): void {
    this._tags.clear()
  }

  /**
   * Get all descendant nodes with the specified tag(s).
   * @param tags Single tag or array of tags
   * @param options Configuration for tag matching
   * @returns Array of nodes matching the specified tags
   */
  public getNodesByTag(
    tags: string | string[],
    options: GetNodesByTagOptions = { matchMode: "all" }
  ): Node[] {
    const tagArray = Array.isArray(tags) ? tags : [tags]
    const results: Node[] = []
    const matchMode = options.matchMode ?? "all"

    // Check self
    const matches =
      matchMode === "all"
        ? this.hasTag(tagArray) // ALL tags must be present
        : tagArray.some((tag) => this.hasTag(tag)) // ANY tag present

    if (matches) {
      results.push(this)
    }

    // Recursively check all children
    this.children.forEach((child) => {
      results.push(...child.getNodesByTag(tags, options))
    })

    return results
  }
}
