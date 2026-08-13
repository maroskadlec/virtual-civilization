/**
 * Jediné místo v celém projektu, které volá jazykový model.
 *
 * Běží v Action jako **samostatný krok za** `npm run sim`, ne uvnitř něj.
 * Kdyby byl součástí runneru, selhání modelu by shodilo zápis checkpointu —
 * a bez checkpointu se láme celé nasazení. Takhle se v nejhorším případě
 * jen nevygeneruje text a všechno ostatní běží dál.
 *
 * Tři věci, které model dělá, a proč zrovna ony:
 *
 * 1. **Čtení planety** — jednou za civilizaci. Planeta je neměnné zadání
 *    a její parametry jsou násobiče ceny objevů, takže se z nich dá dopředu
 *    říct, kudy dějiny nepůjdou. Bez toho se alternativní historie stane
 *    potichu: civilizace objeví elektřinu před průmyslem a nikdo nepozná,
 *    že to bylo tím chybějícím uhlím.
 * 2. **Epitaf** — jednou za zaniklou civilizaci. Nejbohatší vstup v projektu
 *    (stovky událostí za celý oblouk) a nejřidší událost (jednou za měsíce).
 * 3. **Denní shrnutí** — jednou za reálný den. Obsluhuje ten jediný způsob
 *    použití, kolem kterého je celý projekt postavený.
 *
 * Co model NEDĚLÁ: nepíše jednotlivé zápisy kroniky. Ty umí šablony nad
 * bohatými daty gramaticky zaručeně, deterministicky a zadarmo; model by
 * u nich přidal jen sloh a obětoval determinismus.
 *
 *   npm run narrate                  vygeneruje, co chybí
 *   npm run narrate -- --dry-run     jen vypíše, co by generoval
 *   npm run narrate -- --force-digest vynutí shrnutí i mimo obvyklý odstup
 */

import Anthropic from '@anthropic-ai/sdk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deserializeCampaign } from '../engine/campaign.js';
import type { Campaign } from '../engine/campaign.js';
import { epochDef, formatYear } from '../engine/epochs.js';
import { planetNotes } from '../engine/planet.js';
import { MILESTONES } from '../engine/milestones.data.js';
import type { RunSummary, WorldEvent } from '../engine/types.js';
import {
  digestKey,
  emptyNarration,
  epitaphKey,
  parseNarration,
  planetKey,
} from './narration.js';
import type { NarrationEntry, NarrationStore } from './narration.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '..', 'data');
const ARCHIVE_DIR = join(DATA_DIR, 'archive');
const NARRATION_FILE = join(DATA_DIR, 'narration.json');

const MODEL = 'claude-opus-5';

/**
 * Strop volání na jedno spuštění. Pojistka proti chybě v kódu, která by jinak
 * prohnala modelem celý archiv — ne úspora, ta při téhle frekvenci nedává smysl.
 */
const MAX_CALLS = 3;

/** Shrnutí jednou za reálný den, stejně jako předpovědi. */
const DIGEST_EVERY = 96;

const flag = (name: string): boolean => process.argv.includes(`--${name}`);

// ─────────────────────────────────────────── Vstupy

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function readJsonl(path: string): WorldEvent[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as WorldEvent];
      } catch {
        return [];
      }
    });
}

/**
 * Výběr z kroniky pro epitaf.
 *
 * Celý běh má stovky až tisíce zápisů a drtivá většina jsou pohromy, které se
 * po sté opakují. Model potřebuje kostru, ne přepis: zlomy epoch, kapitoly,
 * války, ztráty znalostí a konec. Když je i tak moc, prořeže se rovnoměrně,
 * aby zůstal zachovaný tvar celého oblouku, ne jen jeho konec.
 */
const SKELETON: ReadonlySet<string> = new Set([
  'genesis', 'epoch', 'chapter', 'ending', 'milestone_lost', 'war', 'faction_split', 'figure_death',
]);

function condense(events: WorldEvent[], limit: number): WorldEvent[] {
  const picked = events.filter((e) => SKELETON.has(e.kind) || e.weight >= 0.9);
  if (picked.length <= limit) return picked;

  const step = picked.length / limit;
  const out: WorldEvent[] = [];
  for (let i = 0; i < limit; i++) out.push(picked[Math.floor(i * step)] as WorldEvent);
  return out;
}

