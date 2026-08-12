/**
 * Deterministický generátor náhody.
 *
 * Klíčová vlastnost: generátor se nikdy nepřenáší mezi ticky. Vytváří se vždy
 * čerstvý z čistých vstupů — `rngFor(seed, tick, stream)`. Díky tomu je
 * checkpoint jen holá data (nenese stav PRNG) a Monte Carlo větev pro predikce
 * je jen jiné `stream`.
 *
 * Každý subsystém má vlastní stream, aby přidání jednoho hodu v jednom
 * subsystému neposunulo výsledky ve všech ostatních.
 */

/** SplitMix32 finalizer — dobrá lavina i pro sousední vstupy. */
function mix(x: number): number {
  x |= 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
}

/** Zahashuje libovolný počet celých čísel do jednoho 32bit seedu. */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) h = mix(h ^ (p | 0));
  return h >>> 0;
}

/** Zahashuje řetězec (pro stabilní ID → seed, např. jméno milníku). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = mix(h ^ s.charCodeAt(i));
  return h >>> 0;
}

/** Oddělené proudy náhody. Nikdy neměň existující hodnoty — rozbije to historii. */
export const STREAM = {
  planet: 1,
  names: 2,
  research: 3,
  disaster: 4,
  population: 5,
  climate: 6,
  factions: 7,
  war: 8,
  settlement: 9,
  collapse: 10,
  flavor: 11,
  predict: 12,
} as const;

export type StreamId = (typeof STREAM)[keyof typeof STREAM];

export class Rng {
  private a: number;

  constructor(seed: number) {
    this.a = seed >>> 0;
  }

  /** [0, 1) */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Celé číslo v [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Float v [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Rng.pick: prázdné pole');
    return arr[this.int(arr.length)] as T;
  }

  /** Vybere podle vah. Váhy musí být nezáporné a alespoň jedna kladná. */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    let total = 0;
    for (const it of items) total += Math.max(0, weightOf(it));
    if (total <= 0) return this.pick(items);
    let roll = this.next() * total;
    for (const it of items) {
      roll -= Math.max(0, weightOf(it));
      if (roll <= 0) return it;
    }
    return items[items.length - 1] as T;
  }

  /** Fisher–Yates, vrací novou kopii. */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  /** Box–Muller. */
  gauss(mean = 0, sd = 1): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * Poissonovo rozdělení. Pro malá λ Knuth, pro velká normální aproximace —
   * v epoše 0 jeden tick pokrývá 4000 let, takže λ běžně vyjde ve stovkách.
   */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda < 30) {
      const limit = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= this.next();
      } while (p > limit);
      return k - 1;
    }
    return Math.max(0, Math.round(this.gauss(lambda, Math.sqrt(lambda))));
  }
}

/** Jediný správný způsob, jak v enginu získat náhodu. */
export function rngFor(worldSeed: number, tick: number, stream: number, salt = 0): Rng {
  return new Rng(hashSeed(worldSeed, tick, stream, salt));
}
