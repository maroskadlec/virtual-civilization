/**
 * Model času.
 *
 * Tick je konstantní v reálném čase (15 minut), ale kolik simulovaných let
 * jeden tick pokryje, se s epochou zmenšuje o pět řádů. Důsledek: hustota
 * událostí na reálný den zůstává zhruba stejná — proto se vyplatí chodit
 * denně — zatímco simulovaný čas se dramaticky zpomaluje, přesně jako
 * ve skutečných dějinách.
 */

export const TICK_REAL_MS = 15 * 60 * 1000;
export const TICKS_PER_REAL_DAY = Math.round((24 * 60 * 60 * 1000) / TICK_REAL_MS);

export interface EpochDef {
  index: number;
  name: string;
  /** Kolik simulovaných let pokryje jeden tick v této epoše. */
  yearsPerTick: number;
  /** Jaký podíl milníků epochy musí být odemčen, aby civilizace postoupila. */
  advanceRatio: number;
}

export const EPOCHS: readonly EpochDef[] = [
  { index: 0, name: 'Úsvit', yearsPerTick: 4000, advanceRatio: 0.7 },
  { index: 1, name: 'Neolit', yearsPerTick: 12, advanceRatio: 0.7 },
  { index: 2, name: 'Doba bronzová', yearsPerTick: 4, advanceRatio: 0.65 },
  { index: 3, name: 'Doba železná', yearsPerTick: 2, advanceRatio: 0.65 },
  { index: 4, name: 'Klasická éra', yearsPerTick: 1.6, advanceRatio: 0.65 },
  { index: 5, name: 'Věk víry', yearsPerTick: 2, advanceRatio: 0.6 },
  { index: 6, name: 'Věk objevů', yearsPerTick: 0.6, advanceRatio: 0.6 },
  { index: 7, name: 'Osvícenství', yearsPerTick: 0.3, advanceRatio: 0.6 },
  { index: 8, name: 'Průmysl', yearsPerTick: 0.24, advanceRatio: 0.6 },
  { index: 9, name: 'Elektřina a atom', yearsPerTick: 0.16, advanceRatio: 0.6 },
  { index: 10, name: 'Informace', yearsPerTick: 0.1, advanceRatio: 0.6 },
  { index: 11, name: 'Sítě a biotechnologie', yearsPerTick: 0.06, advanceRatio: 0.6 },
  { index: 12, name: 'Postlidská éra', yearsPerTick: 0.08, advanceRatio: 0.6 },
  { index: 13, name: 'Transcendence', yearsPerTick: 0.2, advanceRatio: 1 },
];

export const LAST_EPOCH = EPOCHS.length - 1;

export function epochDef(index: number): EpochDef {
  const clamped = Math.max(0, Math.min(LAST_EPOCH, index));
  return EPOCHS[clamped] as EpochDef;
}

export function yearsPerTick(epoch: number): number {
  return epochDef(epoch).yearsPerTick;
}

/** Index ticku odvozený z reálného času. Jediné místo, kde se potkávají hodiny a simulace. */
export function tickIndexAt(nowMs: number, genesisMs: number): number {
  return Math.max(0, Math.floor((nowMs - genesisMs) / TICK_REAL_MS));
}

/**
 * Oddělovač tisíců.
 *
 * Schválně ručně, ne přes `toLocaleString`: text událostí se porovnává mezi
 * serverem a prohlížečem a ty mohou mít jiné ICU, které oddělí tisíce jiným
 * znakem. Rozdíl v jediné mezeře by rozešel kroniku spočítanou v Action
 * s kronikou, kterou si dopočítá klient.
 */
function group(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Hloubka času před založením — tam se počítá ve statisících let. */
export function formatDeepTime(year: number): string {
  const y = Math.round(year);
  if (y >= 1_000_000) return `${(y / 1_000_000).toFixed(2)} mil. let`;
  if (y >= 10_000) return `${group(y / 1000)} tis. let`;
  return `${group(y)} let`;
}

/**
 * Datum pro kroniku.
 *
 * Před založením se udává stáří světa, po založení vlastní letopočet
 * civilizace. Bez toho by celá historie od neolitu dál nesla jediné datum —
 * paleolit spolkne miliony let a všechno po něm se v absolutním čísle ztratí.
 */
export function formatYear(year: number, foundingYear: number | null): string {
  if (foundingYear === null || year < foundingYear) return `${formatDeepTime(year)} stáří`;
  return `rok ${group(year - foundingYear)}`;
}
