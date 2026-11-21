#!/usr/bin/env python3
"""
Token Launch Radar — make.fun bounty prototype.

Ranks tokenless DeFi protocols by the implied value of a hypothetical
future token launch, using only the public DefiLlama API.

Improvements over the "Patient Index" competitor submission (2026-11-16):
  1. Strict, explicit derivative exclusion (wrapped / staked / bridged
     single-asset products, canonical L2 bridges, CEX reserve balances,
     children of already-tokenized parents) — each rule is a named,
     auditable step in the code and counted in the run log.
  2. A single, clearly defined growth window: DefiLlama's `change_7d`
     field (the /protocols endpoint exposes only change_1h/1d/7d —
     there is no 1-month field, so any "monthly growth" claim built on
     this endpoint is undefined). Missing growth data is neutral (1.0)
     and flagged per entry, never silently treated as 0% or dropped.
  3. A per-entry human-readable explanation of every multiplier.
  4. A separate 0-100 "launch likelihood" score, so implied value
     (how big) is not conflated with likelihood (how probable).
  5. board.json is sorted by implied value descending, so implied
     values are monotonic non-increasing by construction; slugs are
     unique (asserted).

Reproduce:
    python3 token_launch_radar.py            # fetches live data
    python3 token_launch_radar.py --offline snapshot.json

Outputs: board.json, summary.md (in the same directory as this script)
Data source: https://api.llama.fi/protocols (no key required)
Stdlib only — no pip installs needed.
"""

import argparse
import json
import math
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_URL = "https://api.llama.fi/protocols"
HERE = Path(__file__).resolve().parent

MIN_TVL = 5_000_000          # board inclusion floor (matches competitor base)
WATCHLIST_TVL = 50_000_000   # "watchlist" flag threshold (matches competitor)

EXCLUDE_CATEGORIES = {"CEX"}
EXCLUDE_CATEGORIES.update({"Canonical Bridge"})
DERIVATIVE_CATEGORIES = {"Restaked BTC", "Anchor BTC", "Decentralized BTC",
                         "Stablecoin Wrapper"}
KNOWN_TOKENIZED_PARENTS = {
    "chainlink", "circle", "aster", "gmx", "ethena", "ipor-protocol",
    "solv-protocol", "rhea-finance", "wemix.fi",
}
DERIVATIVE_SLUGS = {
    "wbtc", "usdt0", "unit", "fassets", "function-fbtc", "stacks-sbtc",
    "nexus-btc", "exsat-staking-btc", "bitget-bgbtc", "kraken-bitcoin",
    "binance-bitcoin", "coinbase-bridge", "usdd", "forward-industries-sol",
    "dfdv-staked-sol", "bittensor-dtao", "sthype",
}
LST_PRODUCT_RE = re.compile(r"\bLSTs?\b")
ISSUER_PRODUCT_RE = re.compile(
    r"^(binance|coinbase|bybit|bitget|kraken|gate)\b.*\b(staked|wrapped|bitcoin|bridge)\b"
    r"|\b(binance|coinbase|bybit|bitget|kraken|gate) (staked|wrapped)\b",
    re.IGNORECASE,
)
WRAPPED_RE = re.compile(r"\bwrapped\b", re.IGNORECASE)
TICKER_ONLY_RE = re.compile(r"^[A-Z][A-Z0-9]{1,5}$")
STABLECOIN_PRODUCT_RE = re.compile(r"^[a-z]{0,4}usd[a-z0-9]{0,3}$", re.IGNORECASE)

CATEGORY_MULTIPLE = {
    "Derivatives": 0.90, "Prediction Market": 0.80, "Chain": 0.80,
    "Dexs": 0.60, "OTC Marketplace": 0.50,
    "Lending": 0.45, "RWA": 0.45,
    "CDP": 0.40, "Insurance": 0.40, "Privacy": 0.40, "Crypto Card Issuer": 0.40,
    "Bridge": 0.35, "Cross Chain Bridge": 0.35, "CDP Manager": 0.35,
    "Basis Trading": 0.35, "Options Vault": 0.35,
    "Collateral Markets": 0.35, "Uncollateralized Lending": 0.35,
    "Risk Curators": 0.30, "Onchain Capital Allocator": 0.30,
    "Liquid Staking": 0.30, "Liquid Restaking": 0.30, "Restaking": 0.30,
    "Payments": 0.30, "CeDeFi": 0.30,
    "Yield": 0.25, "Yield Aggregator": 0.25, "Liquidity Manager": 0.25,
    "Indexes": 0.25,
    "Staking Pool": 0.20, "Leveraged Farming": 0.20, "Dual-Token Stablecoin": 0.20,
    "Farm": 0.15, "Governance Incentives": 0.15,
}
DEFAULT_CATEGORY_MULTIPLE = 0.30


