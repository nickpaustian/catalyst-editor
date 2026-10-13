export const removeDebugCalls = (code) => {
  let result = ""
  let i = 0

  while (i < code.length) {
    const match = code.slice(i).match(/^(?:debug|trace)\s*\(/)
    const prevChar = i > 0 ? code[i - 1] : " "

    if (match && /[\s\W]/.test(prevChar)) {
      let depth = 1
      let j = i + match[0].length

      while (j < code.length && depth > 0) {
        if (code[j] === "(" && code[j - 1] !== "\\") depth++
        else if (code[j] === ")" && code[j - 1] !== "\\") depth--
        j++
      }

      let end = j
      if (code[end] === ";") {
        end++
      }

      result += "void 0"
      i = end
    } else {
      result += code[i]
      i++
    }
  }

  return result
}

/** Replaces every debug(...) and trace(...) call with `void 0` outside node_modules. */
export const stripDebug = () => ({
  name: "strip-debug",
  enforce: "pre",
  transform(code, id) {
    if (id.includes("node_modules")) return null
    if (/\.(js|ts|jsx|tsx)$/.test(id)) {
      return { code: removeDebugCalls(code), map: null }
    }
  },
})
