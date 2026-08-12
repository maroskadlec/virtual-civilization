/**
 * SPIRÁLA — čas tak, jak ho civilizace prožívá.
 *
 * Klíč k celému pohledu: délka oblouku odpovídá REÁLNÉMU času, tedy tickům.
 * Každý tick zabere na spirále stejný kus dráhy. Popisky u prstenců ale
 * ukazují SIMULOVANÉ roky — a ty se směrem ven propadají o pět řádů.
 *
 * Vnitřní závit spolkne statisíce let paleolitu, vnější sotva pár desítek.
 * Divák tak zrychlování dějin neuvidí jako tvrzení, ale jako tvar.
 */

import { epochDef, formatYear, yearsPerTick } from '../../engine/epochs.js';
import type { WorldEvent, World } from '../../engine/types.js';
import { EVENT_COLOR, INK_FAINT, epochColor, setupCanvas } from './palette.js';

/** Kolik závitů spirála udělá. Víc znamená hustší, ale hůř čitelné prstence. */
const TURNS = 5;
const INNER_RADIUS = 26;

interface Point {
  x: number;
  y: number;
}

export interface SpiralHit {
  text: string;
  tick: number;
  year: number;
}

interface Geometry {
  key: string;
  points: Point[];
  radius: number;
}

let geometry: Geometry | null = null;
let hitTargets: { x: number; y: number; event: WorldEvent }[] = [];

/**
 * Spočítá dráhu spirály tak, aby na každý tick připadl stejně dlouhý oblouk.
 *
 * Archimédova spirála r = r0 + kθ; krok úhlu se odvozuje z požadované délky
 * oblouku (ds ≈ r dθ). Výsledek se cachuje, protože se mění jen když přibude
 * tick nebo se změní velikost plátna.
 */
function buildGeometry(ticks: number, maxRadius: number): Geometry {
  const key = `${ticks}:${Math.round(maxRadius)}`;
  if (geometry && geometry.key === key) return geometry;

  const thetaMax = Math.PI * 2 * TURNS;
  const k = (maxRadius - INNER_RADIUS) / thetaMax;
  const totalArc = INNER_RADIUS * thetaMax + (k * thetaMax * thetaMax) / 2;
  const arcPerTick = totalArc / Math.max(1, ticks);

  const points: Point[] = [];
  let theta = 0;
  for (let tick = 0; tick <= ticks; tick++) {
    const r = INNER_RADIUS + k * theta;
    points.push({ x: Math.cos(theta) * r, y: Math.sin(theta) * r });
    theta += arcPerTick / Math.max(1, r);
  }

  geometry = { key, points, radius: maxRadius };
  return geometry;
}

/** Kdy která epocha začala — odvozeno z kroniky, ne z dodatečného stavu. */
function epochTimeline(events: readonly WorldEvent[], world: World): { tick: number; epoch: number }[] {
  const marks: { tick: number; epoch: number }[] = [{ tick: 0, epoch: 0 }];
  for (const event of events) {
    if (event.kind !== 'epoch') continue;
    const epoch = Number(event.data.epoch);
    if (Number.isFinite(epoch)) marks.push({ tick: event.tick, epoch });
  }
  marks.push({ tick: world.tick + 1, epoch: world.epoch });
  return marks;
}

