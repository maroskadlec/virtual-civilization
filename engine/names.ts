/**
 * Generátor českých jmen.
 *
 * Frakce se v kronice objevují ve všech pádech, a strojové skloňování češtiny
 * je nespolehlivé. Proto se jména skládají z ručně předskloňovaných dílů:
 * skloňuje se jen hlavní slovo, přívlastek zůstává v genitivu a nemění se.
 * „Strážci ohnišť" → „Strážců ohnišť" → „Strážcům ohnišť" — vždy správně.
 *
 * Jména osad naproti tomu vznikají z fonémové gramatiky, kterou má každá
 * frakce vlastní — sídla jedné frakce tak znějí příbuzně. Do vět vstupují
 * jen v apozici („v osadě Karnath"), takže se skloňovat nemusí.
 */

import type { Declined } from './types.js';
import type { Rng } from './rng.js';

/** Podstatná jména — rod mužský životný, číslo množné. Pořadí: nom, gen, dat, acc, loc, ins. */
const HEADS: readonly [string, string, string, string, string, string][] = [
  ['Strážci', 'Strážců', 'Strážcům', 'Strážce', 'Strážcích', 'Strážci'],
  ['Lovci', 'Lovců', 'Lovcům', 'Lovce', 'Lovcích', 'Lovci'],
  ['Kováři', 'Kovářů', 'Kovářům', 'Kováře', 'Kovářích', 'Kováři'],
  ['Poutníci', 'Poutníků', 'Poutníkům', 'Poutníky', 'Poutnících', 'Poutníky'],
  ['Pastýři', 'Pastýřů', 'Pastýřům', 'Pastýře', 'Pastýřích', 'Pastýři'],
  ['Rybáři', 'Rybářů', 'Rybářům', 'Rybáře', 'Rybářích', 'Rybáři'],
  ['Synové', 'Synů', 'Synům', 'Syny', 'Synech', 'Syny'],
  ['Bratři', 'Bratrů', 'Bratrům', 'Bratry', 'Bratrech', 'Bratry'],
  ['Vyhnanci', 'Vyhnanců', 'Vyhnancům', 'Vyhnance', 'Vyhnancích', 'Vyhnanci'],
  ['Nomádi', 'Nomádů', 'Nomádům', 'Nomády', 'Nomádech', 'Nomády'],
  ['Osadníci', 'Osadníků', 'Osadníkům', 'Osadníky', 'Osadnících', 'Osadníky'],
  ['Horalé', 'Horalů', 'Horalům', 'Horaly', 'Horalech', 'Horaly'],
  ['Písaři', 'Písařů', 'Písařům', 'Písaře', 'Písařích', 'Písaři'],
  ['Věštci', 'Věštců', 'Věštcům', 'Věštce', 'Věštcích', 'Věštci'],
  ['Kopáči', 'Kopáčů', 'Kopáčům', 'Kopáče', 'Kopáčích', 'Kopáči'],
  ['Sběrači', 'Sběračů', 'Sběračům', 'Sběrače', 'Sběračích', 'Sběrači'],
  ['Mořeplavci', 'Mořeplavců', 'Mořeplavcům', 'Mořeplavce', 'Mořeplavcích', 'Mořeplavci'],
  ['Tesaři', 'Tesařů', 'Tesařům', 'Tesaře', 'Tesařích', 'Tesaři'],
  ['Nositelé', 'Nositelů', 'Nositelům', 'Nositele', 'Nositelích', 'Nositeli'],
  ['Hlídači', 'Hlídačů', 'Hlídačům', 'Hlídače', 'Hlídačích', 'Hlídači'],
  ['Tkalci', 'Tkalců', 'Tkalcům', 'Tkalce', 'Tkalcích', 'Tkalci'],
  ['Lučištníci', 'Lučištníků', 'Lučištníkům', 'Lučištníky', 'Lučištnících', 'Lučištníky'],
  ['Kněží', 'Kněží', 'Kněžím', 'Kněze', 'Kněžích', 'Kněžími'],
  ['Zaklínači', 'Zaklínačů', 'Zaklínačům', 'Zaklínače', 'Zaklínačích', 'Zaklínači'],
  ['Ohňonoši', 'Ohňonošů', 'Ohňonošům', 'Ohňonoše', 'Ohňonoších', 'Ohňonoši'],
  ['Kameníci', 'Kameníků', 'Kameníkům', 'Kameníky', 'Kamenících', 'Kameníky'],
  ['Jezdci', 'Jezdců', 'Jezdcům', 'Jezdce', 'Jezdcích', 'Jezdci'],
  ['Tuláci', 'Tuláků', 'Tulákům', 'Tuláky', 'Tulácích', 'Tuláky'],
];

/** Přívlastky v genitivu — neskloňují se, jen se přilepí za hlavní slovo. */
const MODIFIERS: readonly string[] = [
  'ohnišť',
  'soumraku',
  'popela',
  'hlubin',
  'úsvitu',
  'severního větru',
  'Modré rokle',
  'solných plání',
  'tiché vody',
  'rudého kamene',
  'první jeskyně',
  'dlouhé zimy',
  'sedmi pramenů',
  'černého písku',
  'vysokých mlh',
  'poslední pastviny',
  'měsíčního světla',
  'kostěné stezky',
  'hořkých jezer',
  'šedého úsvitu',
  'dvou řek',
  'zapomenutého údolí',
  'bílé skály',
  'vlčí soutěsky',
  'nízkého nebe',
  'železné hory',
];

