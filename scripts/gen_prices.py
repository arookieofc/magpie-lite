#!/usr/bin/env python3
"""Regenerate crates/router/src/prices.json from upstream magpie's bundled
models.dev snapshot (internal/catalog/bundled/api.json.gz).

Usage: python scripts/gen_prices.py
"""
import gzip
import json
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UPSTREAM = ROOT.parent / "magpie" / "internal" / "catalog" / "bundled" / "api.json.gz"
OUT = ROOT / "crates" / "router" / "src" / "prices.json"

# Host -> models.dev provider id, for vendors whose catalog entry carries no
# `api` URL (the majors) or whose api URL is not the host a provider config
# would name.
EXTRA = {
    "api.openai.com": "openai",
    "api.anthropic.com": "anthropic",
    "api.x.ai": "xai",
    "api.groq.com": "groq",
    "generativelanguage.googleapis.com": "google",
    "open.bigmodel.cn": "zhipuai",
    "dashscope.aliyuncs.com": "alibaba-cn",
    "dashscope-intl.aliyuncs.com": "alibaba",
    "api.moonshot.cn": "moonshotai-cn",
    "api.moonshot.ai": "moonshotai",
    "api.deepseek.com": "deepseek",
    "api.siliconflow.cn": "siliconflow-cn",
    "api.siliconflow.com": "siliconflow",
    "openrouter.ai": "openrouter",
    "integrate.api.nvidia.com": "nvidia",
    "api.z.ai": "zai",
    "api.cline.bot": "cline-pass",
    "api.minimax.cn": "minimax-cn",
    "api.minimax.io": "minimax",
    "ark.cn-beijing.volces.com": "volcengine",
    "api.stepfun.com": "stepfun",
    "api.stepfun.ai": "stepfun-ai",
}


def main() -> None:
    data = json.loads(gzip.decompress(UPSTREAM.read_bytes()))
    host_prices: dict[str, dict[str, dict]] = {}

    def add(host: str, pid: str) -> None:
        prov = data.get(pid)
        if not prov:
            return
        table = host_prices.setdefault(host, {})
        for mid, model in prov.get("models", {}).items():
            cost = model.get("cost") or {}
            inp, out = cost.get("input"), cost.get("output")
            if inp is None or out is None:
                continue
            entry = {"input": inp, "output": out}
            if cost.get("cache_read"):
                entry["cache_read"] = cost["cache_read"]
            if cost.get("cache_write"):
                entry["cache_write"] = cost["cache_write"]
            table.setdefault(mid, entry)

    # Providers that declare their own api URL.
    for pid, prov in data.items():
        api = prov.get("api")
        if not api or "${" in api:
            continue
        host = (urllib.parse.urlparse(api).hostname or "").lower()
        if not host or host in ("127.0.0.1", "localhost"):
            continue
        add(host, pid)

    for host, pid in EXTRA.items():
        add(host, pid)

    out = {h: m for h, m in sorted(host_prices.items()) if m}
    OUT.write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
        encoding="utf-8",
    )
    print(f"wrote {OUT}: {len(out)} hosts")


if __name__ == "__main__":
    main()
