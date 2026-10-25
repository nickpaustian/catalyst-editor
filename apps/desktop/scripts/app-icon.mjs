// Compiles the Liquid Glass icon (src-tauri/icons/Catalyst.icon) into Assets.car with actool, for
// tauri.conf.json to copy into the bundle beside icon.icns. Tauri's own .icon support hands actool
// a copy without the icon's Assets folder, and actool fails on it; compiling it here sidesteps that.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

if (process.platform !== "darwin") process.exit(0)
const icons = join(dirname(fileURLToPath(import.meta.url)), "../src-tauri/icons")
const out = join(icons, "build")
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
execFileSync("xcrun", [
  "actool", join(icons, "Catalyst.icon"),
  "--compile", out,
  "--output-format", "human-readable-text", "--errors",
  "--app-icon", "Catalyst",
  "--output-partial-info-plist", join(out, "partial.plist"),
  "--platform", "macosx",
  "--target-device", "mac",
  "--minimum-deployment-target", "10.13",
], { stdio: ["ignore", "ignore", "inherit"] })
if (!existsSync(join(out, "Assets.car"))) {
  console.error("app-icon: actool wrote no Assets.car; it needs Xcode 26 or later")
  process.exit(1)
}
console.log(`app-icon: ${join(out, "Assets.car")}`)
