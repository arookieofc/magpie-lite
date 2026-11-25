import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { hueOf, initials } from "../util";
import { useT } from "../i18n";

export type Tone = "good" | "bad" | "warn" | "accent" | "neutral";

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-heading">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {children ? <div className="page-actions">{children}</div> : null}
    </header>
  );
}

export function Card({
  title,
  icon,
  description,
  actions,
  children,
  className = "",
  flush = false,
  labelledBy,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  flush?: boolean;
  labelledBy?: string;
}) {
  return (
    <section className={`card ${className}`} aria-labelledby={labelledBy}>
      {title || actions ? (
        <div className="card-head">
          <div className="card-title">
            {icon ? <span className="card-icon">{icon}</span> : null}
            <div>
              {title ? <h2 id={labelledBy}>{title}</h2> : null}
              {description ? <p>{description}</p> : null}
            </div>
          </div>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? "card-body flush" : "card-body"}>{children}</div>
    </section>
  );
}

export function Badge({
  tone = "neutral",
  dot = false,
  children,
  title,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge ${tone}`} data-tip={title}>
      {dot ? <span className="badge-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      className={`avatar ${size}`}
      style={{ "--hue": hueOf(name) } as React.CSSProperties}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function Field({
  label,
  htmlFor,
  help,
  children,
  className = "",
  hidden,
}: {
  label: ReactNode;
  htmlFor?: string;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
  hidden?: boolean;
}) {
  return (
    <div className={`field ${className}`} hidden={hidden}>
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="field-label">{label}</span>}
      {children}
      {help ? <p className="help">{help}</p> : null}
    </div>
  );
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="form-section">
      <div className="form-section-head">
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="form-section-body">{children}</div>
    </section>
  );
}

export function Notice({
  tone = "neutral",
  icon,
  children,
  live = false,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  live?: boolean;
}) {
  return (
    <div
      className={`notice ${tone}`}
      role={live ? "status" : undefined}
      aria-live={live ? "polite" : undefined}
    >
      {icon ? <span className="notice-icon">{icon}</span> : null}
      <div className="notice-body">{children}</div>
    </div>
  );
}

export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon ? <span className="empty-icon">{icon}</span> : null}
      <p className="empty-title">{title}</p>
      {children ? <p className="empty-copy">{children}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[];
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          disabled={disabled || option.disabled}
          data-tip={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch-track" aria-hidden="true" />
      <span className="switch-label">{children}</span>
    </label>
  );
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className="tab-btn"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({
  open,
  onClose,
  title,
  description,
  icon,
  footer,
  children,
  onSubmit,
  busy,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  onSubmit?: (e: FormEvent) => void;
  busy?: boolean;
  wide?: boolean;
}) {
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const t = useT();
  const requestClose = () => {
    if (!busyRef.current) closeRef.current();
  };

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const first =
      node?.querySelector<HTMLElement>("[data-autofocus]") ??
      node?.querySelector<HTMLElement>(
        ".sheet-body input:not([readonly]):not([disabled]), .sheet-body select:not([disabled]), .sheet-body textarea:not([disabled])",
      );
    (first ?? node)?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!busyRef.current) closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const inner = (
    <>
      <header className="sheet-head">
        {icon ? <span className="sheet-icon">{icon}</span> : null}
        <div className="sheet-title">
          <h2 id="sheet-title">{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label={t("common.closePanel")}
          disabled={busy}
          onClick={requestClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="sheet-body">{children}</div>
      {footer ? <footer className="sheet-foot">{footer}</footer> : null}
    </>
  );

  return createPortal(
    <div className="sheet-layer">
      <div className="sheet-scrim" onClick={requestClose} aria-hidden="true" />
      {onSubmit ? (
        <form
          ref={panel as React.RefObject<HTMLFormElement>}
          className={`sheet${wide ? " wide" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="sheet-title"
          aria-busy={busy}
          autoComplete="off"
          noValidate
          tabIndex={-1}
          onSubmit={onSubmit}
        >
          {inner}
        </form>
      ) : (
        <aside
          ref={panel}
          className={`sheet${wide ? " wide" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="sheet-title"
          aria-busy={busy}
          tabIndex={-1}
        >
          {inner}
        </aside>
      )}
    </div>,
    document.body,
  );
}
