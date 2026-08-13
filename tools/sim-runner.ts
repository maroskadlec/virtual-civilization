/**
 * Posune kampaň na aktuální čas a zapíše datové soubory.
 *
 * Tohle běží v GitHub Action každých pár minut. Není to ale zdroj pravdy —
 * tím je genesis timestamp a seed. Runner jen materializuje to, co si jinak
 * musí dopočítat každý návštěvník sám. Kdyby Action navždy umřela, web funguje
 * dál; jen bude klient počítat víc ticků.
 *
 *   npm run sim                            posune na teď a zapíše
 *   npm run sim -- --dry-run               spočítá a jen vypíše, nic nezapíše
 *   npm run sim -- --backdate-days 3       založí kampaň se zpětným genesis
 *
 * Kampaň se založí sama, když data/world.json neexistuje.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  advanceToNow,
  createCampaign,
  deserializeCampaign,
  serializeCampaign,
  targetTickAt,
} from '../engine/campaign.js';
import type { Campaign } from '../engine/campaign.js';
import { genesisEvent } from '../engine/tick.js';
import { epochDef, formatYear, TICK_REAL_MS } from '../engine/epochs.js';
import { MILESTONES } from '../engine/milestones.data.js';
import { brierScore, forecast, selectPredictions } from '../engine/predict.js';
import type { WorldEvent } from '../engine/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(HERE, '..', 'data');
const ARCHIVE_DIR = join(DATA_DIR, 'archive');

const WORLD_FILE = join(DATA_DIR, 'world.json');
const CHRONICLE_FILE = join(DATA_DIR, 'chronicle.jsonl');
const RECENT_FILE = join(DATA_DIR, 'recent.json');
const STATUS_FILE = join(DATA_DIR, 'status.json');

/** Kolik posledních událostí se drží zvlášť, aby web nemusel stahovat celou kroniku. */
const RECENT_LIMIT = 300;

/**
 * Jak často se staví nové předpovědi — jednou za reálný den.
 *
 * Monte Carlo stojí několik sekund, což je pro Action nic, ale pro prohlížeč
 * moc. Proto se počítá jen tady a klient výsledek jen čte.
 */
const FORECAST_EVERY = 96;

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

function chronicleFileFor(run: number): string {
  return join(ARCHIVE_DIR, `run-${String(run).padStart(4, '0')}.jsonl`);
}

/** Založí kampaň. Genesis se dá posunout do minulosti, aby šel web hned vyzkoušet. */
function initCampaign(nowMs: number): Campaign {
  const backdateDays = arg('backdate-days', 0);
  const genesisMs = nowMs - backdateDays * 24 * 60 * 60 * 1000;
  const seed = arg('seed', Math.floor((genesisMs / 1000) % 2147483647));
  return createCampaign(seed, genesisMs);
}

function loadCampaign(nowMs: number): { campaign: Campaign; fresh: boolean } {
  if (existsSync(WORLD_FILE)) {
    return { campaign: deserializeCampaign(readFileSync(WORLD_FILE, 'utf8')), fresh: false };
  }
  return { campaign: initCampaign(nowMs), fresh: true };
}

/** Události se ukládají po civilizacích — kronika zaniklé se uzavře a odloží. */
function writeEvents(events: WorldEvent[], currentRun: number): void {
  if (events.length === 0) return;
  mkdirSync(ARCHIVE_DIR, { recursive: true });

  const byRun = new Map<number, WorldEvent[]>();
  for (const e of events) {
    const bucket = byRun.get(e.run) ?? [];
    bucket.push(e);
    byRun.set(e.run, bucket);
  }

  for (const run of [...byRun.keys()].sort((a, b) => a - b)) {
    const lines = (byRun.get(run) ?? []).map((e) => JSON.stringify(e)).join('\n') + '\n';

    if (run === currentRun) {
      appendFileSync(CHRONICLE_FILE, lines, 'utf8');
    } else {
      // Zaniklá civilizace: dopsat zbytek a odsunout celou kroniku do archivu.
      appendFileSync(CHRONICLE_FILE, lines, 'utf8');
      if (existsSync(CHRONICLE_FILE)) renameSync(CHRONICLE_FILE, chronicleFileFor(run));
    }
  }
}

function readRecent(): WorldEvent[] {
  if (!existsSync(RECENT_FILE)) return [];
  try {
    return JSON.parse(readFileSync(RECENT_FILE, 'utf8')) as WorldEvent[];
  } catch {
    return [];
  }
}

