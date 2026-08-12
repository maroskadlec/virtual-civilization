# Virtual Civilization

Autonomní virtuální civilizace. Začíná jako hrstka primitivů v jeskyni a vyvíjí se
sama — bez zásahu uživatele, bez hráče. Divák se jen dívá.

Vyvíjí se **i když se nikdo nedívá**, protože se vlastně nikdy „neběží": stav světa
je čistá funkce `(seed, tick)`, kde `tick = (teď − genesis) / 15 minut`. Kdo přijde
na web, dopočítá si aktuální stav sám a uvidí přesně tutéž civilizaci jako všichni
ostatní.

Inspirací byl [michalstrnadel/lili-octopus](https://github.com/michalstrnadel/lili-octopus).

## Stav

Hotové jsou fáze **M1 a M2** — deterministický engine s úplným obsahem
a kronika v terminálu. Vizualizace zatím žádná; nejdřív musí být jisté,
že vygenerované dějiny stojí za čtení.

**161 milníků** ve 14 epochách, od ohně po tichou otázku. Každá epocha
trvá kolem 500 ticků, celý oblouk civilizace tedy zhruba **7000 ticků
= 2,4 měsíce reálného času**. Když civilizace zanikne, začne na nové planetě další.

Jak civilizace končí, měřeno přes 30 světů:

| osud | podíl |
|---|---|
| transcendence | 50 % |
| sebezničení (jaderná válka, klima, sebereplikace) | 30 % |
| vyhynutí v paleolitu | 13 % |
| stagnace | zbytek |

Cestou se 24 z 30 civilizací propadne do temného věku a část znalostí zapomene.

## Jak se na to podívat

```bash
npm install
npm run chronicle -- --seed 5 --ticks 2600 --min-weight 0.7
```

```
    0 0 let stáří     ◆ Na planetě Nymudor se v jeskyni u Drihel probudilo 35 lidí.
                        Říkali si Vyhnanci dlouhé zimy. Neuměli nic.
  109 436 tis. let    ✦ Vyhnancům dlouhé zimy se podařil milník: Oheň — ve snaze
                        uniknout chladu. První udržený plamen.
  184 736 tis. let    ✦ Vyhnanci dosáhli milníku: Vor — protože osady přestaly
                        stačit. Voda přestala být hranicí.
  202 808 tis. let    ✖ Propad byl tak prudký, že se přetrhlo předávání znalostí.
                        Zapomnělo se: vor.
```

`--min-weight 0.7` odfiltruje šum pozadí. Bez něj uvidíš i katastrofy a klima.

Posloupnost civilizací, jak web poběží doopravdy — jedna zanikne, další začíná
na nové planetě:

```bash
npm run chronicle -- --campaign --seed 3 --ticks 20000
```

```
ARCHIV ZANIKLÝCH CIVILIZACÍ
  1. Kesranna   Úsvit          vyhynutí      rozpad
     71 ticků · 284 000 let · vrchol 37 obyvatel · 0 milníků
  2. Ishsetar   Sítě a biotech sebezničení   jaderná válka
     4653 ticků · vrchol 758 296 890 obyvatel · 132 milníků (6 ztraceno)
  3. Vordesha   Transcendence  transcendence odchod
     9134 ticků · vrchol 23 401 483 174 obyvatel · 159 milníků (6 ztraceno)
```

Vyvažovací nástroj přes mnoho světů:

```bash
npm run sweep -- 60 --ticks 12000
```

Vypíše rozložení dosažených epoch, délky epoch v ticích, konce civilizací
a milníky, které se skoro nikdy neodemknou.

Automatická kalibrace tempa — dojede smyčku sama a vypíše tabulku k vložení:

```bash
npm run calibrate -- 30 10 8
```

Argumenty jsou počet světů, počet iterací a od které epochy ladit
(nižší epochy zůstanou nedotčené).

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
hvězdářství ano. Civilizace se může propadnout i o celou epochu zpět.
Díky tomu není oblouk dějin monotónní.

**Alternativní cesty** jsou v datech vedené záměrně, aby chybějící surovina
civilizaci nezastavila, ale odklonila:

| oblast | hlavní cesta | alternativy |
|---|---|---|
| energie | pára (uhlí) | vodní turbína, geotermál, vítr |
| pohon | spalovací motor (ropa) | dynamo a elektromotor |
| výpočty | tranzistor (vzácné zeminy) | reléový počítač |
| přesná mechanika | ocel | bronz, keramika |

Právě proto svět bez uhlí dojde k elektřině dřív než k průmyslu — a svět
bez uranu nemůže zaniknout v jaderné válce, protože si ji nemá čím způsobit.

**Průmyslové oteplování** je jediná pohroma, kterou nezpůsobí planeta, ale
civilizace sama. Od chvíle, kdy stojí továrny, se teplo načítá; zastavit to jde
jen obnovitelnou sítí, fúzí, jádrem nebo klimatickým inženýrstvím. Někdo to
stihne, někdo ne.

## Struktura

```
engine/    čistý TypeScript bez DOM — běží v Node i v prohlížeči
  milestones.early.ts   epochy 0–3
  milestones.late.ts    epochy 4–13
  milestones.data.ts    rejstřík a měřítka cen
tools/     chronicle-cli.ts (kronika, kampaň, sweep) · calibrate.ts
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

- **M3** — checkpointy, GitHub Action, statický web
- **M4** — vizualizace: kruhová mapa světa, logaritmická spirála času, souhvězdí milníků (2D, Canvas + SVG + GSAP)
- **M5** — predikce metodou Monte Carlo a jejich zpětné vyhodnocení
- **M6** — archiv minulých civilizací, volitelná LLM vrstva kroniky
