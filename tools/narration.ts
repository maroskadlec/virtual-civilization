/**
 * Smlouva o souboru `data/narration.json`.
 *
 * Vyprávěcí vrstva stojí **vedle** enginu, ne v něm. Engine je čistá funkce
 * seedu a ticku; text od modelu čistá funkce není a do stavu světa nesmí —
 * jinak by se checkpoint a dopočet klienta rozešly.
 *
 * Z toho plyne pravidlo, na kterém celá vrstva stojí: **model smí přidávat,
 * nikdy přepisovat.** Kdyby přepisoval zápisy kroniky, návštěvník by v 10:05
 * viděl jedno znění a v 10:35 jiné znění téže události, podle toho, jestli
 * mezitím doběhla Action. Nic → text je proti tomu neškodné.
 *
 * Soubor je proto klíčovaný slovník, do kterého se jen přidává. Co jednou
 * vznikne, se už nikdy negeneruje znovu — je to zároveň pojistka proti tomu,
 * aby chyba v kódu prohnala celý archiv modelem.
 *
 * Tenhle modul je schválně bez závislostí a bez vedlejších efektů: importuje
 * ho generátor v Node i klient v prohlížeči (ten jen typy).
 */

export const NARRATION_FORMAT_VERSION = 1;

export type NarrationKind = 'planet' | 'epitaph' | 'digest';

export interface NarrationEntry {
  kind: NarrationKind;
  /** Které civilizace se text týká. */
  run: number;
  text: string;
  /** Tick, ve kterém text vznikl — u shrnutí zároveň konec shrnovaného okna. */
  tick: number;
  model: string;
  createdAtMs: number;
}

export interface NarrationStore {
  version: number;
  entries: Record<string, NarrationEntry>;
}

export function emptyNarration(): NarrationStore {
  return { version: NARRATION_FORMAT_VERSION, entries: {} };
}

export const planetKey = (run: number): string => `planet:${run}`;
export const epitaphKey = (run: number): string => `epitaph:${run}`;
export const digestKey = (tick: number): string => `digest:${tick}`;

/**
 * Načte slovník z rozparsovaného JSONu. Cokoli neznámého se zahodí —
 * chybějící vyprávění je stav, se kterým web počítá, takže se nemá cenu
 * kvůli poškozenému souboru zastavovat.
 */
export function parseNarration(raw: unknown): NarrationStore {
  if (!raw || typeof raw !== 'object') return emptyNarration();
  const parsed = raw as Partial<NarrationStore>;
  if (!parsed.entries || typeof parsed.entries !== 'object') return emptyNarration();

  const entries: Record<string, NarrationEntry> = {};
  for (const [key, value] of Object.entries(parsed.entries)) {
    const e = value as Partial<NarrationEntry>;
    if (typeof e?.text === 'string' && e.text.length > 0 && typeof e.run === 'number') {
      entries[key] = {
        kind: (e.kind ?? 'digest') as NarrationKind,
        run: e.run,
        text: e.text,
        tick: e.tick ?? 0,
        model: e.model ?? 'neznámý',
        createdAtMs: e.createdAtMs ?? 0,
      };
    }
  }
  return { version: NARRATION_FORMAT_VERSION, entries };
}

/** Nejnovější shrnutí pro danou civilizaci, nebo null. */
export function latestDigest(store: NarrationStore, run: number): NarrationEntry | null {
  let best: NarrationEntry | null = null;
  for (const entry of Object.values(store.entries)) {
    if (entry.kind !== 'digest' || entry.run !== run) continue;
    if (!best || entry.tick > best.tick) best = entry;
  }
  return best;
}
