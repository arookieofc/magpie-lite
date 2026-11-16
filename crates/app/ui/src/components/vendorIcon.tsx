import { useState } from "react";
import { Avatar } from "./ui";
import type { VendorPreset } from "../types";

export function hostOf(url: string): string {
  const bare = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0];
  return (bare.split(":")[0] || bare).toLowerCase();
}

function presetUrls(pr: VendorPreset): string[] {
  return [pr.chat, pr.responses, pr.anthropic, pr.gemini].filter((u): u is string => !!u);
}

// Match an already-configured provider to the vendor catalog by host,
// so the row list can reuse the same logo the Add sheet tile shows.
export function presetIconForHost(
  presets: VendorPreset[] | null | undefined,
  host: string,
): string | null {
  if (!presets || !host) return null;
  const want = host.toLowerCase();
  for (const pr of presets) {
    if (!pr.icon) continue;
    if (presetUrls(pr).some((u) => hostOf(u) === want)) return pr.icon;
  }
  return null;
}

export default function VendorIcon({
  name,
  icon,
  size = "md",
}: {
  name: string;
  icon?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  if (!icon || failed) return <Avatar name={name} size={size} />;
  const src = `icons/${icon}`;
  // `-color` files are full-color pictures rendered directly; the rest
  // are single-tone masks tinted to the theme text color.
  if (icon.includes("-color")) {
    return (
      <span className={`vicon ${size}`} aria-hidden="true">
        <img className="vicon-img" src={src} alt="" onError={() => setFailed(true)} />
        <img
          className="vicon-probe"
          src={src}
          alt=""
          aria-hidden="true"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  return (
    <span className={`vicon ${size}`} aria-hidden="true">
      <span
        className="vicon-mask"
        style={{ maskImage: `url(${src})`, WebkitMaskImage: `url(${src})` }}
      />
      <img
        className="vicon-probe"
        src={src}
        alt=""
        aria-hidden="true"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
