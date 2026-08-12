/**
 * Hlavní smyčka simulace.
 *
 * Jeden tick je čistá funkce: stejný vstupní svět dá vždy stejný výstupní svět
 * i stejné události. Žádné hodiny, žádné globální proměnné, veškerá náhoda
 * z `rngFor(seed, tick, stream)`.
 */

import { rngFor, STREAM } from './rng.js';
import { LAST_EPOCH, epochDef, formatYear, yearsPerTick } from './epochs.js';
import { MAX_CONTENT_EPOCH, MILESTONE_BY_ID, milestonesOfEpoch } from './milestones.data.js';
import { applyResearch, computeAccess, reachableIds, shouldAdvanceEpoch } from './research.js';
import { DISASTERS, rollDisasters } from './disasters.js';
import type { DisasterDef } from './disasters.js';
import { biomeAt } from './planet.js';
import { factionName, placeName } from './names.js';
import {
  languageOf,
  recomputeDerived,
  reliefFor,
  settlementCapacity,
  totalCapacity,
  usedFactionNames,
  usedSettlementNames,
} from './world.js';
import type { Declined, Faction, PressureId, Settlement, TickResult, World, WorldEvent } from './types.js';
import { PRESSURE_IDS } from './types.js';

/** Převod populace a vzdělanosti na jednotky poznání za rok. */
const RESEARCH_CONSTANT = 0.0002;

/** Nejvyšší počet osad — brzda pro výkon i pro čitelnost mapy. */
const SETTLEMENT_HARD_CAP = 90;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function event(
  world: World,
  kind: WorldEvent['kind'],
  weight: number,
  text: string,
  data: Record<string, unknown> = {},
): WorldEvent {
  return { tick: world.tick, year: world.year, kind, weight, text, data };
}

// ─────────────────────────────────────────── Klima

/**
 * Klima je čistá funkce simulovaného roku — Milankovičovské cykly složené
 * ze tří sinusovek. Nic se nekumuluje, takže nemůže dojít k driftu při
 * dopočítávání z checkpointu.
 */
export function temperatureAt(world: World, year: number): number {
  const tiltGain = 0.4 + world.planet.axialTilt / 30;
  const wobble =
    3.2 * Math.sin((year / 41000) * Math.PI * 2) +
    1.8 * Math.sin((year / 101000) * Math.PI * 2 + 1.1) +
    1.1 * Math.sin((year / 23000) * Math.PI * 2 + 2.3);
  return wobble * tiltGain + (world.planet.greenhouse - 0.42) * 4;
}

function updateClimate(world: World): void {
  const t = temperatureAt(world, world.year);
  world.climate.temperature = t;
  world.climate.iceCoverage = clamp01(0.1 - t * 0.09);
  world.climate.aridity = clamp01(0.35 + t * 0.035 - world.planet.hydrology * 0.25);
  world.climate.seaLevel = -world.climate.iceCoverage * 80;
}

/**
 * Doba ledová se hlásí s hysterezí a s minimálním odstupem.
 *
 * Milankovičovské cykly mají periodu 23–100 tisíc let, což jsou v epoše 0
 * pouhé jednotky ticků. Prostý práh proto kmital sem a tam a kronika hlásila
 * příchod a ústup ledovců každých pět ticků. Široké pásmo mezi vstupem
 * a výstupem plus odstup nechají projít jen skutečné velké zvraty.
 */
const ICE_AGE_ENTER = -4.5;
const ICE_AGE_EXIT = -2;
const MIN_TICKS_BETWEEN_SHIFTS = 12;