interface Status {
  updatedAtMs: number;
  globalTick: number;
  nextTickAtMs: number;
  run: number;
  planet: string;
  epoch: number;
  epochName: string;
  year: number;
  foundingYear: number | null;
  population: number;
  milestonesUnlocked: number;
  milestonesTotal: number;
  factions: number;
  settlements: number;
  ended: string | null;
  archivedRuns: number;
  predictionsPending: number;
  predictionsResolved: number;
  brier: number | null;
  /** Jednořádkové shrnutí — používá se jako zpráva commitu. */
  headline: string;
}

function buildStatus(campaign: Campaign, nowMs: number): Status {
  const w = campaign.world;
  const nextTickAtMs = campaign.genesisMs + (campaign.globalTick + 1) * TICK_REAL_MS;
  const headline =
    `tick ${campaign.globalTick} · civilizace ${w.run} na ${w.planet.name} · ` +
    `${epochDef(w.epoch).name} · ${formatYear(w.year, w.foundingYear)} · ` +
    `${Math.round(w.stats.population).toLocaleString('cs-CZ')} obyvatel`;

  return {
    updatedAtMs: nowMs,
    globalTick: campaign.globalTick,
    nextTickAtMs,
    run: w.run,
    planet: w.planet.name,
    epoch: w.epoch,
    epochName: epochDef(w.epoch).name,
    year: w.year,
    foundingYear: w.foundingYear,
    population: w.stats.population,
    milestonesUnlocked: Object.keys(w.tech.unlocked).length,
    milestonesTotal: MILESTONES.length,
    factions: w.factions.length,
    settlements: w.settlements.length,
    ended: w.ending?.kind ?? null,
    archivedRuns: campaign.archive.length,
    predictionsPending: campaign.predictions.filter((p) => p.outcome === 'pending').length,
    predictionsResolved: campaign.scoreboard.resolved,
    brier: brierScore(campaign.scoreboard),
    headline,
  };
}

/** Nové předpovědi, když je čas — a je co předpovídat. */
function maybeForecast(campaign: Campaign): number {
  if (campaign.world.ending) return 0;

  const lastMadeAt = campaign.predictions.reduce(
    (max, p) => Math.max(max, p.madeAtTick),
    -Infinity,
  );
  if (Number.isFinite(lastMadeAt) && campaign.globalTick - lastMadeAt < FORECAST_EVERY) return 0;

  const raw = forecast(campaign.world, campaign.globalTick);
  const fresh = selectPredictions(raw, campaign.globalTick, campaign.world.run);
  campaign.predictions = [...campaign.predictions, ...fresh];
  return fresh.length;
}

function main(): void {
  const nowMs = Date.now();
  const dryRun = flag('dry-run');

  const { campaign, fresh } = loadCampaign(nowMs);
  const target = targetTickAt(campaign, nowMs);

  if (fresh) {
    console.log(
      `Zakládám kampaň: seed ${campaign.startSeed}, genesis ${new Date(campaign.genesisMs).toISOString()}`,
    );
  }

  const pending = target - campaign.globalTick;
  if (pending <= 0 && !fresh) {
    console.log(`Nic k dopočítání — kampaň je na ticku ${campaign.globalTick}.`);
    return;
  }

  const runBefore = campaign.world.run;
  const result = advanceToNow(campaign, nowMs);

  // U čerstvé kampaně patří do kroniky i věta o probuzení první tlupy.
  const events = fresh ? [genesisEvent(campaign.world), ...result.events] : result.events;

  const forecasted = maybeForecast(campaign);
  if (forecasted > 0) {
    const brier = brierScore(campaign.scoreboard);
    console.log(
      `Nových předpovědí: ${forecasted}.` +
        (brier === null ? '' : ` Dosavadní Brier ${brier.toFixed(3)} z ${campaign.scoreboard.resolved} vyhodnocených.`),
    );
  }

  const status = buildStatus(campaign, nowMs);
  console.log(
    `Dopočítáno ${result.ticks} ticků (cíl ${target}), ${events.length} událostí.` +
      (result.truncated ? ' POZOR: naráželo se na strop, spusť znovu.' : ''),
  );
  console.log(status.headline);
  if (runBefore !== campaign.world.run) {
    console.log(`Civilizace ${runBefore} zanikla, začíná ${campaign.world.run}.`);
  }

  if (dryRun) {
    console.log('--dry-run: nic se nezapisuje.');
    return;
  }

  mkdirSync(DATA_DIR, { recursive: true });
  writeEvents(events, campaign.world.run);

  const recent = [...readRecent(), ...events].slice(-RECENT_LIMIT);
  writeFileSync(RECENT_FILE, JSON.stringify(recent), 'utf8');
  writeFileSync(WORLD_FILE, serializeCampaign(campaign), 'utf8');
  writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2) + '\n', 'utf8');
}

main();