def size_multiplier(tvl: float) -> float:
    if tvl < 25_000_000:
        return 1.15
    if tvl < 100_000_000:
        return 1.05
    if tvl < 500_000_000:
        return 1.00
    if tvl < 2_000_000_000:
        return 0.90
    return 0.80


def growth_multiplier(change_7d):
    if change_7d is None:
        return 1.0
    clamped = max(-30.0, min(60.0, float(change_7d)))
    return 1.0 + clamped / 200.0


def maturity_multiplier(age_days):
    if age_days is None:
        return 0.90
    if age_days < 180:
        return 0.75
    if age_days < 730:
        return 0.95
    if age_days < 1460:
        return 1.10
    return 1.00


def likelihood_score(p, tvl, age_days):
    tvl_part = 35 * (math.log10(tvl) - math.log10(MIN_TVL)) / (
        math.log10(3_000_000_000) - math.log10(MIN_TVL))
    tvl_part = max(0.0, min(35.0, tvl_part))
    chg = p.get("change_7d")
    growth_part = 0.0 if chg is None else 20 * max(0.0, min(1.0, (float(chg) + 10) / 40))
    if age_days is None:
        maturity_part = 8.0
    elif age_days < 180:
        maturity_part = 5.0
    elif age_days < 730:
        maturity_part = 12.0
    elif age_days < 1460:
        maturity_part = 20.0
    else:
        maturity_part = 15.0
    chain_part = 10 * min(len(p.get("chains") or []), 10) / 10
    signal_part = 0.0
    audits = p.get("audits")
    if p.get("audit_links") or (audits not in (None, "0", 0)):
        signal_part += 7.5
    if p.get("twitter"):
        signal_part += 3.75
    if p.get("github"):
        signal_part += 3.75
    return round(tvl_part + growth_part + maturity_part + chain_part + signal_part, 1)


def exclusion_reason(p):
    cat = p.get("category")
    name = p.get("name") or ""
    slug = p.get("slug") or ""
    if cat in EXCLUDE_CATEGORIES:
        return f"category:{cat}"
    if cat in DERIVATIVE_CATEGORIES:
        return f"derivative-category:{cat}"
    if p.get("parentProtocolSlug") in KNOWN_TOKENIZED_PARENTS:
        return f"tokenized-parent:{p['parentProtocolSlug']}"
    if slug in DERIVATIVE_SLUGS:
        return "derivative-asset:blocklist"
    if WRAPPED_RE.search(name):
        return "derivative-name:wrapped"
    if LST_PRODUCT_RE.search(name):
        return "derivative-name:lst-product"
    if ISSUER_PRODUCT_RE.search(name):
        return "derivative-name:issuer-product"
    if TICKER_ONLY_RE.match(name.strip()) and cat in ("Bridge", "Cross Chain Bridge"):
        return "derivative-name:asset-ticker"
    words = name.split()
    if p.get("parentProtocolSlug") and words and STABLECOIN_PRODUCT_RE.match(words[-1]):
        return "derivative-name:stablecoin-product"
    return None


