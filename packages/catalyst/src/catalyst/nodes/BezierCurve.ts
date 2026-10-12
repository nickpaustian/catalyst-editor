import * as THREE from "three"
import { Node3D } from "./Node3D"
import { Catalyst } from "../core"

interface BezierCurveConfig {
  name?: string
  closed?: boolean
  visualise?: boolean
}

interface ControlPoint {
  name?: string
  point: THREE.Vector3
}

/**
 * BezierCurve - A spatial node that defines a 3D bezier curve.
 *
 * Can be used for:
 * - Camera paths for cinematic exploration
 * - Object movement along curves
 * - Animation paths
 *
 * The curve is defined by child nodes positioned as control points.
 * Uses Three.js CatmullRomCurve3 or CubicBezierCurve3 depending on needs.
 *
 * Usage:
 * const path = new BezierCurve()
 * path.addControlPoint(new THREE.Vector3(0, 0, 0))
 * path.addControlPoint(new THREE.Vector3(5, 5, 5))
 * path.addControlPoint(new THREE.Vector3(10, 0, 10))
 *
 * const point = path.getPointAtT(0.5) // Get point halfway along curve
 * const tangent = path.getTangentAtT(0.5) // Get direction at point
 */
export class BezierCurve extends Node3D {
  private controlPoints: ControlPoint[] = []
  private curve: THREE.CatmullRomCurve3 | null = null
  private _closed: boolean = false
  private visualisationLine: THREE.Line | null = null
  private isVisualised: boolean = false

  constructor(config: BezierCurveConfig = {}) {
    super(config?.name ?? "bezierCurve")

    this._closed = config?.closed ?? false

    if (config.visualise) {
      this.isVisualised = true
    }
  }

  //=========================
  // Setters & Getters
  //=========================

  public get closed(): boolean {
    return this._closed
  }

  public set closed(state: boolean) {
    this._closed = state
    this.updateCurve()
  }

  /**
   * Add a control point to the curve.
   */
  public addControlPoint(controlPoint: ControlPoint | THREE.Vector3): void {
    this.controlPoints.push(
      controlPoint instanceof THREE.Vector3
        ? { point: controlPoint }
        : controlPoint
    )
    this.updateCurve()
  }

  /**
   * Set control points (replaces existing).
   */
  public setControlPoints(controlPoints: ControlPoint[]): void {
    this.controlPoints = controlPoints
    this.updateCurve()
  }

  /**
   * Get all control points.
   */
  public getControlPoints(): ControlPoint[] {
    return this.controlPoints
  }

  /**
   * Get number of control points.
   */
  public getControlPointCount(): number {
    return this.controlPoints.length
  }

  /**
   * Update curve when the world transform changes.
   */
  protected onWorldTransformChanged(): void {
    this.updateCurve()
  }

  /**
   * Update the internal curve from control points.
   */
  private updateCurve(): void {
    if (this.controlPoints.length < 2) {
      this.curve = null
      return
    }

    // Get world position of this node
    const worldPos = this.transform.getWorldPosition()

    // Build curve points in world space
    let curvePoints = this.controlPoints.map((controlPoint) => {
      return controlPoint.point.clone().add(worldPos)
    })

    // Use CatmullRomCurve3 for smooth interpolation through points
    this.curve = new THREE.CatmullRomCurve3(curvePoints, this._closed)

    // Update visualisation if enabled
    if (this.isVisualised) {
      this.updateVisualisation()
    }
  }

  /**
   * Create/update visualisation of the curve.
   */
  private updateVisualisation(): void {
    if (!this.curve) return

    // Remove old visualisation
    if (this.visualisationLine) {
      const parent = this.visualisationLine.parent
      if (parent) parent.remove(this.visualisationLine)
    }

    // Create new line geometry from curve points
    const points = this.curve.getPoints(50) // 50 segments
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineBasicMaterial({ color: 0xffff00 })
    this.visualisationLine = new THREE.Line(geometry, material)

    // Add to scene
    Catalyst._.scene.add(this.visualisationLine)
  }

  protected override onDispose(): void {
    if (!this.visualisationLine) return
    this.visualisationLine.parent?.remove(this.visualisationLine)
    this.visualisationLine.geometry.dispose()
    ;(this.visualisationLine.material as THREE.Material).dispose()
    this.visualisationLine = null
  }

  /**
   * Get a point on the curve at parameter t (0 to 1).
   */
  public getPointAt(
    t: number,
    useArcLength: boolean = true
  ): THREE.Vector3 | null {
    if (!this.curve) return null
    const clamped = Math.max(0, Math.min(1, t))
    return useArcLength
      ? this.curve.getPointAt(clamped)
      : this.curve.getPoint(clamped)
  }