function checkIceAge(world: World, events: WorldEvent[]): void {
  const t = world.climate.temperature;
  const since = world.tick - world.climate.lastShiftTick;
  const wants = world.climate.iceAge ? t < ICE_AGE_EXIT : t < ICE_AGE_ENTER;
  if (wants === world.climate.iceAge || since < MIN_TICKS_BETWEEN_SHIFTS) return;

  world.climate.iceAge = wants;
  world.climate.lastShiftTick = world.tick;

  // V epoše 0 je střídání ledovců rytmus existence, ne zpráva — jeden tick
  // pokrývá čtyři tisíciletí a celý glaciální cyklus proběhne za pár ticků.
  // Událost se zaznamená vždy (časová osa ji bude chtít), ale v hlubokém čase
  // dostane nízkou váhu, aby nepřehlušila to, co se civilizace právě naučila.
  const weight = world.epoch === 0 ? 0.5 : 0.9;

  events.push(
    wants
      ? event(world, 'climate', weight, 'Zima přestala končit. Ledovce se daly do pohybu k jihu.', { onset: true })
      : event(world, 'climate', weight, 'Led ustoupil. Pod ním se objevila země, kterou nikdo nepamatoval.', {
          onset: false,
        }),
  );
}

// ─────────────────────────────────────────── Populace

function growPopulation(world: World, years: number): void {
  // Rychlost růstu roste s epochou — v paleolitu se populace hýbe po tisíciletích,
  // v průmyslu po desetiletích. Meze drží krok stabilní napříč všemi epochami.
  // Strop držíme nízko schválně: populace musí za kapacitou znatelně zaostávat,
  // jinak by poměr pop/kapacita byl vždy 1 a všechny tlaky z něj odvozené
  // by ztuhly na konstantě. Zpoždění je to, co dělá skok po nové technologii viditelným.
  //
  // V epoše 0 je ale strop vyšší: čtyři tisíciletí na jeden tick znamenají,
  // že se tlupa po ráně prakticky vždy stihne vzpamatovat. S nižším stropem
  // vymírala skoro polovina světů ještě v paleolitu.
  const kYear = 0.0008 * Math.pow(1.55, world.epoch);
  const ceiling = world.epoch === 0 ? 0.62 : 0.3;
  const fraction = Math.max(0.02, Math.min(ceiling, 1 - Math.exp(-kYear * years)));

  for (const s of world.settlements) {
    const cap = settlementCapacity(world, s);
    s.population = Math.max(0, cap + (s.population - cap) * (1 - fraction));
  }
  recomputeDerived(world);
}

// ─────────────────────────────────────────── Katastrofy

function pickSettlement(world: World, rng: ReturnType<typeof rngFor>): Settlement | null {
  if (world.settlements.length === 0) return null;
  return rng.weighted(world.settlements, (s) => Math.max(1, s.population));
}

/**
 * Klíčová věc pro hluboký čas: dopady katastrof se NESČÍTAJÍ.
 *
 * Když jeden tick pokrývá čtyři tisíciletí, populace se mezi jednotlivými
 * ranami stihne vrátit ke kapacitě. Na konci ticku je tedy vidět v podstatě
 * jen ta poslední rána — ne součet všech. Sčítání by civilizaci vyhladilo
 * hned v prvním ticku, což byla první věc, kterou simulace udělala.
 */
function applyDisasters(world: World, years: number, events: WorldEvent[]): void {
  const rng = rngFor(world.seed, world.tick, STREAM.disaster);
  const rolls = rollDisasters(world, years, rng);
  const total = rolls.reduce((sum, r) => sum + r.count, 0);
  if (total === 0) return;

  if (total <= 3) {
    for (const { def, count } of rolls) {
      for (let i = 0; i < count; i++) strikeOnce(world, def, rng, events);
    }
    return;
  }

  const ordered = rolls
    .slice()
    .sort((a, b) => b.count - a.count || (a.def.id < b.def.id ? -1 : 1));

  const worst = ordered[0];
  const target = pickSettlement(world, rng);
  const wiped = target && worst ? applyToll(world, worst.def, target, 1, rng) : false;

  // Trvalý neklid období se ale projeví — jako zvýšené tlaky, ne jako mrtví.
  for (const { def, count } of ordered) {
    for (const [key, value] of Object.entries(def.spikes)) {
      const p = key as PressureId;
      world.pressures[p] = clamp01(
        world.pressures[p] + (value ?? 0) * Math.min(1, count / 8) * 0.5,
      );
    }
  }

  // Pohromy jsou v hlubokém čase normální stav, ne zpráva. Do kroniky se
  // dostane jen období, které bylo výrazně zlejší než obvyklé, nebo takové,
  // po kterém zůstala prázdná osada. Jinak by každý tick vypadal stejně.
  const expected = DISASTERS.reduce((sum, d) => sum + Math.max(0, d.rate(world)) * years, 0);
  if (!wiped && !(expected > 0 && total > expected * 1.5)) return;

  const summary = ordered
    .slice(0, 3)
    .map((r) => `${r.count}× ${r.def.label}`)
    .join(', ');

  events.push(
    event(
      world,
      'disaster_aggregate',
      wiped ? 0.75 : 0.5,
      wiped
        ? `Zlé období: ${summary}. Osada ${target?.name ?? '?'} se z něj už nezvedla.`
        : `Zlé období: ${summary}. Osídlení pokaždé ustoupilo a znovu se vrátilo.`,
      { rolls: ordered.map((r) => ({ id: r.def.id, count: r.count })), wiped },
    ),
  );
}

