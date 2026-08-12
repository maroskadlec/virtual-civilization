/**
 * Výzkumný engine — srdce kauzality.
 *
 * Milníky se neodemykají v pevném pořadí. Každý tick se ohodnotí kandidáti
 * podle toho, jak odpovídají na aktuální tlaky, jak drahé je jich dosáhnout
 * na téhle konkrétní planetě a co civilizaci kulturně zajímá. Výzkumný výkon
 * se rozdělí mezi několik nejsilnějších. Proto na vyprahlém světě přijde
 * zavlažování dřív než tavení mědi — a proto to kronika umí zdůvodnit.
 */

import type { Milestone, PressureId, ResourceId, World } from './types.js';
import { PRESSURE_IDS } from './types.js';
import { EPOCH_COST_SCALE, MILESTONES, MILESTONE_BY_ID, milestonesOfEpoch } from './milestones.data.js';
import { epochDef } from './epochs.js';
import type { Rng } from './rng.js';

/** Pod touhle dostupností se surovina považuje za nedostupnou. */
const RESOURCE_FLOOR = 0.15;

/** Jak silně tlaky přebíjejí základní pořadí. Vysoká hodnota = dějiny hnané nouzí. */
const PRESSURE_WEIGHT = 2.2;

/** Efektivní cena milníku na téhle planetě, v jednotkách poznání. */
export function costOf(world: World, m: Milestone): number {
  let mul = 1;

  for (const mod of m.costMods ?? []) {
    if (matchesCostMod(world, mod)) mul *= mod.mul;
  }

  // Vzácná surovina prodražuje úměrně tomu, jak je vzácná.
  for (const res of m.needsResources ?? []) {
    const avail = world.access[res];
    if (avail < 1) mul *= Math.min(6, 1 / Math.max(RESOURCE_FLOOR, avail));
  }

  const scale = EPOCH_COST_SCALE[m.epoch] ?? 1;
  return m.cost * scale * mul;
}

function matchesCostMod(world: World, mod: NonNullable<Milestone['costMods']>[number]): boolean {
  if (mod.ore) {
    const v = world.planet.ores[mod.ore.id];
    if (mod.ore.below !== undefined && !(v < mod.ore.below)) return false;
    if (mod.ore.above !== undefined && !(v > mod.ore.above)) return false;
  }
  if (mod.planet) {
    const v = world.planet[mod.planet.key];
    if (mod.planet.below !== undefined && !(v < mod.planet.below)) return false;
    if (mod.planet.above !== undefined && !(v > mod.planet.above)) return false;
  }
  return true;
}

function isUnlocked(world: World, id: string): boolean {
  return world.tech.unlocked[id] !== undefined;
}

/** Splňuje milník tvrdé předpoklady? */
export function prereqsMet(world: World, m: Milestone): boolean {
  const req = m.requires;
  if (!req) return true;
  if (req.all && !req.all.every((id) => isUnlocked(world, id))) return false;
  if (req.any && req.any.length > 0 && !req.any.some((id) => isUnlocked(world, id))) return false;
  return true;
}

function hasResources(world: World, m: Milestone): boolean {
  return (m.needsResources ?? []).every((r) => world.access[r] >= RESOURCE_FLOOR);
}

function meetsThresholds(world: World, m: Milestone): boolean {
  if (m.needsPopulation !== undefined && world.stats.population < m.needsPopulation) return false;
  if (m.needsLiteracy !== undefined && world.stats.literacy < m.needsLiteracy) return false;
  return true;
}

/**
 * Je milník na téhle planetě vůbec dosažitelný? Počítá se rekurzivně přes
 * předpoklady. Používá se pro postup epochou — bez toho by svět bez cínu
 * uvízl navěky v době bronzové jen proto, že nemůže naplnit kvótu.
 */
export function reachableIds(world: World): Set<string> {
  const reachable = new Set<string>();
  let changed = true;

  while (changed) {
    changed = false;
    for (const m of MILESTONES) {
      if (reachable.has(m.id)) continue;
      if (!(m.needsResources ?? []).every((r) => world.access[r] >= RESOURCE_FLOOR)) continue;

      const req = m.requires;
      const allOk = !req?.all || req.all.every((id) => reachable.has(id));
      const anyOk = !req?.any || req.any.length === 0 || req.any.some((id) => reachable.has(id));
      if (allOk && anyOk) {
        reachable.add(m.id);
        changed = true;
      }
    }
  }
  return reachable;
}

