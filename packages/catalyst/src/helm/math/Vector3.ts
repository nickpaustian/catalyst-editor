export class Vector3 {
  public x: number
  public y: number
  public z: number

  constructor(x: number = 0, y: number = 0, z: number = 0) {
    this.x = x
    this.y = y
    this.z = z
  }

  public set(x: number, y: number, z: number) {
    this.x = x
    this.y = y
    this.z = z
  }

  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z)
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z)
  }
}

export type Vec3 = Vector3
