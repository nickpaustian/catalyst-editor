export const ResourceType = {
  MODEL: "model",
  TEXTURE: "texture",
  AUDIO: "audio",
  IMAGE: "image",
  SPLAT: "splat",
  HDRI: "hdri",
  JSON: "json",
  TEXT: "text",
} as const

export type ResourceType = (typeof ResourceType)[keyof typeof ResourceType]
