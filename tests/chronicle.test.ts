/**
 * Kronika musí být gramaticky správná a fakticky podložená.
 *
 * Jména lidí se skloňují strojově, takže generátor musí držet svá omezení —
 * jediné jméno končící vokálem by vyrobilo tvar, který v češtině neexistuje.
 * A žádná věta nesmí tvrdit víc, než co engine skutečně spočítal.
 */

import { describe, expect, it } from 'vitest';
import { simulate } from '../engine/tick.js';
import { createWorld } from '../engine/world.js';
import { makeLanguage, personName } from '../engine/names.js';
import { rememberDisaster, rememberWar } from '../engine/memory.js';
import { FIGURE_MIN_EPOCH } from '../engine/figures.js';
import { STREAM, rngFor } from '../engine/rng.js';
import {
  milestonesPhrase,
  settlementsNom,
  settlementsPhrase,
  yearsAgoPhrase,
  yearsPhrase,
} from '../engine/narrate.js';

describe('skloňování jmen lidí', () => {
  it('mužská jména končí souhláskou a skloňují se jako „pán"', () => {
    const lang = makeLanguage(rngFor(1, 0, STREAM.names));

    for (let i = 0; i < 300; i++) {
      const { given } = personName(rngFor(i, 0, STREAM.figures), lang, 'm', 'scholar', new Set());
      // Jméno na samohlásku by celý mechanický vzor rozbilo.
      expect(given.nom).toMatch(/[^aeiouyáéíóúýěů]$/i);
      expect(given.gen).toBe(`${given.nom}a`);
      expect(given.acc).toBe(`${given.nom}a`);
      expect(given.dat).toBe(`${given.nom}ovi`);
      expect(given.ins).toBe(`${given.nom}em`);
    }
  });

  it('ženská jména končí na -a a měkčí jednoznačně', () => {
    const lang = makeLanguage(rngFor(2, 0, STREAM.names));

    for (let i = 0; i < 300; i++) {
      const { given } = personName(rngFor(i, 0, STREAM.figures), lang, 'f', 'seer', new Set());
      expect(given.nom).toMatch(/a$/);
      expect(given.gen).toMatch(/y$/);
      expect(given.acc).toMatch(/u$/);
      expect(given.ins).toMatch(/ou$/);
      // 3. a 6. pád jsou u vzoru „žena" totožné.
      expect(given.dat).toBe(given.loc);
      // Zakončení, u kterých je měkčení nejednoznačné, generátor nesmí vyrobit.
      expect(given.nom).not.toMatch(/[kghr]a$/);
    }
  });

  it('celé jméno nese funkci i přídomek a mění se ve všech pádech', () => {
    const lang = makeLanguage(rngFor(5, 0, STREAM.names));
    const { name } = personName(rngFor(9, 0, STREAM.figures), lang, 'f', 'general', new Set());

    expect(name.nom.startsWith('vojevůdkyně ')).toBe(true);
    expect(name.dat.startsWith('vojevůdkyni ')).toBe(true);
    expect(new Set([name.nom, name.gen, name.dat, name.acc, name.loc, name.ins]).size).toBeGreaterThan(2);
  });
});

describe('české počítané tvary', () => {
  it('jednička, dvojka až čtyřka a pětka mají různé tvary', () => {
    expect(milestonesPhrase(1)).toBe('jeden milník');
    expect(milestonesPhrase(3)).toBe('3 milníky');
    expect(milestonesPhrase(9)).toBe('9 milníků');

    // Podmět a předmět se u jedničky liší — „stojí jedna osada" vs „vzali jednu osadu".
    expect(settlementsNom(1)).toBe('jedna osada');
    expect(settlementsPhrase(1)).toBe('jednu osadu');

    expect(yearsPhrase(1)).toBe('rok');
    expect(yearsPhrase(3)).toBe('3 roky');
    expect(yearsPhrase(340)).toBe('340 let');
    // Po předložce „před" si čeština žádá 7. pád.
    expect(yearsAgoPhrase(340)).toBe('před 340 lety');
    expect(yearsAgoPhrase(1)).toBe('před rokem');
  });

  it('tisíce se oddělují bez ohledu na národní nastavení běhového prostředí', () => {
    // Kdyby se sáhlo po toLocaleString, server a prohlížeč by mohly oddělit
    // jinak — a text událostí se mezi nimi porovnává.
    expect(yearsPhrase(12_345_000)).not.toMatch(/,/);
    expect(yearsPhrase(4012)).toBe('4 012 let');
  });
});

