/**
 * SOUHVĚZDÍ — strom poznání jako hvězdná mapa.
 *
 * Odpovídá na otázku „kde se civilizace zrovna nachází". Sloupce jsou epochy,
 * čáry vedou od předpokladu k tomu, co umožnil, a stav každé hvězdy říká,
 * jestli se to už povedlo, jestli se na tom pracuje, jestli se to zapomnělo —
 * nebo jestli je to na téhle planetě rovnou nemožné, protože chybí surovina.
 *
 * Kreslí se v SVG: sto šedesát bodů je pro prohlížeč nic a text i chytání
 * kurzoru jsou zadarmo.
 */

import { MILESTONES, milestonesOfEpoch } from '../../engine/milestones.data.js';
import { prereqsMet, reachableIds } from '../../engine/research.js';
import { epochDef } from '../../engine/epochs.js';
import { hashString } from '../../engine/rng.js';
import type { Milestone, World } from '../../engine/types.js';

const COLUMN = 190;
const ROW = 44;
const PADDING = 70;

type State = 'unlocked' | 'progress' | 'available' | 'locked' | 'lost' | 'unreachable';

const STATE_STYLE: Record<State, { fill: string; radius: number; label: string }> = {
  unlocked: { fill: '#e8dcc4', radius: 4, label: 'rgba(232,220,196,0.92)' },
  progress: { fill: '#7fd6a6', radius: 3.4, label: 'rgba(127,214,166,0.92)' },
  available: { fill: '#5c646f', radius: 2.4, label: 'rgba(154,161,171,0.55)' },
  locked: { fill: '#2b323b', radius: 1.8, label: 'rgba(92,100,111,0.4)' },
  lost: { fill: '#b8574e', radius: 3.2, label: 'rgba(184,87,78,0.9)' },
  unreachable: { fill: '#232a34', radius: 1.6, label: 'rgba(70,78,88,0.4)' },
};

const STATE_LABEL: Record<State, string> = {
  unlocked: 'zvládnuto',
  progress: 'právě se na tom pracuje',
  available: 'na dosah',
  locked: 'zatím mimo dosah',
  lost: 'zapomenuto při kolapsu',
  unreachable: 'na této planetě nedosažitelné',
};

export interface ConstellationHandle {
  destroy: () => void;
}

interface Node {
  milestone: Milestone;
  x: number;
  y: number;
  state: State;
  progress: number;
}

function stateOf(world: World, m: Milestone, reachable: ReadonlySet<string>): State {
  if (world.tech.unlocked[m.id]) return 'unlocked';
  if (world.tech.lost.includes(m.id)) return 'lost';
  if (!reachable.has(m.id)) return 'unreachable';
  if ((world.tech.progress[m.id] ?? 0) > 0) return 'progress';
  return prereqsMet(world, m) ? 'available' : 'locked';
}

/**
 * Rozmístění. Sloupec je epocha, pozice ve sloupci je stabilní — odvozuje se
 * z hashe identifikátoru, takže se hvězdy při každém překreslení neposunou.
 */
function layout(world: World): { nodes: Map<string, Node>; width: number; height: number } {
  const reachable = reachableIds(world);
  const nodes = new Map<string, Node>();
  let maxRows = 0;

  const epochs = [...new Set(MILESTONES.map((m) => m.epoch))].sort((a, b) => a - b);

  for (const epoch of epochs) {
    const inEpoch = milestonesOfEpoch(epoch).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
    maxRows = Math.max(maxRows, inEpoch.length);

    inEpoch.forEach((milestone, index) => {
      // Jemné rozhození do stran, aby sloupec nevypadal jako tabulka.
      const jitter = ((hashString(milestone.id) % 1000) / 1000 - 0.5) * 46;
      nodes.set(milestone.id, {
        milestone,
        x: PADDING + epoch * COLUMN + jitter,
        y: PADDING + index * ROW,
        state: stateOf(world, milestone, reachable),
        progress: world.tech.progress[milestone.id] ?? 0,
      });
    });
  }

  return {
    nodes,
    width: PADDING * 2 + (epochs.length - 1) * COLUMN + 120,
    height: PADDING * 2 + maxRows * ROW,
  };
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);
}

