import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  id?: string;
  className?: string;
  mono?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  placeholder?: string;
}

// The one dropdown every picker shares, styled like the reference's
// picker popover: the menu grows out of the button it drops from, flips
// up when the window's edge is near, answers arrows and Enter/Escape,
// and closes on an outside press. A native `<select>` stays in the DOM
// only as the hidden form/screen-reader peer.
export default function Select({
  value,
  onChange,
  options,
  id,
  className = "",
  mono = false,
  disabled = false,
  placeholder = "",
  ...rest
}: Props) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0 });
  const [active, setActive] = useState(-1);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const ariaLabel = rest["aria-label"];

  const selected = options.find((o) => o.value === value);

  const place = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const est = Math.min(320, 40 + options.length * 32);
    const fitsBelow = r.bottom + 6 + est <= window.innerHeight - 8;
    const fitsAbove = r.top - 6 - est >= 8;
    const flip = !fitsBelow && fitsAbove;
    setUp(flip);
    setRect({ left: r.left, top: flip ? r.top : r.bottom, width: Math.max(r.width, 180) });
  }, [options.length]);

  const openMenu = () => {
    if (disabled) return;
    place();
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const closeMenu = () => setOpen(false);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (
        !btnRef.current?.contains(e.target as Node) &&
        !popRef.current?.contains(e.target as Node)
      ) {
        closeMenu();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeMenu();
        btnRef.current?.focus();
      }
    };
    const onMove = () => place();
    document.addEventListener("pointerdown", onDoc, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("pointerdown", onDoc, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open || active < 0) return;
    popRef.current
      ?.querySelector(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const step = (dir: 1 | -1) => {
    if (!options.length) return;
    let i = active;
    for (let n = 0; n < options.length; n++) {
      i = (i + dir + options.length) % options.length;
      if (!options[i].disabled) break;
    }
    setActive(i);
  };

  const onButtonKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open ? step(e.key === "ArrowUp" ? -1 : 1) : openMenu();
    }
  };
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      step(e.key === "ArrowUp" ? -1 : 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = options[active];
      if (opt && !opt.disabled) {
        onChange(opt.value);
        closeMenu();
        btnRef.current?.focus();
      }
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(options.findIndex((o) => !o.disabled));
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1 - [...options].reverse().findIndex((o) => !o.disabled));
    } else if (e.key === "Tab") {
      closeMenu();
    }
  };

  const pop = open ? (
    <div
      ref={popRef}
      id={listId}
      role="listbox"
      aria-label={ariaLabel}
      className={`sel-pop${up ? " up" : ""}`}
      style={{
        left: rect.left,
        width: rect.width,
        ...(up
          ? { bottom: window.innerHeight - rect.top + 6 }
          : { top: rect.top + 6 }),
      }}
      onKeyDown={onMenuKey}
    >
      {options.map((opt, i) => (
        <button
          key={opt.value || `empty-${i}`}
          type="button"
          role="option"
          data-idx={i}
          aria-selected={opt.value === value}
          disabled={opt.disabled}
          title={opt.title}
          className={`sel-opt${i === active ? " hot" : ""}${opt.value === value ? " on" : ""}`}
          onMouseEnter={() => setActive(i)}
          onClick={() => {
            onChange(opt.value);
            closeMenu();
            btnRef.current?.focus();
          }}
        >
          <span className="sel-opt-label">{opt.label}</span>
          {opt.value === value ? <Check size={14} className="sel-opt-check" /> : null}
        </button>
      ))}
      {options.length === 0 ? <span className="sel-empty" /> : null}
    </div>
  ) : null;

  return (
    <>
      <select
        id={id}
        className="sel-peer"
        aria-hidden="true"
        tabIndex={-1}
        value={value}
        onChange={() => {}}
      >
        {options.map((o, i) => (
          <option key={o.value || `empty-${i}`} value={o.value}>
            {typeof o.label === "string" ? o.label : o.value}
          </option>
        ))}
      </select>
      <button
        ref={btnRef}
        type="button"
        className={`input sel${mono ? " mono" : ""}${className ? ` ${className}` : ""}${open ? " open" : ""}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onButtonKey}
      >
        <span className={`sel-value${selected ? "" : " ph"}`}>
          {selected ? selected.label : placeholder || " "}
        </span>
        <ChevronDown size={14} className="sel-chev" aria-hidden="true" />
      </button>
      {pop ? createPortal(pop, document.body) : null}
    </>
  );
}