def is_tokenless(p):
    if p.get("symbol") != "-":
        return False
    if p.get("gecko_id") or p.get("cmcId"):
        return False
    if p.get("mcap"):
        return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", help="read a saved /protocols JSON snapshot instead of fetching")
    args = ap.parse_args()

    if args.offline:
        raw = Path(args.offline).read_bytes()
        fetched_at = datetime.fromtimestamp(Path(args.offline).stat().st_mtime, tz=timezone.utc)
    else:
        req = urllib.request.Request(API_URL, headers={"User-Agent": "token-launch-radar/1.0"})
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read()
        fetched_at = datetime.now(timezone.utc)
        (HERE / "snapshot_protocols.json").write_bytes(raw)

    protocols = json.loads(raw)
    snapshot_date = fetched_at.strftime("%Y-%m-%d")
    counts = {"total_protocols": len(protocols)}
    print(f"snapshot: {snapshot_date} ({fetched_at.isoformat()})  total={len(protocols)}")

    tokenless = [p for p in protocols if is_tokenless(p)]
    counts["tokenless_strict"] = len(tokenless)
    base = [p for p in tokenless if (p.get("tvl") or 0) >= MIN_TVL]
    counts["tokenless_tvl_ge_5m"] = len(base)

    excluded = {}
    board = []
    for p in base:
        reason = exclusion_reason(p)
        if reason:
            key = reason.split(":")[0] if reason.startswith("category") else reason
            excluded[reason] = excluded.get(reason, 0) + 1
            continue
        tvl = float(p["tvl"])
        listed_at = p.get("listedAt")
        age_days = None
        if listed_at:
            age_days = int((fetched_at - datetime.fromtimestamp(listed_at, tz=timezone.utc)).days)
        cat_mult = CATEGORY_MULTIPLE.get(p.get("category"), DEFAULT_CATEGORY_MULTIPLE)
        size_mult = size_multiplier(tvl)
        grow_mult = growth_multiplier(p.get("change_7d"))
        mat_mult = maturity_multiplier(age_days)
        implied = tvl * cat_mult * size_mult * grow_mult * mat_mult
        chg = p.get("change_7d")
        explanation = (
            f"TVL ${tvl:,.0f} x category {p.get('category')} {cat_mult:.2f} "
            f"x size {size_mult:.2f} x growth(7d {chg if chg is not None else 'n/a'}%) "
            f"{grow_mult:.3f} x maturity(age {age_days if age_days is not None else 'unknown'}d) "
            f"{mat_mult:.2f} = ${implied:,.0f}"
        )
        if chg is None:
            explanation += " [growth data unavailable: neutral 1.0]"
        if age_days is None:
            explanation += " [listedAt unavailable: maturity 0.90]"
        board.append({
            "rank": 0,
            "name": p["name"],
            "slug": p["slug"],
            "url": p.get("url"),
            "category": p.get("category"),
            "chains": p.get("chains") or [],
            "chain_count": len(p.get("chains") or []),
            "tvl_usd": round(tvl, 2),
            "change_7d_pct": chg,
            "change_1d_pct": p.get("change_1d"),
            "age_days": age_days,
            "watchlist_50m_plus": tvl >= WATCHLIST_TVL,
            "category_multiple": cat_mult,
            "size_multiplier": size_mult,
            "growth_multiplier": round(grow_mult, 4),
            "maturity_multiplier": mat_mult,
            "implied_value_usd": round(implied, 2),
            "likelihood_score": likelihood_score(p, tvl, age_days),
            "explanation": explanation,
        })

    board.sort(key=lambda e: e["implied_value_usd"], reverse=True)
    for i, e in enumerate(board, 1):
        e["rank"] = i

    slugs = [e["slug"] for e in board]
    assert len(slugs) == len(set(slugs)), "duplicate slugs!"
    vals = [e["implied_value_usd"] for e in board]
    assert all(vals[i] >= vals[i + 1] for i in range(len(vals) - 1)), "not monotonic!"

    counts["excluded_total"] = sum(excluded.values())
    counts["excluded_by_reason"] = dict(sorted(excluded.items(), key=lambda kv: -kv[1]))
    counts["board_entries"] = len(board)
    counts["watchlist_50m_plus"] = sum(1 for e in board if e["watchlist_50m_plus"])

    out = {
        "meta": {
            "title": "Token Launch Radar",
            "generated_at": fetched_at.isoformat(),
            "snapshot_date": snapshot_date,
            "data_source": API_URL,
            "model_version": "1.0",
            "formula": "implied_value = TVL x category_multiple x size_multiplier "
                       "x growth_multiplier(change_7d) x maturity_multiplier(age)",
            "counts": counts,
        },
        "board": board,
    }
    (HERE / "board.json").write_text(json.dumps(out, indent=2, ensure_ascii=False))

    lines = [f"# Token Launch Radar — results summary ({snapshot_date})", "",
             f"- Total protocols in snapshot: {counts['total_protocols']:,}",
             f"- Strictly tokenless (symbol '-', no gecko/cmc id, no mcap): {counts['tokenless_strict']:,}",
             f"- Tokenless with TVL >= $5M: {counts['tokenless_tvl_ge_5m']}",
             f"- Excluded by derivative/CEX/canonical/tokenized-parent rules: {counts['excluded_total']}",
             f"- Final board entries: {counts['board_entries']} "
             f"(of which TVL >= $50M watchlist: {counts['watchlist_50m_plus']})", "",
             "## Exclusions by reason", ""]
    for k, v in counts["excluded_by_reason"].items():
        lines.append(f"- {k}: {v}")
    lines += ["", "## Top 20", "",
              "| # | Protocol | Category | TVL | 7d % | Implied value | Likelihood |",
              "|---|----------|----------|----:|-----:|--------------:|-----------:|"]
    for e in board[:20]:
        chg = "n/a" if e["change_7d_pct"] is None else f"{e['change_7d_pct']:+.1f}"
        lines.append(f"| {e['rank']} | {e['name']} | {e['category']} | "
                     f"${e['tvl_usd']:,.0f} | {chg} | ${e['implied_value_usd']:,.0f} | "
                     f"{e['likelihood_score']} |")
    (HERE / "summary.md").write_text("\n".join(lines) + "\n")

    print(json.dumps(counts, indent=2))
    print("\nTop 10:")
    for e in board[:10]:
        print(f"  {e['rank']:>3}. {e['name']:<32} TVL ${e['tvl_usd']/1e6:>9,.1f}M  "
              f"implied ${e['implied_value_usd']/1e6:>9,.1f}M  score {e['likelihood_score']}")
    print(f"\nwrote {HERE/'board.json'} and {HERE/'summary.md'}")


if __name__ == "__main__":
    main()
