import { Node } from "../nodes"

export class NodeRegistry {
  private nodesByTag: Map<string, Set<Node>> = new Map()
  private allNodes: Set<Node> = new Set()

  /**
   * Register a node.
   */
  public registerNode(node: Node): void {
    this.allNodes.add(node)
    // Register by all current tags
    node.tags.forEach((tag) => {
      if (!this.nodesByTag.has(tag)) {
        this.nodesByTag.set(tag, new Set())
      }
      this.nodesByTag.get(tag)!.add(node)
    })
  }

  /**
   * Unregister a node.
   */
  public unregisterNode(node: Node): void {
    this.allNodes.delete(node)
    // Remove from all tags
    this.nodesByTag.forEach((nodes) => nodes.delete(node))
  }

  /**
   * Get all nodes with a tag (or tags).
   */
  public getNodesByTag(tags: string | string[]): Node[] {
    const tagArray = Array.isArray(tags) ? tags : [tags]

    if (tagArray.length === 1) {
      // Single tag: return all nodes with that tag
      return Array.from(this.nodesByTag.get(tagArray[0]) ?? new Set())
    }

    // Multiple tags: return nodes that have ALL tags
    return Array.from(this.allNodes).filter((node) =>
      tagArray.every((tag) => node.hasTag(tag))
    )
  }

  /**
   * Get all registered nodes.
   */
  public getAllNodes(): Node[] {
    return Array.from(this.allNodes)
  }

  /**
   * Clear all registrations.
   */
  public clear(): void {
    this.allNodes.clear()
    this.nodesByTag.clear()
  }
}