/**
 * Milníky, na kterých se dá právě teď pracovat.
 *
 * Do příští epochy se zásadně nenahlíží. Zní to jako zbytečná tvrdost, ale
 * plyne to přímo z modelu času: epocha 0 má 4000 let na tick, neolit dvanáct.
 * Výkon na tick proto na hranici epoch spadne o víc než řád — a cokoli
 * naceněného pro neolit je během úsvitu prakticky zadarmo. Při povoleném
 * nahlížení si civilizace stihla odbýt celý neolit dřív, než do něj vstoupila,
 * a odbyla ho pak za jediný tick.
 */
export function candidates(world: World): Milestone[] {
  return MILESTONES.filter(
    (m) =>
      !isUnlocked(world, m.id) &&
      m.epoch <= world.epoch &&
      prereqsMet(world, m) &&
      hasResources(world, m) &&
      meetsThresholds(world, m),
  );
}

/** Součet afinity milníku k aktuálním tlakům. */
function pressureFit(world: World, m: Milestone): number {
  let sum = 0;
  for (const p of PRESSURE_IDS) {
    const aff = m.affinity?.[p];
    if (aff) sum += aff * world.pressures[p];
  }
  return sum;
}

/** Populačně vážená kultura celé civilizace. */
function meanCulture(world: World): { curiosity: number; aggression: number; piety: number; mercantile: number } {
  let total = 0;
  const acc = { curiosity: 0, aggression: 0, piety: 0, mercantile: 0 };
  for (const s of world.settlements) {
    const f = world.factions.find((x) => x.id === s.factionId);
    if (!f) continue;
    total += s.population;
    acc.curiosity += f.culture.curiosity * s.population;
    acc.aggression += f.culture.aggression * s.population;
    acc.piety += f.culture.piety * s.population;
    acc.mercantile += f.culture.mercantile * s.population;
  }
  if (total <= 0) return { curiosity: 0.5, aggression: 0.5, piety: 0.5, mercantile: 0.5 };
  return {
    curiosity: acc.curiosity / total,
    aggression: acc.aggression / total,
    piety: acc.piety / total,
    mercantile: acc.mercantile / total,
  };
}

export interface ScoredCandidate {
  milestone: Milestone;
  score: number;
  cost: number;
}

export function scoreCandidates(world: World, rng: Rng): ScoredCandidate[] {
  const culture = meanCulture(world);

  const scored = candidates(world).map((m) => {
    const cost = costOf(world, m);
    // Levnější věci se prosadí dřív — ale ne drtivě, jinak by se drahé nikdy nezačaly.
    let score = 1 / Math.sqrt(Math.max(1e-6, cost));

    score *= 1 + PRESSURE_WEIGHT * pressureFit(world, m);

    // Kulturní sklon: zvídavá civilizace tíhne k poznání, bojovná ke zbraním.
    const curiosityAff = m.affinity?.curiosity ?? 0;
    const warAff = m.affinity?.war ?? 0;
    score *= 1 + curiosityAff * (culture.curiosity - 0.5) * 0.8;
    score *= 1 + warAff * (culture.aggression - 0.5) * 0.8;

    // Nedodělky z minulých epoch se doženou rychle — v době železné
    // už je organizovaný lov samozřejmost. Bez tohohle by civilizace
    // postavila říši dřív, než by se naučila lovit ve skupině.
    if (m.epoch < world.epoch) score *= 1 + 4 * (world.epoch - m.epoch);

    // Znovuobjevení ztraceného jde rychleji — lidová paměť.
    if (world.tech.lost.includes(m.id)) score *= 1.6;

    score *= rng.range(0.75, 1.3);
    return { milestone: m, score, cost };
  });

  scored.sort((a, b) => b.score - a.score || (a.milestone.id < b.milestone.id ? -1 : 1));
  return scored;
}

/** Kolik věcí zvládne civilizace řešit najednou. Roste se specializací. */
function focusWidth(world: World): number {
  return Math.max(2, Math.min(9, Math.round(3 + world.stats.specialization * 5)));
}


export interface ResearchOutcome {
  unlocked: { milestone: Milestone; because: string }[];
  /** Zda vůbec bylo na čem pracovat. Rozlišuje pomalý postup od skutečné stagnace. */
  hadCandidates: boolean;
}

