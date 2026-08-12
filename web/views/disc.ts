/**
 * DISK — svět jako kruhová mapa.
 *
 * Planeta se zobrazuje Lambertovou azimutální projekcí se stejnou plochou:
 * střed je jeden pól, okraj druhý, rovník leží na poloměru 0,707. Plocha na
 * disku odpovídá ploše na kouli, takže rozložení sídel není zkreslené.
 *
 * Biomy se nekreslí z nějaké textury — každé políčko se ptá téže funkce
 * `biomeAt`, kterou používá simulace. Když se ochladí, mapa zbělá, protože
 * se posunou pásma, ne proto, že by to někdo vykreslil.
 *
 * Technologický postup roste jako prstenec KOLEM disku. Odchod z planety je
 * tak vidět, aniž by bylo potřeba jakékoli 3D.
 */

import { biomeAt } from '../../engine/planet.js';
import { MILESTONES } from '../../engine/milestones.data.js';
import type { Settlement, World } from '../../engine/types.js';
import { BIOME_COLOR, INK_FAINT, RULE, factionColor, setupCanvas } from './palette.js';

/** Velikost jednoho políčka v pixelech. Menší je hezčí, ale dráž se kreslí. */
const HEX_SIZE = 6.5;

interface Point {
  x: number;
  y: number;
}

function polarToXY(r: number, theta: number, radius: number): Point {
  return { x: Math.cos(theta) * r * radius, y: Math.sin(theta) * r * radius };
}

function settlementPoint(s: Settlement, radius: number): Point {
  return polarToXY(s.r, s.theta, radius);
}

function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    const x = cx + Math.cos(angle) * size;
    const y = cy + Math.sin(angle) * size;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Povrch planety — políčka obarvená stejnou funkcí, jakou používá simulace. */
function drawSurface(ctx: CanvasRenderingContext2D, world: World, radius: number): void {
  const { planet, climate } = world;
  const columns = Math.ceil(radius / (HEX_SIZE * 1.5)) + 1;
  const rows = Math.ceil(radius / (HEX_SIZE * Math.sqrt(3))) + 1;

  for (let q = -columns; q <= columns; q++) {
    for (let r = -rows; r <= rows; r++) {
      const x = HEX_SIZE * 1.5 * q;
      const y = HEX_SIZE * Math.sqrt(3) * (r + q / 2);
      const distance = Math.hypot(x, y);
      if (distance > radius) continue;

      const rNorm = distance / radius;
      const theta = (Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2);
      const biome = biomeAt(planet, rNorm, theta, climate.temperature, climate.aridity);

      ctx.fillStyle = BIOME_COLOR[biome];
      hexPath(ctx, x, y, HEX_SIZE * 0.9);
      ctx.fill();
    }
  }
}

/**
 * Ledová pokrývka. Kreslí se jako závoj u obou pólů — tedy uprostřed disku
 * a při jeho okraji, což je na azimutální projekci totéž místo na kouli.
 */
function drawIce(ctx: CanvasRenderingContext2D, world: World, radius: number): void {
  const coverage = world.climate.iceCoverage;
  if (coverage <= 0.02) return;

  const reach = Math.min(0.3, coverage * 0.36);
  const alpha = Math.min(0.34, 0.08 + coverage * 0.32);

  // Severní pól je střed disku.
  const north = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * Math.sqrt(reach));
  north.addColorStop(0, `rgba(214, 228, 240, ${alpha})`);
  north.addColorStop(0.65, `rgba(214, 228, 240, ${alpha * 0.45})`);
  north.addColorStop(1, 'rgba(214, 228, 240, 0)');
  ctx.fillStyle = north;
  ctx.beginPath();
  ctx.arc(0, 0, radius * Math.sqrt(reach), 0, Math.PI * 2);
  ctx.fill();

  // Jižní pól je celý obvod.
  const inner = radius * Math.sqrt(Math.max(0, 1 - reach));
  const south = ctx.createRadialGradient(0, 0, inner, 0, 0, radius);
  south.addColorStop(0, 'rgba(214, 228, 240, 0)');
  south.addColorStop(0.6, `rgba(214, 228, 240, ${alpha * 0.4})`);
  south.addColorStop(1, `rgba(214, 228, 240, ${alpha})`);
  ctx.fillStyle = south;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** Rovník a obrys planety — jemné vodicí linky, ne ozdoba. */
