import * as THREE from "three"
import { Catalyst } from "../core"

// Config interfaces with sensible defaults
interface LineConfig {
  color?: number
  lineWidth?: number
  autoAdd?: boolean
}

interface CubeConfig {
  size?: number
  color?: number
  autoAdd?: boolean
}

interface BoxConfig {
  width?: number
  height?: number
  depth?: number
  color?: number
  autoAdd?: boolean
}

interface PrismConfig {
  radius?: number
  height?: number
  sides?: number
  color?: number
  autoAdd?: boolean
}

interface SphereConfig {
  radius?: number
  color?: number
  autoAdd?: boolean
}

interface ConeConfig {
  radius?: number
  height?: number
  sides?: number
  color?: number
  autoAdd?: boolean
}

interface PyramidConfig {
  baseSize?: number
  height?: number
  color?: number
  autoAdd?: boolean
}

interface PolyhedronConfig {
  faces?: number
  radius?: number
  color?: number
  autoAdd?: boolean
}

interface CustomPolyhedronConfig {
  vertices: number[]
  indices: number[]
  radius?: number
  color?: number
  autoAdd?: boolean
}

interface ArrowConfig {
  length?: number
  color?: number
  headSize?: number
  autoAdd?: boolean
}

interface AxesConfig {
  size?: number
  autoAdd?: boolean
}

interface GridConfig {
  sizeInUnits?: number
  divisionsPerUnit?: number
  color?: number
  autoAdd?: boolean
}

/**
 * DebugShapes - A library of reusable debug visualisation shapes.
 *
 * Provides wireframe shapes for debugging spatial relationships, raycasts,
 * physics bodies, and other visual debugging needs.
 *
 * All shapes auto-add to the Catalyst scene by default for convenience.
 */
export class DebugShapes {
  /**
   * Add object to Catalyst scene if autoAdd is true.
   */
  private static addToScene(
    object: THREE.Object3D,
    autoAdd: boolean = true
  ): void {
    if (autoAdd) Catalyst._.scene.add(object)
  }

