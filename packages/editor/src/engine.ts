import { Catalyst, DebugShapes, type CatalystOptions } from "@nickpaustian/catalyst"
import { Input } from "@nickpaustian/catalyst/input"
import { Interaction } from "@nickpaustian/catalyst/interaction"
import { Physics } from "@nickpaustian/catalyst/physics"
import { Resources } from "@nickpaustian/catalyst/resources"
import { Splats } from "@nickpaustian/catalyst/splats"
import { HemisphereLight } from "three"
import type { Recipe } from "./recipe"

/** The engine the editor and the runner share: the core modules, a recipe's own, a light and a grid. */
export const createEngine = (recipe: Recipe, options: CatalystOptions & { grid?: boolean } = {}): Catalyst => {
  const { grid = true, ...rest } = options
  const engine = new Catalyst({
    background: 0x15181d,
    pixelRatio: 2,
    log: (message, tag) => console.debug(`[${tag ?? "catalyst"}] ${message}`),
    ...rest,
    modules: [new Physics({ gravity: 9.8 }), new Input(), new Interaction(), new Resources(), new Splats({ capacity: 500_000 }), ...(recipe.modules?.() ?? []), ...(rest.modules ?? [])],
  })
  engine.scene.add(new HemisphereLight(0xffffff, 0x334455, 2))
  if (grid) engine.scene.add(DebugShapes.grid({ size: 40, colour: 0x2a2f3a }))
  return engine
}
