# Virtual Civilization

Autonomní virtuální civilizace. Začíná jako hrstka primitivů v jeskyni a vyvíjí se
sama — bez zásahu uživatele, bez hráče. Divák se jen dívá.

Vyvíjí se **i když se nikdo nedívá**, protože se vlastně nikdy „neběží": stav světa
je čistá funkce `(seed, tick)`, kde `tick = (teď − genesis) / 15 minut`. Kdo přijde
na web, dopočítá si aktuální stav sám a uvidí přesně tutéž civilizaci jako všichni
ostatní.

Inspirací byl [michalstrnadel/lili-octopus](https://github.com/michalstrnadel/lili-octopus).

## Stav

Hotová je fáze **M1** — deterministický engine a kronika v terminálu. Vizualizace
zatím žádná; nejdřív musí být jisté, že vygenerované dějiny stojí za čtení.

Obsah sahá po dobu železnou (epochy 0–3, 52 milníků). Dál se civilizace zatím
nedostane a skončí stagnací.

## Jak se na to podívat

```bash
npm install
npm run chronicle -- --seed 5 --ticks 2600 --min-weight 0.7
```

```
    0 0 let stáří     ◆ Na planetě Nymudor se v jeskyni u Drihel probudilo 35 lidí.
                        Říkali si Vyhnanci dlouhé zimy. Neuměli nic.
  120 480 tis. let    ✦ Vyhnancům dlouhé zimy se podařil milník: Oheň — ve snaze
                        uniknout chladu. První udržený plamen.
  553 rok 2 196       ✦ U Vyhnanců dlouhé zimy se prosadil objev: Zemědělství —
                        pod tlakem hladu. Zasít a čekat.
  643 rok 3 276       ■ Začíná nová epocha: Doba bronzová.
```

`--min-weight 0.7` odfiltruje šum pozadí. Bez něj uvidíš i katastrofy a klima.

Vyvažovací nástroj přes mnoho světů:

```bash
npm run sweep -- 60 -- --ticks 6000
```

Vypíše rozložení dosažených epoch, délky epoch v ticích, konce civilizací,
milníky, které se skoro nikdy neodemknou, a doporučené hodnoty `EPOCH_COST_SCALE`.

## Jak to funguje

**Čas.** Tick trvá 15 reálných minut, ale kolik simulovaných let pokryje, se
s epochou zmenšuje o pět řádů — od 4000 let na tick v paleolitu po setiny roku
v éře sítí. Hustota událostí na reálný den tak zůstává zhruba stejná, zatímco
simulovaný čas se dramaticky zpomaluje. Přesně jako ve skutečných dějinách.

Protože paleolit spolkne miliony let, má civilizace **vlastní letopočet** začínající
vstupem do neolitu. Před ním se udává stáří světa, po něm „rok 2 196".

**Planeta** se generuje ze seedu a je neměnná: gravitace, tektonika, magnetické pole,
dostupnost rud, biosféra. Její parametry násobí ceny milníků a frekvenci katastrof,
takže alternativní dějiny nevznikají scénářem, ale odvozeně — na světě bez cínu je
bronz šestkrát dražší a civilizace se vydá keramickou cestou.

**Milníky** se neodemykají v pevném pořadí. Kandidáti se každý tick skórují podle
toho, jak odpovídají na aktuální tlaky (hlad, chlad, nemoc, válka, tlačenice,
zvědavost), kolik stojí na téhle planetě a co civilizaci kulturně zajímá. Engine
u každého objevu emituje důvod, takže kronika umí říct *proč*.

**Kolaps** může milníky ztratit — podle jejich křehkosti. Ohně se nezapomene,
hvězdářství ano. Díky tomu není oblouk dějin monotónní.

## Struktura

```
engine/    čistý TypeScript bez DOM — běží v Node i v prohlížeči
tools/     chronicle-cli.ts (kronika a sweep)
tests/     determinismus a integrita stromu milníků
```

Engine nesmí použít `Math.random`, `Date.now` ani `new Date()` — hlídá to ESLint.
Veškerá náhoda jde přes `rngFor(seed, tick, stream)`, který se vytváří čerstvý
z čistých vstupů, takže checkpoint je jen holá data.

## Testy

```bash
npm test
```

Nejdůležitější z nich ověřuje, že simulace přerušená v půlce, poslaná přes JSON
a dopočítaná dá bit po bitu stejný stav jako souvislý výpočet. Na tom stojí celé
budoucí nasazení: server commituje checkpoint, klient si od něj dopočítá zbytek.

## Dál

- **M2** — obsah do epochy 13, války a schizmata, kolapsy, konce a archiv
- **M3** — checkpointy, GitHub Action, statický web
- **M4** — vizualizace: kruhová mapa světa, logaritmická spirála času, souhvězdí milníků (2D, Canvas + SVG + GSAP)
- **M5** — predikce metodou Monte Carlo a jejich zpětné vyhodnocení
- **M6** — archiv minulých civilizací, volitelná LLM vrstva kroniky
