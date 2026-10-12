export const ResourceType = {
  MODEL: "model",
  TEXTURE: "texture",
  AUDIO: "audio",
  IMAGE: "image",
  SPLAT: "splat",
  HDRI: "hdri",
} as const

export type ResourceType = (typeof ResourceType)[keyof typeof ResourceType]
