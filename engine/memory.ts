/**
 * Historická paměť.
 *
 * Bez počítadel je každá událost osamocená a kronika je jen seznam. Teprve
 * když engine ví, že tohle je třetí sucho za dvě století a že horší mor
 * dějiny neznaly, může vzniknout souvislost — a souvislost je jediné,
 * co odlišuje dějiny od logu.
 *
 * Tenhle soubor drží jen stav a čísla. Slova z nich skládá `narrate.ts`.
 */

import type { DisasterId, Era, Memory, World } from './types.js';

export function emptyMemory(): Memory {
  return {
    disasters: {},
    iceAges: 0,
    wars: 0,
    schisms: 0,
    collapses: 0,
    settlementsFounded: 0,
    settlementsLost: 0,
    lastWarYear: null,
    longestPeace: 0,
    worstShare: 0,
    totalDeaths: 0,
  };
}

export function emptyEra(epoch: number, tick: number, year: number, population: number): Era {
  return {
    epoch,
    startTick: tick,
    startYear: year,
    startPopulation: population,
    milestones: [],
    lostMilestones: 0,
    wars: 0,
    disasters: 0,
    deaths: 0,
    settlementsFounded: 0,
    settlementsLost: 0,
    figures: [],
  };
}

// ─────────────────────────────────────────── Pohromy

/** Jak výjimečná ta rána byla — podklad pro větu, ne pro mechaniku. */
export interface DisasterMemo {
  /** Kolikátá svého druhu. 1 = nic takového dosud nebylo. */
  nth: number;
  /** Kolik let od minulé téhož druhu; null, když je první. */
  sinceYears: number | null;
  /** Nejhorší svého druhu. Platí až od druhého výskytu — první je triviálně nejhorší. */
  worstOfKind: boolean;
  /** Nejhorší jednorázový zásah v celých dějinách. */
  worstEver: boolean;
}

/**
 * Rekord se posuzuje podle podílu, ne podle počtu mrtvých.
 *
 * Populace roste přes několik řádů, takže v absolutních číslech je skoro každá
 * další pohroma „nejhorší v dějinách" — a kronika to pak hlásí u každého
 * druhého zápisu, čímž to přestane něco znamenat. Podíl zasažené osady je
 * srovnatelný napříč celými dějinami.
 *
 * Spodní hranice brání tomu, aby se rekordem stala škrábnutí jen proto,
 * že předchozí byla ještě menší.
 */
const RECORD_FLOOR = 0.12;

export function rememberDisaster(
  world: World,
  id: DisasterId,
  deaths: number,
  share: number,
): DisasterMemo {
  const m = world.memory;
  const prev = m.disasters[id];
  const nth = (prev?.count ?? 0) + 1;

  const memo: DisasterMemo = {
    nth,
    sinceYears: prev ? world.year - prev.lastYear : null,
    // Porovnává se se stavem PŘED zápisem, jinak by rekordem byla každá rána.
    worstOfKind: nth > 1 && share > (prev?.worstShare ?? 0) && share >= RECORD_FLOOR,
    worstEver: m.totalDeaths > 0 && share > m.worstShare && share >= RECORD_FLOOR,
  };

  m.disasters[id] = {
    count: nth,
    lastYear: world.year,
    worstShare: Math.max(share, prev?.worstShare ?? 0),
  };
  m.worstShare = Math.max(m.worstShare, share);
  rememberDeaths(world, deaths);
  world.era.disasters += 1;
  return memo;
}

// ─────────────────────────────────────────── Války

export interface WarMemo {
  nth: number;
  /** Kolik let trval mír, který tahle válka ukončila; null u první války. */
  peaceYears: number | null;
  /** Byl to nejdelší mír, jaký civilizace zažila? */
  brokeLongestPeace: boolean;
}

export function rememberWar(world: World): WarMemo {
  const m = world.memory;
  const peaceYears = m.lastWarYear === null ? null : world.year - m.lastWarYear;

  const memo: WarMemo = {
    nth: m.wars + 1,
    peaceYears,
    brokeLongestPeace: peaceYears !== null && peaceYears > m.longestPeace && m.wars >= 2,
  };

  if (peaceYears !== null) m.longestPeace = Math.max(m.longestPeace, peaceYears);
  m.wars += 1;
  m.lastWarYear = world.year;
  world.era.wars += 1;
  return memo;
}

// ─────────────────────────────────────────── Ostatní

export function rememberDeaths(world: World, deaths: number): void {
  if (deaths <= 0) return;
  world.memory.totalDeaths += deaths;
  world.era.deaths += deaths;
}

/** Vrátí pořadí této doby ledové. */
export function rememberIceAge(world: World): number {
  return (world.memory.iceAges += 1);
}

export function rememberSchism(world: World): number {
  return (world.memory.schisms += 1);
}

export function rememberCollapse(world: World, lostCount: number): number {
  world.era.lostMilestones += lostCount;
  return (world.memory.collapses += 1);
}

export function rememberSettlementFounded(world: World): void {
  world.memory.settlementsFounded += 1;
  world.era.settlementsFounded += 1;
}

export function rememberSettlementLost(world: World): void {
  world.memory.settlementsLost += 1;
  world.era.settlementsLost += 1;
}
