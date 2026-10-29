import { Runner, createEngine, sceneRecipe, type Recipe } from "@nickpaustian/catalyst-editor"
import { boot } from "./boot"
import { desktop } from "./desktop"

const recipes: Recipe[] = [sceneRecipe]

document.addEventListener("DOMContentLoaded", async () => {
  const recipe = recipes.find((r) => r.name === new URLSearchParams(location.search).get("recipe")) ?? recipes[0]
  await boot()
  const engine = createEngine(recipe, { container: "#app", grid: false })
  engine.start()
  const shell = await desktop()
  const runner = new Runner(engine, recipe, { folders: shell?.folders, link: shell?.runnerPageLink, debug: new URLSearchParams(location.search).has("debug") })
  Object.assign(window, { engine, runner })
})
