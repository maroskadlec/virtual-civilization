/**
 * Predikce metodou Monte Carlo.
 *
 * Žádná věštba ani ručně psaná pravidla: z aktuálního stavu se pustí stovka
 * kopií téhož světa dopředu a spočítá se, v kolika z nich daná věc nastala.
 * Když se ve 68 kopiích ze sta objeví metalurgie, je to předpověď na 68 %.
 *
 * Větvení náhody: engine je čistá funkce `(seed, tick, stream)`, takže stačí
 * kopii přepsat odvozený seed. Planeta i stav zůstanou, ale všechny hody
 * dopadnou jinak — přesně to, co Monte Carlo potřebuje.
 *
 * Tvrzení jsou schválně jen MONOTÓNNÍ, tedy typu „stane se to do…". Jakmile
 * jednou nastanou, platí. Díky tomu se dají vyhodnocovat průběžně jedním
 * příznakem a není potřeba se zpětně doptávat do historie.
 *
 * Každý rollout si pamatuje, ve kterém kroku tvrzení poprvé nastalo. Z jednoho
 * průchodu se tak dá odečíst pravděpodobnost pro LIBOVOLNÝ horizont — a to je
 * podstatné: načasování milníků je totiž skoro deterministické. Při pevném
 * horizontu vycházela skoro všechna tvrzení na nulu nebo na jistotu a nebylo
 * co zveřejnit. Každé tvrzení si proto samo vybere lhůtu, ve které je napínavé.
 */

import { hashSeed } from './rng.js';
import { tickWorld } from './tick.js';
import { epochDef } from './epochs.js';
import { MILESTONE_BY_ID, milestonesOfEpoch } from './milestones.data.js';
import { candidates, reachableIds } from './research.js';
import type { World, WorldEvent } from './types.js';

export type Claim =
  | { type: 'milestone'; id: string }
  | { type: 'epoch'; epoch: number }
  | { type: 'population'; direction: 'above' | 'below'; value: number }
  | { type: 'war' }
  | { type: 'knowledge_loss' }
  | { type: 'ending' };

export interface Prediction {
  id: string;
  claim: Claim;
  text: string;
  probability: number;
  /** Globální tick, kdy předpověď vznikla, a kdy se má vyhodnotit. */
  madeAtTick: number;
  resolveAtTick: number;
  /** Které civilizace se týká — po jejím zániku předpověď propadá. */
  run: number;
  /** Nastalo to už? Aktualizuje se každý tick, proto stačí monotónní tvrzení. */
  happened: boolean;
  /**
   * Když civilizace zanikne dřív, než měla předpověď dozrát, vyhodnotí se
   * rovnou — a když se tvrzení nesplnilo, je to prostě minutí. Předpověď měla
   * riziko zániku zahrnout, jinak by si kalibrace pomáhala výmluvami.
   */
  outcome: 'pending' | 'hit' | 'miss';
}

export interface Scoreboard {
  resolved: number;
  hits: number;
  /** Součet (pravděpodobnost − skutečnost)², základ Brierova skóre. */
  brierSum: number;
  /** Deset košů po deseti procentech: kolik předpovědí a kolik se jich trefilo. */
  buckets: { total: number; hits: number }[];
}

export function emptyScoreboard(): Scoreboard {
  return {
    resolved: 0,
    hits: 0,
    brierSum: 0,
    buckets: Array.from({ length: 10 }, () => ({ total: 0, hits: 0 })),
  };
}

/** Vyhodnocení tvrzení nad stavem světa. Stejná funkce pro rollout i pro realitu. */
export function claimHolds(claim: Claim, world: World, events: readonly WorldEvent[]): boolean {
  switch (claim.type) {
    case 'milestone':
      return world.tech.unlocked[claim.id] !== undefined;
    case 'epoch':
      return world.epoch >= claim.epoch;
    case 'population':
      return claim.direction === 'above'
        ? world.stats.population > claim.value
        : world.stats.population < claim.value;
    case 'war':
      return events.some((e) => e.kind === 'war');
    case 'knowledge_loss':
      return events.some((e) => e.kind === 'milestone_lost');
    case 'ending':
      return world.ending !== null;
  }
}

