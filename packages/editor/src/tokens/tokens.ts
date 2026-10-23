// Catalyst editor design tokens — mirrors tokens.json (the source of truth).
// Use these for anything not styled through CSS (canvas/WebGL overlays, gizmos, inline styles).

export const color = {
  bg: {
    app: '#0E0F12',
    viewport: '#111216',
    panel: '#16171B',
    raised: '#1C1D22',
    field: '#22242A',
    hover: '#2A2C33',
    active: '#33363E',
  },
  text: {
    primary: '#E6E7EA',
    secondary: '#A3A7B0',
    tertiary: '#8A8E98',
    disabled: '#5C606A',
    onAccent: '#0E0F12',
  },
  border: {
    subtle: '#24262C',
    default: '#2F3239',
    strong: '#464A54',
  },
  accent: {
    default: '#FF4FC8',
    soft: 'rgba(255, 79, 200, 0.16)',
    ring: 'rgba(255, 79, 200, 0.40)',
  },
  selectionInactive: '#33363E',
  status: {
    success: '#5FCB8A',
    warning: '#F2B451',
    warningSurface: '#2B2416',
    warningBorder: '#6B5320',
    danger: '#F2696B',
    dangerSurface: '#2E1F22',
    dangerSurfacePressed: '#3A2427',
    dangerBorder: '#6B3337',
    dangerTextPressed: '#F58A8B',
    info: '#6FA8FF',
  },
  axis: { x: '#FF6B6B', y: '#7BD88F', z: '#6FA8FF', w: '#A3A7B0' },
  anim: { key: '#F2B451', keySurface: '#2B2416', keyBorder: '#6B5320' },
  override: '#6FA8FF',
  changed: '#A3A7B0',
  logo: {
    pink: '#FF4FC8',
    pinkOnLight: '#E62DAE',
    ink: '#141414',
    bone: '#F3F1EC',
    stone: { cap: '#F4F2EE', front: '#D9D5CC', side: '#8F8C86' }, // obelisk faces, full-colour mark
  },
  overlay: {
    viewportChrome: 'rgba(22, 23, 27, 0.88)',
    checkerA: '#46484F',
    checkerB: '#2A2C33',
    scrim: 'rgba(8, 9, 11, 0.6)',
  },
} as const;

export const font = {
  ui: 'Geist, ui-sans-serif, system-ui, sans-serif',
  mono: "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

export const type = {
  titleDialog:  { font: font.ui,   size: 15, lineHeight: 20, weight: 600 },
  titlePanel:   { font: font.ui,   size: 12, lineHeight: 16, weight: 500, letterSpacing: '0.01em' },
  labelSection: { font: font.ui,   size: 11, lineHeight: 16, weight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' },
  body:         { font: font.ui,   size: 12, lineHeight: 18, weight: 400 },
  bodyStrong:   { font: font.ui,   size: 12, lineHeight: 18, weight: 500 },
  bodySmall:    { font: font.ui,   size: 11, lineHeight: 16, weight: 400 },
  nodeNameEdit: { font: font.ui,   size: 13, lineHeight: 18, weight: 500 },
  monoValue:    { font: font.mono, size: 12, lineHeight: 16, weight: 400, fontVariantNumeric: 'tabular-nums' },
  monoSmall:    { font: font.mono, size: 11, lineHeight: 16, weight: 400 },
  monoAxis:     { font: font.mono, size: 11, lineHeight: 16, weight: 500 },
  monoCode:     { font: font.mono, size: 13, lineHeight: 20, weight: 400 },
} as const;

export const space = { 0.5: 2, 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32 } as const;

export const radius = { xs: 3, sm: 4, md: 6, lg: 10, pill: 999 } as const;

export const size = {
  control: { xs: 20, sm: 24, md: 28, lg: 32 },
  row: 24,
  menuItem: 26,
  panelHeader: 32,
  sectionHeader: 28,
  titleBar: 44,
  treeIndent: 18,
  labelColumn: 112,
  labelColumnNarrow: 72,
  rowGap: 4,
  labelGap: 8,
  checkbox: 14,
  switch: { w: 26, h: 14 },
  icon: 16,
  iconSm: 14,
  iconXs: 12,
  axisCell: 18,
  axisCellNarrow: 14,
  dropIndicator: 2,
} as const;

export const shadow = {
  e0: 'none',
  e1: '0 4px 12px rgba(0, 0, 0, 0.35)',
  e2: '0 16px 40px rgba(0, 0, 0, 0.55)',
} as const;

/** PROPOSED — not yet designed on the canvas. */
export const motion = {
  duration: { instant: 0, fast: 80, base: 140, slow: 220 },
  easing: { standard: 'cubic-bezier(0.2, 0, 0, 1)', exit: 'cubic-bezier(0.4, 0, 1, 1)' },
  tooltipDelay: 500,
} as const;

export const tokens = { color, font, type, space, radius, size, shadow, motion } as const;
export default tokens;
