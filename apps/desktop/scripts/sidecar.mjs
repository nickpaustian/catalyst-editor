// Builds the sidecars for the app's target and puts them where Tauri's externalBin looks:
// src-tauri/binaries/<name>-<target triple>, stripped. A universal macOS build gets both
// architectures merged. Iapetus comes from $IAPETUS_SRC or the iapetus repository beside
// this one and is required; the native runner comes from $CATALYST_RS_SRC or the
// catalyst-rs repository beside this one and is skipped with a note when absent.
import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const host = /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))[1]
const target = process.env.TAURI_ENV_TARGET_TRIPLE || host
const exe = target.includes("windows") ? ".exe" : ""
const run = (command, args) => execFileSync(command, args, { stdio: "inherit" })
const out = join(here, "../src-tauri/binaries")
mkdirSync(out, { recursive: true })

/** Build one cargo package's binary for the target and place it as a sidecar. */
const sidecar = ({ name, source, args }) => {
  const manifest = join(source, "Cargo.toml")
  const build = (triple) => {
    run("cargo", ["build", "--release", "--manifest-path", manifest, "--target", triple, ...args])
    return join(source, "target", triple, "release", `${name}${exe}`)
  }
  const destination = join(out, `${name}-${target}${exe}`)
  if (target === "universal-apple-darwin") {
    run("lipo", ["-create", "-output", destination, build("aarch64-apple-darwin"), build("x86_64-apple-darwin")])
  } else {
    copyFileSync(build(target), destination)
  }
  if (!exe) run("strip", ["-x", destination])
  console.log(`sidecar: ${destination}`)
}

const iapetus = resolve(process.env.IAPETUS_SRC ?? join(here, "../../../../iapetus"))
if (!existsSync(join(iapetus, "Cargo.toml"))) {
  console.error(`sidecar: no Iapetus source at ${iapetus}; clone it there or set IAPETUS_SRC`)
  process.exit(1)
}
sidecar({ name: "iapetus", source: iapetus, args: [] })

const catalystRs = resolve(process.env.CATALYST_RS_SRC ?? join(here, "../../../../catalyst-rs"))
if (existsSync(join(catalystRs, "Cargo.toml"))) sidecar({ name: "catalyst-runner", source: catalystRs, args: ["-p", "catalyst-runner"] })
else console.warn(`sidecar: no catalyst-rs source at ${catalystRs}; the app ships without the native runner (set CATALYST_RS_SRC to add it)`)
