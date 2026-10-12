import * as THREE from "three"

export declare class Loader {
  static loadModel(url: string): Promise<THREE.Group>
  static loadSplat(
    splatUrl: string,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    options?: SplatOptions
  ): any
}
