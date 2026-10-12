declare global {
  const __DEBUG__: boolean
}

interface DebugType {
  [key: string]: string
}

export const debugTypes: DebugType = {
  error: "#bf203e",
  warning: "#ff9900",
  info: "#0099ff",
  ready: "#0099ff",
  debug: "#ad48c1",
  success: "#58ce4e",
  performance: "#69c1c6",
}

let muted = false

/** Silence debug() output, e.g. while benchmarking. */
export const muteDebug = (mute: boolean): void => {
  muted = mute
}

export const debug = __DEBUG__
  ? (messages: any | any[], type?: string, colour?: string) => {
      if (muted) return
      let typeColour = "#ad48c1"
      let typeText = "DEBUG"
      if (typeof debugTypes !== "undefined") {
        typeColour = debugTypes?.["debug"] || typeColour
      }
      if (type) {
        typeText = type.toUpperCase()
        if (typeof debugTypes !== "undefined") {
          typeColour = debugTypes?.[type] || typeColour
        }
      }
      if (colour) typeColour = colour
      const parsedMessages = Array.isArray(messages) ? messages : [messages]
      console.log(
        `%c[${typeText}]%c`,
        `color: ${typeColour};`,
        "",
        ...parsedMessages
      )
    }
  : () => {}