describe('historická paměť', () => {
  it('rekord se posuzuje podílem, ne počtem mrtvých', () => {
    // Populace roste přes několik řádů. V absolutních číslech by byla
    // „nejhorší v dějinách" skoro každá další rána.
    const world = createWorld(3);

    rememberDisaster(world, 'flood', 50, 0.5);
    const huge = rememberDisaster(world, 'flood', 5000, 0.01);
    expect(huge.worstOfKind).toBe(false);

    const record = rememberDisaster(world, 'flood', 60, 0.62);
    expect(record.worstOfKind).toBe(true);
    expect(world.memory.disasters.flood?.count).toBe(3);
  });

  it('drobný zásah se rekordem nestane, i když je největší dosud', () => {
    const world = createWorld(3);
    rememberDisaster(world, 'plague', 1, 0.01);
    const tiny = rememberDisaster(world, 'plague', 2, 0.03);
    expect(tiny.worstOfKind).toBe(false);
  });

  it('mír se měří od konce poslední války', () => {
    const world = createWorld(3);
    world.year = 100;
    expect(rememberWar(world).peaceYears).toBeNull();

    world.year = 400;
    const second = rememberWar(world);
    expect(second.nth).toBe(2);
    expect(second.peaceYears).toBe(300);
  });
});

describe('zápisy kroniky', () => {
  const run = simulate(createWorld(7), 900);

  it('každá událost nese snímek okamžiku', () => {
    expect(run.events.length).toBeGreaterThan(40);
    for (const e of run.events) {
      expect(e.context).toBeDefined();
      expect(e.context.epoch).toBeGreaterThanOrEqual(0);
      expect(e.context.population).toBeGreaterThanOrEqual(0);
      expect(e.context.settlements).toBeGreaterThanOrEqual(0);
    }
  });

  it('následky nese jen událost, která někoho stála život', () => {
    expect(run.events.some((e) => e.toll)).toBe(true);

    for (const e of run.events) {
      if (!e.toll) continue;
      expect(e.toll.deaths).toBeGreaterThanOrEqual(1);
      expect(e.toll.before).toBeGreaterThanOrEqual(e.toll.after);
    }

    // Objev nikoho nezabije.
    expect(run.events.filter((e) => e.kind === 'milestone').every((e) => !e.toll)).toBe(true);
  });

  it('žádný zápis nekončí uprostřed a nemá dvojité mezery', () => {
    for (const e of run.events) {
      expect(e.text.trim()).toBe(e.text);
      expect(e.text).not.toMatch(/ {2}/);
      expect(e.text).toMatch(/[.!?]$/);
    }
  });
});

describe('lidé a kapitoly', () => {
  it('jednotlivci se objevují až tam, kde se dožijí víc než jednoho ticku', () => {
    // V paleolitu pokrývá tick čtyři tisíciletí — jméno by bliklo jedinkrát.
    const early = simulate(createWorld(11), 400).world;
    expect(early.epoch).toBeLessThan(FIGURE_MIN_EPOCH);
    expect(early.figures.length).toBe(0);

    const later = simulate(createWorld(11), 1200).world;
    expect(later.epoch).toBeGreaterThanOrEqual(FIGURE_MIN_EPOCH);
    expect(later.figures.length).toBeGreaterThan(0);
  });

  it('nekrolog dostane jen ten, po kom něco zůstalo', () => {
    const { events } = simulate(createWorld(11), 1600);
    const deaths = events.filter((e) => e.kind === 'figure_death');

    expect(deaths.length).toBeGreaterThan(0);
    for (const e of deaths) {
      expect(e.data.deeds as number).toBeGreaterThanOrEqual(2);
      expect(e.text).toMatch(/^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/);
    }
  });

  it('konec epochy uzavře kapitolu, která shrne celé období', () => {
    const { events } = simulate(createWorld(11), 1600);
    const chapters = events.filter((e) => e.kind === 'chapter');

    expect(chapters.length).toBeGreaterThan(1);
    for (const c of chapters) {
      expect(c.text).toContain('Konec epochy:');
      expect(c.data.years as number).toBeGreaterThan(0);
      // Kapitola smí tvrdit jen to, co engine spočítal.
      expect(c.data.milestones as number).toBeGreaterThanOrEqual(0);
    }

    // Prázdná epocha kapitolu nedostane — shrnutí o tom, že se nic nestalo,
    // je horší než žádné.
    const epochs = events.filter((e) => e.kind === 'epoch' && !e.data.regression);
    expect(chapters.length).toBeLessThanOrEqual(epochs.length);
  });

  it('člověk drží jméno napříč událostmi, ne jen jednu zmínku', () => {
    const { events } = simulate(createWorld(11), 1600);
    const credited = events
      .filter((e) => e.kind === 'milestone' && e.data.figure)
      .map((e) => e.data.figure as string);

    // Kdyby ke každému objevu vznikl nový člověk, jména by ztratila smysl.
    expect(credited.length).toBeGreaterThan(new Set(credited).size);
  });
});
