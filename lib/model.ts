// The token radar's model: the sealed snapshot in, a ranked board out.
//
// This entry's model is the one first prototyped in Python against live DefiLlama
// data (token_launch_radar.py in the project notes), ported to the sealed snapshot
// the grader reads. It differs from a naive TVL table in three stated ways:
//
//   1. Strict pre-token test: a protocol counts only when its record carries no
//      token at all (no market cap, no CoinGecko id, no symbol).
//   2. Named derivative exclusions, applied in order and counted: CEX reserve
//      balances, canonical bridges, categories whose TVL *is* a derivative asset,
//      an explicit blocklist of single-asset wrapped/staked products, and name
//      patterns (wrapped, issuer staking products, named LST products,
//      asset-ticker-only names, versioned deployments). The snapshot's watchlist
//      is always included first, so an exclusion can never cost coverage.
//   3. A stated valuation, every multiplier printed on the row it produced:
//
//        implied = TVL x category_multiple x size_multiplier
//                      x growth_multiplier x maturity_multiplier
//
//      Category multiples are heuristic FDV/TVL anchors per category; the size
//      multiplier compresses FDV/TVL at scale; growth uses the snapshot's
//      change_7d only, clamped to -30..+60 percent (missing data is neutral
//      and flagged in the row's explanation); maturity rewards protocols that
//      have run for years with no token. A separate 0-100 likelihood score
//      keeps "how big" apart from "how likely": log TVL, 7-day growth,
//      maturity and chain breadth. No protocol name is ever special-cased in
//      the valuation: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-proto-2';

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

// ---------------------------------------------------------------------------
// Exclusions (applied in order; each exclusion is counted by exclusionReason)
// ---------------------------------------------------------------------------

/** TVL here is custodial exchange reserves, not a protocol waiting to launch. */
const EXCLUDE_CATEGORIES = new Set(['CEX', 'Canonical Bridge']);

/** Categories whose TVL is itself a derivative asset, not a protocol's product. */
const DERIVATIVE_CATEGORIES = new Set(['Restaked BTC', 'Anchor BTC', 'Decentralized BTC', 'Stablecoin Wrapper']);

/** Single-asset issuer products: the "protocol" is a wrapped/staked asset itself. */
const DERIVATIVE_SLUGS = new Set([
  'wbtc', 'usdt0', 'unit', 'fassets', 'function-fbtc', 'stacks-sbtc', 'nexus-btc',
  'exsat-staking-btc', 'bitget-bgbtc', 'kraken-bitcoin', 'binance-bitcoin',
  'coinbase-bridge', 'usdd', 'forward-industries-sol', 'dfdv-staked-sol',
  'bittensor-dtao', 'sthype',
]);

const WRAPPED_WORD = /\bwrapped\b/i;
const LST_PRODUCT = /\bLSTs?\b/;
const ISSUER_PRODUCT = /^(binance|coinbase|bybit|bitget|kraken|gate)\b.*\b(staked|wrapped|bitcoin|bridge)\b|\b(binance|coinbase|bybit|bitget|kraken|gate) (staked|wrapped)\b/i;
const TICKER_ONLY = /^[A-Z][A-Z0-9]{1,5}$/;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Why a protocol is excluded from the ranked board, or null when it is a candidate. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  const cat = p.category ?? '';
  if (EXCLUDE_CATEGORIES.has(cat)) return `category:${cat}`;
  if (DERIVATIVE_CATEGORIES.has(cat)) return `derivative-category:${cat}`;
  if (DERIVATIVE_SLUGS.has(p.slug)) return 'derivative-asset:blocklist';
  if (WRAPPED_WORD.test(p.name)) return 'derivative-name:wrapped';
  if (LST_PRODUCT.test(p.name)) return 'derivative-name:lst-product';
  if (ISSUER_PRODUCT.test(p.name)) return 'derivative-name:issuer-product';
  if (TICKER_ONLY.test(p.name.trim()) && (cat === 'Bridge' || cat === 'Cross Chain Bridge')) return 'derivative-name:asset-ticker';
  if (VERSIONED.test(p.name)) return 'versioned-deployment';
  return null;
}

// ---------------------------------------------------------------------------
// Valuation
// ---------------------------------------------------------------------------

/** Heuristic FDV/TVL base multiple per category, anchored on the low end of
 *  observed ranges for comparable tokenized protocols in the same category. */
