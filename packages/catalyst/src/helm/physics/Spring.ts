export interface SpringConfig {
  stiffness?: number
  damping?: number
}

const SPRING_DEFAULTS: Required<SpringConfig> = {
  stiffness: 0.15,
  damping: 0.75,
}

export class Spring {
  private _config: Required<SpringConfig>

  constructor(config: SpringConfig = {}) {
    this._config = { ...SPRING_DEFAULTS, ...config }
  }

  public get stiffness(): number {
    return this._config.stiffness
  }

  public set stiffness(value: number) {
    this._config.stiffness = value
  }

  public get damping(): number {
    return this._config.damping
  }

  public set damping(value: number) {
    this._config.damping = value
  }

  public force(current: number, target: number, velocity: number): number {
    const displacement = target - current
    const springForce = displacement * this._config.stiffness
    const dampingForce = -velocity * this._config.damping
    return springForce + dampingForce
  }
}
