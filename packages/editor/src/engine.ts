import { Catalyst, DebugShapes, type CatalystOptions } from "@nickpaustian/catalyst"
import { Input } from "@nickpaustian/catalyst/input"
import { Interaction } from "@nickpaustian/catalyst/interaction"
import { Physics } from "@nickpaustian/catalyst/physics"
import { Resources } from "@nickpaustian/catalyst/resources"
import type { Recipe } from "./recipe"
import { color } from "./tokens/tokens"

const hex = (css: string): number => parseInt(css.replace("#", ""), 16)

/** The engine the editor and the runner share: the core modules, a recipe's own, the default lights and a grid. */
export const createEngine = (recipe: Recipe, options: CatalystOptions & { grid?: boolean } = {}): Catalyst => {
  const { grid = true, ...rest } = options
  const engine = new Catalyst({
    background: 0x15181d,
    pixelRatio: 2,
    log: (message, tag) => console.debug(`[${tag ?? "catalyst"}] ${message}`),
    ...rest,
    modules: [new Physics({ gravity: 9.8 }), new Input(), new Interaction(), new Resources(), ...(recipe.modules?.() ?? []), ...(rest.modules ?? [])],
  })
  if (grid) engine.scene.add(DebugShapes.grid({ size: 40, colour: hex(color.border.default) }))
  return engine
}
