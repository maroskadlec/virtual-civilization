/**
 * Rejstřík všech milníků a měřítka cen.
 *
 * Data samotná žijí ve dvou souborech podle epochy — jinak by šlo o jeden
 * soubor se sto šedesáti položkami, ve kterém se nedá nic najít.
 */

import type { Milestone } from './types.js';
import { EARLY_MILESTONES } from './milestones.early.js';
import { LATE_MILESTONES } from './milestones.late.js';

/**
 * Převod relativní obtížnosti na jednotky poznání.
 *
 * Proč vůbec existuje: mezi epochami klesá počet simulovaných let na tick
 * o pět řádů, zatímco populace a výzkumné násobiče rostou. Výkon na tick se
 * proto mezi epochami liší o řády a absolutní ceny by nešly autorsky odhadnout.
 * Takhle autor zapíše, že je něco „tak dvakrát těžší než sousední milník",
 * a vyvažuje se čtrnáct čísel místo sto šedesáti.
 *
 * Rozsah patnácti řádů není chyba: výkon na tick roste napříč obloukem dějin
 * o zhruba tolik, protože populace i násobiče výzkumu se kompoundují, zatímco
 * počet let na tick klesá. Tabulka to jen zrcadlí.
 *
 * Laděno příkazem `npm run calibrate`, který smyčku dojede sám a vypíše
 * výslednou tabulku k vložení sem. Ručně to ladit nejde — měřítka jsou
 * provázaná přes populaci, která se do pozdních epoch přenáší z těch raných.
 */
export const EPOCH_COST_SCALE: number[] = [
  54, // 0 Úsvit
  0.31, // 1 Neolit
  1.43, // 2 Doba bronzová
  54, // 3 Doba železná
  5.21e3, // 4 Klasická éra
  9.01e4, // 5 Věk víry
  1.49e5, // 6 Věk objevů
  1.38e6, // 7 Osvícenství
  8.17e6, // 8 Průmysl
  7.42e7, // 9 Elektřina a atom
  6.36e8, // 10 Informace
  1.34e10, // 11 Sítě a biotechnologie
  7.68e11, // 12 Postlidská éra
  1.51e14, // 13 Transcendence
];

/**
 * Přepíše měřítka za běhu. Používá výhradně kalibrační nástroj, který musí
 * v jednom procesu projet desítky variant — jinak by se musel po každé
 * iteraci restartovat.
 */
export function setEpochCostScale(next: readonly number[]): void {
  for (let i = 0; i < EPOCH_COST_SCALE.length; i++) {
    EPOCH_COST_SCALE[i] = next[i] ?? (EPOCH_COST_SCALE[i] as number);
  }
}

export const MILESTONES: readonly Milestone[] = [...EARLY_MILESTONES, ...LATE_MILESTONES];

/** Rychlý index podle id. */
export const MILESTONE_BY_ID: ReadonlyMap<string, Milestone> = new Map(
  MILESTONES.map((m) => [m.id, m]),
);

/** Milníky dané epochy. */
export function milestonesOfEpoch(epoch: number): Milestone[] {
  return MILESTONES.filter((m) => m.epoch === epoch);
}

/** Nejvyšší epocha, pro kterou jsou data. Dál se civilizace nedostane. */
export const MAX_CONTENT_EPOCH = MILESTONES.reduce((max, m) => Math.max(max, m.epoch), 0);
