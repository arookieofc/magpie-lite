import { TriangleAlert, OctagonX, X } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "../i18n";

/* Dismissible incident banner (idea borrowed from devl `incident-banner`).
 * Simplified to what a local gateway needs: one severity, one title, one
 * body, an optional retry action and a dismiss button. */
export default function NoticeBanner({
  tone,
  title,
  children,
  actionLabel,
  onAction,
  onDismiss,
}: {
  tone: "bad" | "warn";
  title: string;
  children: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}) {
  const t = useT();
  const Icon = tone === "bad" ? OctagonX : TriangleAlert;
  return (
    <div className={`notice-banner ${tone}`} role="alert">
      <span className="notice-banner-rail" aria-hidden="true" />
      <span className="notice-banner-icon">
        <Icon size={16} aria-hidden="true" />
      </span>
      <div className="notice-banner-body">
        <p className="notice-banner-title">{title}</p>
        <div className="notice-banner-copy">{children}</div>
      </div>
      {actionLabel && onAction ? (
        <button type="button" className="btn sm" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          className="icon-btn"
          aria-label={t("banner.dismiss")}
          data-tip={t("banner.dismiss")}
          onClick={onDismiss}
        >
          <X size={15} />
        </button>
      ) : null}
    </div>
  );
}