/** Ryze přídavná jména — rod mužský životný, číslo množné. */
const ADJECTIVAL: readonly [string, string, string, string, string, string][] = [
  ['Popelaví', 'Popelavých', 'Popelavým', 'Popelavé', 'Popelavých', 'Popelavými'],
  ['Rudí', 'Rudých', 'Rudým', 'Rudé', 'Rudých', 'Rudými'],
  ['Tiší', 'Tichých', 'Tichým', 'Tiché', 'Tichých', 'Tichými'],
  ['Bílí', 'Bílých', 'Bílým', 'Bílé', 'Bílých', 'Bílými'],
  ['Divocí', 'Divokých', 'Divokým', 'Divoké', 'Divokých', 'Divokými'],
  ['Nezlomní', 'Nezlomných', 'Nezlomným', 'Nezlomné', 'Nezlomných', 'Nezlomnými'],
  ['Bezejmenní', 'Bezejmenných', 'Bezejmenným', 'Bezejmenné', 'Bezejmenných', 'Bezejmennými'],
  ['Zbloudilí', 'Zbloudilých', 'Zbloudilým', 'Zbloudilé', 'Zbloudilých', 'Zbloudilými'],
  ['Ostražití', 'Ostražitých', 'Ostražitým', 'Ostražité', 'Ostražitých', 'Ostražitými'],
  ['Slepí', 'Slepých', 'Slepým', 'Slepé', 'Slepých', 'Slepými'],
];

function decline(
  forms: readonly [string, string, string, string, string, string],
  suffix = '',
): Declined {
  const tail = suffix ? ` ${suffix}` : '';
  return {
    nom: forms[0] + tail,
    gen: forms[1] + tail,
    dat: forms[2] + tail,
    acc: forms[3] + tail,
    loc: forms[4] + tail,
    ins: forms[5] + tail,
  };
}

/** Vygeneruje jméno frakce, které se ještě nepoužilo. */
export function factionName(rng: Rng, used: ReadonlySet<string>): Declined {
  for (let attempt = 0; attempt < 60; attempt++) {
    const candidate = rng.chance(0.25)
      ? decline(rng.pick(ADJECTIVAL))
      : decline(rng.pick(HEADS), rng.pick(MODIFIERS));
    if (!used.has(candidate.nom)) return candidate;
  }
  // Po šedesáti pokusech je banka vyčerpaná — přidáme pořadové označení.
  const base = decline(rng.pick(HEADS), rng.pick(MODIFIERS));
  const mark = ` ${rng.int(90) + 10}`;
  return {
    nom: base.nom + mark,
    gen: base.gen + mark,
    dat: base.dat + mark,
    acc: base.acc + mark,
    loc: base.loc + mark,
    ins: base.ins + mark,
  };
}

// ─────────────────────────────────────────── Fonémová gramatika pro místní jména

const ONSETS = ['k', 't', 'm', 'n', 'r', 's', 'v', 'd', 'l', 'b', 'h', 'g', 'p', 'z', 'th', 'br', 'kr', 'dr', 'st', 'ml', 'vr', 'ch', 'sk'];
const NUCLEI = ['a', 'e', 'i', 'o', 'u', 'á', 'e', 'í', 'o', 'au', 'ei', 'ó', 'y'];
const CODAS = ['', '', '', 'n', 'r', 'l', 's', 'm', 'th', 'k', 'rn', 'st', 'nd', 'l'];

/** Jazyk frakce — zúžený výběr fonémů, takže sídla jedné frakce znějí příbuzně. */
export interface Language {
  onsets: string[];
  nuclei: string[];
  codas: string[];
  minSyllables: number;
  maxSyllables: number;
}

export function makeLanguage(rng: Rng): Language {
  const take = <T,>(pool: readonly T[], n: number): T[] => rng.shuffle(pool).slice(0, n);
  const min = rng.chance(0.6) ? 2 : 1;
  return {
    onsets: take(ONSETS, 5 + rng.int(4)),
    nuclei: take(NUCLEI, 3 + rng.int(3)),
    codas: take(CODAS, 4 + rng.int(4)),
    minSyllables: min,
    maxSyllables: min + 1,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function placeName(rng: Rng, lang: Language, used: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    const syllables =
      lang.minSyllables + rng.int(lang.maxSyllables - lang.minSyllables + 1);
    let out = '';
    for (let i = 0; i < syllables; i++) {
      out += rng.pick(lang.onsets) + rng.pick(lang.nuclei);
      // Kodu dáváme hlavně na konec slova, jinak jména drhnou.
      if (i === syllables - 1 || rng.chance(0.25)) out += rng.pick(lang.codas);
    }
    const name = capitalize(out);
    if (name.length >= 3 && !used.has(name)) return name;
  }
  return capitalize(`${rng.pick(lang.onsets)}${rng.pick(lang.nuclei)}${used.size}`);
}

const PLANET_PREFIX = ['An', 'Vor', 'Kes', 'Thal', 'Mir', 'Ol', 'Sar', 'Ur', 'Ael', 'Nym', 'Tor', 'Ish'];
const PLANET_MIDDLE = ['ha', 'u', 'a', 'e', 'i', 'ra', 'de', 'no', 'va', 'se'];
const PLANET_SUFFIX = ['reth', 'nna', 'dor', 'mis', 'kar', 'lith', 'ven', 'tar', 'sha', 'ryn'];

export function planetName(rng: Rng): string {
  return rng.pick(PLANET_PREFIX) + rng.pick(PLANET_MIDDLE) + rng.pick(PLANET_SUFFIX);
}