/** Nejváženější události okna, vrácené zpátky v pořadí, jak se staly. */
function topEvents(events: WorldEvent[], limit: number): WorldEvent[] {
  if (events.length <= limit) return events;
  return events
    .map((e, index) => ({ e, index }))
    .sort((a, b) => b.e.weight - a.e.weight || a.index - b.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((x) => x.e);
}

function asLines(events: WorldEvent[], foundingYear: number | null): string {
  return events.map((e) => `${formatYear(e.year, foundingYear)} — ${e.text}`).join('\n');
}

// ─────────────────────────────────────────── Prompty

const SYSTEM = `Jsi kronikář simulované civilizace. Píšeš česky, věcně a bez patosu.

Dostáváš SKUTEČNÁ data ze simulace. Piš výhradně o tom, co v datech je. Nikdy
si nevymýšlej události, jména, čísla ani příčiny. Co v datech není, o tom nepiš.

Styl: střízlivá dějepisná próza. Spíš krátké věty. Neoslovuj čtenáře, nepokládej
řečnické otázky, nepiš „mohli bychom si představit". Žádné nadpisy, odrážky ani
markdown — jen souvislý text v odstavcích.

Odpovídej pouze samotným textem, bez úvodní věty a bez uvozovek.`;

function planetPrompt(campaign: Campaign): string {
  const p = campaign.world.planet;
  const ores = Object.entries(p.ores)
    .map(([id, value]) => `${id} ${value.toFixed(2)}`)
    .join(', ');

  return `Na téhle planetě se právě probudila civilizace. Planeta je neměnná —
tyhle hodnoty budou platit po celé její dějiny.

Jak parametry v simulaci fungují:
- Dostupnost rud je násobič ceny objevů, které tu surovinu potřebují. Hodnota
  kolem nuly znamená, že ta cesta je prakticky uzavřená a civilizace bude muset
  najít jinou.
- Tektonika a vulkanismus přinášejí katastrofy, ale i úrodnou půdu, obsidián
  a snadné geotermální teplo.
- Slabé magnetické pole spolu s aktivní hvězdou opakovaně ničí elektroniku,
  takže informační věk se může několikrát smazat.
- Vysoká gravitace prodražuje let a orbitu.
- Vysoká patogenní zátěž znamená častější a horší mory.
- Nízká vydatnost vegetace a málo megafauny znamenají trvalý hlad.

PLANETA ${p.name}
gravitace ${p.gravity.toFixed(2)} g · den ${p.dayHours.toFixed(1)} h · rok ${Math.round(p.yearDays)} dní · sklon osy ${Math.round(p.axialTilt)}°
atmosféra ${p.atmosphereDensity.toFixed(2)} · kyslík ${p.oxygen.toFixed(2)} · skleníkový efekt ${p.greenhouse.toFixed(2)}
tektonika ${p.tectonics.toFixed(2)} · vulkanismus ${p.volcanism.toFixed(2)} · hydrologie ${p.hydrology.toFixed(2)}
magnetické pole ${p.magneticField.toFixed(2)} · erupce hvězdy ${p.stellarFlareRate.toFixed(2)} · měsíce ${p.moons}
megafauna ${p.biosphere.megafauna.toFixed(2)} · vydatnost vegetace ${p.biosphere.plantYield.toFixed(2)} · patogeny ${p.biosphere.pathogenLoad.toFixed(2)}
rudy: ${ores}

Co z toho simulace sama vyčetla:
${planetNotes(p).map((n) => `- ${n}`).join('\n') || '- Nic mimořádného; svět bez výrazných extrémů.'}

Napiš 100 až 150 slov o tom, co tenhle svět bude po civilizaci vyžadovat: co jí
ztíží, co jí naopak nabídne, a kudy nejspíš povedou dějiny jinudy, než by člověk
čekal. Konkrétně a s oporou v těch hodnotách. Nepředstírej jistotu tam, kde jde
o pravděpodobnost.`;
}

function epitaphPrompt(summary: RunSummary, events: WorldEvent[], foundingYear: number | null): string {
  const ending: Record<string, string> = {
    extinction: 'vyhynutí',
    stagnation: 'stagnace',
    self_destruction: 'sebezničení',
    transcendence: 'transcendence',
  };

  return `Tahle civilizace skončila. Níž je souhrn jejího života a kostra její kroniky.

SOUHRN
planeta ${summary.planet} · ${summary.run}. civilizace v pořadí
konec: ${ending[summary.ending] ?? summary.ending} (${summary.cause})
dožila se epochy ${epochDef(summary.epoch).name}
trvala ${Math.round(summary.years).toLocaleString('cs-CZ')} let vlastního letopočtu, ${summary.ticks} kroků simulace
nejvyšší dosažená populace ${Math.round(summary.peakPopulation).toLocaleString('cs-CZ')}
milníků zvládnutých ${summary.milestonesUnlocked} z ${MILESTONES.length}, znalostí ztracených ${summary.milestonesLost}
frakcí za celé dějiny ${summary.factionsEver} · zakladatelé ${summary.firstFaction} · nejsilnější na konci ${summary.lastFaction}

KRONIKA (výběr)
${asLines(events, foundingYear)}

Napiš 150 až 220 slov o tom, jaká ta civilizace byla a proč skončila zrovna
takhle. Nechci převyprávěnou kroniku — hledej v ní tvar. Co ji celou dobu
drželo, co se v jejích dějinách opakovalo, co ji nakonec dostalo. Když je mezi
souhrnem a kronikou napětí (třeba že vysoko došla a přesto skončila špatně),
piš o něm.`;
}

function digestPrompt(campaign: Campaign, events: WorldEvent[], fromTick: number): string {
  const w = campaign.world;
  return `Tohle se v civilizaci stalo za poslední reálný den (kroky ${fromTick} až
${campaign.globalTick}). Návštěvník tu mezitím nebyl a chce vědět, co propásl.

KDE CIVILIZACE JE
planeta ${w.planet.name} · epocha ${epochDef(w.epoch).name} · ${formatYear(w.year, w.foundingYear)}
obyvatel ${Math.round(w.stats.population).toLocaleString('cs-CZ')} · osad ${w.settlements.length} · frakcí ${w.factions.length}
milníků ${Object.keys(w.tech.unlocked).length} z ${MILESTONES.length}

CO SE STALO
${asLines(events, w.foundingYear)}

Napiš 60 až 100 slov souvislého textu. Vypíchni to, co má následky, ne to, co je
jen časté — opakující se pohromy shrň jedním dechem a místo dej tomu, co změnilo
směr. Když se nestalo nic podstatného, napiš i to a nenafukuj to.`;
}

// ─────────────────────────────────────────── Volání modelu

interface Task {
  key: string;
  kind: NarrationEntry['kind'];
  run: number;
  prompt: string;
  effort: 'low' | 'medium' | 'high';
  minChars: number;
  maxChars: number;
}

/**
 * Text z modelu se bere, jen když vypadá jako to, co jsme chtěli.
 *
 * Vrstva je přídavná, takže zahodit podezřelou odpověď nic nestojí — web bez
 * ní vypadá přesně jako předtím. To je mnohem lepší než pustit na stránku
 * odpověď, která začíná „Zde je epitaf:" nebo skončila uprostřed věty.
 */
function sanitize(raw: string, min: number, max: number): string | null {
  const text = raw.trim();
  if (text.length < min || text.length > max) return null;
  if (text.includes('```') || text.includes('# ')) return null;
  if (!/[.!?]["»“]?$/.test(text)) return null;
  return text;
}

async function generate(client: Anthropic, task: Task, tick: number): Promise<NarrationEntry | null> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: { effort: task.effort },
    messages: [{ role: 'user', content: task.prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  const clean = sanitize(text, task.minChars, task.maxChars);
  if (!clean) {
    console.warn(`  ${task.key}: odpověď neprošla kontrolou (${text.length} znaků), zahazuji.`);
    return null;
  }

  return { kind: task.kind, run: task.run, text: clean, tick, model: MODEL, createdAtMs: Date.now() };
}

// ─────────────────────────────────────────── Co je potřeba vygenerovat

function planTasks(campaign: Campaign, store: NarrationStore): Task[] {
  const tasks: Task[] = [];
  const w = campaign.world;

  // Epitafy mají přednost: jsou nejřidší a nejcennější. Bere se jeden na běh,
  // takže i po delším výpadku se archiv doplní postupně, ne jednou dávkou.
  for (const summary of campaign.archive) {
    if (store.entries[epitaphKey(summary.run)]) continue;
    const events = condense(readJsonl(join(ARCHIVE_DIR, `run-${String(summary.run).padStart(4, '0')}.jsonl`)), 140);
    if (events.length === 0) continue;
    // Letopočet zaniklé civilizace už ve světě není; kronika si ho nese sama.
    const founding = events.find((e) => e.kind === 'epoch' && e.data?.epoch === 1)?.year ?? null;
    tasks.push({
      key: epitaphKey(summary.run),
      kind: 'epitaph',
      run: summary.run,
      prompt: epitaphPrompt(summary, events, founding),
      effort: 'high',
      minChars: 500,
      maxChars: 2600,
    });
    break;
  }

  // Čtení planety pro běžící civilizaci. Doplní se i zpětně — genesis té
  // současné mohla proběhnout dávno předtím, než tahle vrstva vznikla.
  if (!store.entries[planetKey(w.run)]) {
    tasks.push({
      key: planetKey(w.run),
      kind: 'planet',
      run: w.run,
      prompt: planetPrompt(campaign),
      effort: 'medium',
      minChars: 350,
      maxChars: 1800,
    });
  }

  return tasks;
}

function planDigest(campaign: Campaign, store: NarrationStore, recent: WorldEvent[]): Task | null {
  if (campaign.world.ending) return null;

  const lastTick = Object.values(store.entries)
    .filter((e) => e.kind === 'digest')
    .reduce((max, e) => Math.max(max, e.tick), 0);

  const elapsed = campaign.globalTick - lastTick;
  if (!flag('force-digest') && elapsed < DIGEST_EVERY) return null;

  const fromTick = Math.max(0, campaign.globalTick - Math.max(DIGEST_EVERY, elapsed));
  const window = recent.filter(
    (e) => e.tick > fromTick && e.tick <= campaign.globalTick && e.run === campaign.world.run,
  );
  // Prázdné okno není hodné volání — a v paleolitu se stává, že se opravdu nic nestane.
  if (window.length === 0) return null;

  return {
    key: digestKey(campaign.globalTick),
    kind: 'digest',
    run: campaign.world.run,
    prompt: digestPrompt(campaign, topEvents(window, 90), fromTick),
    effort: 'medium',
    minChars: 200,
    maxChars: 1200,
  };
}

// ─────────────────────────────────────────── Běh

async function main(): Promise<void> {
  const worldFile = join(DATA_DIR, 'world.json');
  if (!existsSync(worldFile)) {
    console.log('Není co vyprávět — chybí data/world.json.');
    return;
  }

  const parsed = deserializeCampaign(readFileSync(worldFile, 'utf8'));
  const raw = readJson<unknown>(NARRATION_FILE);
  const store = raw ? parseNarration(raw) : emptyNarration();

  const recent = readJson<WorldEvent[]>(join(DATA_DIR, 'recent.json')) ?? [];

  const tasks = planTasks(parsed, store);
  const digest = planDigest(parsed, store, recent);
  if (digest) tasks.push(digest);

  if (tasks.length === 0) {
    console.log('Vyprávěcí vrstva je aktuální, není co generovat.');
    return;
  }

  const queued = tasks.slice(0, MAX_CALLS);
  console.log(`Ke generování: ${queued.map((t) => t.key).join(', ')}`);

  if (flag('dry-run')) {
    for (const task of queued) {
      console.log(`\n───── ${task.key} (${task.prompt.length} znaků promptu) ─────\n${task.prompt}`);
    }
    return;
  }

  // Bez klíče se vrstva prostě neuplatní. Není to chyba: web bez ní vypadá
  // přesně jako předtím a lokální vývoj ani cizí fork klíč nemají.
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY není nastavený — vyprávěcí vrstva se přeskakuje.');
    return;
  }

  const client = new Anthropic();
  let written = 0;

  for (const task of queued) {
    try {
      const entry = await generate(client, task, parsed.globalTick);
      if (!entry) continue;
      store.entries[task.key] = entry;
      written++;
      console.log(`  ${task.key}: ${entry.text.length} znaků.`);
    } catch (error) {
      // Selhání modelu nesmí shodit krok — checkpoint už je dávno commitnutý
      // a chybějící text je stav, se kterým web počítá.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`  ${task.key}: nepovedlo se (${message}).`);
    }
  }

  if (written === 0) {
    console.log('Nic nového se nezapsalo.');
    return;
  }

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(NARRATION_FILE, JSON.stringify(store, null, 2) + '\n', 'utf8');
  console.log(`Zapsáno ${written} nových textů do narration.json.`);
}

main().catch((error: unknown) => {
  // I neočekávaná chyba smí skončit nanejvýš tím, že vyprávění chybí.
  console.warn('Vyprávěcí vrstva selhala:', error);
});
