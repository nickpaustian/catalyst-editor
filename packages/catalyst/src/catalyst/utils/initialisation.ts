import * as THREE from "three"

/**
 * Catalyst initialisation utilities - Pure functions for creating Three.js objects.
 */

/**
 * Create a WebGL renderer.
 */
export const createRenderer = (
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): THREE.WebGLRenderer => {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
  })

  renderer.setSize(width, height)
  renderer.setClearColor(0x000000)
  // renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setPixelRatio(1.0)

  return renderer
}

/**
 * Create a Three.js scene.
 */
export const createScene = (): THREE.Scene => {
  return new THREE.Scene()
}

/**
 * Create a perspective camera.
 */
export const createCamera = (
  width: number,
  height: number
): THREE.PerspectiveCamera => {
  const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000)

  camera.position.z = 5

  return camera
}

/**
 * Create and attach a canvas element to a container.
 */
export const createCanvas = (
  containerElement: HTMLElement
): HTMLCanvasElement => {
  const canvas = document.createElement("canvas")
  canvas.style.display = "block"
  canvas.style.width = "100%"
  canvas.style.height = "100%"

  containerElement.appendChild(canvas)

  return canvas
}

/**
 * Resolve a container element from a selector string or HTMLElement.
 */
export const resolveContainer = (
  container?: HTMLElement | string
): HTMLElement => {
  if (!container) {
    return document.body
  }

  if (typeof container === "string") {
    const element = document.querySelector(container)
    if (!element) {
      console.warn(`Container selector "${container}" not found, using body`)
      return document.body
    }
    return element as HTMLElement
  }

  return container
}

/**
 * Update camera aspect ratio and renderer size on window resize.
 */
export const updateOnResize = (
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  width: number,
  height: number
): void => {
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}
