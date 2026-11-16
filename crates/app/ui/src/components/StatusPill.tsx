import { useT } from "../i18n";

export type GatewayState = "checking" | "online" | "offline";

/* Status pill (idea borrowed from devl `status-pill`): a compact gateway
 * state indicator for the TopBar. Ours is dependency-free and reduced to
 * the three states this console actually has. */
export default function StatusPill({
  state,
  sync,
}: {
  state: GatewayState;
  sync: string;
}) {
  const t = useT();
  const label =
    state === "online"
      ? t("topbar.online")
      : state === "offline"
        ? t("topbar.offline")
        : t("topbar.checking");
  return (
    <div className={`status-pill ${state}`} role="status" aria-live="polite" title={sync}>
      <span className="status-dot" aria-hidden="true" />
      <span className="status-label">{label}</span>
      <span className="status-sync">{sync}</span>
    </div>
  );
}