function render(world: World): { markup: string; width: number; height: number } {
  const { nodes, width, height } = layout(world);
  const parts: string[] = [];

  // Popisky epoch nad sloupci.
  const epochs = [...new Set(MILESTONES.map((m) => m.epoch))].sort((a, b) => a - b);
  for (const epoch of epochs) {
    const x = PADDING + epoch * COLUMN;
    const reached = world.epoch >= epoch;
    parts.push(
      `<text x="${x}" y="${PADDING - 34}" class="epoch-label${reached ? ' reached' : ''}">${escapeXml(epochDef(epoch).name)}</text>`,
      `<line x1="${x - 30}" y1="${PADDING - 26}" x2="${x - 30}" y2="${height - 30}" class="epoch-rule" />`,
    );
  }

  // Vazby předpokladů. Kreslí se první, aby zůstaly pod hvězdami.
  for (const node of nodes.values()) {
    const deps = [
      ...(node.milestone.requires?.all ?? []),
      ...(node.milestone.requires?.any ?? []),
    ];
    for (const id of deps) {
      const from = nodes.get(id);
      if (!from) continue;
      const live = node.state === 'unlocked' && from.state === 'unlocked';
      const midX = (from.x + node.x) / 2;
      parts.push(
        `<path d="M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${node.y}, ${node.x} ${node.y}" class="link${live ? ' live' : ''}" />`,
      );
    }
  }

  for (const node of nodes.values()) {
    const style = STATE_STYLE[node.state];
    const name = escapeXml(node.milestone.name);
    const tip = escapeXml(`${node.milestone.name}|${node.milestone.blurb}|${STATE_LABEL[node.state]}`);

    parts.push(`<g class="node state-${node.state}" data-tip="${tip}">`);

    // Rozpracované milníky nosí prstýnek s podílem hotového.
    if (node.state === 'progress') {
      parts.push(`<circle cx="${node.x}" cy="${node.y}" r="7" class="progress-ring" />`);
    }
    if (node.state === 'unlocked') {
      parts.push(`<circle cx="${node.x}" cy="${node.y}" r="9" class="halo" />`);
    }

    parts.push(
      `<circle cx="${node.x}" cy="${node.y}" r="${style.radius}" fill="${style.fill}" />`,
      `<circle cx="${node.x}" cy="${node.y}" r="12" fill="transparent" />`,
      `<text x="${node.x + 11}" y="${node.y + 3.5}" fill="${style.label}">${name}</text>`,
      `</g>`,
    );
  }

  return { markup: parts.join(''), width, height };
}

const STYLE = `
  .node text { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9.5px; }
  .node { cursor: default; }
  .node:hover text { fill: #e8dcc4; }
  .link { fill: none; stroke: rgba(232,220,196,0.07); stroke-width: 1; }
  .link.live { stroke: rgba(127,214,166,0.22); }
  .halo { fill: none; stroke: rgba(232,220,196,0.16); stroke-width: 1; }
  .progress-ring { fill: none; stroke: rgba(127,214,166,0.4); stroke-width: 1; stroke-dasharray: 2 3; }
  .epoch-label { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9px;
                 letter-spacing: 0.14em; text-transform: uppercase; fill: #3c444e; }
  .epoch-label.reached { fill: #8fb4de; }
  .epoch-rule { stroke: rgba(232,220,196,0.05); stroke-width: 1; }
`;

interface TipApi {
  showTip: (html: string, x: number, y: number) => void;
  hideTip: () => void;
}

/** Nejtěsnější a nejvolnější přiblížení, měřeno šířkou výřezu. */
const MIN_VIEW = 220;

/** Kolik pixelů ještě projde jako ťuknutí, ne jako tažení. */
const TAP_SLOP = 8;

/**
 * Ovládání pohledu.
 *
 * Kolečko myši je na dotykovém displeji k ničemu a gesto dvěma prsty nikde
 * není vidět. Tlačítka jsou proto jediná objevitelná cesta k přiblížení —
 * a zároveň to jediné, co funguje i bez myši a bez dotyku.
 */
function mountControls(
  frame: HTMLElement,
  actions: { zoomIn: () => void; zoomOut: () => void; fit: () => void },
): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'zoomers';
  bar.innerHTML =
    '<button type="button" data-act="out" aria-label="Oddálit">−</button>' +
    '<button type="button" data-act="in" aria-label="Přiblížit">+</button>' +
    '<button type="button" data-act="fit" aria-label="Zobrazit celý strom">⤢</button>';

  bar.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest('button')?.dataset.act;
    if (act === 'in') actions.zoomIn();
    else if (act === 'out') actions.zoomOut();
    else if (act === 'fit') actions.fit();
  });

  // Tlačítka nesmí propustit gesto do plátna pod sebou, jinak se mapa
  // při každém ťuknutí zároveň posune.
  bar.addEventListener('pointerdown', (e) => e.stopPropagation());

  frame.appendChild(bar);
  return bar;
}

