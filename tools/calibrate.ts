/**
 * Automatická kalibrace EPOCH_COST_SCALE.
 *
 *   npm run calibrate -- [seedů] [iterací] [od které epochy]
 *
 * Cíl je, aby každá epocha trvala kolem 500 ticků, tedy zhruba pět reálných
 * dnů. Ručně to ladit nejde: měřítka jsou provázaná — když se zrychlí raná
 * epocha, dorazí do pozdní jiná populace a s ní i jiný výkon. Nástroj proto
 * jede smyčku: odsimuluje vzorek světů, změří skutečné délky epoch, posune
 * měřítka poměrem cíl/skutečnost a opakuje, dokud se to neustálí.
 *
 *   npm run calibrate
 */

import { createWorld } from '../engine/world.js';
import { tickWorld } from '../engine/tick.js';
import { EPOCH_COST_SCALE, setEpochCostScale, MAX_CONTENT_EPOCH } from '../engine/milestones.data.js';
import { epochDef } from '../engine/epochs.js';

const TARGET = 500;
const SEEDS = Number(process.argv[2] ?? 24);
const ITERATIONS = Number(process.argv[3] ?? 10);
/** Epochy pod touhle hranicí se neladí — drží se ručně ověřené hodnoty. */
const FROM_EPOCH = Number(process.argv[4] ?? 0);
const MAX_TICKS = 16000;
/** Krok jedné iterace se omezuje, jinak smyčka osciluje místo aby dosedla. */
const MAX_STEP = 3;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

/** Kolik ticků strávily světy v jednotlivých epochách. */
function measure(): { durations: Map<number, number[]>; reached: Map<number, number>; endings: Map<string, number> } {
  const durations = new Map<number, number[]>();
  const reached = new Map<number, number>();
  const endings = new Map<string, number>();

  for (let seed = 1; seed <= SEEDS; seed++) {
    let world = createWorld(seed);
    let epochStart = 0;
    let current = 0;

    for (let i = 0; i < MAX_TICKS; i++) {
      if (world.ending) break;
      world = tickWorld(world).world;
      if (world.epoch !== current) {
        // Regrese po kolapsu se do délky epochy nepočítá — měřili bychom šum.
        if (world.epoch > current) {
          const bucket = durations.get(current) ?? [];
          bucket.push(world.tick - epochStart);
          durations.set(current, bucket);
        }
        current = world.epoch;
        epochStart = world.tick;
      }
    }

    // Zásadní: započítat i epochu, ve které civilizace skončila.
    //
    // Bez toho se medián počítá jen z těch, kdo epochu PŘEŽILI — tedy z těch
    // rychlých. Smyčka pak epochu zdražuje, čímž zabije další světy, čímž
    // vzorek zkreslí ještě víc. Přesně tahle survivorship bias vyhnala
    // vymírání na 88 % a měřítko epochy 0 na pětinásobek.
    const bucket = durations.get(current) ?? [];
    bucket.push(world.tick - epochStart);
    durations.set(current, bucket);

    reached.set(world.epoch, (reached.get(world.epoch) ?? 0) + 1);
    const kind = world.ending?.kind ?? 'nedokončeno';
    endings.set(kind, (endings.get(kind) ?? 0) + 1);
  }

  return { durations, reached, endings };
}

const C = { dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m', reset: '\x1b[0m' };

for (let iteration = 1; iteration <= ITERATIONS; iteration++) {
  const { durations, endings } = measure();
  const next = EPOCH_COST_SCALE.slice();
  let worst = 0;

  for (let e = FROM_EPOCH; e <= MAX_CONTENT_EPOCH; e++) {
    const samples = durations.get(e) ?? [];
    // Pod pět vzorků je medián šum — měřítko raději necháme být.
    if (samples.length < 5) continue;
    const actual = median(samples);
    if (actual <= 0) continue;
    const ratio = Math.max(1 / MAX_STEP, Math.min(MAX_STEP, TARGET / actual));
    next[e] = (next[e] as number) * ratio;
    worst = Math.max(worst, Math.abs(Math.log(TARGET / actual)));
  }

  setEpochCostScale(next);

  const summary = [...endings.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ');
  console.log(
    `${C.dim}iterace ${String(iteration).padStart(2)} — největší odchylka ${worst.toFixed(2)} · ${summary}${C.reset}`,
  );

  if (worst < 0.2) {
    console.log(`${C.green}ustáleno${C.reset}`);
    break;
  }
}

const { durations, reached, endings } = measure();

console.log(`\n${C.bold}Výsledek${C.reset}`);
for (let e = 0; e <= MAX_CONTENT_EPOCH; e++) {
  const samples = durations.get(e) ?? [];
  const actual = samples.length > 0 ? median(samples) : 0;
  const ok = actual >= 250 && actual <= 900;
  const mark = samples.length < 5 ? C.dim : ok ? C.green : C.red;
  console.log(
    `  ${String(e).padStart(2)} ${epochDef(e).name.padEnd(22)} ${mark}${String(actual).padStart(5)} ticků${C.reset} ${C.dim}(n=${samples.length})${C.reset}`,
  );
}

console.log(`\n${C.bold}Dosažená epocha${C.reset}`);
for (const e of [...reached.keys()].sort((a, b) => a - b)) {
  console.log(`  ${String(e).padStart(2)} ${epochDef(e).name.padEnd(22)} ${reached.get(e)}`);
}
console.log(`\n${C.bold}Konce${C.reset}`);
for (const [k, n] of [...endings.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(18)} ${n}  ${((n / SEEDS) * 100).toFixed(0)} %`);
}

console.log(`\n${C.bold}Vlož do engine/milestones.data.ts${C.reset}`);
console.log('export const EPOCH_COST_SCALE: number[] = [');
for (let e = 0; e < EPOCH_COST_SCALE.length; e++) {
  const v = EPOCH_COST_SCALE[e] as number;
  const rounded = v >= 100 ? Math.round(v) : Number(v.toPrecision(3));
  console.log(`  ${rounded}, // ${e} ${epochDef(e).name}`);
}
console.log('];');