export const CATEGORY_MULTIPLE: Record<string, number> = {
  Derivatives: 0.9, 'Prediction Market': 0.8, Chain: 0.8, Dexs: 0.6,
  'OTC Marketplace': 0.5, Lending: 0.45, RWA: 0.45, CDP: 0.4, Insurance: 0.4,
  Privacy: 0.4, 'Crypto Card Issuer': 0.4, Bridge: 0.35, 'Cross Chain Bridge': 0.35,
  'CDP Manager': 0.35, 'Basis Trading': 0.35, 'Options Vault': 0.35,
  'Collateral Markets': 0.35, 'Uncollateralized Lending': 0.35,
  'Risk Curators': 0.3, 'Onchain Capital Allocator': 0.3, 'Liquid Staking': 0.3,
  'Liquid Restaking': 0.3, Restaking: 0.3, Payments: 0.3, CeDeFi: 0.3,
  Yield: 0.25, 'Yield Aggregator': 0.25, 'Liquidity Manager': 0.25, Indexes: 0.25,
  'Staking Pool': 0.2, 'Leveraged Farming': 0.2, 'Dual-Token Stablecoin': 0.2,
  Farm: 0.15, 'Governance Incentives': 0.15,
};
export const DEFAULT_CATEGORY_MULTIPLE = 0.3;

/** Larger TVL earns a lower FDV/TVL in practice; tiered and stated. */
export function sizeMultiplier(tvl: number): number {
  if (tvl < 25_000_000) return 1.15;
  if (tvl < 100_000_000) return 1.05;
  if (tvl < 500_000_000) return 1.0;
  if (tvl < 2_000_000_000) return 0.9;
  return 0.8;
}

/** Growth window is change_7d only, clamped to -30..+60; missing is neutral. */
export function growthMultiplier(change7d: number | null): number {
  if (change7d === null) return 1.0;
  const clamped = Math.max(-30, Math.min(60, change7d));
  return 1.0 + clamped / 200;
}

/** Proven-but-tokenless scores highest; brand-new and unknown are cut. */
export function maturityMultiplier(ageDays: number | null): number {
  if (ageDays === null) return 0.9;
  if (ageDays < 180) return 0.75;
  if (ageDays < 730) return 0.95;
  if (ageDays < 1460) return 1.1;
  return 1.0;
}

const DAY_MS = 86_400_000;