/** Rozdělí výzkumný výkon a vrátí, co se odemklo. */
export function applyResearch(world: World, output: number, rng: Rng): ResearchOutcome {
  const scored = scoreCandidates(world, rng);
  const focus = scored.slice(0, focusWidth(world));
  const unlocked: ResearchOutcome['unlocked'] = [];
  if (focus.length === 0) return { unlocked, hadCandidates: false };

  const totalScore = focus.reduce((s, c) => s + c.score, 0);
  if (totalScore <= 0) return { unlocked, hadCandidates: false };

  for (const c of focus) {
    const share = (c.score / totalScore) * output;
    const id = c.milestone.id;
    const next = (world.tech.progress[id] ?? 0) + share;

    if (next >= c.cost) {
      const because = becauseOf(world, c.milestone);
      world.tech.progress[id] = 0;
      world.tech.unlocked[id] = { tick: world.tick, year: world.year };
      const lostAt = world.tech.lost.indexOf(id);
      if (lostAt >= 0) world.tech.lost.splice(lostAt, 1);
      unlocked.push({ milestone: c.milestone, because });
    } else {
      world.tech.progress[id] = next;
    }
  }

  return { unlocked, hadCandidates: true };
}

const PRESSURE_PHRASE: Record<PressureId, string> = {
  hunger: 'pod tlakem hladu',
  cold: 've snaze uniknout chladu',
  disease: 'tváří v tvář nemocem',
  war: 'pod tlakem válek',
  crowding: 'protože osady přestaly stačit',
  curiosity: 'z čiré zvědavosti',
};

/** Proč zrovna tenhle milník a zrovna teď. Bez toho je kronika jen seznam. */
export function becauseOf(world: World, m: Milestone): string {
  let bestPressure: PressureId | null = null;
  let bestValue = 0;

  for (const p of PRESSURE_IDS) {
    const aff = m.affinity?.[p];
    if (!aff) continue;
    const v = aff * world.pressures[p];
    if (v > bestValue) {
      bestValue = v;
      bestPressure = p;
    }
  }

  if (bestPressure && bestValue > 0.28) return PRESSURE_PHRASE[bestPressure];

  // Zlevňující vlastnost planety je taky dobrý důvod.
  for (const mod of m.costMods ?? []) {
    if (mod.mul < 1 && matchesCostMod(world, mod)) return mod.why;
  }

  if (world.tech.lost.includes(m.id)) return 'z útržků, které po předcích zbyly';

  // Jméno milníku se drží v 1. pádě za dvojtečkou — čeština by jinak
  // vyžadovala rod a pád každého ze stovky názvů.
  const req = m.requires?.all?.[0] ?? m.requires?.any?.[0];
  const parent = req ? MILESTONE_BY_ID.get(req) : undefined;
  if (parent) return `jako přirozené pokračování dřívějšího objevu (${parent.name.toLowerCase()})`;

  return 'bez zjevné vnější příčiny';
}

/** Podíl dosažitelných milníků epochy, které jsou odemčené. */
export function epochProgress(world: World, reachable: ReadonlySet<string>): number {
  const inEpoch = milestonesOfEpoch(world.epoch).filter((m) => reachable.has(m.id));
  if (inEpoch.length === 0) return 1;
  const done = inEpoch.filter((m) => isUnlocked(world, m.id)).length;
  return done / inEpoch.length;
}

/** Postoupila civilizace do další epochy? */
export function shouldAdvanceEpoch(world: World, reachable: ReadonlySet<string>): boolean {
  return epochProgress(world, reachable) >= epochDef(world.epoch).advanceRatio;
}

/** Přepočítá dostupnost surovin z planety a odemčených technologií. */
export function computeAccess(world: World): Record<ResourceId, number> {
  const p = world.planet;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  return {
    food: clamp(0.4 + p.biosphere.plantYield * 0.4),
    wood: clamp(p.biosphere.plantYield * 0.7 + (1 - world.climate.aridity) * 0.3),
    stone: 0.95,
    flint: clamp(0.5 + p.tectonics * 0.5),
    hide: clamp(0.3 + p.biosphere.megafauna * 0.7),
    fiber: clamp(0.35 + p.biosphere.plantYield * 0.5),
    clay: clamp(0.3 + p.hydrology * 0.7),
    salt: clamp(0.25 + p.hydrology * 0.4 + world.climate.aridity * 0.4),
    obsidian: clamp(p.volcanism * 1.2 - 0.15),
    horses: clamp(p.biosphere.megafauna * 0.9 - world.climate.aridity * 0.2),
    copper: clamp(p.ores.copper),
    tin: clamp(p.ores.tin),
    iron: clamp(p.ores.iron),
    coal: clamp(p.ores.coal),
    oil: clamp(p.ores.oil),
    uranium: clamp(p.ores.uranium),
    rare: clamp(p.ores.rare),
    gold: clamp(p.ores.gold),
  };
}
