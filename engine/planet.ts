/**
 * Generátor planety.
 *
 * Planeta je zadání, ne kulisa. Její parametry vstupují do cen milníků
 * a do frekvence katastrof, takže alternativní dějiny nevznikají scénářem,
 * ale tím, že na světě bez uhlí je parní stroj neúnosně drahý a civilizace
 * dojde k elektřině dřív než k průmyslu.
 */

import { Rng, STREAM, rngFor } from './rng.js';
import { planetName } from './names.js';
import type { Biome, OreId, Planet } from './types.js';

export const ORE_IDS: readonly OreId[] = [
  'copper',
  'tin',
  'iron',
  'coal',
  'oil',
  'uranium',
  'rare',
  'gold',
];

/**
 * Dostupnost jedné rudy. Většinou průměr, ale s ~14% pravděpodobností
 * je surovina prakticky nedostupná — právě ty světy jsou zajímavé.
 */
function rollOre(rng: Rng): number {
  if (rng.chance(0.14)) return rng.range(0, 0.12);
  return Math.max(0.15, Math.min(2, rng.gauss(0.95, 0.42)));
}

export function generatePlanet(seed: number): Planet {
  const rng = rngFor(seed, 0, STREAM.planet);

  const ores = {} as Record<OreId, number>;
  for (const id of ORE_IDS) ores[id] = rollOre(rng);

  return {
    name: planetName(rng),
    gravity: Math.max(0.45, Math.min(1.9, rng.gauss(1, 0.24))),
    dayHours: Math.max(6, Math.min(60, rng.gauss(24, 9))),
    yearDays: Math.max(90, Math.min(900, rng.gauss(365, 140))),
    axialTilt: Math.max(0, Math.min(52, rng.gauss(23, 12))),
    atmosphereDensity: Math.max(0.3, Math.min(2.6, rng.gauss(1, 0.32))),
    oxygen: Math.max(0.12, Math.min(0.38, rng.gauss(0.21, 0.045))),
    greenhouse: Math.max(0, Math.min(1, rng.gauss(0.42, 0.2))),
    tectonics: rng.next(),
    volcanism: rng.next(),
    hydrology: Math.max(0.08, Math.min(0.95, rng.gauss(0.5, 0.22))),
    ores,
    magneticField: rng.next(),
    stellarFlareRate: Math.max(0, rng.gauss(1.2, 1.1)),
    moons: rng.chance(0.18) ? 0 : 1 + rng.int(3),
    biosphere: {
      megafauna: rng.next(),
      plantYield: Math.max(0.25, Math.min(1.9, rng.gauss(1, 0.3))),
      pathogenLoad: rng.next(),
    },
  };
}

/** Základní únosná kapacita jednoho sídla před započtením technologií. */
export function baseCapacity(planet: Planet): number {
  const water = 0.5 + planet.hydrology;
  const soil = 0.7 + planet.volcanism * 0.5; // sopečný popel je úrodný
  const air = Math.min(1.3, planet.oxygen / 0.21);
  return 220 * planet.biosphere.plantYield * water * soil * air;
}

// ─────────────────────────────────────────── Geografie kruhové mapy

/**
 * Svět se zobrazuje jako kruh (Lambertova azimutální projekce se stejnou
 * plochou). Střed je severní pól, okraj jižní, rovník leží na r ≈ 0.707.
 * Plocha na disku odpovídá ploše na kouli, takže rozložení sídel není zkreslené.
 */
export function latitudeAt(r: number): number {
  const clamped = Math.max(0, Math.min(1, r));
  const colatitude = Math.acos(1 - 2 * clamped * clamped);
  return 90 - (colatitude * 180) / Math.PI;
}

/** Rovnoměrné rozdělení bodů po povrchu koule → rovnoměrné po ploše disku. */
export function randomPosition(rng: Rng): { r: number; theta: number } {
  return { r: Math.sqrt(rng.next()), theta: rng.next() * Math.PI * 2 };
}

/**
 * Biom z polohy, planety a aktuálního klimatu. `temperature` je odchylka
 * od optima ve stupních — v ledové době posouvá pásma k rovníku.
 */
