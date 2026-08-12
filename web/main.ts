/**
 * Klient.
 *
 * Načte checkpoint, který commitla Action, a sám si dopočítá ticky, které od
 * té doby uplynuly. Proto web ukazuje správný stav i tehdy, když Action
 * vypadne — jen se počítá víc lokálně. Tentýž engine běží na obou stranách,
 * takže výsledek je bit po bitu stejný.
 */

import {
  advanceToNow,
  createCampaign,
  deserializeCampaign,
  msUntilNextTick,
} from '../engine/campaign.js';
import type { Campaign } from '../engine/campaign.js';
import { epochDef, formatYear, TICK_REAL_MS } from '../engine/epochs.js';
import { MILESTONES } from '../engine/milestones.data.js';
import type { WorldEvent } from '../engine/types.js';
import { drawDisc } from './views/disc.js';
import { drawSpiral, spiralHitTest } from './views/spiral.js';
import { mountConstellation } from './views/constellation.js';
import type { ConstellationHandle } from './views/constellation.js';

/** Kolik položek kroniky se vykreslí. Víc už nikdo nepřečte. */
const FEED_LIMIT = 240;
const LAST_SEEN_KEY = 'vc:last-seen-tick';
const VIEW_KEY = 'vc:view';

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
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);
}

// ─────────────────────────────────────────── Hlavička a kronika

