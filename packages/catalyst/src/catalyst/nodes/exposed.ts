/** tags: a list of strings; layers: a list of physics layer numbers (0-31). */
export type ExposedType = "number" | "boolean" | "string" | "tags" | "layers"

/**
 * A property a node class offers to editors. Declared on the class as
 * `static exposed: ExposedProperty[]`; subclasses add to (or override, by
 * key) what their base classes declare, the way Godot's exported variables
 * or Blender's RNA properties work.
 */
export interface ExposedProperty {
  /**
   * The instance property read and written; it needs a getter and a setter.
   * `tags` reads `tags` and writes through `clearTags`/`addTag`; `layers`
   * reads a PhysicsLayerSet's `list` and writes an array to its setter.
   */
  key: string
  label?: string
  type: ExposedType
  min?: number
  max?: number
  step?: number
  /**
   * Where the value lives in a scene file entry: a constructor `config` key
   * (the default), a `properties` key applied after construction, or nowhere.
   */
  save?: "config" | "properties" | false
}

interface ExposingClass {
  exposed?: ExposedProperty[]
}

/** Every exposed property of a node, base classes first, later declarations winning by key. */
export const exposedProperties = (node: object): ExposedProperty[] => {
  const chain: ExposingClass[] = []
  let proto = Object.getPrototypeOf(node)
  while (proto && proto !== Object.prototype) {
    chain.unshift(proto.constructor as ExposingClass)
    proto = Object.getPrototypeOf(proto)
  }
  const merged = new Map<string, ExposedProperty>()
  for (const cls of chain) {
    if (!Object.prototype.hasOwnProperty.call(cls, "exposed")) continue
    for (const property of cls.exposed ?? []) merged.set(property.key, property)
  }
  return Array.from(merged.values())
}