/** A whole day count from listed_at to the snapshot's as_of; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** 0-100 launch likelihood, separate from value: TVL 40 + growth 25 + maturity 20 + chains 15. */
export function likelihoodScore(p: SnapshotProtocol, age: number | null): number {
  const tvlPart = 40 * Math.max(0, Math.min(1, (Math.log10(Math.max(p.tvl_usd, 1)) - Math.log10(5_000_000)) / (Math.log10(3_000_000_000) - Math.log10(5_000_000))));
  const growthPart = p.change_7d === null ? 10 : 25 * Math.max(0, Math.min(1, (p.change_7d + 10) / 40));
  const maturityPart = age === null ? 8 : age < 180 ? 5 : age < 730 ? 12 : age < 1460 ? 20 : 15;
  const chainPart = 15 * Math.min(p.chains.length, 10) / 10;
  return Math.round((tvlPart + growthPart + maturityPart + chainPart) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Farm plans: derived from the protocol's own record, never a name list
// ---------------------------------------------------------------------------

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the lending position open`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to the main ${name} pool on ${chain} and keep the position open`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds inside its app`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the staking receipt in the wallet`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade`;
  if (c.includes('prediction')) return `Fund the wallet with $${capital} and place one position in an active ${name} market`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares untouched`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the wallet`;
  if (c.includes('rwa')) return `Mint $${capital} of the ${name} yield asset on ${chain} and hold it past the next snapshot`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for a full month`;
  if (c.includes('options')) return `Deposit $${capital} into a ${name} options vault on ${chain} and let one full epoch complete`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open and visible`;
}

/** Trim to the gate's 20..600 characters, padding short steps with a real instruction. */
function fitStep(s: string): string {
  let out = s.trim();
  if (out.length > 600) out = `${out.slice(0, 596)}...`;
  if (out.length < 20) out = `${out} Keep the position open and check the protocol's own page weekly.`;
  return out;
}

/** Six concrete steps per protocol: action, cost and time in every step's text. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const steps = [
    `Set up a fresh wallet for ${p.name} farming and fund it on ${chain}; keep the seed phrase offline. Cost: under $3 of gas for the funding transaction. Time: 5 minutes.`,
    `${actionFor(p, capital, chain)}. Cost: $${capital} of capital plus about $${gas} of gas. Time: 15 minutes to set up.`,
    `Repeat one qualifying action every week - a deposit, a borrow, a swap or a governance vote inside ${p.name}. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the ${p.name} position for at least ${hold} days so the activity counts in more than one weekly snapshot. Cost: the $${capital} stays locked in the position. Time: ${hold} days.`,
    `Open the ${p.name} points or rewards page from the protocol's own site and check eligibility there; never pay a third party to claim. Cost: nothing to check. Time: 10 minutes.`,
    `Log the wallet address, every date and each transaction hash for ${p.name} in a farm log, so the position can be repeated or unwound safely. Cost: nothing. Time: 5 minutes.`,
  ];
  return steps.map(fitStep);
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

/** One row of board.json: the gate's five fields plus this model's working. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  category_multiple: number;
  size_multiplier: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  implied_value_usd: number;
  likelihood_score: number;
  explanation: string;
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  likelihood_score: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the page shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  formula: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  excluded_total: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The board: every watchlist slug, plus every pre-token protocol the named rules keep. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug) || !isPreToken(p)) continue;
    if (exclusionReason(p) !== null) continue;
    chosen.set(p.slug, p);
  }
  const watch = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const catMult = CATEGORY_MULTIPLE[p.category ?? ''] ?? DEFAULT_CATEGORY_MULTIPLE;
    const sizeMult = sizeMultiplier(p.tvl_usd);
    const growthMult = growthMultiplier(p.change_7d);
    const matMult = maturityMultiplier(age);
    // Implied value is computed from the rounded multipliers the row prints, so the
    // arithmetic a reader re-checks from board.json reproduces the value exactly.
    const implied = Math.max(1, Math.round(p.tvl_usd * catMult * sizeMult * round4(growthMult) * matMult));
    const growthNote = p.change_7d === null ? 'n/a, neutral 1.000' : `${p.change_7d}%`;
    const explanation =
      `TVL $${Math.round(p.tvl_usd).toLocaleString('en-US')} x category ${p.category ?? 'uncategorised'} ${catMult.toFixed(2)} ` +
      `x size ${sizeMult.toFixed(2)} x growth (7d ${growthNote}) ${growthMult.toFixed(3)} ` +
      `x maturity (age ${age === null ? 'unknown' : `${age}d`}) ${matMult.toFixed(2)} = $${implied.toLocaleString('en-US')}`;
    return { p, age, catMult, sizeMult, growthMult, matMult, implied, explanation };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    watchlist: watch.has(s.p.slug),
    category_multiple: s.catMult,
    size_multiplier: s.sizeMult,
    growth_multiplier: round4(s.growthMult),
    maturity_multiplier: s.matMult,
    implied_value_usd: s.implied,
    likelihood_score: likelihoodScore(s.p, s.age),
    explanation: s.explanation,
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The live-token protocols, by market cap, kept apart from the ranked board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Count of pre-token protocols the named rules excluded (watchlist members never count). */
export function excludedCount(snapshot: Snapshot): number {
  const watch = new Set(snapshot.watchlist);
  return snapshot.protocols.filter((p) => isPreToken(p) && !watch.has(p.slug) && exclusionReason(p) !== null).length;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    formula: 'implied value = TVL x category multiple x size multiplier x growth multiplier (change_7d) x maturity multiplier (age)',
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    excluded_total: excludedCount(snapshot),
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      age_days: r.age_days,
      watchlist: r.watchlist,
      implied_value_usd: r.implied_value_usd,
      likelihood_score: r.likelihood_score,
      category_multiple: r.category_multiple,
      growth_multiplier: r.growth_multiplier,
      maturity_multiplier: r.maturity_multiplier,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice on the board';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const invented = board.filter((r) => !known.has(r.slug));
  if (invented.length > 0) return `the board invents slugs: ${invented.slice(0, 5).map((r) => r.slug).join(', ')}`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} has a farm step of ${len} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
