/**
 * Kampaň — posloupnost civilizací ukotvená v reálném čase.
 *
 * Tohle je místo, kde se potkají hodiny se simulací. Nikde jinde v enginu
 * se čas nečte. Kampaň drží globální tick (napříč všemi civilizacemi) a ten
 * je čistou funkcí reálného času:
 *
 *     globalTick = floor((teď − genesisMs) / TICK_REAL_MS)
 *
 * Z toho plyne celá architektura nasazení: server nic „neběží", jen dopočítává,
 * a klient dokáže dopočítat totéž z libovolného checkpointu. Když server týden
 * vypadne, klient si prostě spočítá o 672 ticků víc a nikdo si toho nevšimne.
 *
 * Jedno omezení je ale potřeba říct nahlas: determinismus platí PRO DANOU VERZI
 * ENGINE. Když se změní pravidla, přepočet od nuly dá jinou historii než tu,
 * která je zapsaná v kronice. Nositelem dějin proto není seed, ale commitnutý
 * checkpoint — od něj se pokračuje novými pravidly, stejně jako se ve světě
 * mění zákony, aniž by se přepisovala minulost.
 */

import { TICK_REAL_MS, tickIndexAt } from './epochs.js';
import { genesisEvent, tickWorld } from './tick.js';
import { createWorld, nextRun, summarizeRun } from './world.js';
import { claimHolds, emptyScoreboard, recordOutcome } from './predict.js';
import type { Prediction, Scoreboard } from './predict.js';
import type { RunSummary, World, WorldEvent } from './types.js';

/** Verze formátu checkpointu. Zvyšuje se při nekompatibilní změně stavu světa. */
export const CAMPAIGN_FORMAT_VERSION = 1;

export interface Campaign {
  version: number;
  /** Okamžik, kdy se první civilizace probudila v jeskyni. Nikdy se nemění. */
  genesisMs: number;
  startSeed: number;
  /** Ticků od genesis napříč všemi civilizacemi. Mapuje reálný čas na simulaci. */
  globalTick: number;
  world: World;
  archive: RunSummary[];
  /** Aktivní i nedávno vyhodnocené předpovědi. */
  predictions: Prediction[];
  /** Průběžná úspěšnost — Brier a kalibrační koše. */
  scoreboard: Scoreboard;
}

/** Kolik vyhodnocených předpovědí se drží v checkpointu. Statistika je v scoreboardu. */
const RESOLVED_KEPT = 40;

export function createCampaign(startSeed: number, genesisMs: number): Campaign {
  return {
    version: CAMPAIGN_FORMAT_VERSION,
    genesisMs,
    startSeed,
    globalTick: 0,
    world: createWorld(startSeed),
    archive: [],
    predictions: [],
    scoreboard: emptyScoreboard(),
  };
}

/** Kolikátý tick má kampaň mít, aby odpovídala hodinám. */
export function targetTickAt(campaign: Campaign, nowMs: number): number {
  return tickIndexAt(nowMs, campaign.genesisMs);
}

/**
 * Strop na jedno volání. Chrání prohlížeč před tím, aby po dlouhém výpadku
 * serveru počítal minuty. Při ~0,2 ms na tick je to zhruba čtyři sekundy.
 */
export const MAX_TICKS_PER_ADVANCE = 20000;

export interface AdvanceResult {
  events: WorldEvent[];
  /** Kolik ticků se skutečně odsimulovalo. */
  ticks: number;
  /** True, když se naráželo na strop a kampaň ještě není u cíle. */
  truncated: boolean;
}

/**
 * Posune kampaň na zadaný globální tick a vrátí, co se cestou stalo.
 *
 * Když civilizace zanikne, uzavře se do archivu a na nové planetě začíná
 * další. Seed nové se odvozuje z té staré, takže celá posloupnost zůstává
 * čistou funkcí prvního seedu — archiv jde kdykoli přepočítat od nuly.
 */
export function advanceCampaign(campaign: Campaign, targetTick: number): AdvanceResult {
  const events: WorldEvent[] = [];
  let ticks = 0;

  while (campaign.globalTick < targetTick) {
    if (ticks >= MAX_TICKS_PER_ADVANCE) {
      return { events, ticks, truncated: true };
    }

    if (campaign.world.ending) {
      // Předpovědi o zaniklé civilizaci se uzavřou hned — dozrát už nemají kde.
      resolvePredictions(campaign, true);
      campaign.archive.push(summarizeRun(campaign.world));
      campaign.world = nextRun(campaign.world);
      events.push(genesisEvent(campaign.world));
      // Zrození nové civilizace stojí jeden tick — jinak by při rychlém
      // zániku mohla smyčka v jednom ticku vystřídat civilizací kolik chce.
      campaign.globalTick += 1;
      ticks += 1;
      continue;
    }

    const result = tickWorld(campaign.world);
    campaign.world = result.world;
    events.push(...result.events);
    campaign.globalTick += 1;
    ticks += 1;

    trackPredictions(campaign, result.events);
    resolvePredictions(campaign, false);
  }

  return { events, ticks, truncated: false };
}

