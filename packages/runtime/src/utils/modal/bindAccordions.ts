export const bindAccordions: (html: HTMLElement) => void = (html) => {
  const accordions = html.querySelectorAll(".accordion")

  accordions.forEach((accordion) => {
    const header = accordion.querySelector(".accordion-header")
    header?.addEventListener("click", () => {
      accordion.classList.toggle("open")
    })
  })
}
