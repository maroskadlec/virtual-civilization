/**
 * Klient.
 *
 * Načte checkpoint, který commitla Action, a sám si dopočítá ticky, které od
 * té doby uplynuly. Proto web ukazuje správný stav i tehdy, když Action
 * vypadne — jen se počítá víc lokálně. Tentýž engine běží na obou stranách,
 * takže výsledek je bit po bitu stejný.
 */

import { advanceToNow, deserializeCampaign, msUntilNextTick } from '../engine/campaign.js';
import type { Campaign } from '../engine/campaign.js';
import { epochDef, formatYear, TICK_REAL_MS } from '../engine/epochs.js';
import { MILESTONES } from '../engine/milestones.data.js';
import type { WorldEvent } from '../engine/types.js';

/** Kolik položek kroniky se vykreslí. Víc už nikdo nepřečte. */
const FEED_LIMIT = 240;
const LAST_SEEN_KEY = 'vc:last-seen-tick';

const MARKS: Record<string, string> = {
  genesis: '◆',
  milestone: '✦',
  milestone_lost: '✖',
  disaster: '▲',
  disaster_aggregate: '▵',
  epoch: '■',
  faction_split: '⑂',
  faction_end: '†',
  war: '⚔',
  settlement_founded: '·',
  settlement_lost: '×',
  climate: '❄',
  population: '·',
  ending: '●',
};

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Chybí element #${id}`);
  return node as T;
};

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path, { cache: 'no-cache' });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function formatCount(value: number): string {
  const n = Math.round(value);
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} mld`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} mil.`;
  return n.toLocaleString('cs-CZ');
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function renderInstruments(campaign: Campaign, nowMs: number): void {
  const w = campaign.world;
  const unlocked = Object.keys(w.tech.unlocked).length;

  const rows: [string, string][] = [
    ['epocha', epochDef(w.epoch).name],
    ['datum', formatYear(w.year, w.foundingYear)],
    ['obyvatel', formatCount(w.stats.population)],
    ['osad', String(w.settlements.length)],
    ['frakcí', String(w.factions.length)],
    ['milníků', `${unlocked} / ${MILESTONES.length}`],
    ['tick', String(campaign.globalTick)],
    ['další za', formatCountdown(msUntilNextTick(campaign, nowMs))],
  ];

  el('instruments').innerHTML = rows
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join('');
}

function renderHeader(campaign: Campaign): void {
  const w = campaign.world;
  el('planet').textContent = w.planet.name;
  el('lede').textContent = ledeFor(campaign);
}

/**
 * Podtitulek nesmí míchat dvě různá měřítka času. Před založením se civilizace
 * počítá ve statisících let stáří světa, po něm ve vlastním letopočtu —
 * jinak vyjde věta typu „vyvíjí se 1 340 632 let a je v osvícenství".
 */
function ledeFor(campaign: Campaign): string {
  const w = campaign.world;
  const unlocked = Object.keys(w.tech.unlocked).length;

  if (w.ending !== null) {
    return `${w.run}. civilizace už není. Než skončila, zvládla ${unlocked} ze ${MILESTONES.length} milníků.`;
  }

  if (w.foundingYear === null) {
    return `${w.run}. civilizace na této obloze. Zatím žije v jeskyni a nemá ani letopočet — od jejího probuzení uplynulo ${formatYear(w.year, null)}.`;
  }

  const calendarYear = Math.round(w.year - w.foundingYear);
  return `${w.run}. civilizace na této obloze. Její vlastní letopočet běží ${calendarYear.toLocaleString('cs-CZ')} let a právě teď je v epoše ${epochDef(w.epoch).name.toLowerCase()}.`;
}

function entryHtml(event: WorldEvent, foundingYear: number | null): string {
  const mark = MARKS[event.kind] ?? '·';
  const when = formatYear(event.year, foundingYear);
  return `
    <article class="entry kind-${event.kind}">
      <div class="entry-when">${when}</div>
      <div class="entry-mark">${mark}</div>
      <p class="entry-text">${escapeHtml(event.text)}</p>
    </article>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);
}

/**
 * Kronika se vypisuje odzadu — nejnovější nahoře. Do proudu se vloží značka
 * místa, kde divák skončil minule, aby poznal, co je nové.
 */
function renderChronicle(events: WorldEvent[], campaign: Campaign, lastSeenTick: number | null): void {
  const foundingYear = campaign.world.foundingYear;
  const shown = events.slice(-FEED_LIMIT).reverse();

  if (shown.length === 0) {
    el('chronicle').innerHTML =
      '<p class="loading">Kronika je zatím prázdná. První zápis přibude s dalším tickem.</p>';
    return;
  }

  let html = '';
  let markerPlaced = lastSeenTick === null;

  for (const event of shown) {
    if (!markerPlaced && event.tick <= lastSeenTick!) {
      const fresh = shown.filter((e) => e.tick > lastSeenTick!).length;
      if (fresh > 0) html += `<div class="resume">zde jsi minule skončil — ${fresh} nových zápisů</div>`;
      markerPlaced = true;
    }
    html += entryHtml(event, foundingYear);
  }

  el('chronicle').innerHTML = html;
}

async function main(): Promise<void> {
  const raw = await fetchJson<unknown>('./world.json');
  if (raw === null) {
    el('lede').textContent =
      'Kronika se ještě nezaložila. Simulace se spustí s prvním během plánované úlohy.';
    el('chronicle').innerHTML = '';
    return;
  }

  const campaign = deserializeCampaign(JSON.stringify(raw));
  const recent = (await fetchJson<WorldEvent[]>('./recent.json')) ?? [];

  // Ticky, které Action ještě nestihla, si klient dopočítá sám.
  const catchUp = advanceToNow(campaign, Date.now());
  let events = [...recent, ...catchUp.events];

  const stored = localStorage.getItem(LAST_SEEN_KEY);
  const lastSeenTick = stored === null ? null : Number(stored);

  renderHeader(campaign);
  renderInstruments(campaign, Date.now());
  renderChronicle(events, campaign, Number.isFinite(lastSeenTick) ? lastSeenTick : null);
  localStorage.setItem(LAST_SEEN_KEY, String(campaign.world.tick));

  // Odpočet běží každou vteřinu, samotný tick se dopočítá, až doopravdy nastane.
  setInterval(() => renderInstruments(campaign, Date.now()), 1000);

  setInterval(() => {
    const step = advanceToNow(campaign, Date.now());
    if (step.ticks === 0) return;
    events = [...events, ...step.events];
    renderHeader(campaign);
    renderChronicle(events, campaign, null);
  }, Math.min(TICK_REAL_MS, 30_000));
}

void main();
