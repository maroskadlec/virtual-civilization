/**
 * Kronika v terminálu.
 *
 * Hlavní nástroj fáze M1: odsimuluje N ticků a vypíše dějiny, aby se dalo
 * posoudit, jestli jsou zajímavé — dřív, než se investuje do vizualizace.
 * Režim --sweep pak proběhne mnoho seedů a vrátí statistiku pro vyvažování.
 *
 *   npm run chronicle -- --seed 42 --ticks 5000
 *   npm run sweep -- 200
 */

import { createWorld } from '../engine/world.js';
import { genesisEvent, researchOutput, simulate, simulateCampaign, tickWorld } from '../engine/tick.js';
import { epochDef, formatYear, yearsPerTick } from '../engine/epochs.js';
import { planetNotes, BIOME_LABEL } from '../engine/planet.js';
import { EPOCH_COST_SCALE, MILESTONES, MAX_CONTENT_EPOCH } from '../engine/milestones.data.js';
import { reachableIds } from '../engine/research.js';
import type { RunSummary, World, WorldEvent } from '../engine/types.js';

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const KIND_STYLE: Record<string, { color: string; mark: string }> = {
  genesis: { color: C.bold, mark: '◆' },
  milestone: { color: C.green, mark: '✦' },
  milestone_lost: { color: C.red, mark: '✖' },
  disaster: { color: C.yellow, mark: '▲' },
  disaster_aggregate: { color: C.dim, mark: '▵' },
  epoch: { color: C.cyan + C.bold, mark: '■' },
  faction_split: { color: C.magenta, mark: '⑂' },
  faction_end: { color: C.magenta, mark: '†' },
  war: { color: C.red, mark: '⚔' },
  settlement_founded: { color: C.dim, mark: '·' },
  settlement_lost: { color: C.dim, mark: '×' },
  climate: { color: C.blue, mark: '❄' },
  population: { color: C.dim, mark: '·' },
  ending: { color: C.bold + C.red, mark: '●' },
};

function printEvent(e: WorldEvent, foundingYear: number | null): void {
  const style = KIND_STYLE[e.kind] ?? { color: '', mark: '·' };
  const stamp = `${String(e.tick).padStart(5)} ${formatYear(e.year, foundingYear).padEnd(16)}`;
  console.log(`${C.dim}${stamp}${C.reset} ${style.color}${style.mark} ${e.text}${C.reset}`);
}

function printPlanet(world: World): void {
  const p = world.planet;
  console.log(`\n${C.bold}PLANETA ${p.name.toUpperCase()}${C.reset}`);
  console.log(
    `${C.dim}  gravitace ${p.gravity.toFixed(2)} g · den ${p.dayHours.toFixed(1)} h · rok ${Math.round(p.yearDays)} dní · sklon osy ${p.axialTilt.toFixed(0)}°${C.reset}`,
  );
  console.log(
    `${C.dim}  tektonika ${p.tectonics.toFixed(2)} · vulkanismus ${p.volcanism.toFixed(2)} · hydrologie ${p.hydrology.toFixed(2)} · mag. pole ${p.magneticField.toFixed(2)} · měsíce ${p.moons}${C.reset}`,
  );
  const ores = Object.entries(p.ores)
    .map(([k, v]) => `${k} ${v.toFixed(2)}`)
    .join(' · ');
  console.log(`${C.dim}  rudy: ${ores}${C.reset}`);
  for (const note of planetNotes(p)) console.log(`  ${C.yellow}→${C.reset} ${note}`);
  console.log();
}

