// How far the editor is from compiling against the Rust engine's runtime: the editor type-checked with
// `@nickpaustian/catalyst` pointed at `@nickpaustian/catalyst-rs/runtime-types`, the errors counted, and the
// names the runtime lacks listed by how often they are wanted. Zero is when the editor can switch engines.
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
let output = ""
try {
  output = execFileSync("npx", ["tsc", "--noEmit", "-p", "tsconfig.rust.json", "--pretty", "false"], { cwd: join(here, "../apps/editor"), encoding: "utf8" })
} catch (error) {
  output = String(error.stdout ?? "")
}
const lines = output.split("\n").filter((line) => line.includes("error TS"))
const counts = new Map()
const note = (key) => counts.set(key, (counts.get(key) ?? 0) + 1)
for (const line of lines) {
  const missingExport = /has no exported member (?:named )?'([^']+)'/.exec(line)
  const missingMember = /Property '([^']+)' does not exist on type '([^']+)'/.exec(line)
  const notFound = /Cannot find (?:name|module) '([^']+)'/.exec(line)
  if (missingExport) note(`export ${missingExport[1]}`)
  else if (missingMember) note(`${missingMember[2].replace(/<.*>/, "").slice(0, 40)}.${missingMember[1]}`)
  else if (notFound) note(`missing ${notFound[1]}`)
  else note(`other: ${line.replace(/^.*error TS\d+: /, "").slice(0, 90)}`)
}
const sorted = [...counts].sort((a, b) => b[1] - a[1])
console.log(`${lines.length} errors against the Rust runtime`)
for (const [key, count] of sorted.slice(0, Number(process.argv[2] ?? 60))) console.log(`${String(count).padStart(4)}  ${key}`)
