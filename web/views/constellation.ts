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

export function mountConstellation(svg: SVGSVGElement, world: World, tip: TipApi): ConstellationHandle {
  const { markup, width, height } = render(world);
  svg.innerHTML = `<style>${STYLE}</style>${markup}`;

  // Na začátku ukážeme okolí epochy, ve které civilizace zrovna je.
  const focusX = Math.max(0, PADDING + world.epoch * COLUMN - 420);
  const view = { x: focusX, y: 0, w: Math.min(width, 1100), h: height };

  const apply = (): void => {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  };
  apply();

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onDown = (e: PointerEvent): void => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    svg.classList.add('dragging');
    svg.setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent): void => {
    if (dragging) {
      const scale = view.w / svg.clientWidth;
      view.x -= (e.clientX - lastX) * scale;
      view.y -= (e.clientY - lastY) * scale;
      lastX = e.clientX;
      lastY = e.clientY;
      apply();
      tip.hideTip();
      return;
    }

    const group = (e.target as Element).closest('.node');
    const data = group?.getAttribute('data-tip');
    if (!data) {
      tip.hideTip();
      return;
    }
    const [name, blurb, state] = data.split('|');
    const rect = svg.getBoundingClientRect();
    tip.showTip(
      `<b>${name}</b>${blurb}<br><span>${state}</span>`,
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
  };

  const onUp = (e: PointerEvent): void => {
    dragging = false;
    svg.classList.remove('dragging');
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    const next = Math.max(320, Math.min(width * 1.4, view.w * factor));
    // Přiblížení drží pod kurzorem tentýž bod mapy.
    const rect = svg.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const ratio = next / view.w;
    view.x += view.w * px * (1 - ratio);
    view.y += view.h * py * (1 - ratio);
    view.w = next;
    view.h = (next * rect.height) / rect.width;
    apply();
  };

  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointerleave', tip.hideTip);
  svg.addEventListener('wheel', onWheel, { passive: false });

  return {
    destroy: () => {
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onUp);
      svg.removeEventListener('pointerleave', tip.hideTip);
      svg.removeEventListener('wheel', onWheel);
      svg.innerHTML = '';
    },
  };
}
