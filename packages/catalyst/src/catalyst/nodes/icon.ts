/**
 * The glyph an editor shows for a node class, declared on the class as
 * `static icon = svgIcon(...)`. Subclasses inherit their nearest base's icon
 * unless they declare their own.
 */
export const svgIcon = (body: string): string =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

interface IconClass {
  icon?: string
}

/** The icon of a node or node class: its own, or the nearest base class's. */
export const editorIcon = (target: object): string => {
  let cls: IconClass | null = typeof target === "function" ? (target as IconClass) : Object.getPrototypeOf(target)?.constructor
  while (cls && cls !== Function.prototype) {
    if (Object.prototype.hasOwnProperty.call(cls, "icon") && cls.icon) return cls.icon
    cls = Object.getPrototypeOf(cls)
  }
  return ""
}