function applyToll(world: World, def: DisasterDef, target: Settlement, severity: number, rng: ReturnType<typeof rngFor>): boolean {
  const toll = rng.range(def.toll[0], def.toll[1]) * severity;
  target.population = Math.max(0, target.population * (1 - Math.min(0.95, toll)));

  const wiped =
    world.settlements.length > 1 &&
    (rng.chance(def.wipeChance * severity) || target.population < 8);

  if (wiped) {
    const idx = world.settlements.indexOf(target);
    if (idx >= 0) world.settlements.splice(idx, 1);
  }

  for (const [key, value] of Object.entries(def.spikes)) {
    const p = key as PressureId;
    world.pressures[p] = clamp01(world.pressures[p] + (value ?? 0) * severity);
  }
  return wiped;
}

function strikeOnce(world: World, def: DisasterDef, rng: ReturnType<typeof rngFor>, events: WorldEvent[]): void {
  const target = pickSettlement(world, rng);
  if (!target) return;

  const before = target.population;
  const wiped = applyToll(world, def, target, 1, rng);
  const line = rng.pick(def.lines).replace('{osada}', target.name);
  const lost = Math.round(before - (wiped ? 0 : target.population));

  events.push(
    event(world, 'disaster', wiped ? 0.9 : 0.6, line, {
      disaster: def.id,
      settlement: target.name,
      wiped,
      lost,
    }),
  );

  if (wiped) {
    events.push(
      event(world, 'settlement_lost', 0.8, `Osada ${target.name} zanikla.`, {
        settlement: target.name,
        cause: def.id,
      }),
    );
  }
}

// ─────────────────────────────────────────── Tlaky

function updatePressures(world: World, years: number): void {
  const cap = Math.max(1, totalCapacity(world));
  const crowding = clamp01(world.stats.population / cap);
  const t = world.climate.temperature;

  const baseline: Record<PressureId, number> = {
    cold: clamp01(0.25 - t * 0.12 + world.climate.iceCoverage * 0.6 - reliefFor(world, 'cold')),
    hunger: clamp01(
      crowding * 0.7 + world.climate.aridity * 0.4 - 0.25 - reliefFor(world, 'hunger'),
    ),
    disease: clamp01(
      crowding * 0.5 * (0.4 + world.planet.biosphere.pathogenLoad) - reliefFor(world, 'disease'),
    ),
    war: clamp01(meanRivalry(world) * 0.8 + crowding * 0.3 - 0.15),
    crowding,
    curiosity: clamp01(0.22 + world.stats.literacy * 0.5 + world.stats.specialization * 0.35),
  };

  // Špičky po katastrofách odeznívají — rychleji tam, kde tick pokrývá víc let.
  const decay = Math.exp(-years * 0.02);
  for (const p of PRESSURE_IDS) {
    world.pressures[p] = clamp01(baseline[p] + (world.pressures[p] - baseline[p]) * decay);
  }
}

