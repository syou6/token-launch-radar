# Token Launch Radar

A ranked board of **tokenless DeFi protocols most likely — and most
valuable — to launch a token**, built entirely from public DefiLlama data.

Built as a working prototype for the make.fun "Token Launch Radar"
bounty ($1,325, deadline 2026-12-14 19:00 JST). Local prototype only —
not yet submitted.

## Quick start

```bash
python3 token_launch_radar.py            # fetch live data, write board.json + summary.md
python3 token_launch_radar.py --offline snapshot_protocols.json   # rerun on the saved snapshot
```

Stdlib only (Python 3.10+), no API key. The raw API response is saved to
`snapshot_protocols.json` on every live run so any board can be audited
and reproduced byte-for-byte against its snapshot.

## Outputs

| File | Contents |
|---|---|
| `board.json` | Full ranked board with meta (snapshot date, counts), per-entry multipliers, implied value, likelihood score, and a plain-English explanation per entry |
| `summary.md` | Run counts, exclusions by reason, top 20 table |
| `snapshot_protocols.json` | Raw DefiLlama `/protocols` response used for the run |

## Data

- Source: `https://api.llama.fi/protocols` (DefiLlama, public, no key)
- Snapshot for the current board: **2026-11-21 (UTC)**, 9,086 protocols
- Fields used: `tvl`, `change_7d`, `change_1d`, `listedAt`, `category`,
  `chains`, `symbol`, `gecko_id`, `cmcId`, `mcap`, `parentProtocolSlug`,
  `audits`/`audit_links`, `twitter`, `github`

## Methodology

### 1. Tokenless, strictly defined
A protocol counts as tokenless only if **all** hold: DefiLlama `symbol`
is `"-"`, `gecko_id` is empty, `cmcId` is empty, and `mcap` is empty/0.
On the current snapshot: 4,379 of 9,086 protocols pass.

### 2. Size floor
TVL ≥ **$5M** → 330 protocols. Entries with TVL ≥ $50M are flagged
`watchlist_50m_plus` (52 on the final board).

### 3. Derivative & non-candidate exclusions (103 excluded)
Applied in order, each counted in `summary.md`:

| Rule | Why | Count |
|---|---|---:|
| Category = CEX | TVL is custodial exchange reserves, not protocol TVL | 43 |
| Category = Canonical Bridge | The bridge belongs to the L2, which already has a token | 14 |
| Category ∈ {Restaked BTC, Anchor BTC, Decentralized BTC, Stablecoin Wrapper} | TVL *is* a derivative asset | 8 |
| Parent already tokenized (`chainlink`, `circle`, `aster`, `gmx`, `ethena`, `ipor-protocol`, `solv-protocol`, `rhea-finance`, `wemix.fi`) | Child TVL already accrues to the parent token (e.g. CCIP → LINK) | 9 |
| Explicit asset blocklist (`wbtc`, `usdt0`, `unit`, `function-fbtc`, `stacks-sbtc`, `bittensor-dtao`, `sthype`, …) | The "protocol" is a single wrapped/staked asset itself | 17 |
| Name patterns: "wrapped", issuer staking products (Binance/Coinbase/… staked/wrapped), asset-ticker-only names, parented stablecoin products (thUSD, avUSD…), named LST products ("X LST") | Same derivative problem, caught generically | 12 |

This is the main correction to a naive TVL ranking: without it, the top
of the board is Bybit/Bitfinex reserve balances, WBTC, Binance staked
ETH and Base Bridge — none of which is a protocol about to launch a token.

### 4. Valuation model
```
implied_value = TVL × category_multiple × size_multiplier
              × growth_multiplier × maturity_multiplier
```

- **Category multiple** — heuristic FDV/TVL anchored on the low end of
  observed ranges for comparable *tokenized* protocols in the same
  category (Derivatives 0.90, Dexs 0.60, Lending 0.45, Risk Curators
  0.30, Yield 0.25, Farm 0.15, default 0.30; full table in the script).
- **Size multiplier** — tiered: <$25M 1.15 · <$100M 1.05 · <$500M 1.00 ·
  <$2B 0.90 · ≥$2B 0.80 (FDV/TVL compresses at scale).
- **Growth multiplier** — window is **DefiLlama `change_7d` only**:
  `1 + clamp(change_7d, −30, +60)/200` → 0.85–1.30. The `/protocols`
  endpoint exposes only `change_1h/1d/7d`; there is no 1-month field, so
  no undefined "monthly growth" is used. Missing data = neutral 1.0 and
  flagged in the entry's explanation.
- **Maturity multiplier** — from `listedAt` age at snapshot: <180d 0.75 ·
  <2y 0.95 · 2–4y 1.10 · >4y 1.00 · unknown 0.90 (flagged).

### 5. Likelihood score (0–100, separate from value)
TVL (log scale) 35 + 7d growth 20 + maturity 20 + multi-chain breadth
10 + transparency signals (audits, Twitter, GitHub) 15. Ranking is by
implied value; the score lets readers separate "big" from "likely".

### 6. Guarantees
`board.json` is sorted by implied value descending (monotonic
non-increasing, asserted in code), slugs are unique (asserted), and
every entry carries an `explanation` string showing its exact arithmetic.

## How this differs from the "Patient Index" submission (2026-11-16)

| | Patient Index | This prototype |
|---|---|---|
| Snapshot | 2026-11-14, TVL $5M+ → 758 protocols* | 2026-11-21, 9,086 protocols total |
| Tokenless filter | Undisclosed test | symbol `-` **and** no gecko/cmc id **and** no mcap |
| Derivatives | "Excluded" (method undisclosed) | 6 named, counted, auditable rules (103 exclusions) |
| Growth window | "Growth multiplier", window undefined | `change_7d` only, formula + caps published; missing = neutral, flagged |
| Ranking count | 198 ranked / 40 watchlist ($50M+) | 227 ranked / 52 watchlist ($50M+) |
| Per-entry explanation | Not described | Full arithmetic string per entry |
| Extra signal | — | Separate 0–100 likelihood score |

*Their 758 count appears to use a looser tokenless test; our strict test
yields 330 at the same $5M floor before derivative exclusions.

## Known limitations

- Category multiples are heuristics for ranking, not price predictions.
- Risk-curator / capital-allocator TVL can overlap underlying lending
  TVL on DefiLlama (possible double counting across entries).
- `listedAt` is when DefiLlama listed the protocol, a proxy for age.
- A parent protocol that is itself tokenless (e.g. Polymarket) keeps its
  child deployments as candidates; only *tokenized* parents exclude.
- Point-in-time snapshot: TVL and 7d change move fast. Rerun to refresh.

## Files

```
token_launch_radar.py     # the whole pipeline (stdlib only)
board.json                # ranked board + meta
summary.md                # counts + top 20
snapshot_protocols.json   # raw snapshot for reproducibility
README.md                 # this file
```
