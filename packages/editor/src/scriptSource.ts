/**
 * Edits to a script file's source that leave the rest of the file as it was:
 * the entries of a static array (`static connections = [...]`,
 * `static signals = [...]`) added, replaced or removed one at a time, and a
 * method added to the class. Only the default-exported class is touched, and
 * an array the file builds some other way is left for the person to edit.
 */

const isIdent = (c: string | undefined) => c !== undefined && /[\w$]/.test(c)

/** Index just past a string, template literal or comment starting at `i`, or `i` when none starts there. */
const skipLiteral = (s: string, i: number): number => {
  const c = s[i]
  if (c === "/" && s[i + 1] === "/") {
    const end = s.indexOf("\n", i)
    return end < 0 ? s.length : end
  }
  if (c === "/" && s[i + 1] === "*") {
    const end = s.indexOf("*/", i + 2)
    return end < 0 ? s.length : end + 2
  }
  if (c === '"' || c === "'") {
    let j = i + 1
    while (j < s.length && s[j] !== c && s[j] !== "\n") j += s[j] === "\\" ? 2 : 1
    return j + 1
  }
  if (c === "`") {
    let j = i + 1
    while (j < s.length && s[j] !== "`") {
      if (s[j] === "\\") j += 2
      else if (s[j] === "$" && s[j + 1] === "{") j = closing(s, j + 1) + 1
      else j++
    }
    return j + 1
  }
  return i
}

const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}" }

/** The index of the bracket that closes the one at `at`. */
const closing = (s: string, at: number): number => {
  const stack = [OPEN[s[at]]]
  let i = at + 1
  while (i < s.length) {
    const skipped = skipLiteral(s, i)
    if (skipped !== i) {
      i = skipped
      continue
    }
    const c = s[i]
    if (OPEN[c]) stack.push(OPEN[c])
    else if (c === stack[stack.length - 1]) {
      stack.pop()
      if (!stack.length) return i
    }
    i++
  }
  return -1
}

/** Positions between `start` and `end` that sit at the top level, not in brackets, strings or comments. */
function* topLevel(s: string, start: number, end: number): Generator<number> {
  let i = start
  while (i < end) {
    const skipped = skipLiteral(s, i)
    if (skipped !== i) {
      i = skipped
      continue
    }
    if (OPEN[s[i]]) {
      yield i
      i = closing(s, i) + 1
      if (i === 0) return
      continue
    }
    yield i
    i++
  }
}

interface ClassBody {
  /** Just inside the class's `{`. */
  start: number
  /** The class's closing `}`. */
  end: number
}

const classBody = (s: string): ClassBody | null => {
  const head = /export\s+default\s+(?:abstract\s+)?class\b/.exec(s)
  if (!head) return null
  for (const i of topLevel(s, head.index, s.length)) {
    if (s[i] !== "{") continue
    const end = closing(s, i)
    return end < 0 ? null : { start: i + 1, end }
  }
  return null
}

/** A static array in the class: where it is, and each entry's text. */
export interface StaticArray {
  /** The array's `[`. */
  open: number
  /** The array's `]`. */
  close: number
  entries: { start: number; end: number; text: string }[]
}

/** The class's `static <name> = [...]`: null when there is none, "unreadable" when it is not written as an array. */
export const staticArray = (s: string, name: string): StaticArray | null | "unreadable" => {
  const body = classBody(s)
  if (!body) return null
  const member = new RegExp(`^static\\s+(?:readonly\\s+)?${name}\\b\\s*(?::[^=;\\n]*)?=\\s*`)
  for (const i of topLevel(s, body.start, body.end)) {
    if (s[i] !== "s" || isIdent(s[i - 1])) continue
    const found = member.exec(s.slice(i, i + 200))
    if (!found) continue
    const open = i + found[0].length
    if (s[open] !== "[") return "unreadable"
    const close = closing(s, open)
    if (close < 0) return "unreadable"
    const entries: StaticArray["entries"] = []
    let from = open + 1
    const cut = (to: number) => {
      const raw = s.slice(from, to)
      const lead = raw.length - raw.trimStart().length
      const text = raw.trim()
      if (text) entries.push({ start: from + lead, end: from + lead + text.length, text })
    }
    for (const j of topLevel(s, open + 1, close)) {
      if (s[j] !== ",") continue
      cut(j)
      from = j + 1
    }
    cut(close)
    return { open, close, entries }
  }
  return null
}

/** An entry's values, read as the plain data it should be, or null when it is not. */
export const readEntry = <T>(text: string): T | null => {
  try {
    const value = new Function(`return (${text})`)() as unknown
    return typeof value === "object" && value !== null ? (value as T) : null
  } catch {
    return null
  }
}