function meanRivalry(world: World): number {
  let sum = 0;
  let n = 0;
  for (const f of world.factions) {
    for (const key of Object.keys(f.rivalry)) {
      sum += f.rivalry[key] ?? 0;
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

// ─────────────────────────────────────────── Výzkum

/**
 * Výzkumný výkon za tick.
 *
 * Násobiče výzkumu se stejně jako u kapacity v datech milníků násobí, takže
 * surový součin roste mezi epochami o dva řády. Stejný změkčující exponent
 * drží tempo v rozsahu, který jde ještě autorsky vyvážit.
 */
export function researchOutput(world: World, years: number): number {
  const { population, literacy, specialization, researchMul } = world.stats;
  if (population <= 0) return 0;
  return (
    Math.pow(population, 0.75) *
    (0.25 + literacy) *
    (0.5 + specialization) *
    Math.pow(researchMul, 0.75) *
    RESEARCH_CONSTANT *
    years
  );
}

/**
 * Věta o milníku.
 *
 * Všechny varianty drží název milníku v 1. pádě za dvojtečkou a shodu věší
 * na slovo „milník" nebo „objev". Kdyby název stál jako předmět, čeština by
 * chtěla akuzativ — a „zvládli filosofie" místo „filosofii" je přesně ta
 * chyba, kterou tímhle obcházíme, aniž bychom u sta názvů evidovali rod.
 */
function milestoneSentence(
  rng: ReturnType<typeof rngFor>,
  faction: Declined,
  name: string,
  because: string,
  blurb: string,
): string {
  const variants = [
    `${faction.nom} dosáhli milníku: ${name} — ${because}. ${blurb}`,
    `Nový milník u ${faction.gen}: ${name} — ${because}. ${blurb}`,
    `U ${faction.gen} se prosadil objev: ${name} — ${because}. ${blurb}`,
    `${faction.dat} se podařil milník: ${name} — ${because}. ${blurb}`,
  ];
  return rng.pick(variants);
}

function doResearch(world: World, years: number, events: WorldEvent[]): boolean {
  const rng = rngFor(world.seed, world.tick, STREAM.research);
  const outcome = applyResearch(world, researchOutput(world, years), rng);

  for (const { milestone, because } of outcome.unlocked) {
    const who = rng.pick(world.factions);
    events.push(
      event(world, 'milestone', 1, milestoneSentence(rng, who.name, milestone.name, because, milestone.blurb), {
        milestone: milestone.id,
        name: milestone.name,
        faction: who.id,
        because,
      }),
    );
  }

  if (outcome.unlocked.length > 0) recomputeDerived(world);

  // Stagnace znamená, že není na čem pracovat — ne že se pracuje pomalu.
  // Původní verze počítala každý tick bez objevu a spolehlivě zabíjela
  // civilizace, které jen měly před sebou drahý milník.
  world.idleTicks = outcome.hadCandidates ? 0 : world.idleTicks + 1;
  return outcome.unlocked.length > 0;
}

// ─────────────────────────────────────────── Osídlení

function maxSettlements(world: World): number {
  const fromTech = Math.log2(Math.max(1, world.stats.capacityMul)) * 1.6;
  return Math.min(SETTLEMENT_HARD_CAP, Math.round(1 + world.epoch * 3 + fromTech));
}

function maybeFoundSettlement(world: World, events: WorldEvent[]): void {
  if (world.settlements.length >= maxSettlements(world)) return;
  if (world.pressures.crowding < 0.72) return;

  const rng = rngFor(world.seed, world.tick, STREAM.settlement);
  if (!rng.chance(0.08)) return;

  const parent = pickSettlement(world, rng);
  if (!parent || parent.population < 60) return;

  // Nová osada vzniká poblíž mateřské — civilizace se šíří, neteleportuje.
  const drift = rng.range(0.06, 0.22);
  const angle = rng.next() * Math.PI * 2;
  const r = Math.max(0.02, Math.min(0.99, parent.r + Math.cos(angle) * drift));
  const theta = (parent.theta + Math.sin(angle) * drift * 3 + Math.PI * 2) % (Math.PI * 2);

  const lang = languageOf(world, parent.factionId);
  const name = placeName(rng, lang, usedSettlementNames(world));
  const moved = parent.population * rng.range(0.2, 0.4);
  parent.population -= moved;

  const s: Settlement = {
    id: `s${world.nextIds.settlement++}`,
    name,
    factionId: parent.factionId,
    population: moved,
    r,
    theta,
    biome: biomeAt(world.planet, r, theta, world.climate.temperature, world.climate.aridity),
    foundedTick: world.tick,
  };
  world.settlements.push(s);

  events.push(
    event(world, 'settlement_founded', 0.4, `Z ${parent.name} odešla část lidí a založila osadu ${name}.`, {
      settlement: name,
      from: parent.name,
    }),
  );
}

// ─────────────────────────────────────────── Frakce a války

function maybeSplitFaction(world: World, events: WorldEvent[]): void {
  if (world.settlements.length < 4 || world.factions.length >= 8) return;

  const rng = rngFor(world.seed, world.tick, STREAM.factions);
  // Rozpad je pravděpodobnější, když je civilizace velká a rozlezlá.
  const pressure = world.pressures.crowding * 0.5 + world.settlements.length / 60;
  if (!rng.chance(0.012 * pressure)) return;

  const parent = rng.pick(world.factions);
  const owned = world.settlements.filter((s) => s.factionId === parent.id);
  if (owned.length < 3) return;

  const taken = rng.shuffle(owned).slice(0, Math.max(1, Math.floor(owned.length * rng.range(0.25, 0.45))));
  if (taken.length === 0 || taken.length === owned.length) return;

  const id = `f${world.nextIds.faction++}`;
  const child: Faction = {
    id,
    name: factionName(rng, usedFactionNames(world)),
    culture: {
      aggression: clamp01(parent.culture.aggression + rng.gauss(0, 0.18)),
      curiosity: clamp01(parent.culture.curiosity + rng.gauss(0, 0.18)),
      piety: clamp01(parent.culture.piety + rng.gauss(0, 0.22)),
      mercantile: clamp01(parent.culture.mercantile + rng.gauss(0, 0.18)),
      collectivism: clamp01(parent.culture.collectivism + rng.gauss(0, 0.18)),
    },
    hue: world.factions.length % 6,
    foundedTick: world.tick,
    foundedYear: world.year,
    parentId: parent.id,
    rivalry: { [parent.id]: rng.range(0.3, 0.6) },
  };

  for (const s of taken) s.factionId = id;
  parent.rivalry[id] = rng.range(0.3, 0.6);
  world.factions.push(child);

  events.push(
    event(
      world,
      'faction_split',
      0.85,
      `${child.name.nom} se odtrhli od ${parent.name.gen}. Rozešli se ve zlém a vzali si ${taken.length} osad.`,
      { faction: id, from: parent.id, settlements: taken.length },
    ),
  );
}

function driftRivalry(world: World, years: number): void {
  const rng = rngFor(world.seed, world.tick, STREAM.war);
  for (const f of world.factions) {
    for (const other of world.factions) {
      if (other.id === f.id) continue;
      const current = f.rivalry[other.id] ?? 0.15;
      // Tlačenice rivalitu živí, obchod ji tlumí. Původní váhy nedokázaly
      // překlopit rivalitu přes válečný práh ani jednou za 3000 ticků —
      // frakce se rozcházely, ale nikdy se nepobily.
      const pull =
        world.pressures.crowding * 0.55 +
        f.culture.aggression * 0.5 -
        f.culture.mercantile * 0.2;
      const rate = Math.min(0.4, years * 0.004);
      f.rivalry[other.id] = clamp01(current + (pull - current) * rate + rng.gauss(0, 0.01));
    }
  }
}

function maybeWar(world: World, events: WorldEvent[]): void {
  if (world.factions.length < 2) return;
  const rng = rngFor(world.seed, world.tick, STREAM.war, 7);

  for (const a of world.factions) {
    for (const b of world.factions) {
      if (a.id >= b.id) continue; // každou dvojici jen jednou, stabilně podle id
      const rivalry = Math.max(a.rivalry[b.id] ?? 0, b.rivalry[a.id] ?? 0);
      if (rivalry < 0.5) continue;
      if (!rng.chance(0.06 * rivalry)) continue;

      const aSet = world.settlements.filter((s) => s.factionId === a.id);
      const bSet = world.settlements.filter((s) => s.factionId === b.id);
      if (aSet.length === 0 || bSet.length === 0) continue;

      const toll = rng.range(0.05, 0.2);
      for (const s of [...aSet, ...bSet]) s.population *= 1 - toll;

      const aPow = aSet.reduce((x, s) => x + s.population, 0) * (1 + world.stats.might);
      const bPow = bSet.reduce((x, s) => x + s.population, 0) * (1 + world.stats.might);
      const winner = aPow >= bPow ? a : b;
      const loser = winner === a ? b : a;
      const loserSet = winner === a ? bSet : aSet;

      // Vítěz si vezme část osad poraženého.
      const seized = rng.shuffle(loserSet).slice(0, Math.max(1, Math.floor(loserSet.length * 0.35)));
      for (const s of seized) s.factionId = winner.id;

      a.rivalry[b.id] = clamp01(rivalry - 0.3);
      b.rivalry[a.id] = clamp01(rivalry - 0.3);
      world.pressures.war = clamp01(world.pressures.war + 0.4);

      events.push(
        event(
          world,
          'war',
          0.95,
          `Válka mezi ${a.name.ins} a ${b.name.ins} skončila po letech vyčerpáním. ${winner.name.nom} si podrobili ${seized.length} osad ${loser.name.gen}.`,
          { a: a.id, b: b.id, winner: winner.id, seized: seized.length },
        ),
      );
    }
  }

  // Frakce, které přišly o všechny osady, mizí.
  const alive = new Set(world.settlements.map((s) => s.factionId));
  for (const f of world.factions.filter((x) => !alive.has(x.id))) {
    // Vlastní druh události: frakce může vymřít i bez války, když jí poslední
    // osadu vezme mor nebo sopka. Označovat to mečem bylo zavádějící.
    events.push(
      event(world, 'faction_end', 0.7, `${f.name.nom} přestali existovat jako společenství.`, {
        faction: f.id,
      }),
    );
  }
  world.factions = world.factions.filter((f) => alive.has(f.id) || world.factions.length === 1);
}

// ─────────────────────────────────────────── Epocha, kolaps, konec

function checkEpoch(world: World, events: WorldEvent[]): void {
  if (world.epoch >= Math.min(LAST_EPOCH, MAX_CONTENT_EPOCH)) return;
  const reachable = reachableIds(world);
  if (!shouldAdvanceEpoch(world, reachable)) return;

  world.epoch += 1;

  // Vstup do neolitu zakládá vlastní letopočet civilizace.
  if (world.epoch === 1 && world.foundingYear === null) world.foundingYear = world.year;

  events.push(
    event(world, 'epoch', 1, `Začíná nová epocha: ${epochDef(world.epoch).name}.`, {
      epoch: world.epoch,
      name: epochDef(world.epoch).name,
    }),
  );
}

/**
 * Kolaps. Prudký propad populace znamená, že se přetrhne předávání znalostí —
 * milníky se hází podle své křehkosti a mohou se ztratit. Ohně se nezapomene,
 * hvězdářství ano. Tohle dělá oblouk dějin nemonotónním.
 */
function checkCollapse(world: World, popBefore: number, events: WorldEvent[]): void {
  if (popBefore <= 0) return;
  const drop = (popBefore - world.stats.population) / popBefore;
  if (drop < 0.28) return;

  const rng = rngFor(world.seed, world.tick, STREAM.collapse);
  const severity = Math.min(1, (drop - 0.28) / 0.4);
  const lost: string[] = [];

  for (const id of Object.keys(world.tech.unlocked)) {
    const m = MILESTONE_BY_ID.get(id);
    if (!m) continue;
    if (rng.chance(m.fragility * severity)) lost.push(id);
  }

  if (lost.length === 0) return;

  for (const id of lost) {
    delete world.tech.unlocked[id];
    world.tech.progress[id] = 0;
    if (!world.tech.lost.includes(id)) world.tech.lost.push(id);
  }
  recomputeDerived(world);

  const names = lost
    .map((id) => MILESTONE_BY_ID.get(id)?.name.toLowerCase())
    .filter((x): x is string => Boolean(x));

  events.push(
    event(
      world,
      'milestone_lost',
      1,
      `Propad byl tak prudký, že se přetrhlo předávání znalostí. Zapomnělo se: ${names.join(', ')}.`,
      { lost, severity },
    ),
  );

  // Epocha může regredovat, když se ztratilo příliš.
  const reachable = reachableIds(world);
  while (world.epoch > 0 && !shouldAdvanceEpoch({ ...world, epoch: world.epoch - 1 }, reachable)) {
    world.epoch -= 1;
    events.push(
      event(world, 'epoch', 1, `Civilizace se propadla zpět do epochy ${epochDef(world.epoch).name}.`, {
        epoch: world.epoch,
        regression: true,
      }),
    );
    break; // nanejvýš jedna epocha zpět za tick
  }
}

const STAGNATION_LIMIT = 500;

function checkEnding(world: World, events: WorldEvent[]): void {
  if (world.ending) return;

  // Jedna zlá rána ještě není konec — teprve když se civilizace nedokáže
  // zvednout několik ticků po sobě, je opravdu po ní.
  const onBrink = world.stats.population < 25 || totalCapacity(world) < 25;
  world.brinkTicks = onBrink ? world.brinkTicks + 1 : 0;

  if (world.settlements.length === 0 || (world.brinkTicks >= 6 && world.stats.population < 12)) {
    world.ending = { kind: 'extinction', tick: world.tick, year: world.year };
    events.push(
      event(world, 'ending', 1, `Poslední z nich zemřeli v ${formatYear(world.year, world.foundingYear)}. Planeta ${world.planet.name} zůstala prázdná.`, {
        ending: 'extinction',
      }),
    );
    return;
  }

  if (world.idleTicks > STAGNATION_LIMIT) {
    world.ending = { kind: 'stagnation', tick: world.tick, year: world.year };
    events.push(
      event(world, 'ending', 1, 'Nic nového už nepřišlo. Civilizace se usadila v tom, co uměla, a zůstala tam.', {
        ending: 'stagnation',
      }),
    );
    return;
  }

  const contentDone = world.epoch >= LAST_EPOCH && milestonesOfEpoch(LAST_EPOCH).every((m) => world.tech.unlocked[m.id]);
  if (contentDone) {
    world.ending = { kind: 'transcendence', tick: world.tick, year: world.year };
    events.push(event(world, 'ending', 1, 'Odsud už nevidíme dál.', { ending: 'transcendence' }));
  }
}

// ─────────────────────────────────────────── Tick

export function tickWorld(prev: World): TickResult {
  const world: World = structuredClone(prev);
  const events: WorldEvent[] = [];

  if (world.ending) return { world, events };

  world.tick += 1;
  const years = yearsPerTick(world.epoch);
  world.year += years;

  updateClimate(world);
  checkIceAge(world, events);

  world.access = computeAccess(world);
  recomputeDerived(world);

  growPopulation(world, years);
  const popBefore = world.stats.population;

  applyDisasters(world, years, events);
  recomputeDerived(world);

  updatePressures(world, years);
  doResearch(world, years, events);

  maybeFoundSettlement(world, events);
  driftRivalry(world, years);
  maybeSplitFaction(world, events);
  maybeWar(world, events);
  recomputeDerived(world);

  checkEpoch(world, events);
  checkCollapse(world, popBefore, events);
  checkEnding(world, events);

  recomputeDerived(world);
  return { world, events };
}

/** Odsimuluje N ticků a vrátí celou kroniku. */
export function simulate(
  start: World,
  ticks: number,
): { world: World; events: WorldEvent[] } {
  let world = start;
  const all: WorldEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    if (world.ending) break;
    const res = tickWorld(world);
    world = res.world;
    all.push(...res.events);
  }
  return { world, events: all };
}

/** Genesis událost — první věta kroniky. */
export function genesisEvent(world: World): WorldEvent {
  const first = world.settlements[0];
  const faction = world.factions[0];
  return {
    tick: 0,
    year: 0,
    kind: 'genesis',
    weight: 1,
    text: `Na planetě ${world.planet.name} se v jeskyni u ${first?.name ?? 'bezejmenného místa'} probudilo ${Math.round(world.stats.population)} lidí. Říkali si ${faction?.name.nom ?? 'nijak'}. Neuměli nic.`,
    data: { planet: world.planet.name, population: world.stats.population },
  };
}
