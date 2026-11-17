import { useEffect, useRef } from "react";

// One shared tooltip for the whole console, mounted once in App. Any
// element carrying `data-tip` gets it; `data-tip-attr="aria-label"`
// reads the label instead for icon buttons that already name
// themselves. Behavior mirrors the reference's rail tip: the first
// hover waits 450ms, hopping between tipped elements moves it at once,
// and it flips sides at the window's edge. Native `title=` is left
// alone where a long text is genuinely a tooltip; short ones were
// converted to data-tip so both are never shown.
const DELAY_MS = 450;
const WARM_MS = 400;

export default function Tooltip() {
  const tipRef = useRef<HTMLDivElement | null>(null);
  const state = useRef({ timer: 0, shownAt: 0, target: null as Element | null });

  useEffect(() => {
    const s = state.current;
    const tipOf = (el: Element | null): { el: Element; text: string } | null => {
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        const tip = node.getAttribute?.("data-tip");
        if (tip) return { el: node, text: tip };
        if (node.getAttribute?.("data-tip-attr") === "aria-label") {
          const label = node.getAttribute("aria-label");
          if (label) return { el: node, text: label };
        }
      }
      return null;
    };
    const hide = () => {
      window.clearTimeout(s.timer);
      s.target = null;
      const tip = tipRef.current;
      if (tip?.classList.contains("on")) {
        tip.classList.remove("on");
        s.shownAt = performance.now();
      }
    };
    const show = (found: { el: Element; text: string }) => {
      if (!found.el.isConnected) return;
      if (!tipRef.current) {
        tipRef.current = document.createElement("div");
        tipRef.current.className = "tip";
        tipRef.current.setAttribute("role", "tooltip");
        document.body.append(tipRef.current);
      }
      const tip = tipRef.current;
      tip.textContent = found.text;
      const r = found.el.getBoundingClientRect();
      tip.classList.add("on");
      // Measure after it is visible: place below by default, above when
      // the bottom edge is near, centered but clamped to the window.
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      let left = r.left + r.width / 2 - tw / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
      let top = r.bottom + 7;
      if (top + th > window.innerHeight - 8) top = Math.max(8, r.top - 7 - th);
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
      s.shownAt = performance.now();
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const found = tipOf(e.target as Element);
      if (!found) {
        if (s.target) hide();
        return;
      }
      if (s.target === found.el && tipRef.current?.classList.contains("on")) return;
      window.clearTimeout(s.timer);
      s.target = found.el;
      const warm =
        tipRef.current?.classList.contains("on") ||
        performance.now() - s.shownAt < WARM_MS;
      if (warm) show(found);
      else s.timer = window.setTimeout(() => show(found), DELAY_MS);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      tipRef.current?.remove();
      tipRef.current = null;
    };
  }, []);

  return null;
}
