/** Datový model světa. Vše je prostá serializovatelná data — žádné třídy, žádné odkazy. */

// ─────────────────────────────────────────── Čeština

/**
 * Skloňované jméno. Frakce se v kronice objevují ve všech pádech
 * („Strážci ohnišť objevili", „území Strážců ohnišť", „porazili Strážce ohnišť"),
 * takže si tvary neseme s sebou místo pokusů o skloňování za běhu.
 */
export interface Declined {
  nom: string; // 1. kdo/co
  gen: string; // 2. koho/čeho
  dat: string; // 3. komu/čemu
  acc: string; // 4. koho/co
  loc: string; // 6. o kom/čem
  ins: string; // 7. kým/čím
}

// ─────────────────────────────────────────── Planeta

export type OreId = 'copper' | 'tin' | 'iron' | 'coal' | 'oil' | 'uranium' | 'rare' | 'gold';

export type ResourceId =
  | OreId
  | 'food'
  | 'wood'
  | 'stone'
  | 'flint'
  | 'hide'
  | 'fiber'
  | 'clay'
  | 'salt'
  | 'obsidian'
  | 'horses';

/** Neměnné zadání světa. Vygeneruje se ze seedu při genesis a už se nikdy nezmění. */
export interface Planet {
  name: string;
  /** 0.5–1.9 pozemské g. Vysoká gravitace prodraží let a orbitu. */
  gravity: number;
  dayHours: number;
  yearDays: number;
  /** Sklon osy ve stupních — řídí ostrost ročních období. */
  axialTilt: number;
  atmosphereDensity: number;
  oxygen: number;
  greenhouse: number;
  /** 0–1. Tektonika a vulkanismus: katastrofy, ale i úrodná půda a geotermální energie. */
  tectonics: number;
  volcanism: number;
  /** 0–1. Podíl vody a hustota říční sítě. */
  hydrology: number;
  /** Multiplikátory dostupnosti 0–2. Nula znamená, že tudy cesta prostě nevede. */
  ores: Record<OreId, number>;
  /** 0–1. Slabé pole + aktivní hvězda = opakované vymazání elektroniky. */
  magneticField: number;
  /** Erupcí hvězdy za milion let. */
  stellarFlareRate: number;
  moons: number;
  biosphere: {
    megafauna: number;
    plantYield: number;
    pathogenLoad: number;
  };
}

// ─────────────────────────────────────────── Tlaky

/** Co civilizaci tlačí. Motor kauzality — určuje, který milník dostane pozornost. */
export interface Pressures {
  cold: number;
  hunger: number;
  disease: number;
  war: number;
  crowding: number;
  curiosity: number;
}

export type PressureId = keyof Pressures;

export const PRESSURE_IDS: readonly PressureId[] = [
  'cold',
  'hunger',
  'disease',
  'war',
  'crowding',
  'curiosity',
];

// ─────────────────────────────────────────── Milníky

export interface MilestoneUnlocks {
  /** Násobí únosnou kapacitu populace. */
  capacity?: number;
  /** Zpřístupní surovinu (např. Hutnictví zpřístupní měď). */
  resources?: ResourceId[];
  /** Trvale tlumí daný tlak. */
  relief?: Partial<Record<PressureId, number>>;
  /** Přičte se ke gramotnosti / specializaci / vojenské síle. */
  literacy?: number;
  specialization?: number;
  might?: number;
  /** Násobí celkový výzkumný výkon. */
  research?: number;
}

/** Podmínka nad planetou — umožňuje alternativní dějiny bez hardcodování. */
export interface CostMod {
  /** Popis do kroniky, proč to bylo dražší nebo levnější. */
  why: string;
  ore?: { id: OreId; below?: number; above?: number };
  planet?: { key: 'gravity' | 'tectonics' | 'volcanism' | 'hydrology' | 'magneticField' | 'atmosphereDensity' | 'oxygen'; below?: number; above?: number };
  mul: number;
}

export interface Milestone {
  id: string;
  name: string;
  epoch: number;
  /** Krátký popis do kroniky a do souhvězdí. */
  blurb: string;
  requires?: { all?: string[]; any?: string[] };
  /** Suroviny, bez kterých to nejde. Nízká dostupnost cenu prudce zvedne. */
  needsResources?: ResourceId[];
  needsPopulation?: number;
  needsLiteracy?: number;
  /** Základní cena v jednotkách poznání. */
  cost: number;
  costMods?: CostMod[];
  /** Jak silně milník odpovídá na daný tlak. Řídí pořadí objevů. */
  affinity?: Partial<Record<PressureId, number>>;
  unlocks?: MilestoneUnlocks;
  /** 0–1: jak snadno se ztratí při kolapsu. Ohně se nezapomene, kalkulu ano. */
  fragility: number;
}

