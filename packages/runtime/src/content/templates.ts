import type { TextAsset } from "@vitrine/assets"
import type { ExhibitionAssets } from "../assets/registers"
import ManagerRegistry from "../managers/ManagerRegistry"
import { Template } from "../managers/Template"
import { Catalyst, nextTick } from "@vitrine/catalyst"
import Spektra from "@vitrine/spektra"
import { bindAccordions } from "../utils"
import { bindModeOptions } from "../utils/modal/bindModeOptions"
import SimpleBar from "simplebar"
import "simplebar/dist/simplebar.css"

type ScrollForwardCleanup = () => void

type SimpleBarElement = HTMLElement & {
  _simpleBar?: SimpleBar
  _scrollForwardCleanup?: ScrollForwardCleanup
}

function bindScrollForwarding(
  el: HTMLElement,
  host: HTMLElement
): ScrollForwardCleanup {
  const scrollEl = el.querySelector<HTMLElement>(".simplebar-content-wrapper")
  if (!scrollEl) return () => {}

  const onWheel = (e: WheelEvent) => {
    // If the event already originated inside the scroll area, let SimpleBar handle it natively.
    if (scrollEl.contains(e.target as Node)) return
    e.preventDefault()
    scrollEl.scrollBy({
      top: e.deltaY,
      left: e.deltaX,
      behavior: "auto",
    })
  }

  let touchStartY = 0
  const onTouchStart = (e: TouchEvent) => {
    touchStartY = e.touches[0].clientY
  }
  const onTouchMove = (e: TouchEvent) => {
    if (scrollEl.contains(e.target as Node)) return
    const currentY = e.touches[0].clientY
    const deltaY = touchStartY - currentY
    touchStartY = currentY
    scrollEl.scrollTop += deltaY
    e.preventDefault()
  }

  host.addEventListener("wheel", onWheel, { passive: false })
  host.addEventListener("touchstart", onTouchStart, { passive: true })
  host.addEventListener("touchmove", onTouchMove, { passive: false })

  return () => {
    host.removeEventListener("wheel", onWheel)
    host.removeEventListener("touchstart", onTouchStart)
    host.removeEventListener("touchmove", onTouchMove)
  }
}

export function initScrollbar(el: SimpleBarElement) {
  el._simpleBar = new SimpleBar(el)

  // Forward scroll events from the whole modal so the article scrolls
  // wherever the cursor / finger happens to be.
  const host =
    (document.getElementById("modal-inner") as HTMLElement | null) ?? el
  el._scrollForwardCleanup = bindScrollForwarding(el, host)
}

export function destroyScrollbar(el: SimpleBarElement) {
  el._scrollForwardCleanup?.()
  el._scrollForwardCleanup = undefined
  el._simpleBar?.unMount()
}

const initModal = (): void => {
  const btn = document.getElementById("btn-resume")
  if (!btn) return
  btn.addEventListener("click", () => {
    Catalyst._.signals.game.onResume.emit()
  })

  const backdrop = document.getElementById("modal-inner")

  if (backdrop) {
    backdrop.addEventListener("pointerup", (e) => {
      const target = e.target as Element | null
      if (
        target?.closest(".modal-article") ||
        target?.closest(".spektra-image") ||
        target?.closest(".modal-quote-wrapper")
      )
        return
      Catalyst._.signals.game.onResume.emit()
    })
  }

  Catalyst._.signals.game.onModalOpen.subscribe(() => {
    const article = document.getElementById("modal-content")
    if (!article) return
    article.classList.add("visible")
  })

  // Handle scrollables if present
  const scrollEl = document.querySelector(".scrollable") as HTMLElement

  if (scrollEl) {
    nextTick(() => {
      initScrollbar(scrollEl)
    })
  }

  // Handle Spektra inline images
  const creditEl = document.querySelector(".image-credit") as HTMLElement
  const spektraInlineEls = document.querySelectorAll(".expandable-image")

  spektraInlineEls.forEach((el, i) => {
    if (!el.id) el.id = `expandable-image-${i}`
    const selector = `#${el.id}`
    new Spektra(selector, {
      padding: 150,
      minScale: 0.75,
      mode: "inline",
      onExpandStart: () => {
        if (scrollEl) scrollEl.classList.add("hidden")
        if (creditEl) creditEl.classList.remove("cloaked")
      },
      onCollapseStart: () => {
        if (scrollEl) scrollEl.classList.remove("hidden")
        if (creditEl) creditEl.classList.add("cloaked")
      },
    })
  })

  const spektraExpanded = document.querySelector(".modal-image") as HTMLElement
  if (spektraExpanded) {
    new Spektra(".modal-image", {
      padding: 100,
      minScale: 0.75,
    })
  }
}

const resetModal = (): void => {
  const article = document.getElementById("modal-content")
  if (!article) return
  article.classList.remove("visible")

  document.querySelectorAll(".expandable-image").forEach((el) => {
    Spektra.destroy(`#${el.id}`)
  })

  const spektraExpanded = document.querySelector(".modal-image") as HTMLElement
  if (spektraExpanded) {
    Spektra.destroy(".modal-image")
  }

  const scrollEl = document.querySelector(".scrollable") as HTMLElement
  if (scrollEl) destroyScrollbar(scrollEl)
}

export interface ExhibitionContent {
  pause: Template
  byId: Record<string, Template>
}

const pauseTemplate = (asset: TextAsset): Template =>
  new Template({
    asset,
    onLoad: () => {
      ManagerRegistry._.state.isPaused = true

      const html = document.getElementById("pause-menu")

      if (html) {
        bindAccordions(html)
        bindModeOptions(html)
      }

      const btn = document.getElementById("btn-resume")

      if (btn) {
        btn.addEventListener("click", () => {
          Catalyst._.signals.game.onResume.emit()
        })
      }

      const soundBtn = document.getElementById("btn-sound")

      if (soundBtn) {
        soundBtn.addEventListener("click", () => {
          ManagerRegistry._.state.toggleMute()
        })
      }
    },
    onUnload: () => {
      ManagerRegistry._.state.isPaused = false
    },
  })

const contentTemplate = (asset: TextAsset): Template =>
  new Template({
    asset,
    onLoad: () => {
      initModal()
    },
    onUnload: () => {
      resetModal()
    },
  })

/** One Template per manifest content entry, plus the pause menu. */
export const buildContent = (exhibition: ExhibitionAssets): ExhibitionContent => {
  const byId = Object.fromEntries(
    Array.from(exhibition.contentById, ([id, asset]) => [id, contentTemplate(asset)])
  )

  return { pause: pauseTemplate(exhibition.menu), byId }
}