function renderInstruments(campaign: Campaign, nowMs: number): void {
  const w = campaign.world;
  const rows: [string, string][] = [
    ['epocha', epochDef(w.epoch).name],
    ['datum', formatYear(w.year, w.foundingYear)],
    ['obyvatel', formatCount(w.stats.population)],
    ['osad', String(w.settlements.length)],
    ['frakcí', String(w.factions.length)],
    ['milníků', `${Object.keys(w.tech.unlocked).length} / ${MILESTONES.length}`],
    ['tick', String(campaign.globalTick)],
    ['další za', formatCountdown(msUntilNextTick(campaign, nowMs))],
  ];

  el('instruments').innerHTML = rows
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join('');
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

function renderHeader(campaign: Campaign): void {
  el('planet').textContent = campaign.world.planet.name;
  const lede = el('lede');
  lede.textContent = ledeFor(campaign);
  if (isDemo) {
    lede.insertAdjacentHTML(
      'afterbegin',
      '<em class="demo-badge">ukázka — tohle není živá civilizace</em> ',
    );
  }
}

function entryHtml(event: WorldEvent, foundingYear: number | null): string {
  return `
    <article class="entry kind-${event.kind}">
      <div class="entry-when">${formatYear(event.year, foundingYear)}</div>
      <div class="entry-mark">${MARKS[event.kind] ?? '·'}</div>
      <p class="entry-text">${escapeHtml(event.text)}</p>
    </article>`;
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
  const resumeAt = lastSeenTick;
  let markerPlaced = resumeAt === null;

  for (const event of shown) {
    if (!markerPlaced && resumeAt !== null && event.tick <= resumeAt) {
      const fresh = shown.filter((e) => e.tick > resumeAt).length;
      if (fresh > 0) html += `<div class="resume">zde jsi minule skončil — ${fresh} nových zápisů</div>`;
      markerPlaced = true;
    }
    html += entryHtml(event, foundingYear);
  }

  el('chronicle').innerHTML = html;
}

// ─────────────────────────────────────────── Jeviště

type ViewId = 'disc' | 'spiral' | 'constellation';

interface ViewDef {
  id: ViewId;
  label: string;
  surface: 'canvas' | 'svg';
  note: string;
}

const VIEWS: readonly ViewDef[] = [
  {
    id: 'disc',
    label: 'svět',
    surface: 'canvas',
    note: 'Planeta v projekci se stejnou plochou: střed je jeden pól, okraj druhý, přerušovaný kruh je rovník. Body jsou osady, barva patří frakci. Prstenec kolem světa ukazuje podíl odemčených milníků — a od orbitálních epoch i to, co civilizace poslala nad sebe.',
  },
  {
    id: 'spiral',
    label: 'čas',
    surface: 'canvas',
    note: 'Spirála běží od středu ven a jeden závit odpovídá stejnému množství reálného času. Popisky u prstenců ale ukazují simulované roky — vnitřní závity spolknou statisíce let, vnější sotva desítky. Přesně tak vypadá zrychlování dějin.',
  },
  {
    id: 'constellation',
    label: 'milníky',
    surface: 'svg',
    note: 'Strom poznání. Sloupce jsou epochy, čáry vedou od předpokladu k tomu, co umožnil. Svítící hvězdy jsou odemčené, prstýnek značí rozpracované, rudý uhlík zapomenuté a vyhaslé body to, co na téhle planetě nejde — chybí k nim surovina.',
  },
];

let activeView: ViewId = 'disc';
let constellation: ConstellationHandle | null = null;
/** Ukázkový režim se musí poznat na první pohled, ať ho nikdo nezamění za živý svět. */
let isDemo = false;

function renderViewTabs(onSelect: (id: ViewId) => void): void {
  const nav = el('views');
  nav.innerHTML = VIEWS.map(
    (v) => `<button type="button" data-view="${v.id}" aria-current="${v.id === activeView}">${v.label}</button>`,
  ).join('');

  for (const button of nav.querySelectorAll<HTMLButtonElement>('button')) {
    button.addEventListener('click', () => onSelect(button.dataset.view as ViewId));
  }
}

function showTip(html: string, x: number, y: number): void {
  const tip = el('tip');
  tip.innerHTML = html;
  tip.hidden = false;
  const frame = tip.parentElement as HTMLElement;
  const width = tip.offsetWidth;
  tip.style.left = `${Math.min(Math.max(8, x + 14), frame.clientWidth - width - 8)}px`;
  tip.style.top = `${Math.max(8, y - tip.offsetHeight - 12)}px`;
}

function hideTip(): void {
  el('tip').hidden = true;
}

async function main(): Promise<void> {
  const campaign = await loadCampaign();
  if (!campaign) return;

  // Feed si vystačí s posledními zápisy, spirála ale potřebuje celý běh.
  // Plnou kroniku proto stahujeme až ve chvíli, kdy se na spirálu někdo podívá.
  const history = (await fetchJson<WorldEvent[]>('./recent.json')) ?? [];
  let computed = catchUp(campaign);
  let fullChronicle: WorldEvent[] | null = null;

  const feedEvents = (): WorldEvent[] => [...history, ...computed];
  const runEvents = (): WorldEvent[] =>
    [...(fullChronicle ?? history), ...computed].filter((e) => e.run === campaign.world.run);

  let events = feedEvents();

  const ensureFullChronicle = async (): Promise<void> => {
    if (fullChronicle !== null) return;
    fullChronicle = [];
    try {
      const response = await fetch('./chronicle.jsonl', { cache: 'no-cache' });
      if (!response.ok) return;
      const text = await response.text();
      fullChronicle = text
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as WorldEvent);
    } catch {
      fullChronicle = [];
    }
  };

  const stored = localStorage.getItem(LAST_SEEN_KEY);
  const lastSeen = stored === null ? null : Number(stored);

  renderHeader(campaign);
  renderInstruments(campaign, Date.now());
  renderChronicle(events, campaign, Number.isFinite(lastSeen) ? lastSeen : null);
  localStorage.setItem(LAST_SEEN_KEY, String(campaign.world.tick));

  const canvas = el<HTMLCanvasElement>('stage-canvas');
  const svg = document.getElementById('stage-svg') as unknown as SVGSVGElement;

  const savedView = localStorage.getItem(VIEW_KEY) as ViewId | null;
  if (savedView && VIEWS.some((v) => v.id === savedView)) activeView = savedView;

  const selectView = (id: ViewId): void => {
    activeView = id;
    localStorage.setItem(VIEW_KEY, id);
    hideTip();

    const def = VIEWS.find((v) => v.id === id);
    el('stage-note').textContent = def?.note ?? '';
    canvas.hidden = def?.surface !== 'canvas';
    if (def?.surface === 'svg') svg.removeAttribute('hidden');
    else svg.setAttribute('hidden', '');

    for (const button of el('views').querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-current', String(button.dataset.view === id));
    }

    if (id === 'constellation') {
      constellation?.destroy();
      constellation = mountConstellation(svg, campaign.world, { showTip, hideTip });
    } else {
      constellation?.destroy();
      constellation = null;
    }

    if (id === 'spiral') void ensureFullChronicle();
  };

  renderViewTabs(selectView);
  selectView(activeView);

  // Kurzor nad spirálou ukazuje, co se v daném okamžiku stalo.
  canvas.addEventListener('mousemove', (e) => {
    if (activeView !== 'spiral') return;
    const rect = canvas.getBoundingClientRect();
    const hit = spiralHitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) {
      hideTip();
      return;
    }
    showTip(
      `<b>${escapeHtml(hit.text)}</b><span>${formatYear(hit.year, campaign.world.foundingYear)} · tick ${hit.tick}</span>`,
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
  });
  canvas.addEventListener('mouseleave', hideTip);

  const startedAt = performance.now();
  const frame = (): void => {
    if (!canvas.hidden) {
      const elapsed = performance.now() - startedAt;
      if (activeView === 'disc') drawDisc(canvas, campaign.world, elapsed);
      else if (activeView === 'spiral') drawSpiral(canvas, campaign.world, runEvents(), elapsed);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  setInterval(() => renderInstruments(campaign, Date.now()), 1000);

  setInterval(() => {
    const step = advanceToNow(campaign, Date.now());
    if (step.ticks === 0) return;
    computed = [...computed, ...step.events];
    events = feedEvents();
    renderHeader(campaign);
    renderChronicle(events, campaign, null);
    if (activeView === 'constellation') selectView('constellation');
  }, Math.min(TICK_REAL_MS, 30_000));
}

/**
 * Dopočet do současnosti.
 *
 * Jedno volání má strop, aby prohlížeč nezamrzl; po dlouhém výpadku serveru
 * je proto potřeba zavolat ho víckrát. Bez téhle smyčky by se kampaň zastavila
 * na dvaceti tisících ticích a web by tiše ukazoval minulost.
 */
function catchUp(campaign: Campaign): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (let pass = 0; pass < 12; pass++) {
    const step = advanceToNow(campaign, Date.now());
    events.push(...step.events);
    if (!step.truncated) break;
  }
  return events;
}

/**
 * Zdroj dat. Běžně checkpoint z repozitáře; s `?demo=9000` se civilizace
 * odsimuluje rovnou v prohlížeči, což se hodí při vývoji vizualizací —
 * ta živá je zpravidla teprve na začátku a není na ní co kreslit.
 */
async function loadCampaign(): Promise<Campaign | null> {
  const params = new URLSearchParams(location.search);
  const demo = params.get('demo');

  if (demo !== null) {
    // Genesis se posune do minulosti přesně o požadovaný počet ticků, takže
    // ukázková kampaň sedí na skutečné hodiny stejně jako ta ostrá. Kdyby
    // zůstala na nule, hnal by se dopočet k dnešku od roku 1970.
    const ticks = Math.max(1, Number(demo) || 9000);
    const seed = Number(params.get('seed')) || 3;
    isDemo = true;
    el('lede').textContent = `Ukázka: simuluji ${ticks} ticků…`;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return createCampaign(seed, Date.now() - ticks * TICK_REAL_MS);
  }

  const raw = await fetchJson<unknown>('./world.json');
  if (raw === null) {
    el('lede').textContent =
      'Kronika se ještě nezaložila. Simulace se spustí s prvním během plánované úlohy.';
    el('chronicle').innerHTML = '';
    return null;
  }
  return deserializeCampaign(JSON.stringify(raw));
}

void main();
