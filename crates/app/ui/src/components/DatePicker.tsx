import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { useLocale, useT } from "../i18n";

const POP_W = 288;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function sameDay(a: Date | null, b: Date | null): boolean {
  return (
    !!a &&
    !!b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function DatePicker({
  value,
  onChange,
  id,
  placeholder,
  ariaLabel,
  withTime = false,
  disabled = false,
  align = "start",
  className = "",
}: {
  value: Date | null;
  onChange: (d: Date | null) => void;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  withTime?: boolean;
  disabled?: boolean;
  align?: "start" | "end";
  className?: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const tag = locale === "zh" ? "zh-CN" : "en-US";
  const weekStart = locale === "zh" ? 1 : 0;
  const autoId = useId();
  const titleId = `${id ?? autoId}-title`;

  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Date>(() => startOfMonth(value ?? new Date()));
  const [focusDay, setFocusDay] = useState<Date>(() => startOfDay(value ?? new Date()));
  const [pos, setPos] = useState({ top: 0, left: 0, up: false });

  const displayFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(
        tag,
        withTime
          ? { dateStyle: "medium", timeStyle: "medium" }
          : { dateStyle: "medium" },
      ),
    [tag, withTime],
  );
  const monthFmt = useMemo(
    () => new Intl.DateTimeFormat(tag, { month: "long", year: "numeric" }),
    [tag],
  );
  const dayFmt = useMemo(
    () => new Intl.DateTimeFormat(tag, { dateStyle: "full" }),
    [tag],
  );
  const weekdayFmt = useMemo(
    () => new Intl.DateTimeFormat(tag, { weekday: "narrow" }),
    [tag],
  );

  const weekdays = useMemo(() => {
    const sunday = new Date(2024, 0, 7);
    return Array.from({ length: 7 }, (_, i) =>
      weekdayFmt.format(addDays(sunday, weekStart + i)),
    );
  }, [weekdayFmt, weekStart]);

  const cells = useMemo(() => {
    const first = startOfMonth(view);
    const lead = (first.getDay() - weekStart + 7) % 7;
    const start = addDays(first, -lead);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [view, weekStart]);

  function place() {
    const btn = btnRef.current;
    const pop = popRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const h = pop?.offsetHeight ?? 340;
    let top = rect.bottom + 6;
    let up = false;
    if (top + h > window.innerHeight - 8 && rect.top - h - 6 > 8) {
      top = rect.top - h - 6;
      up = true;
    }
    let left = align === "end" ? rect.right - POP_W : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - POP_W - 8));
    setPos({ top, left, up });
  }

  function openPicker() {
    const base = value ?? new Date();
    setView(startOfMonth(base));
    setFocusDay(startOfDay(base));
    setOpen(true);
  }

  function closePicker(refocus = true) {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }

  useLayoutEffect(() => {
    if (!open) return;
    place();
    function onDown(e: PointerEvent) {
      const el = e.target as Node;
      if (popRef.current?.contains(el) || btnRef.current?.contains(el)) return;
      setOpen(false);
    }
    function onMove() {
      place();
    }
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = popRef.current?.querySelector<HTMLElement>(
      `[data-day="${dayKey(focusDay)}"]`,
    );
    el?.focus();
  }, [open, focusDay]);

  function moveFocus(day: Date) {
    setFocusDay(day);
    if (!sameMonth(day, view)) setView(startOfMonth(day));
  }

  function pick(day: Date) {
    const h = value?.getHours() ?? 0;
    const m = value?.getMinutes() ?? 0;
    const s = value?.getSeconds() ?? 0;
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, s);
    onChange(next);
    setFocusDay(startOfDay(day));
    if (!withTime) closePicker();
  }

  function setTime(part: "h" | "m" | "s", raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 2);
    if (digits === "") return;
    const max = part === "h" ? 23 : 59;
    const n = Math.min(max, parseInt(digits, 10));
    const base = value ? new Date(value) : new Date(focusDay);
    if (part === "h") base.setHours(n);
    if (part === "m") base.setMinutes(n);
    if (part === "s") base.setSeconds(n);
    base.setMilliseconds(0);
    onChange(base);
  }

  function onGridKey(e: React.KeyboardEvent) {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (e.key in moves) {
      e.preventDefault();
      moveFocus(addDays(focusDay, moves[e.key]));
      return;
    }
    if (e.key === "PageDown") {
      e.preventDefault();
      moveFocus(addMonths(focusDay, e.shiftKey ? -12 : 1));
      return;
    }
    if (e.key === "PageUp") {
      e.preventDefault();
      moveFocus(addMonths(focusDay, e.shiftKey ? 12 : -1));
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closePicker();
    }
  }

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const today = new Date();

  const popover = open ? (
    <div
      ref={popRef}
      className={`dp-pop${pos.up ? " up" : ""}`}
      style={{ top: pos.top, left: pos.left, width: POP_W }}
      role="dialog"
      aria-modal="false"
      aria-label={ariaLabel ?? placeholder ?? t("dp.placeholder")}
      onKeyDown={onGridKey}
    >
      <div className="dp-head">
        <span className="dp-title" id={titleId}>
          {monthFmt.format(view)}
        </span>
        <span className="dp-nav">
          <button
            type="button"
            className="icon-btn tiny"
            aria-label={t("dp.prevMonth")}
            onClick={() => setView(addMonths(view, -1))}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            className="icon-btn tiny"
            aria-label={t("dp.nextMonth")}
            onClick={() => setView(addMonths(view, 1))}
          >
            <ChevronRight size={14} />
          </button>
        </span>
      </div>
      <div className="dp-grid" role="grid" aria-labelledby={titleId}>
        {weekdays.map((w, i) => (
          <span key={i} className="dp-wd" role="columnheader">
            {w}
          </span>
        ))}
        {cells.map((day) => {
          const sel = sameDay(day, value);
          const inMonth = sameMonth(day, view);
          const isToday = sameDay(day, today);
          const focused = sameDay(day, focusDay);
          return (
            <button
              key={dayKey(day)}
              type="button"
              role="gridcell"
              data-day={dayKey(day)}
              tabIndex={focused ? 0 : -1}
              className={`dp-day${inMonth ? "" : " out"}${sel ? " sel" : ""}${isToday ? " today" : ""}`}
              aria-label={`${dayFmt.format(day)}${sel ? `, ${t("dp.selected")}` : ""}`}
              aria-pressed={sel}
              onClick={() => pick(day)}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
      {withTime ? (
        <div className="dp-time">
          <Clock size={13} aria-hidden="true" />
          {(["h", "m", "s"] as const).map((part, i) => (
            <Fragment key={part}>
              {i > 0 ? <span className="dp-sep">:</span> : null}
              <input
                className="input"
                inputMode="numeric"
                aria-label={
                  part === "h" ? t("dp.hours") : part === "m" ? t("dp.minutes") : t("dp.seconds")
                }
                value={
                  value
                    ? pad2(
                        part === "h"
                          ? value.getHours()
                          : part === "m"
                            ? value.getMinutes()
                            : value.getSeconds(),
                      )
                    : ""
                }
                placeholder="00"
                onFocus={(e) => e.target.select()}
                onChange={(e) => setTime(part, e.target.value)}
              />
            </Fragment>
          ))}
        </div>
      ) : null}
      <div className="dp-foot">
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            onChange(null);
            closePicker();
          }}
        >
          {t("req.clear")}
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            const now = new Date();
            onChange(withTime ? now : startOfDay(now));
            setView(startOfMonth(now));
            setFocusDay(startOfDay(now));
            if (!withTime) closePicker();
          }}
        >
          {t("dp.today")}
        </button>
        {withTime ? (
          <button type="button" className="btn sm" onClick={() => closePicker()}>
            {t("dp.done")}
          </button>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <span className={`dp ${className}`}>
      <button
        ref={btnRef}
        id={id}
        type="button"
        className={`dp-trigger input${value ? "" : " is-empty"}`}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openPicker())}
      >
        <span className="dp-text">
          {value ? displayFmt.format(value) : (placeholder ?? t("dp.placeholder"))}
        </span>
        <CalendarDays size={14} className="dp-ico" aria-hidden="true" />
      </button>
      {popover ? createPortal(popover, document.body) : null}
    </span>
  );
}

export function DatePickerBlock({
  value,
  onChange,
  label,
  placeholder,
  helperText,
  id,
  disabled,
}: {
  value: Date | null;
  onChange: (d: Date | null) => void;
  label?: string;
  placeholder?: string;
  helperText?: string;
  id?: string;
  disabled?: boolean;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const t = useT();
  return (
    <div className="field dp-block">
      {label ? <label htmlFor={inputId}>{label}</label> : null}
      <DatePicker
        value={value}
        onChange={onChange}
        id={inputId}
        placeholder={placeholder ?? t("dp.placeholder")}
        disabled={disabled}
      />
      {helperText ? <p className="help">{helperText}</p> : null}
    </div>
  );
}
