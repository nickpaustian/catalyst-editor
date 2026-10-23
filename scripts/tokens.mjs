// Writes packages/editor/src/tokens/tokens.css and tokens.ts from tokens.json,
// the one copy to edit. `npm run tokens`, or `npm run tokens -- --check` to
// fail when the written files are stale.
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const dir = join(dirname(fileURLToPath(import.meta.url)), "../packages/editor/src/tokens")
const tokens = JSON.parse(readFileSync(join(dir, "tokens.json"), "utf8"))
const check = process.argv.includes("--check")

const value = (token) => (token && typeof token === "object" && "value" in token ? token.value : token)
const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()
const px = (n) => `${n}px`

// `#RRGGBBAA` as the modern rgb() syntax for CSS, and as rgba() for three.js and inline styles
const splitHex = (hex) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return m && { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), a: Number((parseInt(m[4], 16) / 255).toFixed(2)) }
}
const cssColour = (v) => {
  const hex = splitHex(v)
  if (hex) return `rgb(${hex.r} ${hex.g} ${hex.b} / ${hex.a})`
  return v.replace(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g, "rgb($1 $2 $3 / $4)")
}
const tsColour = (v) => {
  const hex = splitHex(v)
  if (hex) return `rgba(${hex.r}, ${hex.g}, ${hex.b}, ${hex.a.toFixed(2)})`
  return v.replace(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g, "rgba($1, $2, $3, $4)")
}

//=========================
// CSS
//=========================

const { color, font, space, radius, size, shadow, motion } = tokens
const styles = font.style
const sizesOf = (names) => names.map((n) => styles[n].size)
const lines = []
const group = (title, entries) => {
  lines.push(`  /* ${title} */`)
  for (const [name, v] of entries) lines.push(`  --cat-${name}: ${v};`)
  lines.push("")
}

const flat = (object, prefix = []) =>
  Object.entries(object).flatMap(([k, v]) => (v && typeof v === "object" && !("value" in v) ? flat(v, [...prefix, k]) : [[[...prefix, k], value(v)]]))

group("Surfaces — one step per level of nesting", Object.entries(color.bg).map(([k, v]) => [`bg-${kebab(k)}`, value(v)]))
group("Text", Object.entries(color.text).map(([k, v]) => [`text-${kebab(k)}`, value(v)]))
group("Borders", Object.entries(color.border).map(([k, v]) => [k === "default" ? "border" : `border-${k}`, value(v)]))
group("Accent — Hot pink. Selected / focused / active only (+ primary button).", [
  ["accent", value(color.accent.default)],
  ["accent-soft", cssColour(value(color.accent.soft))],
  ["accent-ring", cssColour(value(color.accent.ring))],
  ["selection-inactive", "var(--cat-bg-active)"],
])
group("Status", Object.entries(color.status).map(([k, v]) => [kebab(k), value(v)]))
group("Axes — always shown with their letter", Object.entries(color.axis).map(([k, v]) => [`axis-${k}`, value(v)]))
group("Property states", [
  ...Object.entries(color.anim).map(([k, v]) => [`anim-${kebab(k)}`, value(v)]),
  ["override", value(color.override)],
  ["changed", value(color.changed)],
])
group("Logo", Object.entries(color.logo).map(([k, v]) => [`logo-${kebab(k)}`, value(v)]))
group("Overlays", [
  ["viewport-chrome", cssColour(value(color.overlay.viewportChrome))],
  ["scrim", cssColour(value(color.overlay.scrim))],
  ["checker", `repeating-conic-gradient(${value(color.overlay.checkerA)} 0 25%, ${value(color.overlay.checkerB)} 0 50%) 0 0 / 8px 8px`],
])
group("Type", [
  ["font-ui", value(font.family.ui)],
  ["font-mono", value(font.family.mono)],
  ["text-xs", px(styles.bodySmall.size)],
  ["text-sm", px(styles.body.size)],
  ["text-md", px(styles.monoCode.size)],
  ["text-lg", px(styles.titleDialog.size)],
  ["leading-tight", px(styles.bodySmall.lineHeight)],
  ["leading-body", px(styles.body.lineHeight)],
  ["leading-code", px(styles.monoCode.lineHeight)],
  ["tracking-section", styles.labelSection.letterSpacing],
  ["tracking-panel", styles.titlePanel.letterSpacing],
])
const spaceSteps = Object.entries(space).sort(([a], [b]) => Number(a) - Number(b))
group("Space (4px grid)", spaceSteps.map(([k, v]) => [`space-${k.replace(".", "-")}`, px(v)]))
group("Radius", Object.entries(radius).map(([k, v]) => [`radius-${k}`, px(v)]))
group("Sizes", [
  ...Object.entries(size.control).map(([k, v]) => [`h-${k}`, px(v)]),
  ["row", px(size.row)],
  ["menu-item", px(size.menuItem)],
  ["panel-header", px(size.panelHeader)],
  ["section-header", px(size.sectionHeader)],
  ["title-bar", px(size.titleBar)],
  ["tree-indent", px(size.treeIndent)],
  ["label-col", px(size.labelColumn)],
  ["label-col-narrow", px(size.labelColumnNarrow)],
  ["checkbox", px(size.checkbox)],
  ["icon", px(size.icon)],
  ["icon-sm", px(size.iconSm)],
  ["icon-xs", px(size.iconXs)],
  ["axis-cell", px(size.axisCell)],
  ["axis-cell-narrow", px(size.axisCellNarrow)],
])
group("Elevation", [
  ["shadow-e1", cssColour(value(shadow.e1))],
  ["shadow-e2", cssColour(value(shadow.e2))],
  ["focus-ring", value(shadow.focus)],
])
group("Motion — PROPOSED, not yet reviewed", [
  ["dur-fast", `${motion.duration.fast}ms`],
  ["dur-base", `${motion.duration.base}ms`],
  ["dur-slow", `${motion.duration.slow}ms`],
  ["ease", motion.easing.standard],
  ["ease-exit", motion.easing.exit],
])
lines.pop()