  /**
   * Create a debug line from point A to point B.
   */
  static line(
    from: THREE.Vector3,
    to: THREE.Vector3,
    config: LineConfig = {}
  ): THREE.Line {
    const { color = 0xff0000, lineWidth = 1, autoAdd = true } = config

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([from.x, from.y, from.z, to.x, to.y, to.z]),
        3
      )
    )
    const material = new THREE.LineBasicMaterial({
      color,
      linewidth: lineWidth,
    })
    const line = new THREE.Line(geometry, material)
    this.addToScene(line, autoAdd)
    return line
  }

  /**
   * Create a debug wireframe cube.
   */
  static cube(config: CubeConfig = {}): THREE.LineSegments {
    const { size = 1, color = 0x00ff00, autoAdd = true } = config

    const geometry = new THREE.BoxGeometry(size, size, size)
    const edges = new THREE.EdgesGeometry(geometry)
    const material = new THREE.LineBasicMaterial({ color })
    const cube = new THREE.LineSegments(edges, material)
    this.addToScene(cube, autoAdd)
    return cube
  }

  /**
   * Create a debug wireframe box.
   */
  static box(config: BoxConfig = {}): THREE.LineSegments {
    const {
      width = 1,
      height = 1,
      depth = 1,
      color = 0x00ff00,
      autoAdd = true,
    } = config

    const geometry = new THREE.BoxGeometry(width, height, depth)
    const edges = new THREE.EdgesGeometry(geometry)
    const material = new THREE.LineBasicMaterial({ color })
    const box = new THREE.LineSegments(edges, material)
    this.addToScene(box, autoAdd)
    return box
  }

  /**
   * Create a debug wireframe prism (cylinder with variable sides).
   * Default is 6 sides (hexagon).
   */
  static prism(config: PrismConfig = {}): THREE.LineSegments {
    const {
      radius = 1,
      height = 1,
      sides = 6,
      color = 0x00ff00,
      autoAdd = true,
    } = config

    const geometry = new THREE.CylinderGeometry(radius, radius, height, sides)
    const edges = new THREE.EdgesGeometry(geometry)
    const material = new THREE.LineBasicMaterial({ color })
    const prism = new THREE.LineSegments(edges, material)
    this.addToScene(prism, autoAdd)
    return prism
  }

  /**
   * Create a debug wireframe sphere.
   */
  static sphere(config: SphereConfig = {}): THREE.LineSegments {
    const { radius = 1, color = 0x00ff00, autoAdd = true } = config

    const geometry = new THREE.SphereGeometry(radius, 8, 8)
    const edges = new THREE.EdgesGeometry(geometry)
    const material = new THREE.LineBasicMaterial({ color })
    const sphere = new THREE.LineSegments(edges, material)
    this.addToScene(sphere, autoAdd)
    return sphere
  }

  /**
   * Create a debug wireframe cone.
   */
  static cone(config: ConeConfig = {}): THREE.LineSegments {
    const {
      radius = 1,
      height = 1,
      sides = 8,
      color = 0x00ff00,
      autoAdd = true,
    } = config

    const geometry = new THREE.ConeGeometry(radius, height, sides)
    const edges = new THREE.EdgesGeometry(geometry)
    const material = new THREE.LineBasicMaterial({ color })
    const cone = new THREE.LineSegments(edges, material)
    this.addToScene(cone, autoAdd)
    return cone
  }

  /**
   * Create a debug wireframe pyramid (4-sided cone).
   */
  static pyramid(config: PyramidConfig = {}): THREE.LineSegments {
    const {
      baseSize = 1,
      height = 1,
      color = 0x00ff00,
      autoAdd = true,
    } = config

    return this.cone({
      radius: baseSize,
      height,
      sides: 4,
      color,
      autoAdd,
    })
  }

  /**
   * Create a debug wireframe polyhedron by face count.
   * Common counts: 4 (tetrahedron), 8 (octahedron), 12 (icosahedron), 20 (dodecahedron)
   */
  static polyhedron(config: PolyhedronConfig = {}): THREE.LineSegments {
    const { faces = 8, radius = 1, color = 0x00ff00, autoAdd = true } = config

    let geometry: THREE.BufferGeometry

    switch (faces) {
      case 4:
        geometry = new THREE.TetrahedronGeometry(radius)
        break
      case 8:
        geometry = new THREE.OctahedronGeometry(radius)
        break
      case 12:
        geometry = new THREE.IcosahedronGeometry(radius)
        break
      case 20:
        geometry = new THREE.DodecahedronGeometry(radius)
        break
      default:
        geometry = new THREE.OctahedronGeometry(radius)
    }

    const edges = new THREE.EdgesGeometry(geometry)
    const material = new THREE.LineBasicMaterial({ color })
    const polyhedron = new THREE.LineSegments(edges, material)
    this.addToScene(polyhedron, autoAdd)
    return polyhedron
  }

  /**
   * Create a debug wireframe custom polyhedron with vertices and indices.
   */
  static customPolyhedron(config: CustomPolyhedronConfig): THREE.LineSegments {
    const {
      vertices,
      indices,
      radius = 1,
      color = 0x00ff00,
      autoAdd = true,
    } = config

    const geometry = new THREE.PolyhedronGeometry(vertices, indices, radius, 0)
    const edges = new THREE.EdgesGeometry(geometry)
    const material = new THREE.LineBasicMaterial({ color })
    const polyhedron = new THREE.LineSegments(edges, material)
    this.addToScene(polyhedron, autoAdd)
    return polyhedron
  }

  /**
   * Create a debug arrow pointing in a direction.
   */
  static arrow(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    config: ArrowConfig = {}
  ): THREE.Group {
    const {
      length = 1,
      color = 0xff0000,
      headSize = 0.2,
      autoAdd = true,
    } = config

    const group = new THREE.Group()

    // Shaft
    const normalisedDir = direction.clone().normalize()
    const end = origin.clone().add(normalisedDir.clone().multiplyScalar(length))
    const shaft = this.line(origin, end, {
      color,
      lineWidth: 1,
      autoAdd: false,
    })
    group.add(shaft)

    // Head (small cone)
    const head = this.cone({
      radius: headSize,
      height: headSize * 2,
      sides: 8,
      color,
      autoAdd: false,
    })
    head.position.copy(end)
    head.lookAt(origin)
    group.add(head)

    this.addToScene(group, autoAdd)
    return group
  }

  /**
   * Create debug axes (XYZ) at origin.
   * X = red, Y = green, Z = blue
   */
  static axes(config: AxesConfig = {}): THREE.Group {
    const { size = 1, autoAdd = true } = config

    const group = new THREE.Group()

    // X axis - red
    group.add(
      this.line(new THREE.Vector3(0, 0, 0), new THREE.Vector3(size, 0, 0), {
        color: 0xff0000,
        autoAdd: false,
      })
    )

    // Y axis - green
    group.add(
      this.line(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, size, 0), {
        color: 0x00ff00,
        autoAdd: false,
      })
    )

    // Z axis - blue
    group.add(
      this.line(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, size), {
        color: 0x0000ff,
        autoAdd: false,
      })
    )

    this.addToScene(group, autoAdd)
    return group
  }

  /**
   * Create a debug grid on the XZ plane.
   */

  static grid(config: GridConfig = {}): THREE.GridHelper {
    const {
      sizeInUnits = 10,
      divisionsPerUnit = 1,
      color = 0x444444,
      autoAdd = true,
    } = config

    const size = sizeInUnits * Catalyst._.unit
    const divisions = sizeInUnits * divisionsPerUnit

    const grid = new THREE.GridHelper(size, divisions, color, color)
    this.addToScene(grid, autoAdd)
    return grid
  }
}