export function claimText(claim: Claim): string {
  switch (claim.type) {
    case 'milestone':
      return `Zvládnou nový milník: ${MILESTONE_BY_ID.get(claim.id)?.name ?? claim.id}`;
    case 'epoch':
      return `Postoupí do další epochy: ${epochDef(claim.epoch).name}`;
    case 'population':
      return claim.direction === 'above'
        ? `Populace překročí ${Math.round(claim.value).toLocaleString('cs-CZ')}`
        : `Populace klesne pod ${Math.round(claim.value).toLocaleString('cs-CZ')}`;
    case 'war':
      return 'Vypukne válka mezi frakcemi';
    case 'knowledge_loss':
      return 'Přijdou o část znalostí';
    case 'ending':
      return 'Civilizace zanikne';
  }
}

function claimKey(claim: Claim): string {
  switch (claim.type) {
    case 'milestone':
      return `milestone:${claim.id}`;
    case 'epoch':
      return `epoch:${claim.epoch}`;
    case 'population':
      return `population:${claim.direction}`;
    default:
      return claim.type;
  }
}

/**
 * O čem má vůbec smysl předpovídat. Bere se z aktuálního stavu, takže
 * se otázky mění spolu s tím, čím civilizace zrovna prochází.
 */
function candidateClaims(world: World): Claim[] {
  const claims: Claim[] = [
    { type: 'war' },
    { type: 'knowledge_loss' },
    { type: 'ending' },
    { type: 'population', direction: 'above', value: world.stats.population * 1.6 },
    { type: 'population', direction: 'below', value: world.stats.population * 0.6 },
  ];

  if (world.epoch < epochDef(13).index) {
    claims.push({ type: 'epoch', epoch: world.epoch + 1 });
  }

  // Milníky, na kterých se zrovna pracuje.
  const inProgress = candidates(world)
    .map((m) => ({ m, progress: world.tech.progress[m.id] ?? 0 }))
    .sort((a, b) => b.progress - a.progress || (a.m.id < b.m.id ? -1 : 1))
    .slice(0, 6);
  for (const { m } of inProgress) claims.push({ type: 'milestone', id: m.id });

  // A pár z příští epochy, na kterou civilizace zatím nedosáhla. Ty rozpracované
  // jsou totiž skoro jisté; napětí je v tom, jestli se stihne dostat dál.
  const reachable = reachableIds(world);
  const ahead = milestonesOfEpoch(world.epoch + 1)
    .filter((m) => reachable.has(m.id) && world.tech.unlocked[m.id] === undefined)
    .sort((a, b) => a.cost - b.cost || (a.id < b.id ? -1 : 1))
    .slice(0, 4);
  for (const m of ahead) claims.push({ type: 'milestone', id: m.id });

  return claims;
}

export interface ForecastOptions {
  rollouts: number;
  /** Nabízené lhůty v ticích. Vybere se ta, ve které je tvrzení nejméně jisté. */
  horizons: number[];
}

/**
 * Horizont je schválně krátký — zhruba dva reálné dny.
 *
 * Se čtyřmi sty ticky vyšlo skoro všechno na jistotu: v půlce oblouku dějin
 * se nevybrala ani jedna předpověď, protože všechna tvrzení byla buď pod
 * čtyřmi, nebo nad sedmadevadesáti procenty. Předpověď, která nic neriskuje,
 * není předpověď.
 */
/** 96 ticků je jeden reálný den, takže lhůty vycházejí na 1, 2,5 a 5 dnů. */
export const DEFAULT_FORECAST: ForecastOptions = { rollouts: 100, horizons: [96, 240, 480] };

/** Kolik reálných dnů odpovídá dané lhůtě, česky a se správným tvarem. */
export function horizonLabel(ticks: number): string {
  const days = Math.max(1, Math.round(ticks / 96));
  if (days === 1) return 'do zítřka';
  if (days < 5) return `do ${days} dnů`;
  return `do ${days} dnů`;
}

/**
 * Pustí kopie světa dopředu a vrátí, v jakém podílu z nich jednotlivá tvrzení
 * nastala. Každá kopie dostane odvozený seed, takže se rozejdou hned prvním
 * hodem — planeta i dosavadní stav ale zůstávají stejné.
 */
export interface ForecastEntry {
  claim: Claim;
  /** Krok, ve kterém tvrzení v daném rolloutu poprvé nastalo. Nekonečno = nenastalo. */
  firstStep: number[];
}

