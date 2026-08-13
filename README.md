# Virtual Civilization

Autonomní virtuální civilizace. Začíná jako hrstka primitivů v jeskyni a vyvíjí se
sama — bez zásahu uživatele, bez hráče. Divák se jen dívá.

Vyvíjí se **i když se nikdo nedívá**, protože se vlastně nikdy „neběží": stav světa
je čistá funkce `(seed, tick)`, kde `tick = (teď − genesis) / 15 minut`. Kdo přijde
na web, dopočítá si aktuální stav sám a uvidí přesně tutéž civilizaci jako všichni
ostatní.

Determinismus platí pro danou verzi enginu. Když se změní pravidla, přepočet
od nuly dá jinou historii — nositelem dějin proto není seed, ale commitnutý
checkpoint. Od něj se pokračuje novými pravidly, aniž by se přepisovala minulost.

Inspirací byl [michalstrnadel/lili-octopus](https://github.com/michalstrnadel/lili-octopus).

## Stav

Hotové jsou fáze **M1 až M5.5** — deterministický engine s úplným obsahem,
kronika v terminálu, **běžící web se třemi pohledy**, předpovědi, které se
samy zpětně vyhodnocují, a kronika, která si pamatuje vlastní dějiny.

**→ [maroskadlec.github.io/virtual-civilization](https://maroskadlec.github.io/virtual-civilization/)**

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

### Co dělá kroniku kronikou

Zápis, který zná jen svou vlastní událost, je položka logu. Souvislost vzniká
až tím, co engine kolem ní ví:

- **Následky.** Kolik lidí to stálo a jaká část osady to byla. „Zemřelo 6 863
  lidí, každý třetí."
- **Paměť.** Kolikátá je to pohroma svého druhu, kdy byla minulá, jestli byla
  horší než všechny předchozí. Rekordy se posuzují **podílem**, ne počtem
  mrtvých — populace roste přes několik řádů a v absolutních číslech by byla
  „nejhorší v dějinách" skoro každá další rána.
- **Jména.** Od doby bronzové mají objevy a války konkrétní lidi, kteří žijí
  napříč několika událostmi a na konci dostanou nekrolog ze svých skutků.
  Dřív ne: v paleolitu pokrývá jeden tick čtyři tisíciletí, takže by se
  jednotlivec nedožil ani setiny ticku.
- **Kapitoly.** Konec epochy uzavře ohlédnutí složené z celého období — jediný
  zápis, který spojuje věci, co se staly stovky ticků od sebe.

Jména lidí se skloňují strojově, a proto generátor drží tvrdé omezení: mužská
jména končí souhláskou a skloňují se jako „pán", ženská končí na -a a skloňují
se jako „žena". Obojí je bezvýjimečně pravidelné.

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

## Pohledy na webu

Všechno je 2D — Canvas a SVG, žádné 3D.

**SVĚT** je planeta v Lambertově azimutální projekci se stejnou plochou: střed je
jeden pól, okraj druhý, rovník leží na poloměru 0,707. Políčka se neberou z žádné
textury — každé se ptá téže funkce `biomeAt`, kterou používá simulace, takže
při ochlazení mapa zbělá proto, že se posunula pásma. Prstenec kolem disku ukazuje
podíl odemčených milníků a od orbitálních epoch přibývají obíhající tělesa.

**ČAS** je logaritmická spirála, na které jeden tick zabere vždy stejně dlouhý
oblouk. Popisky u prstenců ale ukazují simulované roky — vnitřní závit spolkne
statisíce let paleolitu, vnější sotva desítky. Zrychlování dějin tak není tvrzení,
ale tvar.

**MILNÍKY** jsou strom poznání jako hvězdná mapa. Sloupce jsou epochy, čáry vedou
od předpokladu k tomu, co umožnil. Svítící hvězdy jsou zvládnuté, prstýnek značí
rozpracované, rudý uhlík zapomenuté při kolapsu a vyhaslé body to, co na téhle
planetě nejde, protože k tomu chybí surovina.

Pro vývoj vizualizací (a pro rychlou představu, jak vypadá vyzrálý svět) umí web
odsimulovat civilizaci rovnou v prohlížeči:

```
?demo=6000&seed=11
```

Genesis se posune do minulosti přesně o zadaný počet ticků, takže ukázka sedí
na skutečné hodiny stejně jako ostrý provoz. V hlavičce se pak zobrazí výrazné
označení, aby si to nikdo nespletl s živou civilizací.

## Předpovědi

Žádná věštba ani ručně psaná pravidla: z aktuálního stavu se pustí stovka kopií
téhož světa dopředu a spočítá se, v kolika z nich daná věc nastala. Když se
v 68 kopiích ze sta objeví metalurgie, je to předpověď na 68 %.

Větvení náhody plyne přímo z architektury — engine je čistá funkce
`(seed, tick, stream)`, takže stačí kopii přepsat odvozený seed. Planeta
i dosavadní stav zůstanou, ale všechny hody dopadnou jinak.

Cestou vyšlo najevo, že **načasování milníků je skoro deterministické** —
náhoda v téhle simulaci žije ve válkách, katastrofách a rozkolech, ne ve
výzkumu. Při pevném horizontu proto vycházela skoro všechna tvrzení na nulu
nebo na jistotu a nebylo co zveřejnit. Každý rollout si teď pamatuje, ve kterém
kroku tvrzení poprvé nastalo, takže se z jednoho průchodu odečte pravděpodobnost
pro libovolnou lhůtu — a každé tvrzení si vybere tu, ve které je nejnapínavější.

Vyhodnocení je bez výmluv. Tvrzení jsou monotónní („stane se to do…"), takže
stačí jeden příznak aktualizovaný každý tick. Když civilizace zanikne dřív, než
předpověď dozraje, uzavře se rovnou — nesplněné tvrzení je minutí, ne
omluvitelná okolnost. Předpověď měla riziko zániku zahrnout.

Web ukazuje **Brierovo skóre** (nula je dokonalost, 0,25 je hod mincí)
a hlavně **kalibraci**: z tvrzení, kterým dala simulace 70 %, se má splnit
zhruba sedm z deseti. Bez toho by stačilo předpovídat samé jistoty
a tvářit se neomylně.

Monte Carlo stojí několik sekund, takže běží výhradně v Action; klient výsledek
jen čte.

## Nasazení

Jeden workflow (`.github/workflows/tick.yml`) běží po půlhodině a dělá tři věci:
posune civilizaci na aktuální čas, commitne checkpoint a nasadí web na GitHub Pages.
Schválně je to jeden workflow — kdyby to byly dva, mohl by nastat stav, kdy jsou
v repu čerstvá data, ale nasazená stránka je starší.

**Simulace na tom běhu ale nestojí.** Zdrojem pravdy je genesis timestamp a seed;
runner jen předpočítává to, co si klient umí dopočítat sám. Když workflow týden
neběží, web ukazuje správný stav dál — prohlížeč si prostě spočítá o pár set
ticků víc. Ověřuje to test, který nechá simulaci přerušit, poslat přes JSON
a dopočítat, a porovná výsledek s výpočtem vcelku.

Datové soubory v `data/`:

| soubor | co je uvnitř |
|---|---|
| `world.json` | checkpoint kampaně — svět, archiv, globální tick |
| `chronicle.jsonl` | kronika probíhající civilizace, jeden zápis na řádek |
| `archive/run-NNNN.jsonl` | uzavřené kroniky zaniklých civilizací |
| `recent.json` | posledních 300 zápisů pro rychlé první vykreslení |
| `status.json` | shrnutí; jeho `headline` se používá jako zpráva commitu |

Zprávy commitů proto nesou skutečné dějinné události — **`git log` je kronika**.

> GitHub vypíná naplánované workflow po 60 dnech neaktivity repozitáře a commity
> pod `GITHUB_TOKEN` se do aktivity nepočítají. Pro dlouhodobý běh bez zásahu
> vyměň token ve workflow za PAT v secrets.

Lokálně:

```bash
npm run dev              # web na localhostu
npm run sim              # posunout kampaň na teď a zapsat data
npm run sim -- --dry-run # spočítat a jen vypsat
```

Kampaň se založí sama, když `data/world.json` neexistuje. Pro rychlý test
s civilizací, která už něco umí, jde genesis posunout do minulosti:

```bash
npm run sim -- --backdate-days 40
```

## Struktura

```
engine/    čistý TypeScript bez DOM — běží v Node i v prohlížeči
  campaign.ts           jediné místo, kde se potkají hodiny se simulací
  tick.ts               mechanika: co se stalo
  narrate.ts            vyprávění: jak se to řekne (sem jednou sedne LLM vrstva)
  memory.ts             počítadla a rekordy, ze kterých vznikají souvislosti
  figures.ts            pojmenovaní lidé a jejich nekrology
  milestones.early.ts   epochy 0–3
  milestones.late.ts    epochy 4–13
  milestones.data.ts    rejstřík a měřítka cen
web/       statický web (Vite) — načte checkpoint a dopočítá zbytek
tools/     chronicle-cli.ts · sim-runner.ts · calibrate.ts
data/      commitovaný checkpoint a kronika
tests/     determinismus, kampaň, integrita stromu milníků
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

- **M6** — archiv minulých civilizací na webu

LLM vrstva kroniky je **volitelná a záměrně úzká**. Jednotlivé zápisy píšou
šablony nad bohatými daty: jsou gramaticky zaručené, deterministické a zadarmo.
Model by u nich přidal jen sloh a obětoval determinismus. Co ale šablona nad
jednou událostí nedokáže ani teoreticky, je syntéza napříč obdobím — a to je
jediné místo, kam LLM patří: **ohlédnutí za érou**. Ta už v kronice jsou,
zatím šablonová; model by přepisoval jen je. Takové zápisy jsou ze své povahy
retrospektivní, píšou se jen o minulosti, která je vždycky commitnutá, takže
se feed událostí nemá jak rozejít s tím, co si dopočítá klient.

Bez API klíče je web úplný — jen bez těch ohlédnutí.