function drawGraticule(ctx: CanvasRenderingContext2D, radius: number): void {
  ctx.strokeStyle = 'rgba(232, 220, 196, 0.09)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 5]);
  ctx.beginPath();
  ctx.arc(0, 0, radius * Math.SQRT1_2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(232, 220, 196, 0.22)';
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
}

/** Území frakcí jako měkký nádech barvy kolem jejich sídel. */
function drawTerritory(ctx: CanvasRenderingContext2D, world: World, radius: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (const settlement of world.settlements) {
    const faction = world.factions.find((f) => f.id === settlement.factionId);
    if (!faction) continue;

    const { x, y } = settlementPoint(settlement, radius);
    const reach = 14 + Math.log10(Math.max(10, settlement.population)) * 9;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, reach);
    glow.addColorStop(0, `${factionColor(faction.hue)}22`);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, reach, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Cesty mezi sídly téže frakce. Každé sídlo se spojí s nejbližším sousedem —
 * úplný graf by mapu zaplevelil, tohle dá síť, která je čitelná.
 */
function drawRoutes(ctx: CanvasRenderingContext2D, world: World, radius: number): void {
  ctx.lineWidth = 1;

  for (const settlement of world.settlements) {
    const peers = world.settlements.filter(
      (other) => other.factionId === settlement.factionId && other.id !== settlement.id,
    );
    if (peers.length === 0) continue;

    const from = settlementPoint(settlement, radius);
    let nearest: Settlement | null = null;
    let best = Infinity;
    for (const peer of peers) {
      const to = settlementPoint(peer, radius);
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      if (distance < best) {
        best = distance;
        nearest = peer;
      }
    }
    if (!nearest || best > radius * 0.8) continue;

    const faction = world.factions.find((f) => f.id === settlement.factionId);
    const to = settlementPoint(nearest, radius);
    // Mírné prohnutí ke středu, aby cesty nebyly rovné čáry.
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const bow = { x: mid.x * 0.88, y: mid.y * 0.88 };

    ctx.strokeStyle = `${factionColor(faction?.hue ?? 0)}30`;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(bow.x, bow.y, to.x, to.y);
    ctx.stroke();
  }
}

/** Sídla. Velikost odpovídá logaritmu populace, jinak by města přebila vesnice. */
function drawSettlements(
  ctx: CanvasRenderingContext2D,
  world: World,
  radius: number,
  timeMs: number,
): void {
  for (const settlement of world.settlements) {
    const faction = world.factions.find((f) => f.id === settlement.factionId);
    const color = factionColor(faction?.hue ?? 0);
    const { x, y } = settlementPoint(settlement, radius);
    const size = 1.6 + Math.log10(Math.max(10, settlement.population)) * 0.85;

    // Sotva znatelný tep, aby mapa nebyla úplně mrtvá.
    const pulse = 0.85 + 0.15 * Math.sin(timeMs / 1400 + settlement.r * 9 + settlement.theta * 3);

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = size * 3.5 * pulse;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Technologický prstenec kolem planety.
 *
 * Vyplněný oblouk ukazuje podíl odemčených milníků, zářezy dosažené epochy.
 * Od orbitálních epoch přibývají obíhající body — civilizace se poprvé objeví
 * i mimo vlastní svět.
 */
function drawTechRing(
  ctx: CanvasRenderingContext2D,
  world: World,
  radius: number,
  timeMs: number,
): void {
  const ringRadius = radius + 26;
  const unlocked = Object.keys(world.tech.unlocked).length;
  const fraction = unlocked / MILESTONES.length;
  const start = -Math.PI / 2;

  ctx.lineWidth = 1;
  ctx.strokeStyle = RULE;
  ctx.beginPath();
  ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 2;
  ctx.strokeStyle = '#7fd6a6';
  ctx.beginPath();
  ctx.arc(0, 0, ringRadius, start, start + Math.PI * 2 * fraction);
  ctx.stroke();

  // Zářezy epoch.
  ctx.lineWidth = 1;
  ctx.strokeStyle = INK_FAINT;
  for (let epoch = 1; epoch <= world.epoch; epoch++) {
    const angle = start + (Math.PI * 2 * epoch) / 14;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * (ringRadius - 4), Math.sin(angle) * (ringRadius - 4));
    ctx.lineTo(Math.cos(angle) * (ringRadius + 4), Math.sin(angle) * (ringRadius + 4));
    ctx.stroke();
  }

  if (world.epoch < 10) return;

  // Orbitální tělesa. Přibývají s epochou, takže pozdní civilizace má kolem
  // planety vlastní soustavu.
  const bodies = Math.min(30, (world.epoch - 9) * 6);
  const orbit = ringRadius + 16;
  ctx.fillStyle = '#e8dcc4';
  for (let i = 0; i < bodies; i++) {
    const angle = (i / bodies) * Math.PI * 2 + timeMs / 9000;
    const wobble = orbit + Math.sin(i * 2.7) * 7;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * wobble, Math.sin(angle) * wobble, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function drawDisc(canvas: HTMLCanvasElement, world: World, timeMs: number): void {
  const surface = setupCanvas(canvas);
  if (!surface) return;
  const { ctx, width, height } = surface;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2);

  const radius = Math.min(width, height) / 2 - 46;
  if (radius <= 10) {
    ctx.restore();
    return;
  }

  drawSurface(ctx, world, radius);
  drawIce(ctx, world, radius);
  drawGraticule(ctx, radius);
  drawTerritory(ctx, world, radius);
  drawRoutes(ctx, world, radius);
  drawSettlements(ctx, world, radius, timeMs);
  drawTechRing(ctx, world, radius, timeMs);

  ctx.restore();
}