export function forecast(
  world: World,
  globalTick: number,
  options: ForecastOptions = DEFAULT_FORECAST,
): Map<string, ForecastEntry> {
  const claims = candidateClaims(world);
  const maxHorizon = Math.max(...options.horizons);
  const out = new Map<string, ForecastEntry>();
  for (const claim of claims) out.set(claimKey(claim), { claim, firstStep: [] });

  for (let i = 0; i < options.rollouts; i++) {
    let sim: World = structuredClone(world);
    // Odvozený seed rozhodí všechny hody, ale planeta i dosavadní stav zůstávají.
    sim.seed = hashSeed(world.seed, globalTick, 0xf0cec, i);

    const first = new Map<string, number>();
    for (const claim of claims) {
      if (claimHolds(claim, sim, [])) first.set(claimKey(claim), 0);
    }

    for (let step = 1; step <= maxHorizon; step++) {
      if (sim.ending) break;
      const result = tickWorld(sim);
      sim = result.world;
      for (const claim of claims) {
        const key = claimKey(claim);
        if (first.has(key)) continue;
        if (claimHolds(claim, sim, result.events)) first.set(key, step);
      }
    }

    for (const claim of claims) {
      const key = claimKey(claim);
      out.get(key)?.firstStep.push(first.get(key) ?? Infinity);
    }
  }

  return out;
}

/** Podíl rolloutů, ve kterých tvrzení nastalo nejpozději v daném kroku. */
export function probabilityWithin(entry: ForecastEntry, horizon: number): number {
  if (entry.firstStep.length === 0) return 0;
  const hits = entry.firstStep.filter((step) => step <= horizon).length;
  return hits / entry.firstStep.length;
}

/**
 * Z hrubých pravděpodobností vybere hrst předpovědí, které stojí za zveřejnění.
 *
 * Jistoty jsou nudné: „populace poroste — 100 %" nikoho nezajímá a kalibraci
 * jen zaplevelí. Vybírají se proto tvrzení blízko poloviny, kde předpověď
 * něco riskuje.
 */
export function selectPredictions(
  raw: Map<string, ForecastEntry>,
  globalTick: number,
  run: number,
  options: ForecastOptions = DEFAULT_FORECAST,
  limit = 5,
): Prediction[] {
  // Pro každé tvrzení se vybere lhůta, ve které je nejblíž k padesáti procentům.
  const best = [...raw.entries()].map(([key, entry]) => {
    let horizon = options.horizons[0] ?? 96;
    let probability = probabilityWithin(entry, horizon);

    for (const candidate of options.horizons) {
      const p = probabilityWithin(entry, candidate);
      if (Math.abs(p - 0.5) < Math.abs(probability - 0.5)) {
        horizon = candidate;
        probability = p;
      }
    }
    return { key, claim: entry.claim, horizon, probability };
  });

  const rank = (list: typeof best) =>
    list
      .map((b) => ({ ...b, interest: 1 - Math.abs(b.probability - 0.5) * 2 }))
      .sort((a, b) => b.interest - a.interest || (a.key < b.key ? -1 : 1));

  let scored = rank(best.filter((b) => b.probability > 0.04 && b.probability < 0.97));
  // Když je zrovna všechno jisté, radši ukázat to nejméně jisté než nic.
  if (scored.length < 3) scored = rank(best.filter((b) => b.probability > 0 && b.probability < 1));

  return scored.slice(0, limit).map((s) => ({
    id: `${globalTick}:${s.key}`,
    claim: s.claim,
    text: `${claimText(s.claim)} — ${horizonLabel(s.horizon)}`,
    probability: s.probability,
    madeAtTick: globalTick,
    resolveAtTick: globalTick + s.horizon,
    run,
    happened: false,
    outcome: 'pending' as const,
  }));
}

/** Zaznamená Brierův příspěvek a kalibrační koš. */
export function recordOutcome(board: Scoreboard, prediction: Prediction): void {
  if (prediction.outcome !== 'hit' && prediction.outcome !== 'miss') return;
  const actual = prediction.outcome === 'hit' ? 1 : 0;

  board.resolved += 1;
  board.hits += actual;
  board.brierSum += (prediction.probability - actual) ** 2;

  const index = Math.min(9, Math.floor(prediction.probability * 10));
  const bucket = board.buckets[index];
  if (bucket) {
    bucket.total += 1;
    bucket.hits += actual;
  }
}

/** Brierovo skóre: nula je dokonalost, 0,25 je hod mincí. */
export function brierScore(board: Scoreboard): number | null {
  return board.resolved === 0 ? null : board.brierSum / board.resolved;
}
