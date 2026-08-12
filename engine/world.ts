/**
 * Vznik světa a odvozené hodnoty.
 *
 * Odvozené statistiky (kapacita, gramotnost, specializace, síla) se nikdy
 * neinkrementují — vždy se přepočítají z množiny odemčených milníků. Díky tomu
 * se stav nemůže rozejít, když se milník ztratí při kolapsu.
 */

import { STREAM, hashString, rngFor } from './rng.js';
import { generatePlanet, randomPosition, biomeAt, baseCapacity, BIOME_YIELD } from './planet.js';
import { factionName, makeLanguage, placeName } from './names.js';
import type { Language } from './names.js';
import { MILESTONE_BY_ID } from './milestones.data.js';
import { computeAccess } from './research.js';
import type { Culture, Faction, Settlement, World } from './types.js';

export const GENESIS_POPULATION = 35;

/** Jazyk frakce se negeneruje do stavu — odvodí se ze seedu a id, kdykoli je potřeba. */
export function languageOf(world: World, factionId: string): Language {
  return makeLanguage(rngFor(world.seed, 0, STREAM.names, hashString(factionId)));
}

function randomCulture(rng: { next: () => number }): Culture {
  return {
    aggression: rng.next(),
    curiosity: rng.next(),
    piety: rng.next(),
    mercantile: rng.next(),
    collectivism: rng.next(),
  };
}

export function createWorld(seed: number): World {
  const planet = generatePlanet(seed);
  const rng = rngFor(seed, 0, STREAM.factions);

  const faction: Faction = {
    id: 'f0',
    name: factionName(rng, new Set()),
    culture: randomCulture(rng),
    hue: 0,
    foundedTick: 0,
    foundedYear: 0,
    parentId: null,
    rivalry: {},
  };

  const climate = {
    temperature: 0,
    aridity: 0.35,
    seaLevel: 0,
    iceCoverage: 0.1,
    iceAge: false,
    lastShiftTick: 0,
  };

  // První tlupa si nevybírá — usadí se tam, kde ji zastihla nutnost.
  const posRng = rngFor(seed, 0, STREAM.settlement);
  const pos = randomPosition(posRng);
  const lang = makeLanguage(rngFor(seed, 0, STREAM.names, hashString(faction.id)));

  const settlement: Settlement = {
    id: 's0',
    name: placeName(posRng, lang, new Set()),
    factionId: faction.id,
    population: GENESIS_POPULATION,
    r: pos.r,
    theta: pos.theta,
    biome: biomeAt(planet, pos.r, pos.theta, climate.temperature, climate.aridity),
    foundedTick: 0,
  };

  const world: World = {
    seed,
    tick: 0,
    year: 0,
    foundingYear: null,
    epoch: 0,
    planet,
    climate,
    factions: [faction],
    settlements: [settlement],
    tech: { unlocked: {}, progress: {}, lost: [] },
    pressures: {
      cold: 0.4,
      hunger: 0.5,
      disease: 0.3,
      war: 0.05,
      crowding: 0.1,
      curiosity: 0.3,
    },
    stats: {
      population: GENESIS_POPULATION,
      literacy: 0,
      specialization: 0,
      might: 0,
      capacityMul: 1,
      researchMul: 1,
    },
    access: {} as World['access'],
    idleTicks: 0,
    brinkTicks: 0,
    ending: null,
    nextIds: { faction: 1, settlement: 1 },
  };

  world.access = computeAccess(world);
  recomputeDerived(world);
  return world;
}

/** Přepočítá vše, co plyne z odemčených milníků. */
export function recomputeDerived(world: World): void {
  let capacityMul = 1;
  let researchMul = 1;
  let literacy = 0;
  let specialization = 0;
  let might = 0;

  for (const id of Object.keys(world.tech.unlocked)) {
    const m = MILESTONE_BY_ID.get(id);
    const u = m?.unlocks;
    if (!u) continue;
    if (u.capacity) capacityMul *= u.capacity;
    if (u.research) researchMul *= u.research;
    if (u.literacy) literacy += u.literacy;
    if (u.specialization) specialization += u.specialization;
    if (u.might) might += u.might;
  }

  world.stats.capacityMul = capacityMul;
  world.stats.researchMul = researchMul;
  world.stats.literacy = Math.min(1, literacy);
  world.stats.specialization = Math.min(1, specialization);
  world.stats.might = might;
  world.stats.population = world.settlements.reduce((s, x) => s + x.population, 0);
}

/** Trvalé tlumení tlaků z odemčených technologií. */
export function reliefFor(world: World, pressure: keyof World['pressures']): number {
  let relief = 0;
  for (const id of Object.keys(world.tech.unlocked)) {
    const r = MILESTONE_BY_ID.get(id)?.unlocks?.relief?.[pressure];
    if (r) relief += r;
  }
  return Math.min(0.85, relief);
}

/**
 * Klesající výnosy z technologií.
 *
 * Násobiče kapacity se v datech milníků násobí, což je autorsky pohodlné,
 * ale surový součin roste přes několik řádů rychleji, než je únosné —
 * v době železné vycházela populace v milionech tam, kde měly být statisíce.
 * Jeden exponent to srovná, aniž by bylo nutné přeladit sto milníků.
 */
const CAPACITY_SOFTENING = 0.72;

/** Únosná kapacita jedné osady při současném klimatu a technologiích. */
export function settlementCapacity(world: World, s: Settlement): number {
  const climatePenalty = Math.max(
    0.2,
    1 - Math.abs(world.climate.temperature) * 0.12 - world.climate.iceCoverage * 0.5,
  );
  return (
    baseCapacity(world.planet) *
    BIOME_YIELD[s.biome] *
    Math.pow(world.stats.capacityMul, CAPACITY_SOFTENING) *
    climatePenalty
  );
}

export function totalCapacity(world: World): number {
  return world.settlements.reduce((sum, s) => sum + settlementCapacity(world, s), 0);
}

/** Jméno osady, které se v rámci světa ještě nepoužilo. */
export function usedSettlementNames(world: World): Set<string> {
  return new Set(world.settlements.map((s) => s.name));
}

export function usedFactionNames(world: World): Set<string> {
  return new Set(world.factions.map((f) => f.name.nom));
}