/** An object of strings as an entry: `{ from: "Door", signal: "onPressed", call: "open" }`, its keys in the order given and empty ones left out. */
export const writeEntry = (value: Record<string, string | undefined>): string =>
  `{ ${Object.entries(value)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(", ")} }`

const indentAt = (s: string, at: number): string => {
  const line = s.lastIndexOf("\n", at - 1) + 1
  return /^[ \t]*/.exec(s.slice(line))![0]
}

/** The indentation of the class's members, from its first member or two spaces. */
const memberIndent = (s: string, body: ClassBody): string => {
  const first = /\n([ \t]+)\S/.exec(s.slice(body.start, body.end))
  return first ? first[1] : "  "
}

/** `entry` added at the end of the class's `static <name>`, which is made after the other statics when there is none. Null when the array cannot be edited. */
export const addEntry = (s: string, name: string, entry: string, type?: string): string | null => {
  const array = staticArray(s, name)
  if (array === "unreadable") return null
  if (array) {
    const last = array.entries[array.entries.length - 1]
    const multiline = s.slice(array.open, array.close).includes("\n")
    if (!last) return `${s.slice(0, array.open + 1)}${entry}${s.slice(array.close)}`
    const between = s.slice(last.end, array.close)
    const comma = between.trimStart().startsWith(",")
    const after = comma ? last.end + between.indexOf(",") + 1 : last.end
    const separator = multiline ? `\n${indentAt(s, last.start)}` : " "
    return `${s.slice(0, after)}${comma ? "" : ","}${separator}${entry}${comma && multiline ? "," : ""}${s.slice(after)}`
  }
  const body = classBody(s)
  if (!body) return null
  const indent = memberIndent(s, body)
  const declaration = `${indent}static ${name}${type ? `: ${type}` : ""} = [${entry}]\n`
  if (!s.slice(body.start, body.end).trim()) return `${s.slice(0, body.start)}\n${declaration}${s.slice(body.end)}`
  // After the last static field at the top of the class, else first.
  let at = s.indexOf("\n", body.start) + 1
  const statics = /^[ \t]*static\s+(?!(?:async\s+)?[\w$]+\s*\()/
  let line = at
  while (line < body.end) {
    const next = s.indexOf("\n", line)
    const text = s.slice(line, next < 0 ? body.end : next)
    if (!text.trim()) break
    if (!statics.test(text) || text.includes("{") && !text.includes("}")) break
    const open = text.indexOf("[")
    const ends = open >= 0 && !text.includes("]") ? closing(s, line + open) : line + text.length
    line = s.indexOf("\n", ends) + 1
    at = line
  }
  return `${s.slice(0, at)}${declaration}${s.slice(at)}`
}

/** The entry at `index` of the class's `static <name>` replaced by `entry`, or taken out when `entry` is null. */
export const changeEntry = (s: string, name: string, index: number, entry: string | null): string | null => {
  const array = staticArray(s, name)
  if (!array || array === "unreadable") return null
  const target = array.entries[index]
  if (!target) return null
  if (entry !== null) return `${s.slice(0, target.start)}${entry}${s.slice(target.end)}`
  const next = array.entries[index + 1]
  const previous = array.entries[index - 1]
  if (next) return `${s.slice(0, target.start)}${s.slice(next.start)}`
  if (previous) return `${s.slice(0, previous.end)}${s.slice(target.end).replace(/^\s*,/, "")}`
  return `${s.slice(0, array.open + 1)}${s.slice(array.close)}`
}

/** Whether the class has a method of that name. */
export const hasMethod = (s: string, name: string): boolean => {
  const body = classBody(s)
  if (!body) return false
  const method = new RegExp(`^(?:(?:public|protected|private|async|static)\\s+)*${name}\\s*(?:<[^>]*>)?\\(`)
  for (const i of topLevel(s, body.start, body.end)) if (isIdent(s[i]) && !isIdent(s[i - 1]) && method.test(s.slice(i, i + 120))) return true
  return false
}

/** An empty method added at the end of the class, for a signal to call. */
export const addMethod = (s: string, name: string, parameter = "value: unknown"): string | null => {
  const body = classBody(s)
  if (!body) return null
  const indent = memberIndent(s, body)
  const empty = !s.slice(body.start, body.end).trim()
  const before = s.slice(0, body.end).replace(/\s*$/, "")
  return `${before}\n${empty ? "" : "\n"}${indent}${name}(${parameter}) {\n${indent}}\n${s.slice(body.end)}`
}
