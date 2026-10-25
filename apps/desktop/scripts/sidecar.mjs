// Builds Iapetus for the app's target and puts it where Tauri's externalBin looks for it:
// src-tauri/binaries/iapetus-<target triple>, stripped. A universal macOS build gets both
// architectures merged. The source is $IAPETUS_SRC, or the iapetus repository beside this one.
import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(process.env.IAPETUS_SRC ?? join(here, "../../../../iapetus"))
const manifest = join(source, "Cargo.toml")
if (!existsSync(manifest)) {
  console.error(`sidecar: no Iapetus source at ${source}; clone it there or set IAPETUS_SRC`)
  process.exit(1)
}
const host = /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))[1]
const target = process.env.TAURI_ENV_TARGET_TRIPLE || host
const exe = target.includes("windows") ? ".exe" : ""
const run = (command, args) => execFileSync(command, args, { stdio: "inherit" })

const build = (triple) => {
  run("cargo", ["build", "--release", "--manifest-path", manifest, "--target", triple])
  return join(source, "target", triple, "release", `iapetus${exe}`)
}

const out = join(here, "../src-tauri/binaries")
mkdirSync(out, { recursive: true })
const destination = join(out, `iapetus-${target}${exe}`)
if (target === "universal-apple-darwin") {
  run("lipo", ["-create", "-output", destination, build("aarch64-apple-darwin"), build("x86_64-apple-darwin")])
} else {
  copyFileSync(build(target), destination)
}
if (!exe) run("strip", ["-x", destination])
console.log(`sidecar: ${destination}`)
