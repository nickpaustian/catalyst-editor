/**
 * Axis - Represents the 3D force axes.
 */
export type Axis = "x" | "y" | "z"

/**
 * SingleAxisInputConfig - Maps a single input dimension to one force axis.
 */
export interface SingleAxisInputConfig {
  axis: Axis
  modifier?: number
  raw?: boolean
  decay?: number
}

/**
 * DualAxisInputConfig - Maps two input dimensions to two force axes.
 */
export interface DualAxisInputConfig {
  xAxis: Axis
  yAxis: Axis
  modifier?: number
  raw?: boolean
  decay?: number
}

export type AxisConfig =
  | DualAxisInputConfig
  | { x: SingleAxisInputConfig; y: SingleAxisInputConfig }

/**
 * InputForceConfig - Complete configuration for all input methods.
 * Maps raw inputs to normalised 3D force vectors.
 */
export interface InputForceConfig {
  mouse: AxisConfig
  touch: AxisConfig
  scroll: SingleAxisInputConfig
  pinch: SingleAxisInputConfig
}

/**
 * Default input force configuration.
 */
export const DEFAULT_INPUT_FORCE_CONFIG: InputForceConfig = {
  mouse: {
    xAxis: "x",
    yAxis: "y",
    modifier: 1.0,
    decay: 0.95,
  },
  touch: {
    xAxis: "x",
    yAxis: "y",
    modifier: 1.0,
    decay: 0.2,
  },
  scroll: {
    axis: "y",
    modifier: 0.1,
    decay: 0.2,
  },
  pinch: {
    axis: "z",
    modifier: 1.0,
    decay: 0.2,
  },
}