export function biomeAt(
  planet: Planet,
  r: number,
  theta: number,
  temperature: number,
  aridity: number,
): Biome {
  const absLat = Math.abs(latitudeAt(r));
  // Sklon osy zmírňuje nebo zostřuje rozdíl mezi pólem a rovníkem.
  const tiltFactor = 0.6 + planet.axialTilt / 46;
  const effectiveLat = absLat * tiltFactor - temperature * 2.5;

  // Kontinentalita: jednoduchá deterministická vlna podél zeměpisné délky.
  const wave = Math.sin(theta * 3 + r * 5) * 0.5 + Math.sin(theta * 7) * 0.25;
  const dryness = aridity + wave * 0.35 - planet.hydrology * 0.4;
  const coastal = Math.abs(wave) < 0.12 && planet.hydrology > 0.25;

  if (coastal) return 'coast';
  if (effectiveLat > 66) return 'tundra';
  if (effectiveLat > 50) return dryness > 0.35 ? 'tundra' : 'taiga';
  if (r < 0.25 || wave > 0.6) return 'highland';
  if (effectiveLat < 22) {
    if (dryness > 0.4) return 'desert';
    return planet.biosphere.plantYield > 0.9 ? 'jungle' : 'grassland';
  }
  if (dryness > 0.45) return 'desert';
  return dryness > 0.05 ? 'grassland' : 'forest';
}

/** Násobek úživnosti biomu. */
export const BIOME_YIELD: Record<Biome, number> = {
  tundra: 0.3,
  taiga: 0.55,
  grassland: 1.15,
  forest: 0.95,
  jungle: 0.85,
  desert: 0.25,
  coast: 1.25,
  highland: 0.6,
};

export const BIOME_LABEL: Record<Biome, string> = {
  tundra: 'tundra',
  taiga: 'tajga',
  grassland: 'step',
  forest: 'les',
  jungle: 'prales',
  desert: 'poušť',
  coast: 'pobřeží',
  highland: 'vysočina',
};

// ─────────────────────────────────────────── Popis pro kroniku a UI

/** Co daný parametr znamená pro civilizaci. Bez toho jsou to jen čísla. */
export function planetNotes(planet: Planet): string[] {
  const notes: string[] = [];

  if (planet.gravity > 1.3) notes.push('Těžká gravitace — létání a orbita budou draho vykoupené.');
  else if (planet.gravity < 0.75) notes.push('Nízká gravitace — cesta k nebi bude nezvykle snadná.');

  if (planet.ores.coal < 0.2) notes.push('Prakticky bez uhlí — průmysl bude muset najít jinou cestu.');
  if (planet.ores.iron < 0.2) notes.push('Chudé na železo — doba železná možná nikdy nepřijde.');
  if (planet.ores.tin < 0.2 && planet.ores.copper > 0.5)
    notes.push('Měď bez cínu — bronz zůstane vzácností.');
  if (planet.ores.uranium < 0.15) notes.push('Bez uranu — atomová éra je uzavřená.');

  if (planet.volcanism > 0.7)
    notes.push('Bouřlivý vulkanismus — časté zkázy, ale úrodná půda a snadné geotermální teplo.');
  if (planet.tectonics > 0.7) notes.push('Neklidná kůra — zemětřesení budou pravidelným hostem.');

  if (planet.magneticField < 0.3 && planet.stellarFlareRate > 1.5)
    notes.push('Slabé magnetické pole a dráždivá hvězda — elektronika zde bude křehká věc.');

  if (planet.hydrology < 0.25) notes.push('Suchý svět — zavlažování rozhodne o všem.');
  else if (planet.hydrology > 0.75) notes.push('Vodnatý svět — plavba přijde dřív než kolo.');

  if (planet.axialTilt > 38) notes.push('Prudký sklon osy — roční období na hranici snesitelnosti.');
  else if (planet.axialTilt < 8) notes.push('Osa téměř kolmá — roční období skoro neexistují.');

  if (planet.biosphere.pathogenLoad > 0.75) notes.push('Bohatá mikrobiální sféra — nemoci budou stálou daní.');
  if (planet.biosphere.megafauna > 0.75) notes.push('Hojná megafauna — lov uživí i velké tlupy.');
  if (planet.biosphere.plantYield < 0.6) notes.push('Skoupá vegetace — hlad bude věčným tématem.');

  if (planet.moons === 0) notes.push('Bez měsíce — bez přílivu a bez prvního nebeského kalendáře.');

  return notes;
}