/**
 * Sleduje, jestli už předpovídaná věc nastala.
 *
 * Právě proto jsou tvrzení monotónní: stačí jeden příznak a není potřeba se
 * zpětně doptávat do historie, která už dávno odtekla do archivu.
 */
function trackPredictions(campaign: Campaign, events: readonly WorldEvent[]): void {
  for (const prediction of campaign.predictions) {
    if (prediction.outcome !== 'pending' || prediction.happened) continue;
    if (prediction.run !== campaign.world.run) continue;
    if (claimHolds(prediction.claim, campaign.world, events)) prediction.happened = true;
  }
}

/** Uzavře předpovědi, kterým vypršel čas — nebo všechny, když civilizace končí. */
function resolvePredictions(campaign: Campaign, closeAll: boolean): void {
  for (const prediction of campaign.predictions) {
    if (prediction.outcome !== 'pending') continue;
    if (!closeAll && campaign.globalTick < prediction.resolveAtTick) continue;

    prediction.outcome = prediction.happened ? 'hit' : 'miss';
    recordOutcome(campaign.scoreboard, prediction);
  }

  const pending = campaign.predictions.filter((p) => p.outcome === 'pending');
  const resolved = campaign.predictions.filter((p) => p.outcome !== 'pending');
  campaign.predictions = [...resolved.slice(-RESOLVED_KEPT), ...pending];
}

/** Kampaň dopočítaná na aktuální čas. */
export function advanceToNow(campaign: Campaign, nowMs: number): AdvanceResult {
  return advanceCampaign(campaign, targetTickAt(campaign, nowMs));
}

/** Kolik reálných milisekund zbývá do dalšího ticku. */
export function msUntilNextTick(campaign: Campaign, nowMs: number): number {
  const elapsed = nowMs - campaign.genesisMs;
  const intoTick = ((elapsed % TICK_REAL_MS) + TICK_REAL_MS) % TICK_REAL_MS;
  return TICK_REAL_MS - intoTick;
}

// ─────────────────────────────────────────── Serializace

export function serializeCampaign(campaign: Campaign): string {
  return JSON.stringify(campaign);
}

/**
 * Načte checkpoint.
 *
 * Vyšší verzi formátu odmítne — je lepší spadnout hlasitě než tiše servírovat
 * rozpadlý svět. Starší checkpoint ale musí projít: pole přidaná pozdějšími
 * verzemi se doplní výchozími hodnotami.
 *
 * Není to kosmetika. Když runner spadne na chybějícím poli, checkpoint už
 * nikdy nepřepíše — a protože na tomtéž souboru staví i klient, zůstane web
 * rozbitý natrvalo. Přesně to se stalo při zavádění předpovědí.
 */
export function deserializeCampaign(json: string): Campaign {
  const parsed = JSON.parse(json) as Partial<Campaign>;
  const version = parsed.version ?? 0;

  if (version > CAMPAIGN_FORMAT_VERSION) {
    throw new Error(
      `Checkpoint má formát verze ${version}, tenhle engine umí nejvýš ${CAMPAIGN_FORMAT_VERSION}.`,
    );
  }
  if (!parsed.world || typeof parsed.genesisMs !== 'number') {
    throw new Error('Checkpoint neobsahuje svět ani okamžik vzniku.');
  }

  const scoreboard = parsed.scoreboard;
  return {
    version: CAMPAIGN_FORMAT_VERSION,
    genesisMs: parsed.genesisMs,
    startSeed: parsed.startSeed ?? 0,
    globalTick: parsed.globalTick ?? 0,
    world: parsed.world,
    archive: parsed.archive ?? [],
    predictions: parsed.predictions ?? [],
    scoreboard:
      scoreboard && Array.isArray(scoreboard.buckets) && scoreboard.buckets.length === 10
        ? scoreboard
        : emptyScoreboard(),
  };
}

/**
 * Odsimuluje kampaň od nuly. Používá CLI a testy; nasazení jde přes checkpoint.
 */
export function simulateCampaign(
  startSeed: number,
  ticks: number,
): { campaign: Campaign; events: WorldEvent[] } {
  const campaign = createCampaign(startSeed, 0);
  const events: WorldEvent[] = [genesisEvent(campaign.world)];
  let remaining = ticks;

  while (remaining > 0) {
    const step = Math.min(remaining, MAX_TICKS_PER_ADVANCE);
    const result = advanceCampaign(campaign, campaign.globalTick + step);
    events.push(...result.events);
    remaining -= result.ticks;
    if (result.ticks === 0) break;
  }

  return { campaign, events };
}