// ─────────────────────────────────────────── Společnost

export interface Culture {
  aggression: number;
  curiosity: number;
  piety: number;
  mercantile: number;
  collectivism: number;
}

export interface Faction {
  id: string;
  name: Declined;
  culture: Culture;
  /** Barevný index do seedované palety. */
  hue: number;
  foundedTick: number;
  foundedYear: number;
  /** Z jaké frakce se odštěpila. */
  parentId: string | null;
  /** Rivalita vůči jiným frakcím, 0–1. Klíč je id frakce. */
  rivalry: Record<string, number>;
}

export interface Settlement {
  id: string;
  name: string;
  factionId: string;
  population: number;
  /** Pozice na kruhové mapě — polární souřadnice, r ∈ [0,1]. */
  r: number;
  theta: number;
  biome: Biome;
  foundedTick: number;
}

export type Biome =
  | 'tundra'
  | 'taiga'
  | 'grassland'
  | 'forest'
  | 'jungle'
  | 'desert'
  | 'coast'
  | 'highland';

// ─────────────────────────────────────────── Události

export type EventKind =
  | 'genesis'
  | 'milestone'
  | 'milestone_lost'
  | 'disaster'
  | 'disaster_aggregate'
  | 'epoch'
  | 'faction_split'
  | 'faction_end'
  | 'war'
  | 'settlement_founded'
  | 'settlement_lost'
  | 'climate'
  | 'population'
  | 'ending';

export type DisasterId =
  | 'volcano'
  | 'earthquake'
  | 'flood'
  | 'drought'
  | 'plague'
  | 'meteor'
  | 'flare'
  | 'ice_age'
  | 'famine';

/**
 * Jedna položka kroniky. `data` je strukturovaná pravda, `text` je vyprávění.
 * Pozdější LLM vrstva přepíše jen `text` — engine se nemění.
 */
export interface WorldEvent {
  tick: number;
  year: number;
  kind: EventKind;
  /** Váha 0–1 pro filtrování ve feedu a velikost korálku na spirále. */
  weight: number;
  text: string;
  data: Record<string, unknown>;
}

// ─────────────────────────────────────────── Svět

export interface Climate {
  /** Odchylka od optima ve stupních. Záporná = ledová doba. */
  temperature: number;
  aridity: number;
  seaLevel: number;
  iceCoverage: number;
  /** Probíhá doba ledová? Drží se se setrvačností, aby stav nekmital. */
  iceAge: boolean;
  /** Tick posledního klimatického zvratu — brání spamu v hlubokém čase. */
  lastShiftTick: number;
}

export interface TechState {
  /** id → kdy se odemklo. */
  unlocked: Record<string, { tick: number; year: number }>;
  /** id → nasbírané poznání. */
  progress: Record<string, number>;
  /** Milníky ztracené při kolapsu. */
  lost: string[];
}

export type EndingKind = 'extinction' | 'stagnation' | 'self_destruction' | 'transcendence';

export interface World {
  seed: number;
  tick: number;
  /** Uplynulé simulované roky od genesis. */
  year: number;
  /**
   * Rok, ve kterém civilizace vstoupila do neolitu — nula jejího vlastního
   * letopočtu. Do té doby null.
   *
   * Paleolit spolkne miliony let, takže absolutní stáří světa přestane být
   * čitelné hned, jak civilizace začne: „1,48 mil. let" vypadá stejně
   * v době bronzové jako o deset tisíc let později. Skutečné letopočty to
   * řeší stejně — počítají se od založení, ne od vzniku druhu.
   */
  foundingYear: number | null;
  epoch: number;
  planet: Planet;
  climate: Climate;
  factions: Faction[];
  settlements: Settlement[];
  tech: TechState;
  pressures: Pressures;
  stats: {
    population: number;
    literacy: number;
    specialization: number;
    might: number;
    /** Násobek základní únosné kapacity z technologií. */
    capacityMul: number;
    researchMul: number;
  };
  /** Dostupnost surovin 0–1, odvozená z planety a odemčených technologií. */
  access: Record<ResourceId, number>;
  /** Kolik ticků po sobě se neodemkl žádný milník — detekce stagnace. */
  idleTicks: number;
  /** Kolik ticků po sobě je civilizace na hraně přežití. Brání ukvapenému vyhynutí. */
  brinkTicks: number;
  ending: { kind: EndingKind; tick: number; year: number } | null;
  /** Počítadla pro generování stabilních ID. */
  nextIds: { faction: number; settlement: number };
}

/** Výsledek jednoho ticku: nový svět + co se v něm stalo. */
export interface TickResult {
  world: World;
  events: WorldEvent[];
}