export function mountConstellation(svg: SVGSVGElement, world: World, tip: TipApi): ConstellationHandle {
  const { markup, width, height } = render(world);
  svg.innerHTML = `<style>${STYLE}</style>${markup}`;

  const frame = svg.parentElement as HTMLElement;
  const frameWidth = svg.clientWidth || 900;
  const frameHeight = svg.clientHeight || 600;
  const aspect = frameHeight / frameWidth;

  /**
   * Výřez se drží ve stejném poměru stran jako rám.
   *
   * Dřív měl vlastní poměr a `meet` ho dopočítával, takže první přiblížení
   * skočilo — a hlavně se na úzkém displeji celý strom nacpal do 340 pixelů
   * a popisky vyšly na tři. Počáteční šířka se proto odvozuje od rámu:
   * na širokém displeji zůstává původních 1100 jednotek (popisek vyjde na
   * plných 9.5 px), na užších se úměrně přitáhne, aby text zůstal čitelný.
   * Zbytek stromu se dojede prstem nebo tlačítky.
   */
  const startWidth = Math.min(width, Math.max(420, Math.min(1100, frameWidth * 1.15)));

  // Na začátku ukážeme okolí epochy, ve které civilizace zrovna je.
  const focusX = Math.max(0, PADDING + world.epoch * COLUMN - startWidth * 0.38);
  const view = { x: focusX, y: 0, w: startWidth, h: startWidth * aspect };

  const apply = (): void => {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  };
  apply();

  /** Přiblíží tak, aby bod pod prsty (nebo pod kurzorem) zůstal na místě. */
  const zoomAround = (nextWidth: number, clientX: number, clientY: number): void => {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const next = Math.max(MIN_VIEW, Math.min(width * 1.4, nextWidth));
    const ratio = next / view.w;
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    view.x += view.w * px * (1 - ratio);
    view.y += view.h * py * (1 - ratio);
    view.w = next;
    view.h = (next * rect.height) / rect.width;
    apply();
  };

  /** Přiblížení ze středu — pro tlačítka, která žádný bod pod sebou nemají. */
  const zoomCenter = (factor: number): void => {
    const rect = svg.getBoundingClientRect();
    zoomAround(view.w * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const fit = (): void => {
    const rect = svg.getBoundingClientRect();
    const frameAspect = rect.height / rect.width;
    // Celý strom se musí vejít v obou směrech, proto ten větší z požadavků.
    view.w = Math.max(width, height / frameAspect);
    view.h = view.w * frameAspect;
    view.x = (width - view.w) / 2;
    view.y = (height - view.h) / 2;
    apply();
    tip.hideTip();
  };

  const controls = mountControls(frame, {
    zoomIn: () => zoomCenter(1 / 1.35),
    zoomOut: () => zoomCenter(1.35),
    fit,
  });

  // Aktivní doteky. Jeden posouvá, dva přibližují.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;
  let pinchMid = { x: 0, y: 0 };
  let lastX = 0;
  let lastY = 0;
  let travelled = 0;

  /**
   * Prst je nepřesný. Citlivá plocha hvězdy má v přiblížení kolem dvaceti
   * pixelů, takže se při minutí zkusí i blízké okolí — jinak se na dotykovém
   * displeji na malé milníky prostě nedá trefit.
   */
  const TAP_RING: readonly [number, number][] = [
    [0, 0], [0, -13], [13, 0], [0, 13], [-13, 0],
    [10, -10], [-10, -10], [10, 10], [-10, 10],
  ];

  const nodeAtPoint = (clientX: number, clientY: number): Element | null => {
    for (const [dx, dy] of TAP_RING) {
      const found = document.elementFromPoint(clientX + dx, clientY + dy)?.closest('.node');
      if (found) return found;
    }
    return null;
  };

  const showTipFor = (element: Element | null, clientX: number, clientY: number): void => {
    const data = element?.closest('.node')?.getAttribute('data-tip');
    if (!data) {
      tip.hideTip();
      return;
    }
    const [name, blurb, state] = data.split('|');
    const rect = svg.getBoundingClientRect();
    tip.showTip(
      `<b>${name}</b>${blurb}<br><span>${state}</span>`,
      clientX - rect.left,
      clientY - rect.top,
    );
  };

  /**
   * Zachycení ukazatele umí vyhodit výjimku, když dotek mezitím skončil.
   * Nechat to probublat by uťalo zbytek obsluhy a gesto by se rozpadlo —
   * přitom bez zachycení všechno funguje dál, jen tažení nepřežije opuštění
   * plátna.
   */
  const capture = (id: number): void => {
    try {
      svg.setPointerCapture(id);
    } catch {
      /* ukazatel už není aktivní */
    }
  };

  const release = (id: number): void => {
    try {
      if (svg.hasPointerCapture(id)) svg.releasePointerCapture(id);
    } catch {
      /* totéž z druhé strany */
    }
  };

  const onDown = (e: PointerEvent): void => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    travelled = 0;
    capture(e.pointerId);

    if (pointers.size === 1) {
      lastX = e.clientX;
      lastY = e.clientY;
      svg.classList.add('dragging');
    } else {
      // Druhý prst gesto překlápí z posunu na přiblížení.
      svg.classList.remove('dragging');
      pinchDistance = 0;
      tip.hideTip();
    }
  };

  const onMove = (e: PointerEvent): void => {
    // Pohyb myši bez stisku jen ukazuje popisek. U doteku by to znamenalo,
    // že popisek naskočí při každém tažení.
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') showTipFor(e.target as Element, e.clientX, e.clientY);
      return;
    }

    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const scale = view.w / Math.max(1, svg.clientWidth);

    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

      if (pinchDistance > 0 && distance > 0) {
        // Prsty zároveň posouvají, ne jen roztahují.
        view.x -= (mid.x - pinchMid.x) * scale;
        view.y -= (mid.y - pinchMid.y) * scale;
        zoomAround(view.w * (pinchDistance / distance), mid.x, mid.y);
      }
      pinchDistance = distance;
      pinchMid = mid;
      return;
    }

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    travelled += Math.hypot(dx, dy);
    view.x -= dx * scale;
    view.y -= dy * scale;
    lastX = e.clientX;
    lastY = e.clientY;
    apply();
    tip.hideTip();
  };

  const onUp = (e: PointerEvent): void => {
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDistance = 0;
    if (pointers.size === 0) svg.classList.remove('dragging');
    release(e.pointerId);

    // Ťuknutí prstem je jediný způsob, jak si na dotykovém displeji přečíst,
    // co ta hvězda je. `elementFromPoint` proto, že cíl události je kvůli
    // zachycení ukazatele vždycky celé plátno.
    if (wasSingle && travelled < TAP_SLOP && e.pointerType !== 'mouse') {
      showTipFor(nodeAtPoint(e.clientX, e.clientY), e.clientX, e.clientY);
    }
  };

  /**
   * Opuštění plátna schová popisek jen u myši.
   *
   * U doteku prohlížeč posílá `pointerleave` hned po `pointerup` — ukazatel
   * přestal existovat, takže z plátna „odešel". Nepodmíněné schování proto
   * zhaslo popisek ve stejném okamžiku, kdy ho ťuknutí rozsvítilo, a na mobilu
   * jen bliknul. Popisek se u doteku zavírá ťuknutím vedle nebo posunem mapy.
   */
  const onLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') tip.hideTip();
  };

  const onCancel = (e: PointerEvent): void => {
    // Bez tohohle zůstane po přerušeném gestu ukazatel v evidenci navždy
    // a mapa se tváří, jako by se na ni pořád sahalo.
    pointers.delete(e.pointerId);
    pinchDistance = 0;
    if (pointers.size === 0) svg.classList.remove('dragging');
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    zoomAround(view.w * (e.deltaY > 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY);
  };

  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onCancel);
  svg.addEventListener('pointerleave', onLeave);
  svg.addEventListener('wheel', onWheel, { passive: false });

  return {
    destroy: () => {
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onUp);
      svg.removeEventListener('pointercancel', onCancel);
      svg.removeEventListener('pointerleave', onLeave);
      svg.removeEventListener('wheel', onWheel);
      controls.remove();
      svg.innerHTML = '';
    },
  };
}
