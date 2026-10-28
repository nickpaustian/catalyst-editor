// Stands in for `@nickpaustian/catalyst-rs` when it is not linked: the editor then offers the TypeScript engine only.
export default async (): Promise<never> => {
  throw new Error("@nickpaustian/catalyst-rs is not linked; build it with catalyst-rs/scripts/build-wasm.sh and run `npm run link:rust`")
}
export class Engine {}
export class Viewport {}
export const create_viewport = async (): Promise<never> => {
  throw new Error("@nickpaustian/catalyst-rs is not linked")
}