function printSummary(world: World, events: WorldEvent[]): void {
  const reachable = reachableIds(world);
  const unlocked = Object.keys(world.tech.unlocked).length;
  const unreachable = MILESTONES.filter((m) => !reachable.has(m.id));

  console.log(`\n${C.bold}STAV PO ${world.tick} TICÍCH${C.reset}`);
  console.log(
    `  epocha ${world.epoch} (${epochDef(world.epoch).name}) · ${formatYear(world.year, world.foundingYear)} · populace ${Math.round(world.stats.population).toLocaleString('cs-CZ')}`,
  );
  console.log(
    `  milníky ${unlocked}/${MILESTONES.length} · ztraceno ${world.tech.lost.length} · frakce ${world.factions.length} · osady ${world.settlements.length}`,
  );
  console.log(
    `${C.dim}  gramotnost ${world.stats.literacy.toFixed(2)} · specializace ${world.stats.specialization.toFixed(2)} · kapacita ×${world.stats.capacityMul.toFixed(1)} · výzkum ×${world.stats.researchMul.toFixed(1)}${C.reset}`,
  );
  const pressures = Object.entries(world.pressures)
    .map(([k, v]) => `${k} ${v.toFixed(2)}`)
    .join(' · ');
  console.log(`${C.dim}  tlaky: ${pressures}${C.reset}`);

  if (world.ending) {
    console.log(`  ${C.red}${C.bold}konec: ${world.ending.kind} v ${formatYear(world.ending.year, world.foundingYear)}${C.reset}`);
  }

  if (unreachable.length > 0) {
    console.log(
      `${C.dim}  nedosažitelné na této planetě: ${unreachable.map((m) => m.name).join(', ')}${C.reset}`,
    );
  }

  const notUnlocked = MILESTONES.filter((m) => reachable.has(m.id) && !world.tech.unlocked[m.id]);
  if (notUnlocked.length > 0) {
    console.log(
      `${C.dim}  dosažitelné, ale neodemčené: ${notUnlocked.map((m) => m.name).join(', ')}${C.reset}`,
    );
  }

  console.log(`${C.dim}  osady: ${world.settlements.slice(0, 12).map((s) => `${s.name} (${BIOME_LABEL[s.biome]}, ${Math.round(s.population)})`).join(', ')}${C.reset}`);
  console.log(`${C.dim}  událostí celkem: ${events.length}${C.reset}\n`);
}

function runOne(seed: number, ticks: number, minWeight: number): void {
  const world = createWorld(seed);
  printPlanet(world);

  const { world: final, events } = simulate(world, ticks);
  printEvent(genesisEvent(world), final.foundingYear);
  for (const e of events) {
    if (e.weight >= minWeight) printEvent(e, final.foundingYear);
  }
  printSummary(final, events);
}

interface SweepRow {
  seed: number;
  epoch: number;
  year: number;
  population: number;
  unlocked: number;
  ending: string;
  endTick: number;
  epochTicks: number[];
}

