import * as NodeModules from "../nodes"
import * as PrefabModules from "../prefabs"

export function buildNodeRegistry(): Record<string, any> {
  const registry: Record<string, any> = {}

  // Get all exports from nodes
  Object.entries({ ...NodeModules, ...PrefabModules }).forEach(
    ([name, value]) => {
      // Check if it's a class (has a prototype)
      if (typeof value === "function" && value.prototype) {
        registry[name] = value
      }
    }
  )

  return registry
}
