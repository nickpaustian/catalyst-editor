import { Node, Node3D } from "../nodes"

export const unsafeNode = <T extends Node>(node: T): any => {
  return node._
}

export const isNode3D = (node: any): node is Node3D => {
  return node instanceof Node3D
}