const TARGET_TICKS_PER_EPOCH = 500;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function runSweep(count: number, ticks: number): void {
  const rows: SweepRow[] = [];
  const neverUnlocked = new Map<string, number>();
  for (const m of MILESTONES) neverUnlocked.set(m.id, 0);
  /** Výzkumný výkon na tick v každé epoše — vstup pro kalibraci EPOCH_COST_SCALE. */
  const outputByEpoch = new Map<number, number[]>();

  for (let seed = 1; seed <= count; seed++) {
    let world = createWorld(seed);
    const epochTicks: number[] = [];
    let lastEpoch = 0;

    for (let i = 0; i < ticks; i++) {
      if (world.ending) break;
      const res = tickWorld(world);
      world = res.world;

      // Měříme jen ticky, kdy civilizace opravdu objevuje. Dlouhý stagnační
      // ocas na konci by medián vyhnal o řády nahoru a kalibrace by lhala.
      if (world.idleTicks < 20) {
        const bucket = outputByEpoch.get(world.epoch) ?? [];
        bucket.push(researchOutput(world, yearsPerTick(world.epoch)));
        outputByEpoch.set(world.epoch, bucket);
      }

      if (world.epoch > lastEpoch) {
        epochTicks.push(world.tick);
        lastEpoch = world.epoch;
      }
    }

    for (const m of MILESTONES) {
      if (!world.tech.unlocked[m.id]) neverUnlocked.set(m.id, (neverUnlocked.get(m.id) ?? 0) + 1);
    }

    rows.push({
      seed,
      epoch: world.epoch,
      year: world.year,
      population: world.stats.population,
      unlocked: Object.keys(world.tech.unlocked).length,
      ending: world.ending?.kind ?? '—',
      endTick: world.tick,
      epochTicks,
    });
  }

  console.log(`\n${C.bold}SWEEP — ${count} seedů × ${ticks} ticků${C.reset}\n`);

  // Rozložení dosažené epochy.
  const byEpoch = new Map<number, number>();
  for (const r of rows) byEpoch.set(r.epoch, (byEpoch.get(r.epoch) ?? 0) + 1);
  console.log(`${C.bold}Dosažená epocha${C.reset}`);
  for (const e of [...byEpoch.keys()].sort((a, b) => a - b)) {
    const n = byEpoch.get(e) ?? 0;
    const bar = '█'.repeat(Math.round((n / count) * 40));
    console.log(`  ${String(e).padStart(2)} ${epochDef(e).name.padEnd(16)} ${String(n).padStart(4)} ${C.cyan}${bar}${C.reset}`);
  }

  // Kolik ticků trvala která epocha.
  console.log(`\n${C.bold}Ticků na epochu (medián)${C.reset}`);
  for (let e = 0; e <= MAX_CONTENT_EPOCH; e++) {
    const durations = rows
      .map((r) => {
        const start = e === 0 ? 0 : r.epochTicks[e - 1];
        const end = r.epochTicks[e];
        return start !== undefined && end !== undefined ? end - start : null;
      })
      .filter((x): x is number => x !== null)
      .sort((a, b) => a - b);
    if (durations.length === 0) {
      console.log(`  ${String(e).padStart(2)} ${epochDef(e).name.padEnd(16)} ${C.dim}nikdy nedokončena${C.reset}`);
      continue;
    }
    const median = durations[Math.floor(durations.length / 2)] ?? 0;
    const flag = median < 200 || median > 900 ? C.red : C.green;
    console.log(
      `  ${String(e).padStart(2)} ${epochDef(e).name.padEnd(16)} ${flag}${String(median).padStart(5)}${C.reset} ${C.dim}(n=${durations.length}, min ${durations[0]}, max ${durations[durations.length - 1]})${C.reset}`,
    );
  }

  // Konce.
  const byEnding = new Map<string, number[]>();
  for (const r of rows) {
    const bucket = byEnding.get(r.ending) ?? [];
    bucket.push(r.endTick);
    byEnding.set(r.ending, bucket);
  }
  console.log(`\n${C.bold}Konce${C.reset} ${C.dim}(a v kolikátém ticku nastaly)${C.reset}`);
  for (const [kind, ticksAt] of [...byEnding.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const med = median(ticksAt);
    const short = kind === 'extinction' && med < 400 ? C.red : '';
    console.log(
      `  ${kind.padEnd(16)} ${String(ticksAt.length).padStart(4)}  ${((ticksAt.length / count) * 100).toFixed(0).padStart(3)} %  ${short}medián tick ${Math.round(med)}${C.reset}`,
    );
  }

  // Milníky, které se skoro nikdy neodemknou — kandidáti na přeladění.
  const problematic = [...neverUnlocked.entries()]
    .filter(([, n]) => n > count * 0.5)
    .sort((a, b) => b[1] - a[1]);
  if (problematic.length > 0) {
    console.log(`\n${C.bold}Milníky odemčené v méně než polovině světů${C.reset}`);
    for (const [id, n] of problematic) {
      const m = MILESTONES.find((x) => x.id === id);
      console.log(`  ${C.yellow}${(m?.name ?? id).padEnd(24)}${C.reset} chybí v ${((n / count) * 100).toFixed(0)} % světů`);
    }
  }

  // Kalibrace: kolik má stát relativní jednotka obtížnosti v každé epoše,
  // aby epocha trvala zhruba TARGET_TICKS_PER_EPOCH ticků.
  console.log(`\n${C.bold}Doporučené EPOCH_COST_SCALE${C.reset} ${C.dim}(cíl ${TARGET_TICKS_PER_EPOCH} ticků/epochu)${C.reset}`);
  for (let e = 0; e <= MAX_CONTENT_EPOCH; e++) {
    const outputs = outputByEpoch.get(e) ?? [];
    if (outputs.length === 0) continue;
    const perTick = median(outputs);
    const relativeSum = MILESTONES.filter((m) => m.epoch === e).reduce((s, m) => s + m.cost, 0);
    if (relativeSum === 0) continue;
    const suggested = (TARGET_TICKS_PER_EPOCH * perTick) / relativeSum;
    const current = EPOCH_COST_SCALE[e] ?? 1;
    const ratio = suggested / current;
    const flag = ratio > 2 || ratio < 0.5 ? C.red : C.green;
    console.log(
      `  ${String(e).padStart(2)} ${epochDef(e).name.padEnd(16)} nyní ${String(current).padStart(7)} → ${flag}${suggested.toPrecision(3).padStart(9)}${C.reset} ${C.dim}(výkon/tick ${perTick.toPrecision(3)})${C.reset}`,
    );
  }

  const medianPop = rows.map((r) => r.population).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0;
  console.log(`\n${C.dim}medián populace na konci: ${Math.round(medianPop).toLocaleString('cs-CZ')}${C.reset}\n`);
}

const ENDING_LABEL: Record<string, string> = {
  extinction: 'vyhynutí',
  stagnation: 'stagnace',
  self_destruction: 'sebezničení',
  transcendence: 'transcendence',
};

const CAUSE_LABEL: Record<string, string> = {
  collapse: 'rozpad',
  quiet: 'dlouhé ticho',
  nuclear_war: 'jaderná válka',
  grey_goo: 'sebereplikace bez dozoru',
  climate_collapse: 'klimatický rozvrat',
  ascension: 'odchod',
};

function printArchive(archive: RunSummary[]): void {
  if (archive.length === 0) return;
  console.log(`\n${C.bold}ARCHIV ZANIKLÝCH CIVILIZACÍ${C.reset}`);
  for (const r of archive) {
    console.log(
      `  ${String(r.run).padStart(2)}. ${r.planet.padEnd(12)} ${C.dim}${epochDef(r.epoch).name.padEnd(22)}${C.reset} ` +
        `${(ENDING_LABEL[r.ending] ?? r.ending).padEnd(14)} ${C.dim}${CAUSE_LABEL[r.cause] ?? r.cause}${C.reset}`,
    );
    console.log(
      `${C.dim}      ${r.ticks} ticků · ${Math.round(r.years).toLocaleString('cs-CZ')} let · vrchol ${Math.round(r.peakPopulation).toLocaleString('cs-CZ')} obyvatel · ` +
        `${r.milestonesUnlocked} milníků (${r.milestonesLost} ztraceno) · ${r.factionsEver} frakcí${C.reset}`,
    );
    const lineage =
      r.firstFaction === r.lastFaction
        ? `zakladatelé ${r.firstFaction} vydrželi až do konce`
        : `od ${r.firstFaction} k ${r.lastFaction}`;
    console.log(`${C.dim}      ${lineage}${C.reset}`);
  }
}

/** Posloupnost civilizací — tak, jak web poběží doopravdy. */
function runCampaign(seed: number, ticks: number, minWeight: number): void {
  const { world, events, archive } = simulateCampaign(seed, ticks);
  for (const e of events) {
    if (e.weight >= minWeight) printEvent(e, world.foundingYear);
  }
  printArchive(archive);
  console.log(`\n${C.bold}PRÁVĚ BĚŽÍ${C.reset} — civilizace č. ${world.run} na planetě ${world.planet.name}`);
  printSummary(world, events);
}

// ─────────────────────────────────────────── main

const sweepIndex = process.argv.indexOf('--sweep');
const ticks = arg('ticks', 5000);

if (sweepIndex >= 0) {
  const raw = Number(process.argv[sweepIndex + 1]);
  runSweep(Number.isFinite(raw) && raw > 0 ? raw : 100, ticks);
} else if (process.argv.includes('--campaign')) {
  runCampaign(arg('seed', 1), ticks, arg('min-weight', 0.9));
} else {
  runOne(arg('seed', 1), ticks, arg('min-weight', 0));
}
