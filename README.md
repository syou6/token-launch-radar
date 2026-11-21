# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/syou6/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/syou6/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads make.fun's sealed DefiLlama snapshot, keeps the
protocols that record no token and are not a wrapped or staked product of one
that trades, ranks them by a stated implied launch value (TVL × category
multiple × size multiplier × 7-day growth multiplier × maturity multiplier),
and hands in a static dashboard — the ranked board, a detail view with the
model's working and a concrete farm plan for every protocol, and filters —
plus the board as `board.json` and a `dossier.json` built by the kit's own
`vendor/makefun-board.ts`.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node.js 22.18 or later, standard library only. In the grader the snapshot is
at `/input/snapshot.json` and the output lands in `/output`.

---

Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