const css = `/* Generated from tokens.json by scripts/tokens.mjs; edit the json and run \`npm run tokens\`.
   Dark theme only (v1). A light theme later redefines the same names. */

:root {
${lines.join("\n")}
}

/* Base — opt-in by importing this file at the app root. */
html, body {
  background: var(--cat-bg-app);
  color: var(--cat-text-primary);
  font-family: var(--cat-font-ui);
  font-size: var(--cat-text-sm);
  line-height: var(--cat-leading-body);
  -webkit-font-smoothing: antialiased;
}

@media (prefers-reduced-motion: reduce) {
  :root { --cat-dur-fast: 0ms; --cat-dur-base: 0ms; --cat-dur-slow: 0ms; }
}
`

//=========================
// TypeScript
//=========================

const tsValue = (v) => (typeof v === "number" ? String(v) : typeof v === "string" && (v.startsWith("#") || v.startsWith("rgba")) ? `'${tsColour(v)}'` : JSON.stringify(v).replace(/^"|"$/g, (q) => (v.includes("'") ? '"' : "'")))
const tsObject = (object, indent) => {
  const pad = "  ".repeat(indent)
  const entries = Object.entries(object).map(([k, v]) => {
    const key = /^[a-zA-Z_$][\w$]*$/.test(k) || /^\d+(\.\d+)?$/.test(k) ? k : JSON.stringify(k)
    const plain = value(v)
    return `${pad}  ${key}: ${plain && typeof plain === "object" ? tsObject(plain, indent + 1) : tsValue(plain)},`
  })
  return `{\n${entries.join("\n")}\n${pad}}`
}
const colourTree = (object) => Object.fromEntries(Object.entries(object).map(([k, v]) => [k, v && typeof v === "object" && !("value" in v) ? colourTree(v) : value(v)]))

const colours = colourTree(color)
colours.selectionInactive = colours.bg.active
colours.logo = { pink: colours.logo.pink, pinkOnLight: colours.logo.pinkOnLight, ink: colours.logo.ink, bone: colours.logo.bone, stone: { cap: colours.logo.stoneCap, front: colours.logo.stoneFront, side: colours.logo.stoneSide } }
const families = { ui: value(font.family.ui), mono: value(font.family.mono) }
const typeStyles = Object.fromEntries(Object.entries(styles).map(([k, { family, note, ...rest }]) => [k, { font: `font.${family}`, ...rest }]))
const sizes = { ...size, control: size.control, switch: { w: size.switchW, h: size.switchH } }
delete sizes.switchW
delete sizes.switchH
const shadows = { e0: value(shadow.e0), e1: value(shadow.e1), e2: value(shadow.e2) }
const { $status, ...motionValues } = motion

const ts = `// Generated from tokens.json by scripts/tokens.mjs; edit the json and run \`npm run tokens\`.
// For anything not styled through CSS: three.js colours, canvas overlays, inline styles.

export const color = ${tsObject(colours, 0)} as const;

export const font = ${tsObject(families, 0)} as const;

export const type = ${tsObject(typeStyles, 0).replace(/'font\.(ui|mono)'/g, "font.$1")} as const;

export const space = {
${spaceSteps.map(([k, v]) => `  ${k}: ${v},`).join("\n")}
} as const;

export const radius = ${tsObject(radius, 0)} as const;

export const size = ${tsObject(sizes, 0)} as const;

export const shadow = ${tsObject(shadows, 0)} as const;

/** ${$status} */
export const motion = ${tsObject(motionValues, 0)} as const;

export const tokens = { color, font, type, space, radius, size, shadow, motion } as const;
export default tokens;
`

let stale = false
for (const [file, text] of [["tokens.css", css], ["tokens.ts", ts]]) {
  const path = join(dir, file)
  let current = ""
  try {
    current = readFileSync(path, "utf8")
  } catch {}
  if (current === text) continue
  stale = true
  if (check) console.error(`${file} is out of date; run npm run tokens`)
  else {
    writeFileSync(path, text)
    console.log(`wrote ${file}`)
  }
}
if (check && stale) process.exit(1)
