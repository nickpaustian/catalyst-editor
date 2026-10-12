import { Vector3, HistoryList } from "../math"

export interface KineticConfig {
  friction?: number | Vector3
  idleThreshold?: number
}

export class Kinetic {
  private _position: Vector3 = new Vector3()
  private _velocity: Vector3 = new Vector3()
  private _velocityHistory: HistoryList<Vector3> = new HistoryList({
    maxAge: 100,
  })
  private _useDisplacement: boolean = false

  private _friction: Vector3
  private _idleThreshold: number

  constructor(config: KineticConfig = {}) {
    const friction = config.friction ?? 0.92

    if (typeof friction === "number") {
      this._friction = new Vector3(friction, friction, friction)
    } else {
      this._friction = friction
    }

    this._idleThreshold = config.idleThreshold ?? 0.000001
  }

  public get position(): Vector3 {
    return this._position
  }

  public get velocity(): Vector3 {
    return this._velocity
  }

  public get isIdle(): boolean {
    return (
      Math.abs(this._velocity.x) < this._idleThreshold &&
      Math.abs(this._velocity.y) < this._idleThreshold &&
      Math.abs(this._velocity.z) < this._idleThreshold &&
      !this._velocityHistory.length
    )
  }

  public get idleThreshold(): number {
    return this._idleThreshold
  }

  public applyForce(force: Vector3): void {
    this._velocity.x += force.x
    this._velocity.y += force.y
    this._velocity.z += force.z
  }

  public applyDisplacement(displacement: Vector3): void {
    this._position.x += displacement.x
    this._position.y += displacement.y
    this._position.z += displacement.z

    this._velocity.x = displacement.x
    this._velocity.y = displacement.y
    this._velocity.z = displacement.z

    this._velocityHistory.add(this._velocity.clone())

    this._useDisplacement = true
  }

  public update(_dt: number): void {
    if (this._useDisplacement) {
      this._useDisplacement = false
      return
    }

    if (this._velocityHistory.length > 0) {
      const avg = this._velocityHistory.average()
      if (avg) {
        const avgMagnitude = Math.sqrt(
          avg.x * avg.x + avg.y * avg.y + avg.z * avg.z,
        )

        // Find last non-zero entry for direction
        let direction: Vector3 | null = null
        for (let i = this._velocityHistory.entries.length - 1; i >= 0; i--) {
          const v = this._velocityHistory.entries[i].value
          if (v.x !== 0 || v.y !== 0 || v.z !== 0) {
            direction = v
            break
          }
        }

        if (direction && avgMagnitude > 0) {
          const dirMagnitude = Math.sqrt(
            direction.x * direction.x +
              direction.y * direction.y +
              direction.z * direction.z,
          )
          const scale = avgMagnitude / dirMagnitude
          this._velocity.x = direction.x * scale
          this._velocity.y = direction.y * scale
          this._velocity.z = direction.z * scale
        }
      }
      this._velocityHistory.clear()
    }

    this._position.x += this._velocity.x
    this._position.y += this._velocity.y
    this._position.z += this._velocity.z

    this._velocity.x *= this._friction.x
    this._velocity.y *= this._friction.y
    this._velocity.z *= this._friction.z

    if (this.isIdle) {
      this._velocity.set(0, 0, 0)
    }
  }

  public reset(): void {
    this._position.set(0, 0, 0)
    this._velocity.set(0, 0, 0)
  }
}
