import {
  layersToBitmask,
  isLayerInMask,
  type PhysicsLayer,
} from "./physicsLayer"

export class PhysicsLayerSet {
  private layers: PhysicsLayer[] = []
  private _mask: number = 0

  constructor(layers: PhysicsLayer | PhysicsLayer[] = []) {
    this.set(layers)
  }

  //=========================
  // Getters & Setters
  //=========================

  public set(layers: PhysicsLayer | PhysicsLayer[]): void {
    const layerArray = Array.isArray(layers) ? layers : [layers]
    this.layers = [...layerArray]
    this._mask = layersToBitmask(this.layers)
  }

  public add(layers: PhysicsLayer | PhysicsLayer[]): void {
    const layerArray = Array.isArray(layers) ? layers : [layers]
    layerArray.forEach((layer) => {
      if (!this.layers.includes(layer)) {
        this.layers.push(layer)
        this._mask |= 1 << layer
      }
    })
  }

  public remove(layers: PhysicsLayer | PhysicsLayer[]): void {
    const layerArray = Array.isArray(layers) ? layers : [layers]
    this.layers = this.layers.filter((l) => !layerArray.includes(l))
    this._mask = layersToBitmask(this.layers)
  }

  public get mask(): number {
    return this._mask
  }

  public get list(): PhysicsLayer[] {
    return [...this.layers]
  }

  //=========================
  // Methods
  //=========================

  public has(layer: PhysicsLayer): boolean {
    return isLayerInMask(layer, this._mask)
  }

  public collidesWith(other: PhysicsLayerSet): boolean {
    return (this._mask & other._mask) !== 0
  }

  public collidesWithLayer(layer: PhysicsLayer): boolean {
    return isLayerInMask(layer, this._mask)
  }
}
