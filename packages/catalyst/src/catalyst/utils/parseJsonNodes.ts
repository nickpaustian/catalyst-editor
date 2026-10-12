import { debug } from "@vitrine/debug"
import { Catalyst } from "../core/Catalyst"

import * as THREE from "three"

export async function loadJsonNodeFile(path: string): Promise<any> {
  const response = await Catalyst._.reQuester.fetch(path)

  if (response.reQuesterStatus === "error") {
    throw new Error(`Failed to load scene file: ${path}`)
  }

  return response.data
}

export function parseJsonNodes(nodeData: any): any {
  if (!Catalyst._?.nodes) {
    debug("Node registry not initialised before trying to parse json.", "error")
    return
  }

  const NodeClass = Catalyst._.nodes[nodeData.type]

  if (!NodeClass) {
    debug(`Unknown node type: ${nodeData.type}`, "error")
    return
  }

  // Create node with config
  const node = new NodeClass(nodeData.config ?? { name: nodeData.name })

  // Apply transform
  if (nodeData.transform) {
    if (nodeData.transform.position) {
      node.transform.position = new THREE.Vector3(
        ...nodeData.transform.position
      )
    }
    if (nodeData.transform.rotation) {
      const rot = nodeData.transform.rotation
      if (rot.length === 4) {
        node.transform.rotation = new THREE.Quaternion(
          rot[0],
          rot[1],
          rot[2],
          rot[3]
        )
      } else if (rot.length === 3) {
        node.transform.rotation.setFromEuler(new THREE.Euler(...rot))
      }
    }
  }

  // Apply properties
  if (nodeData.properties) {
    if (nodeData.properties.tags) {
      nodeData.properties.tags.forEach((tag: string) => {
        node.addTag(tag)
      })
    }
    if ("isTrigger" in nodeData.properties) {
      node.isTrigger = nodeData.properties.isTrigger
    }
    if ("active" in nodeData.properties) {
      node.active = nodeData.properties.active
    }
    if (nodeData.properties.layers) {
      node.layers = nodeData.properties.layers
    }
    if (nodeData.properties.collidesWith) {
      node.collidesWith = nodeData.properties.collidesWith
    }
  }

  // Recursively parse children
  if (nodeData.children) {
    nodeData.children.forEach((childData: any) => {
      const child = parseJsonNodes(childData)
      node.addNode(child)
    })
  }

  return node
}
