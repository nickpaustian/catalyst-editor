import { Runner, createEngine, sceneRecipe, type Recipe } from "@vitrine/editor"

const recipes: Recipe[] = [sceneRecipe]

document.addEventListener("DOMContentLoaded", () => {
  const recipe = recipes.find((r) => r.name === new URLSearchParams(location.search).get("recipe")) ?? recipes[0]
  const engine = createEngine(recipe, { container: "#app", grid: false })
  engine.start()
  const runner = new Runner(engine, recipe)
  Object.assign(window, { engine, runner })
})