function drawTrack(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  marks: readonly { tick: number; epoch: number }[],
): void {
  ctx.lineWidth = 7;
  ctx.lineCap = 'butt';

  for (let i = 0; i < marks.length - 1; i++) {
    const from = marks[i];
    const to = marks[i + 1];
    if (!from || !to) continue;

    ctx.strokeStyle = epochColor(from.epoch);
    ctx.beginPath();
    for (let tick = from.tick; tick <= Math.min(to.tick, points.length - 1); tick++) {
      const p = points[tick];
      if (!p) continue;
      if (tick === from.tick) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
}

/**
 * Popisky prstenců. U každého závitu se napíše, jaké datum civilizace v tu
 * chvíli psala — právě z toho je vidět, že vnitřní závity spolkly statisíce
 * let a vnější sotva desítky.
 */
function drawRingLabels(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  world: World,
  marks: readonly { tick: number; epoch: number }[],
  ticks: number,
): void {
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const epochAt = (tick: number): number => {
    let epoch = 0;
    for (const mark of marks) if (mark.tick <= tick) epoch = mark.epoch;
    return epoch;
  };

  // Rok se rekonstruuje součtem let na tick podle epochy — stejná pravidla,
  // jaká používá simulace, takže popisek nemůže lhát.
  let year = 0;
  const yearAtTick: number[] = [0];
  for (let tick = 1; tick <= ticks; tick++) {
    year += yearsPerTick(epochAt(tick));
    yearAtTick.push(year);
  }

  for (let turn = 1; turn <= TURNS; turn++) {
    const tick = Math.round((turn / TURNS) * ticks);
    const p = points[tick];
    const atYear = yearAtTick[tick];
    if (!p || atYear === undefined) continue;

    ctx.fillStyle = INK_FAINT;
    ctx.fillText(formatYear(atYear, world.foundingYear), p.x + 9, p.y);

    ctx.strokeStyle = 'rgba(232, 220, 196, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawBeads(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  events: readonly WorldEvent[],
  originX: number,
  originY: number,
): void {
  hitTargets = [];

  for (const event of events) {
    const p = points[event.tick];
    if (!p) continue;
    // Drobné události spirálu jen zaplevelí.
    if (event.weight < 0.55) continue;

    const size = event.kind === 'epoch' || event.kind === 'ending' ? 4.5 : 1.4 + event.weight * 2.6;
    const color = EVENT_COLOR[event.kind] ?? INK_FAINT;

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = size * 2.6;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    hitTargets.push({ x: p.x + originX, y: p.y + originY, event });
  }
}

/** Čelo spirály — kde se civilizace nachází právě teď. */
function drawHead(ctx: CanvasRenderingContext2D, head: Point, timeMs: number): void {
  const pulse = 0.6 + 0.4 * Math.sin(timeMs / 700);
  ctx.save();
  ctx.strokeStyle = `rgba(232, 220, 196, ${0.35 + pulse * 0.4})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(head.x, head.y, 7 + pulse * 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawSpiral(
  canvas: HTMLCanvasElement,
  world: World,
  events: readonly WorldEvent[],
  timeMs: number,
): void {
  const surface = setupCanvas(canvas);
  if (!surface) return;
  const { ctx, width, height } = surface;

  ctx.clearRect(0, 0, width, height);

  const ticks = Math.max(1, world.tick);
  const originX = width / 2;
  const originY = height / 2;
  const maxRadius = Math.min(width, height) / 2 - 34;
  if (maxRadius <= INNER_RADIUS + 10) return;

  const { points } = buildGeometry(ticks, maxRadius);
  const marks = epochTimeline(events, world);

  ctx.save();
  ctx.translate(originX, originY);

  drawTrack(ctx, points, marks);
  drawRingLabels(ctx, points, world, marks, ticks);
  drawBeads(ctx, points, events, originX, originY);

  const head = points[ticks];
  if (head) drawHead(ctx, head, timeMs);

  // Střed: odkud se to všechno rozeběhlo.
  ctx.fillStyle = INK_FAINT;
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('jeskyně', 0, 0);

  ctx.restore();

  // Legenda epoch podél spodní hrany.
  const seen = [...new Set(marks.map((m) => m.epoch))].sort((a, b) => a - b);
  ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  let x = 4;
  for (const epoch of seen) {
    ctx.fillStyle = epochColor(epoch);
    ctx.fillRect(x, height - 12, 16, 3);
    ctx.fillStyle = INK_FAINT;
    const label = epochDef(epoch).name;
    ctx.fillText(label, x + 20, height - 6);
    x += 26 + ctx.measureText(label).width;
    if (x > width - 90) break;
  }
}

/** Najde událost pod kurzorem. Souřadnice jsou v pixelech plátna. */
export function spiralHitTest(x: number, y: number): SpiralHit | null {
  let best: { distance: number; event: WorldEvent } | null = null;

  for (const target of hitTargets) {
    const distance = Math.hypot(target.x - x, target.y - y);
    if (distance < 9 && (!best || distance < best.distance)) {
      best = { distance, event: target.event };
    }
  }

  if (!best) return null;
  return { text: best.event.text, tick: best.event.tick, year: best.event.year };
}
