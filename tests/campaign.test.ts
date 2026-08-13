/**
 * Kampaň je most mezi hodinami a simulací a zároveň nosník celého nasazení:
 * server commitne checkpoint, klient si od něj dopočítá zbytek. Když se ty dva
 * výpočty rozejdou, každý návštěvník uvidí jinou civilizaci.
 */

import { describe, expect, it } from 'vitest';
import {
  advanceCampaign,
  advanceToNow,
  createCampaign,
  deserializeCampaign,
  serializeCampaign,
  targetTickAt,
  msUntilNextTick,
  MAX_TICKS_PER_ADVANCE,
  CAMPAIGN_FORMAT_VERSION,
} from '../engine/campaign.js';
import type { Campaign } from '../engine/campaign.js';
import { TICK_REAL_MS } from '../engine/epochs.js';
import { hashString } from '../engine/rng.js';

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

const fingerprint = (c: Campaign): number => hashString(canonical(c));

describe('kampaň', () => {
  it('checkpoint přežije cestu přes JSON a dopočítá se do stejného stavu', () => {
    const straight = createCampaign(4242, 0);
    advanceCampaign(straight, 3000);

    const halfway = createCampaign(4242, 0);
    advanceCampaign(halfway, 1200);
    const restored = deserializeCampaign(serializeCampaign(halfway));
    advanceCampaign(restored, 3000);

    expect(fingerprint(restored)).toBe(fingerprint(straight));
  });

  it('kronika je stejná, ať se počítá vcelku nebo po částech', () => {
    const straight = createCampaign(77, 0);
    const all = advanceCampaign(straight, 2500).events;

    const chunked = createCampaign(77, 0);
    const pieces = [
      ...advanceCampaign(chunked, 400).events,
      ...advanceCampaign(chunked, 1700).events,
      ...advanceCampaign(chunked, 2500).events,
    ];

    expect(pieces.map((e) => e.text)).toEqual(all.map((e) => e.text));
    expect(pieces.map((e) => e.run)).toEqual(all.map((e) => e.run));
  });

  it('cílový tick je čistou funkcí reálného času', () => {
    const genesisMs = 1_700_000_000_000;
    const campaign = createCampaign(1, genesisMs);

    expect(targetTickAt(campaign, genesisMs)).toBe(0);
    expect(targetTickAt(campaign, genesisMs + TICK_REAL_MS - 1)).toBe(0);
    expect(targetTickAt(campaign, genesisMs + TICK_REAL_MS)).toBe(1);
    expect(targetTickAt(campaign, genesisMs + 96 * TICK_REAL_MS)).toBe(96);
    // Před genesis se nesimuluje do záporu.
    expect(targetTickAt(campaign, genesisMs - 10_000)).toBe(0);
  });

  it('dva klienti se stejnými hodinami dojdou ke stejnému světu', () => {
    const genesisMs = 1_700_000_000_000;
    const nowMs = genesisMs + 1500 * TICK_REAL_MS;

    const a = createCampaign(31337, genesisMs);
    const b = createCampaign(31337, genesisMs);
    advanceToNow(a, nowMs);
    advanceToNow(b, nowMs);

    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(a.globalTick).toBe(1500);
  });

  it('odpočet do dalšího ticku je vždy v mezích jednoho ticku', () => {
    const genesisMs = 1_700_000_000_000;
    const campaign = createCampaign(1, genesisMs);

    expect(msUntilNextTick(campaign, genesisMs)).toBe(TICK_REAL_MS);
    expect(msUntilNextTick(campaign, genesisMs + 60_000)).toBe(TICK_REAL_MS - 60_000);
    for (const offset of [0, 1, 12345, TICK_REAL_MS - 1, TICK_REAL_MS, 7 * TICK_REAL_MS + 3]) {
      const left = msUntilNextTick(campaign, genesisMs + offset);
      expect(left).toBeGreaterThan(0);
      expect(left).toBeLessThanOrEqual(TICK_REAL_MS);
    }
  });

  it('po dlouhém výpadku se dopočítává po dávkách a dojde ke stejnému konci', () => {
    // Prohlížeč nesmí zamrznout, když Action neběžela měsíce. Dopočet se proto
    // zastropuje — ale opakované volání musí dojít přesně tam, kam vcelku.
    const target = MAX_TICKS_PER_ADVANCE + 500;

    const straight = createCampaign(9, 0);
    while (straight.globalTick < target) advanceCampaign(straight, target);

    const first = createCampaign(9, 0);
    const step = advanceCampaign(first, target);
    expect(step.truncated).toBe(true);
    expect(step.ticks).toBe(MAX_TICKS_PER_ADVANCE);
    advanceCampaign(first, target);

    expect(first.globalTick).toBe(straight.globalTick);
    expect(fingerprint(first)).toBe(fingerprint(straight));
  });

  it('nové civilizace navazují a archiv sedí na počet zániků', () => {
    const campaign = createCampaign(3, 0);
    const events = advanceCampaign(campaign, 24000).events;

    expect(campaign.archive.length).toBeGreaterThan(0);
    expect(campaign.world.run).toBe(campaign.archive.length + 1);

    // Každý běh v archivu má vlastní planetu a vlastní seed.
    const seeds = new Set(campaign.archive.map((r) => r.seed));
    expect(seeds.size).toBe(campaign.archive.length);

    const genesisEvents = events.filter((e) => e.kind === 'genesis');
    expect(genesisEvents.length).toBe(campaign.archive.length);
  });

  it('starší checkpoint bez novějších polí se načte s výchozími hodnotami', () => {
    // Když runner spadne na chybějícím poli, checkpoint už nikdy nepřepíše —
    // a web na něm staví taky. Rozbilo by to nasazení natrvalo.
    const campaign = createCampaign(1, 0);
    advanceCampaign(campaign, 50);

    const raw = JSON.parse(serializeCampaign(campaign)) as Record<string, unknown>;
    delete raw.predictions;
    delete raw.scoreboard;
    delete raw.version;

    const restored = deserializeCampaign(JSON.stringify(raw));
    expect(restored.predictions).toEqual([]);
    expect(restored.scoreboard.buckets.length).toBe(10);
    expect(restored.globalTick).toBe(50);
    // A musí jít rovnou dál, ne jen načíst.
    expect(() => advanceCampaign(restored, 60)).not.toThrow();
  });

  it('checkpoint bez světa se odmítne', () => {
    expect(() => deserializeCampaign('{"genesisMs":0}')).toThrow(/neobsahuje svět/);
  });

  it('checkpoint z budoucí verze formátu se odmítne, ne tiše načte', () => {
    const campaign = createCampaign(1, 0);
    const raw = JSON.parse(serializeCampaign(campaign)) as Campaign;
    raw.version = CAMPAIGN_FORMAT_VERSION + 1;
    expect(() => deserializeCampaign(JSON.stringify(raw))).toThrow(/formát verze/);
  });
});
