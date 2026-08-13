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
  | 'figure_death'
  | 'chapter'
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
 * Snímek okamžiku, ve kterém událost nastala.
 *
 * Bez něj je každý zápis osamocený a stejná povodeň zní stejně pro tlupu
 * o čtyřiceti lidech i pro říši. Nese se u události proto, že později už se
 * nedá zrekonstruovat — svět se mezitím pohnul dál.
 */
export interface EventContext {
  epoch: number;
  population: number;
  settlements: number;
  factions: number;
  /** Nejsilnější tlak v tu chvíli, nebo null, když žádný nevyčnívá. */
  pressure: PressureId | null;
}

/** Kolik to stálo lidí. Engine to počítal odjakživa, jen to zahazoval. */
export interface Toll {
  before: number;
  after: number;
  deaths: number;
}

/**
 * Jedna položka kroniky. `data` je strukturovaná pravda, `text` je vyprávění.
 * Pozdější LLM vrstva přepíše jen `text` — engine se nemění.
 */
export interface WorldEvent {
  /** Pořadí civilizace, ve které se to stalo — kronika se podle něj rotuje. */
  run: number;
  tick: number;
  year: number;
  kind: EventKind;
  /** Váha 0–1 pro filtrování ve feedu a velikost korálku na spirále. */
  weight: number;
  text: string;
  context: EventContext;
  /** Jen u událostí, které někoho stály život. */
  toll?: Toll;
  data: Record<string, unknown>;
}

// ─────────────────────────────────────────── Pojmenovaní aktéři

export type FigureRole = 'chieftain' | 'scholar' | 'general' | 'seer' | 'builder';

/** Co po sobě člověk zanechal. Z těchhle položek se skládá nekrolog. */
export interface FigureDeed {
  kind: 'milestone' | 'war_won' | 'war_lost' | 'schism' | 'settlement';
  /** Čitelný název — milník, osada, protivník. */
  what: string;
  year: number;
}

/**
 * Jeden člověk, kterého si dějiny zapamatovaly.
 *
 * Jména se objevují až od doby bronzové, a ne z rozmaru: v paleolitu pokrývá
 * jeden tick čtyři tisíciletí, takže by se jednotlivec nedožil ani setiny
 * ticku. Teprve když lidský život zabere aspoň několik ticků, má smysl ho
 * sledovat — a je to zároveň doba, kdy se první jména objevují i ve
 * skutečných záznamech.
 */
export interface Figure {
  id: string;
  /** Celé jméno i s funkcí a přídomkem: „náčelník Karnath Tichý". */
  name: Declined;
  /** Samotné rodné jméno — pro opakované zmínky, kde by funkce překážela. */
  given: Declined;
  gender: 'm' | 'f';
  role: FigureRole;
  factionId: string;
  bornYear: number;
  /** Kolika let se dožije. */
  lifespan: number;
  /** Rok úmrtí; dokud žije, null. */
  diedYear: number | null;
  deeds: FigureDeed[];
}

// ─────────────────────────────────────────── Historická paměť

/** Bez počítadel nejde napsat „potřetí za dvě století". */
export interface DisasterRecord {
  count: number;
  lastYear: number;
  /**
   * Nejhorší dosavadní zásah — jako PODÍL zasažené osady, ne jako počet mrtvých.
   * Populace roste exponenciálně, takže v absolutních číslech je skoro každá
   * další rána „nejhorší v dějinách" a to slovo ztratí význam.
   */
  worstShare: number;
}

export interface Memory {
  disasters: Record<string, DisasterRecord>;
  iceAges: number;
  wars: number;
  schisms: number;
  collapses: number;
  settlementsFounded: number;
  settlementsLost: number;
  /** Rok konce poslední války — mír se měří od něj. */
  lastWarYear: number | null;
  /** Nejdelší mír v dějinách, v letech. */
  longestPeace: number;
  /** Nejhorší jednorázový zásah v dějinách, jako podíl zasažené osady. */
  worstShare: number;
  totalDeaths: number;
}

/**
 * Rozepsaná kapitola. Sbírá se celou epochu a uzavře se na jejím konci —
 * teprve tehdy se dá o období napsat něco, co jednotlivé zápisy neunesou.
 */
export interface Era {
  epoch: number;
  startTick: number;
  startYear: number;
  startPopulation: number;
  milestones: string[];
  lostMilestones: number;
  wars: number;
  disasters: number;
  deaths: number;
  settlementsFounded: number;
  settlementsLost: number;
  /** Jména těch, kdo v epoše zemřeli a stálo to za zápis. */
  figures: string[];
}

// ─────────────────────────────────────────── Svět

export interface Climate {
  /** Odchylka od optima ve stupních. Záporná = ledová doba. */
  temperature: number;
  aridity: number;
  seaLevel: number;
  iceCoverage: number;
  /**
   * Oteplení způsobené vlastním průmyslem, ve stupních. Načítá se, dokud
   * civilizace pálí a nemá čím to nahradit — a přičítá se k přirozené teplotě.
   */
  industrialWarming: number;
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
  /** Milníky ztracené při kolapsu a dosud neobjevené znovu. */
  lost: string[];
  /**
   * Kolik znalostí se za celou historii ztratilo — včetně těch, které se
   * pak podařilo objevit znovu. `lost` samo je momentka, ne dějiny.
   */
  everLost: number;
}

export type EndingKind = 'extinction' | 'stagnation' | 'self_destruction' | 'transcendence';

/** Jak přesně to skončilo — pro archiv a pro kroniku. */
export type EndingCause =
  | 'collapse'
  | 'quiet'
  | 'nuclear_war'
  | 'grey_goo'
  | 'climate_collapse'
  | 'ascension';

/** Zápis o zaniklé civilizaci. Zůstane v archivu, až ji vystřídá další. */
export interface RunSummary {
  run: number;
  seed: number;
  planet: string;
  ending: EndingKind;
  cause: EndingCause;
  ticks: number;
  years: number;
  epoch: number;
  peakPopulation: number;
  milestonesUnlocked: number;
  /** Kolik znalostí civilizace za celou historii ztratila, i když je pak dohnala. */
  milestonesLost: number;
  factionsEver: number;
  firstFaction: string;
  lastFaction: string;
}

export interface World {
  seed: number;
  /** Pořadí civilizace. Když jedna zanikne, na nové planetě začíná další. */
  run: number;
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
  /** Živí i nedávno zesnulí. Starší se prořezávají, aby stav nerostl donekonečna. */
  figures: Figure[];
  memory: Memory;
  era: Era;
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
  ending: { kind: EndingKind; cause: EndingCause; tick: number; year: number } | null;
  /** Nejvyšší dosažená populace — pro archiv. */
  peakPopulation: number;
  /** Jméno zakládající frakce. Může zaniknout, ale do archivu patří. */
  firstFactionName: string;
  /** Počítadla pro generování stabilních ID. */
  nextIds: { faction: number; settlement: number; figure: number };
}

/** Výsledek jednoho ticku: nový svět + co se v něm stalo. */
export interface TickResult {
  world: World;
  events: WorldEvent[];
}
