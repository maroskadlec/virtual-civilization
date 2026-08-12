/**
 * Katastrofy jako Poissonovy procesy s intenzitou danou planetou.
 *
 * Míry jsou vždy PER SIMULOVANÝ ROK, takže jeden tick v epoše 0 (4000 let)
 * jich přinese desítky, zatímco tick v době železné (2 roky) sotva jednu.
 * Když jich v jednom ticku vyjde příliš mnoho, kronika je shrne do jediné
 * věty — v hlubokém čase stejně nikoho nezajímá jednotlivá povodeň.
 *
 * Katastrofa nikdy jen neničí. Sopka vezme osadu, ale nechá po sobě obsidián
 * a úrodný popel — a tím změní, kudy se civilizace vydá dál.
 */

import type { DisasterId, Planet, World } from './types.js';
import type { Rng } from './rng.js';

export interface DisasterDef {
  id: DisasterId;
  label: string;
  /** Základní míra na simulovaný rok. */
  rate: (world: World) => number;
  /** Podíl populace, který zahyne. */
  toll: [number, number];
  /** Tlaky, které událost zvedne. */
  spikes: Partial<Record<'cold' | 'hunger' | 'disease' | 'war' | 'crowding' | 'curiosity', number>>;
  /** Šance, že zničí celou osadu. */
  wipeChance: number;
  /** Věty do kroniky. `{osada}` se nahradí jménem. */
  lines: string[];
  /** Co po sobě nechá dobrého. */
  boon?: string;
}

const p = (world: World): Planet => world.planet;

export const DISASTERS: readonly DisasterDef[] = [
  {
    id: 'earthquake',
    label: 'zemětřesení',
    rate: (w) => 0.012 * p(w).tectonics,
    toll: [0.02, 0.14],
    spikes: { hunger: 0.2, disease: 0.1 },
    wipeChance: 0.06,
    lines: [
      'Země se otevřela a osada {osada} se propadla do vlastních základů.',
      'Otřesy srovnaly {osada} se zemí. Přeživší odcházeli s tím, co unesli.',
      'Půda pod {osada} se rozestoupila; studny se zakalily na celé generace.',
    ],
  },
  {
    id: 'volcano',
    label: 'sopečný výbuch',
    rate: (w) => 0.009 * p(w).volcanism,
    toll: [0.04, 0.22],
    spikes: { hunger: 0.35, cold: 0.25 },
    wipeChance: 0.14,
    lines: [
      'Hora nad {osada} se roztrhla. Popel padal tak dlouho, že zmizelo slunce.',
      'Ohnivá řeka pohltila {osada}. Co zbylo, bylo pokryto sklem.',
      'Výbuch zasypal {osada} popelem — a s ním přišla i nejúrodnější půda, jakou kdy viděli.',
    ],
    boon: 'popel a obsidián',
  },
  {
    id: 'flood',
    label: 'povodeň',
    rate: (w) => 0.014 * p(w).hydrology,
    toll: [0.02, 0.12],
    spikes: { hunger: 0.3, disease: 0.25 },
    wipeChance: 0.05,
    lines: [
      'Voda vzala {osada} i s obilím uskladněným na zimu.',
      'Řeka opustila koryto a {osada} zůstala celé měsíce pod hladinou.',
      'Záplava odnesla ohrady i pole; nános bahna po ní ale zůstal úrodný.',
    ],
    boon: 'nánosy úrodného bahna',
  },
  {
    id: 'drought',
    label: 'sucho',
    rate: (w) => 0.013 * (0.3 + w.climate.aridity),
    toll: [0.03, 0.16],
    spikes: { hunger: 0.55, war: 0.2 },
    wipeChance: 0.04,
    lines: [
      'Prameny kolem {osada} vyschly. Lidé pili to, co zbylo v hliněných nádobách.',
      'Tři roky nepršelo. Stáda pošla dřív než lidé.',
      'Sucho vyhnalo obyvatele {osada} k severu a cestou jich polovina zůstala.',
    ],
  },
  {
    id: 'plague',
    label: 'mor',
    rate: (w) =>
      0.01 * p(w).biosphere.pathogenLoad * (0.4 + Math.min(1.6, w.pressures.crowding * 2)),
    toll: [0.06, 0.3],
    spikes: { disease: 0.7, hunger: 0.15 },
    wipeChance: 0.07,
    lines: [
      'V osadě {osada} začali lidé umírat rychleji, než je stačili pohřbívat.',
      'Nemoc prošla {osada} za jediné léto a vzala každého třetího.',
      'Mor se šířil po obchodních stezkách; {osada} zavřela brány, ale pozdě.',
    ],
  },
  {
    id: 'meteor',
    label: 'pád tělesa',
    rate: () => 0.0015,
    toll: [0.05, 0.3],
    spikes: { cold: 0.4, hunger: 0.4, curiosity: 0.3 },
    wipeChance: 0.2,
    lines: [
      'Z nebe spadl kámen a tam, kde stála {osada}, zbyl kráter.',
      'Ohnivá čára přeťala oblohu. Náraz bylo slyšet přes celý kontinent.',
    ],
    boon: 'nebeské železo',
  },
  {
    id: 'flare',
    label: 'erupce hvězdy',
    rate: (w) => 0.004 * p(w).stellarFlareRate * (1 - p(w).magneticField),
    toll: [0.01, 0.06],
    spikes: { curiosity: 0.4, disease: 0.2 },
    wipeChance: 0.01,
    lines: [
      'Obloha hořela zelení tři noci po sobě. Nikdo nevěděl, co to znamená.',
      'Hvězda se rozzářila tak, že stíny zmizely i v poledne.',
    ],
  },
  {
    id: 'famine',
    label: 'hladomor',
    rate: (w) => 0.01 * Math.max(0, w.pressures.hunger - 0.35) * 2,
    toll: [0.05, 0.2],
    spikes: { hunger: 0.4, war: 0.35 },
    wipeChance: 0.05,
    lines: [
      'Sýpky {osada} byly prázdné dřív, než přišlo jaro.',
      'Hlad rozdělil osadu {osada} na ty, kdo měli, a na ty, kdo přišli s noži.',
    ],
  },
];

export interface DisasterRoll {
  def: DisasterDef;
  count: number;
}

/** Kolikrát která katastrofa v tomto ticku udeřila. */
export function rollDisasters(world: World, years: number, rng: Rng): DisasterRoll[] {
  const out: DisasterRoll[] = [];
  for (const def of DISASTERS) {
    const lambda = Math.max(0, def.rate(world)) * years;
    const count = rng.poisson(lambda);
    if (count > 0) out.push({ def, count });
  }
  return out;
}
