import ManagerRegistry from "../../managers/ManagerRegistry"

const setActive = (
  html: HTMLElement,
  target: "interactive" | "guided"
): void => {
  const options = html.querySelectorAll(".menu-mode-selector-option")

  options.forEach((opt) => {
    opt.classList.contains(target)
      ? opt.classList.add("active")
      : opt.classList.remove("active")
  })
}

export const bindModeOptions: (html: HTMLElement) => void = (html) => {
  const managers = ManagerRegistry.getInstance()

  const options = html.querySelectorAll(".menu-mode-selector-option")

  setActive(html, !managers.state.isGuidedCamera ? "interactive" : "guided")

  options.forEach((option) => {
    option?.addEventListener("click", () => {
      const interactiveMode = option.classList.contains("interactive")
      if (
        (interactiveMode && managers.state.isGuidedCamera) ||
        (!interactiveMode && !managers.state.isGuidedCamera)
      )
        managers.scene.toggleCamera()
      setActive(html, !managers.state.isGuidedCamera ? "interactive" : "guided")
    })
  })
}
