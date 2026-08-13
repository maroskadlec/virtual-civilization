/**
 * Pojmenovaní aktéři.
 *
 * Dokud je všechno kolektivní — „Strážci ohnišť zvládli" — nemají dějiny
 * měřítko, na které si člověk sáhne. Skutečné kroniky jsou plné jmen.
 *
 * Lidé tu ale nevznikají jako vlastní druh událostí; to by kroniku zahltilo.
 * Vznikají potichu ve chvíli, kdy je nějaká událost potřebuje, připisují se
 * jim objevy a války, a do kroniky se dostanou teprve svým nekrologem —
 * a jen tehdy, když po nich něco zůstalo.
 */

import { rngFor, STREAM, hashString } from './rng.js';
import type { Rng } from './rng.js';
import { personName } from './names.js';
import { languageOf, reliefFor } from './world.js';
import type { Figure, FigureDeed, FigureRole, World } from './types.js';

/**
 * Od které epochy má smysl sledovat jednotlivce.
 *
 * V paleolitu pokrývá jeden tick čtyři tisíciletí a v neolitu dvanáct let —
 * člověk by se nedožil ani čtyř ticků a jeho jméno by v kronice bliklo
 * jedinkrát, což je horší než žádné jméno. Od doby bronzové (čtyři roky na
 * tick) zabere život kolem deseti ticků a jméno se stihne vrátit. Shodou
 * okolností je to i doba, kdy se první jména objevují ve skutečných záznamech.
 */
export const FIGURE_MIN_EPOCH = 2;

/** Kolik lidí smí kronika sledovat naráz. Víc jmen než tohle si nikdo nespojí. */
const MAX_LIVING = 10;

/** Kolik jich zůstane ve stavu i po smrti — kvůli nekrologu a kapitolám. */
const MAX_KEPT = 26;

/** Kolik skutků si člověk odnese do nekrologu. */
const MAX_DEEDS = 8;

function lifespanFor(world: World, rng: Rng): number {
  // Délka života se odvozuje od úlevy od nemocí, ne od konkrétních milníků —
  // ta je už spočítaná a platí na každé cestě dějinami, i na té, která
  // medicínu objevila v jiném pořadí.
  //
  // Rozpětí je vysoké schválně: tohle nejsou průměrní lidé, ale ti, kdo se
  // dožili dospělosti a pak ještě dost dlouho na to, aby po nich něco zbylo.
  // Bonus je přesto střídmý — se štědřejším se v době železné běžně umíralo
  // ve stovce, což je nesmysl.
  return rng.range(50, 70) + reliefFor(world, 'disease') * 18;
}

function livingFigures(world: World): Figure[] {
  return world.figures.filter((f) => f.diedYear === null);
}

/**
 * Vrátí člověka, kterému se dá událost připsat — buď někoho, kdo už v kronice
 * je, nebo nového. Vracet přednostně žijícího je celý smysl věci: jméno musí
 * vydržet přes několik událostí, jinak si ho nikdo nezapamatuje.
 */
export function actorFor(
  world: World,
  factionId: string,
  role: FigureRole,
  salt: number,
): Figure | null {
  if (world.epoch < FIGURE_MIN_EPOCH || world.ending) return null;

  const existing = world.figures.find(
    (f) => f.diedYear === null && f.factionId === factionId && f.role === role,
  );
  if (existing) return existing;

  if (livingFigures(world).length >= MAX_LIVING) return null;

  const rng = rngFor(world.seed, world.tick, STREAM.figures, salt + hashString(factionId));
  const gender = rng.chance(0.42) ? 'f' : 'm';
  const used = new Set(world.figures.map((f) => f.given.nom));
  const { name, given } = personName(rng, languageOf(world, factionId), gender, role, used);

  const figure: Figure = {
    id: `p${world.nextIds.figure++}`,
    name,
    given,
    gender,
    role,
    factionId,
    // Do kroniky nevstupují jako děti — objeví se v ní dospělí.
    bornYear: world.year - rng.range(24, 34),
    lifespan: lifespanFor(world, rng),
    diedYear: null,
    deeds: [],
  };
  world.figures.push(figure);
  return figure;
}

export function recordDeed(figure: Figure | null, deed: FigureDeed): void {
  if (!figure) return;
  figure.deeds.push(deed);
  if (figure.deeds.length > MAX_DEEDS) figure.deeds.shift();
}

/**
 * Váha toho, co po člověku zbylo.
 *
 * Prosté počítání skutků nestačilo: zakládání osad je v pozdních epochách
 * skoro nepřetržité, takže každý náčelník posbíral dva zápisy jen tím, že
 * byl u toho — a kronika se zaplnila nekrology lidí, o kterých se nedalo
 * říct nic než „za jeho života přibyly dvě osady".
 */
const DEED_WEIGHT: Record<FigureDeed['kind'], number> = {
  milestone: 2,
  war_won: 2,
  war_lost: 2,
  schism: 2,
  settlement: 1,
};

const NOTABLE = 4;

function notability(figure: Figure): number {
  return figure.deeds.reduce((sum, d) => sum + DEED_WEIGHT[d.kind], 0);
}

/**
 * Zestárne živé a vrátí ty, kdo právě zemřeli a stojí za nekrolog.
 *
 * Za zápis stojí ten, po kom něco zůstalo. Kdo prožil život, aniž by se ho
 * dotkla jediná událost, projde kronikou beze jména — stejně jako všichni
 * ostatní, které si dějiny nezapamatovaly.
 */
export function ageFigures(world: World): Figure[] {
  if (world.figures.length === 0) return [];

  const alive = new Set(world.factions.map((f) => f.id));
  const departed: Figure[] = [];

  for (const f of world.figures) {
    if (f.diedYear !== null) continue;
    const outlived = world.year - f.bornYear >= f.lifespan;
    // Se zánikem frakce mizí i její lidé — ale bez nekrologu, protože
    // zpráva o konci společenství už v kronice stojí.
    const orphaned = !alive.has(f.factionId);
    if (!outlived && !orphaned) continue;

    f.diedYear = world.year;
    if (outlived && notability(f) >= NOTABLE) departed.push(f);
  }

  pruneFigures(world);
  return departed;
}

/** Mrtví se drží jen chvíli — stav světa nesmí růst donekonečna. */
function pruneFigures(world: World): void {
  if (world.figures.length <= MAX_KEPT) return;
  const living = world.figures.filter((f) => f.diedYear === null);
  const dead = world.figures.filter((f) => f.diedYear !== null);
  world.figures = [...living, ...dead.slice(-Math.max(0, MAX_KEPT - living.length))];
}
