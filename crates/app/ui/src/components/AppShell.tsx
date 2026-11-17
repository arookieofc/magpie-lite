import type { ReactNode } from "react";
import { useT } from "../i18n";

/* Astryx AppShell anatomy (lightweight port):
   skip link + sideNav slot + topNav slot + main landmark.
   Mobile drawer omitted: the Tauri window has a 960px minimum width and
   the rail collapses to icons below 860px instead. */

export default function AppShell({
  sideNav,
  topBar,
  overlay,
  children,
}: {
  sideNav: ReactNode;
  topBar: ReactNode;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        {t("shell.skip")}
      </a>
      {sideNav}
      <div className="shell-column">
        {topBar}
        <main className="main" id="main" tabIndex={-1}>
          {children}
        </main>
      </div>
      {overlay}
    </div>
  );
}