  /**
   * Get the tangent (direction) at parameter t (0 to 1).
   */
  public getTangentAt(
    t: number,
    useArcLength: boolean = true
  ): THREE.Vector3 | null {
    if (!this.curve) return null
    const clamped = Math.max(0, Math.min(1, t))
    const tangent = useArcLength
      ? this.curve.getTangentAt(clamped)
      : this.curve.getTangent(clamped)
    return tangent.normalize()
  }

  /**
   * Check if a parameter t is between two control points by name.
   */
  public isBetweenControlPoints(
    t: number,
    beforeName: string,
    afterName: string
  ): boolean {
    if (this.controlPoints.length < 2) return false

    const beforeIndex = this.controlPoints.findIndex(
      (cp) => cp.name === beforeName
    )
    const afterIndex = this.controlPoints.findIndex(
      (cp) => cp.name === afterName
    )

    if (beforeIndex === -1 || afterIndex === -1) return false

    const segmentStart = this.getArcLengthTForControlPoint(beforeIndex)
    const segmentEnd = this.getArcLengthTForControlPoint(afterIndex)

    if (segmentStart === null || segmentEnd === null) return false

    return t > segmentStart && t < segmentEnd
  }

  /**
   * Get a mapped parameter t within a sub-range between two named control points.
   * Returns a value between 0-1 representing position within that segment.
   * Returns null if control points not found or t is outside the range.
   */
  public getMappedParameterBetween(
    t: number,
    beforeName: string,
    afterName: string
  ): number | null {
    const beforeIndex = this.controlPoints.findIndex(
      (cp) => cp.name === beforeName
    )
    const afterIndex = this.controlPoints.findIndex(
      (cp) => cp.name === afterName
    )

    if (beforeIndex === -1 || afterIndex === -1) return null
    if (beforeIndex >= afterIndex) return null

    // Get arc-length t values for the named control points
    const segmentStart = this.getArcLengthTForControlPoint(beforeIndex)
    const segmentEnd = this.getArcLengthTForControlPoint(afterIndex)

    if (segmentStart === null || segmentEnd === null) return null

    // Check if t is within this segment
    if (t < segmentStart || t > segmentEnd) return null

    // Map t to 0-1 within this sub-range
    const mapped = (t - segmentStart) / (segmentEnd - segmentStart)
    return Math.max(0, Math.min(1, mapped))
  }

  /**
   * Get the arc-length parameter (0 to 1) at which a named control point sits.
   */
  public getControlPointParameter(name: string): number | null {
    const index = this.controlPoints.findIndex((cp) => cp.name === name)
    if (index === -1) return null
    return this.getArcLengthTForControlPoint(index)
  }

  private getArcLengthTForControlPoint(index: number): number | null {
    if (!this.curve || this.controlPoints.length < 2) return null

    const uniformT = index / (this.controlPoints.length - 1)

    // Get the actual distance to this point along the curve:
    const lengths = this.curve.getLengths()
    const totalLength = lengths[lengths.length - 1]
    const segmentIndex = uniformT * (lengths.length - 1)
    const i = Math.floor(segmentIndex)
    const frac = segmentIndex - i

    const lengthAtPoint =
      i < lengths.length - 1
        ? lengths[i] + frac * (lengths[i + 1] - lengths[i])
        : lengths[lengths.length - 1]

    return lengthAtPoint / totalLength
  }

  /**
   * Get total length of the curve.
   */
  public getLength(): number {
    if (!this.curve) return 0
    return this.curve.getLength()
  }

  /**
   * Get point at a specific distance along curve.
   */
  public getPointAtDistance(distance: number): THREE.Vector3 | null {
    if (!this.curve) return null
    const length = this.curve.getLength()
    const t = distance / length
    return this.getPointAt(t)
  }

  /**
   * Get parameter t for a given distance along curve.
   */
  public getParameterAtDistance(distance: number): number {
    if (!this.curve) return 0
    const length = this.curve.getLength()
    return Math.max(0, Math.min(1, distance / length))
  }

  /**
   * Enable/disable visualisation.
   */
  public setVisualised(enabled: boolean): void {
    this.isVisualised = enabled
    if (enabled && this.curve) {
      this.updateVisualisation()
    } else if (!enabled && this.visualisationLine) {
      const parent = this.visualisationLine.parent
      if (parent) parent.remove(this.visualisationLine)
      this.visualisationLine = null
    }
  }
}
