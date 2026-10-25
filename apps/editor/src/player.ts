import { AssetFolder, HttpFolder, Runner, SCENE_FILE, createEngine, sceneRecipe } from "@nickpaustian/catalyst-editor"

/** A published project: the scene and its files beside this page, played as a run plays them. */
document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(location.search)
  const engine = createEngine(sceneRecipe, { container: "#app", grid: false })
  engine.start()
  const runner = new Runner(engine, sceneRecipe, { link: null, debug: params.has("debug") })
  Object.assign(window, { engine, runner })
  try {
    const folder = await AssetFolder.open(new HttpFolder(new URL("./project/", location.href)))
    await runner.playProject(await folder.readJSON(SCENE_FILE), folder)
  } catch (error) {
    document.getElementById("failed")!.textContent = `This project could not be opened: ${error instanceof Error ? error.message : String(error)}`
    throw error
  }
})
