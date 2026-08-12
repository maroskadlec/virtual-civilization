/**
 * Determinismus je nosná podmínka celé architektury: server commitne checkpoint
 * a klient si od něj dopočítá zbytek sám. Jakmile se ty dva výpočty rozejdou,
 * ukazuje web jinou civilizaci každému návštěvníkovi.
 *
 * Tyhle testy hlídají přesně to.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '../engine/world.js';
import { simulate, tickWorld } from '../engine/tick.js';
import { hashString } from '../engine/rng.js';
import type { World } from '../engine/types.js';

/** Kanonický zápis stavu — klíče seřazené, aby na pořadí vložení nezáleželo. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

function hashWorld(world: World): number {
  return hashString(canonical(world));
}

describe('determinismus', () => {
  it('dvě nezávislé simulace téhož seedu dají bit po bitu shodný stav', () => {
    const a = simulate(createWorld(12345), 1500);
    const b = simulate(createWorld(12345), 1500);

    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
    expect(a.events.length).toBe(b.events.length);
    expect(a.events.map((e) => e.text)).toEqual(b.events.map((e) => e.text));
  });

  it('různé seedy dají různé světy', () => {
    const a = simulate(createWorld(1), 600);
    const b = simulate(createWorld(2), 600);
    expect(hashWorld(a.world)).not.toBe(hashWorld(b.world));
  });

  /**
   * Tohle je ten test, na kterém stojí celé nasazení: klient načte checkpoint
   * z půlky cesty a dopočítá zbytek. Musí skončit tam, kde by skončil,
   * kdyby počítal celou dobu sám.
   */
  it('dopočítání z checkpointu vede ke stejnému stavu jako souvislý výpočet', () => {
    const straight = simulate(createWorld(777), 1200);

    const half = simulate(createWorld(777), 500);
    // Checkpoint projde serializací — přesně jako cesta přes data/world.json.
    const restored: World = JSON.parse(JSON.stringify(half.world));
    const rest = simulate(restored, 700);

    expect(hashWorld(rest.world)).toBe(hashWorld(straight.world));
    expect([...half.events, ...rest.events].map((e) => e.text)).toEqual(
      straight.events.map((e) => e.text),
    );
  });

  it('tick nemění svět, který dostal na vstupu', () => {
    const world = simulate(createWorld(99), 400).world;
    const before = hashWorld(world);
    tickWorld(world);
    expect(hashWorld(world)).toBe(before);
  });

  it('golden hash se nemění mezi běhy', () => {
    // Fixture zamyká chování enginu. Když padne, něco se v simulaci změnilo —
    // což je legitimní, ale musí to být vědomé rozhodnutí, ne překlep.
    const { world } = simulate(createWorld(42), 1000);
    expect(hashWorld(world)).toMatchSnapshot();
  });
});
