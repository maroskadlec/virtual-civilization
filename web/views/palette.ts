/**
 * Společná paleta pro všechny pohledy.
 *
 * Držíme se art direction: téměř černý podklad, teplý inkoust, vlasové linky.
 * Biomy jsou schválně málo syté — mapa má být pozadím, na kterém svítí sídla,
 * ne barevný atlas. Frakce naopak dostávají syté odstíny, protože to je
 * jediné, co má na mapě strhávat pozornost.
 */

import type { Biome } from '../../engine/types.js';

export const GROUND = '#07090c';
export const INK = '#e8dcc4';
export const INK_DIM = '#9aa1ab';
export const INK_FAINT = '#5c646f';
export const RULE = '#1c222b';

export const BIOME_COLOR: Record<Biome, string> = {
  tundra: '#4a5866',
  taiga: '#26423c',
  grassland: '#5b5636',
  forest: '#2c4a32',
  jungle: '#1f4e2c',
  desert: '#6b5734',
  coast: '#22506b',
  highland: '#514741',
};

/** Šest odstínů frakcí. Víc jich na tmavém podkladu nejde rozlišit. */
export const FACTION_COLORS: readonly string[] = [
  '#7fd6a6', // máta
  '#e0b25e', // jantar
  '#d2624a', // cihla
  '#b48fd6', // fialová
  '#63b8d4', // modrozelená
  '#c9d46a', // olivová
];

export function factionColor(hue: number): string {
  return FACTION_COLORS[((hue % FACTION_COLORS.length) + FACTION_COLORS.length) % FACTION_COLORS.length] as string;
}

export const EVENT_COLOR: Record<string, string> = {
  genesis: INK,
  milestone: '#7fd6a6',
  milestone_lost: '#b8574e',
  disaster: '#d9a04a',
  disaster_aggregate: '#8a6f47',
  epoch: '#8fb4de',
  faction_split: '#b48fd6',
  faction_end: '#8f6fa6',
  war: '#d2624a',
  settlement_founded: '#4a5560',
  settlement_lost: '#4a5560',
  climate: '#63b8d4',
  population: '#4a5560',
  ending: '#d2624a',
};

/** Barva epochy pro výseče na spirále — od chladné k teplé, jak dějiny zrychlují. */
export const EPOCH_COLORS: readonly string[] = [
  '#2f3b45', '#35474a', '#3b5147', '#455842', '#525c3e', '#61603c',
  '#70613c', '#7d5e3e', '#885843', '#91504c', '#964858', '#964468',
  '#8c447c', '#7a4c92',
];

export function epochColor(epoch: number): string {
  const i = Math.max(0, Math.min(EPOCH_COLORS.length - 1, epoch));
  return EPOCH_COLORS[i] as string;
}

/**
 * Připraví plátno pro ostré kreslení na displejích s vysokou hustotou.
 * Vrací logické rozměry, se kterými se pak počítá.
 */
export function setupCanvas(
  canvas: HTMLCanvasElement,
): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}
