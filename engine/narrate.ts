/**
 * Vyprávěcí vrstva — jediné místo, kde se z faktů stávají věty.
 *
 * Mechanika (`tick.ts`) rozhoduje, co se stalo. Tenhle soubor rozhoduje, jak
 * se to řekne. Oddělení je záměrné: až sem jednou sedne LLM vrstva, vymění se
 * generátor textu a engine se nezmění ani o řádek.
 *
 * Dvě pravidla, která tu platí bez výjimky:
 *
 * 1. **Nikdy nedávat generované jméno do pozice, kde by čeština chtěla shodu.**
 *    Názvy milníků a epoch stojí za dvojtečkou v 1. pádě, shoda se věší na
 *    slovo, jehož rod známe („milník", „epocha", „civilizace").
 * 2. **Žádné `toLocaleString`.** Server a prohlížeč mohou mít jiné ICU a
 *    oddělovat tisíce jiným znakem — a text událostí se porovnává mezi nimi.
 */

import { formatDeepTime } from './epochs.js';
import type { DisasterMemo, WarMemo } from './memory.js';
import type { Declined, Era, Figure, Toll } from './types.js';
import type { Rng } from './rng.js';

// ─────────────────────────────────────────── Čísla a počty

/** Tisíce se oddělují mezerou. Vlastní implementace kvůli determinismu. */
export function num(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * České počítané tvary. `forms` je [tvar pro jedničku, tvar pro 2–4, tvar pro 5+].
 * U jedničky se číslovka nepíše — „jednu válku" zní líp než „1 válku".
 */
function countPhrase(n: number, forms: readonly [string, string, string]): string {
  if (n === 1) return forms[0];
  if (n >= 2 && n <= 4) return `${n} ${forms[1]}`;
  return `${num(n)} ${forms[2]}`;
}

export const milestonesPhrase = (n: number) => countPhrase(n, ['jeden milník', 'milníky', 'milníků']);
export const warsPhrase = (n: number) => countPhrase(n, ['jednu válku', 'války', 'válek']);
export const disastersPhrase = (n: number) => countPhrase(n, ['jednu pohromu', 'pohromy', 'pohrom']);
/** 4. pád — „podrobili si jednu osadu". */
export const settlementsPhrase = (n: number) => countPhrase(n, ['jednu osadu', 'osady', 'osad']);
/** 1. pád — „stojí jedna osada". Tvar se u jedničky liší, u vyšších ne. */
export const settlementsNom = (n: number) => countPhrase(n, ['jedna osada', 'osady', 'osad']);
export const knowledgePhrase = (n: number) => countPhrase(n, ['jednu znalost', 'znalosti', 'znalostí']);

/** „rok" / „3 roky" / „340 let" — a v hloubce času „12 tis. let". */
export function yearsPhrase(years: number): string {
  const y = Math.round(years);
  if (y >= 10_000) return formatDeepTime(y);
  if (y === 1) return 'rok';
  if (y >= 2 && y <= 4) return `${y} roky`;
  return `${num(y)} let`;
}

/**
 * Totéž po předložce „před", která si žádá 7. pád: „před 340 lety", ne
 * „před 340 let". Vlastní funkce proto, že tvar se od počítaného liší
 * u všech čísel, ne jen u některých.
 */
export function yearsAgoPhrase(years: number): string {
  const y = Math.round(years);
  if (y <= 1) return 'před rokem';
  if (y >= 10_000) return `před ${formatDeepTime(y).replace(/ let$/, ' lety')}`;
  return `před ${num(y)} lety`;
}

const NTH: readonly string[] = [
  '', 'poprvé', 'podruhé', 'potřetí', 'počtvrté', 'popáté',
  'pošesté', 'posedmé', 'poosmé', 'podeváté', 'podesáté',
];

export function nthTime(n: number): string {
  return NTH[n] ?? `už ${n}×`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─────────────────────────────────────────── Následky

/** Jak velká část z toho byla — „každý třetí" řekne víc než holé číslo. */
function sharePhrase(ratio: number): string | null {
  if (ratio >= 0.5) return 'víc než polovina';
  if (ratio >= 0.3) return 'každý třetí';
  if (ratio >= 0.22) return 'každý čtvrtý';
  if (ratio >= 0.17) return 'každý pátý';
  if (ratio >= 0.09) return 'desetina';
  return null;
}

/**
 * Věta o mrtvých. Sloveso se shoduje s počtem — „zemřel jeden člověk",
 * „zemřeli tři lidé", „zemřelo 340 lidí".
 */
export function tollClause(toll: Toll | undefined, verb: 'zemřít' | 'padnout' = 'zemřít'): string | null {
  if (!toll || toll.deaths < 1) return null;
  const n = Math.round(toll.deaths);
  const share = toll.before > 0 ? sharePhrase(toll.deaths / toll.before) : null;
  const tail = share ? `, ${share}` : '';

  const forms = verb === 'padnout'
    ? ['Padl jeden člověk', 'Padli', 'Padlo']
    : ['Zemřel jeden člověk', 'Zemřeli', 'Zemřelo'];

  if (n === 1) return `${forms[0]}${tail}.`;
  if (n <= 4) return `${forms[1]} ${n} lidé${tail}.`;
  return `${forms[2]} ${num(n)} lidí${tail}.`;
}

// ─────────────────────────────────────────── Milníky

/**
 * Věta o milníku.
 *
 * Všechny varianty drží název milníku v 1. pádě za dvojtečkou a shodu věší
 * na slovo „milník" nebo „objev". Kdyby název stál jako předmět, čeština by
 * chtěla akuzativ — a „zvládli filosofie" místo „filosofii" je přesně ta
 * chyba, kterou tímhle obcházíme, aniž bychom u sta názvů evidovali rod.
 */
export function milestoneSentence(
  rng: Rng,
  faction: Declined,
  name: string,
  because: string,
  blurb: string,
  actor: Figure | null,
  nthInEra: number,
): string {
  const opening = rng.pick([
    `${faction.nom} dosáhli milníku: ${name} — ${because}. ${blurb}`,
    `Nový milník u ${faction.gen}: ${name} — ${because}. ${blurb}`,
    `U ${faction.gen} se prosadil objev: ${name} — ${because}. ${blurb}`,
    `${faction.dat} se podařil milník: ${name} — ${because}. ${blurb}`,
  ]);

  const clauses = [opening];

  if (actor) {
    clauses.push(
      rng.pick([
        `Připisuje se to ${actor.name.dat}.`,
        `Vděčí za to ${actor.name.dat}.`,
        `Jméno, které si u toho zapamatovali: ${actor.given.nom}.`,
      ]),
    );
  }

  // Zmínka o pořadí v epoše dává objevu měřítko, ale u každého druhého
  // zápisu by zevšedněla.
  if (nthInEra >= 8 && rng.chance(0.18)) {
    clauses.push(`V téhle epoše už ${nthInEra}. objev.`);
  }

  return clauses.join(' ');
}

// ─────────────────────────────────────────── Pohromy

/**
 * Co na té ráně bylo výjimečné. Nejsilnější sdělení vyhrává — vršit „poprvé"
 * a zároveň „nejhorší" by znělo jako výčet, ne jako kronika.
 *
 * Označení pohromy se do věty nikdy nedostane jako podmět: `label` má napříč
 * druhy všechny tři rody („povodeň", „mor", „sucho") a shoda by se rozpadla.
 */
export function disasterMemoryClause(rng: Rng, memo: DisasterMemo): string | null {
  if (memo.worstEver) {
    return rng.pick([
      'Horší ránu dějiny nepamatovaly.',
      'Nic zlejšího je do té doby nepotkalo.',
    ]);
  }
  if (memo.nth === 1) {
    return rng.pick([
      'Nic takového nikdo nepamatoval.',
      'V paměti civilizace to nemělo obdobu.',
      'Nestalo se to nikdy předtím a nikdo nevěděl, co si o tom myslet.',
    ]);
  }
  if (memo.worstOfKind) return 'Ze všech, které pamatovali, byla tahle nejhorší.';

  // Pořadí má smysl, jen dokud se dá spočítat na prstech. „Už 212×" nikomu
  // nic neřekne a v pozdních epochách by to stálo u každého druhého zápisu.
  if (memo.nth <= 6 && memo.sinceYears !== null) {
    return `${capitalize(nthTime(memo.nth))} za ${yearsPhrase(memo.sinceYears)}.`;
  }

  // Dlouhá odmlka je naopak zpráva i po dvoustém opakování.
  if (memo.sinceYears !== null && memo.sinceYears >= 250 && rng.chance(0.55)) {
    return `Naposledy něco takového přišlo ${yearsAgoPhrase(memo.sinceYears)}.`;
  }

  return null;
}

export function disasterSentence(rng: Rng, line: string, memo: DisasterMemo, toll: Toll): string {
  const clauses = [line];
  const memory = disasterMemoryClause(rng, memo);
  if (memory) clauses.push(memory);
  const deaths = tollClause(toll);
  if (deaths) clauses.push(deaths);
  return clauses.join(' ');
}

/** Zánik osady je vlastní zápis — o zkáze samotné mluví událost pohromy. */
export function settlementLostSentence(name: string, nth: number): string {
  if (nth <= 1) return `Osada ${name} zanikla — první, o kterou civilizace přišla.`;
  return `Osada ${name} zanikla. Byla to ${nth}. osada, o kterou civilizace přišla.`;
}

/**
 * Kolaps. Kolikátý je, mění jeho vyznění: první přetržení nitě je šok,
 * páté je způsob, jakým tahle civilizace žije.
 */
export function collapseSentence(names: readonly string[], nth: number): string {
  const opening =
    nth === 1
      ? 'Propad byl tak prudký, že se přetrhlo předávání znalostí.'
      : `${capitalize(nthTime(nth))} se přetrhlo předávání znalostí.`;
  const clauses = [`${opening} Zapomnělo se: ${names.join(', ')}.`];
  if (nth >= 3) clauses.push('Zapomínání se pro ně stalo součástí dějin, ne výjimkou.');
  return clauses.join(' ');
}

// ─────────────────────────────────────────── Války

export function warSentence(
  rng: Rng,
  a: Declined,
  b: Declined,
  winner: Declined,
  loser: Declined,
  seized: number,
  memo: WarMemo,
  toll: Toll,
  actor: Figure | null,
): string {
  const clauses = [
    `Válka mezi ${a.ins} a ${b.ins} skončila po letech vyčerpáním.`,
    `${winner.nom} si podrobili ${settlementsPhrase(seized)} ${loser.gen}.`,
  ];

  if (memo.nth === 1) {
    clauses.push('Byla to první válka, kterou kdy vedli.');
  } else if (memo.brokeLongestPeace && memo.peaceYears !== null) {
    clauses.push(`Skončil jí nejdelší mír v jejich dějinách — ${yearsPhrase(memo.peaceYears)}.`);
  } else if (memo.peaceYears !== null && memo.peaceYears > 40) {
    clauses.push(`Předcházelo jí ${yearsPhrase(memo.peaceYears)} klidu.`);
  }

  const deaths = tollClause(toll, 'padnout');
  if (deaths) clauses.push(deaths);
  if (actor) clauses.push(`Vojsko vedl${actor.gender === 'f' ? 'a' : ''} ${actor.name.nom}.`);

  return clauses.join(' ');
}

// ─────────────────────────────────────────── Klima

export function iceAgeSentence(rng: Rng, line: string, onset: boolean, nth: number): string {
  // V paleolitu se glaciály střídají desetkrát za epochu a pořadí je to
  // jediné, co je od sebe odliší.
  if (onset && nth >= 2 && rng.chance(0.6)) {
    return `${line} ${capitalize(nthTime(nth))}, co led přišel.`;
  }
  return line;
}

// ─────────────────────────────────────────── Nekrolog

/** „mu" / „jí" — do vazby „připisuje se mu". */
const dativePronoun = (f: Figure) => (f.gender === 'f' ? 'jí' : 'mu');
const possessive = (f: Figure) => (f.gender === 'f' ? 'jejího' : 'jeho');
/** Minulý čas: ženský rod přibírá -a. Platí pro všechna česká l-příčestí. */
const fem = (f: Figure) => (f.gender === 'f' ? 'a' : '');

export function necrology(rng: Rng, figure: Figure, faction: Declined | null): string {
  const age = Math.max(1, Math.round((figure.diedYear ?? 0) - figure.bornYear));
  const them = figure.gender === 'f' ? 'jí' : 'mu';
  const clauses = [
    rng.pick([
      `Zemřel${fem(figure)} ${figure.name.nom} ve věku ${num(age)} let.`,
      `Ve věku ${num(age)} let zemřel${fem(figure)} ${figure.name.nom}.`,
      // Jméno začíná funkcí, která je malým písmenem — na začátku věty se musí zvětšit.
      `${capitalize(figure.name.nom)} se dalšího jara nedožil${fem(figure)}; bylo ${them} ${num(age)} let.`,
    ]),
  ];

  const milestones = figure.deeds.filter((d) => d.kind === 'milestone').map((d) => d.what);
  const won = figure.deeds.filter((d) => d.kind === 'war_won').length;
  const lost = figure.deeds.filter((d) => d.kind === 'war_lost').length;
  const schisms = figure.deeds.filter((d) => d.kind === 'schism').length;
  const founded = figure.deeds.filter((d) => d.kind === 'settlement').length;

  if (milestones.length === 1) {
    clauses.push(`Připisuje se ${dativePronoun(figure)} objev: ${milestones[0]}.`);
  } else if (milestones.length > 1) {
    clauses.push(`Připisují se ${dativePronoun(figure)} objevy: ${milestones.join(', ')}.`);
  }

  if (won > 0 && lost > 0) {
    clauses.push(`Vyhrál${fem(figure)} ${warsPhrase(won)} a ${warsPhrase(lost)} prohrál${fem(figure)}.`);
  } else if (won > 0) {
    clauses.push(`Vyhrál${fem(figure)} ${warsPhrase(won)}.`);
  } else if (lost > 0) {
    clauses.push(`Prohrál${fem(figure)} ${warsPhrase(lost)}.`);
  }

  // Osady stojí v akuzativu po „založili" — v podmětu by si počet vynutil
  // shodu se slovesem a „přibyla jednu osadu" je přesně ta chyba.
  if (founded > 0) {
    clauses.push(
      rng.pick([
        `Za ${possessive(figure)} života založili ${settlementsPhrase(founded)}.`,
        `Pod ${figure.gender === 'f' ? 'jejím' : 'jeho'} jménem stojí ${settlementsNom(founded)}.`,
      ]),
    );
  }
  if (schisms > 0) clauses.push(`Společenství se za ${possessive(figure)} vedení rozpadlo.`);

  // Uzavírací věta jen občas — u každého nekrologu by z ní byl refrén.
  if (faction && rng.chance(0.3)) {
    clauses.push(
      rng.pick([
        `Kronika ${faction.gen} tím ztratila jméno, které v ní stálo celý život.`,
        `${faction.nom} si to jméno předávali ještě dlouho potom.`,
        `Nástupce nikdo nepamatoval tak dobře.`,
      ]),
    );
  }

  return clauses.join(' ');
}

// ─────────────────────────────────────────── Kapitola

/**
 * Ohlédnutí za epochou — jediný zápis, který nevzniká z jedné události,
 * ale z celého období. Tohle je přesně ta vrstva, kterou žádná šablona nad
 * jednotlivou událostí nedokáže: souvislost mezi věcmi, které se staly
 * stovky ticků od sebe.
 */
export function chapterText(era: Era, epochName: string, endYear: number, endPopulation: number): string {
  const years = Math.max(1, endYear - era.startYear);
  const clauses = [`Konec epochy: ${epochName}. Trvala ${yearsPhrase(years)}.`];

  const gained = era.milestones.length;
  if (gained > 0) clauses.push(`Civilizace za tu dobu zvládla ${milestonesPhrase(gained)}.`);

  const from = Math.round(era.startPopulation);
  const to = Math.round(endPopulation);
  if (from > 0 && to > from * 1.15) {
    clauses.push(`Rozrostla se z ${num(from)} na ${num(to)} lidí.`);
  } else if (from > 0 && to < from * 0.85) {
    clauses.push(`Smrskla se z ${num(from)} na ${num(to)} lidí.`);
  } else {
    clauses.push(`Zůstalo jich zhruba tolik, kolik jich bylo na začátku — ${num(to)}.`);
  }

  if (era.wars > 0 || era.disasters > 0) {
    const parts: string[] = [];
    if (era.wars > 0) parts.push(warsPhrase(era.wars));
    if (era.disasters > 0) parts.push(disastersPhrase(era.disasters));
    const cost = era.deaths >= 1 ? `, které stály ${num(era.deaths)} životů` : '';
    clauses.push(`Přežila ${parts.join(' a ')}${cost}.`);
  }

  if (era.lostMilestones > 0) {
    const again = era.lostMilestones === 1 ? 'ji' : 'je';
    clauses.push(`Přišla přitom o ${knowledgePhrase(era.lostMilestones)} a musela ${again} dohánět znovu.`);
  }

  if (era.figures.length > 0) {
    clauses.push(`Z těch, kdo tu dobu nesli, odešli: ${era.figures.join(', ')}.`);
  }

  return clauses.join(' ');
}
