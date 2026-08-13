/**
 * Predikce se musí chovat poctivě: pravděpodobnost odvozená z rolloutů,
 * vyhodnocení bez výmluv a kalibrace, která nejde ošidit.
 */

import { describe, expect, it } from 'vitest';
import {
  brierScore,
  claimHolds,
  emptyScoreboard,
  forecast,
  probabilityWithin,
  recordOutcome,
  selectPredictions,
} from '../engine/predict.js';
import type { Prediction } from '../engine/predict.js';
import { advanceCampaign, createCampaign } from '../engine/campaign.js';
import { createWorld } from '../engine/world.js';
import { simulate } from '../engine/tick.js';

const OPTIONS = { rollouts: 24, horizons: [60, 150] };

describe('Monte Carlo', () => {
  it('rollouty se navzájem rozejdou, ale vycházejí ze stejného světa', () => {
    const world = simulate(createWorld(11), 600).world;
    const raw = forecast(world, 600, OPTIONS);

    expect(raw.size).toBeGreaterThan(3);
    for (const entry of raw.values()) {
      expect(entry.firstStep.length).toBe(OPTIONS.rollouts);
    }

    // Kdyby všechny kopie dopadly identicky, nebylo by co počítat.
    const variety = [...raw.values()].some(
      (entry) => new Set(entry.firstStep).size > 1,
    );
    expect(variety).toBe(true);
  });

  it('pravděpodobnost roste s delší lhůtou, nikdy neklesá', () => {
    const world = simulate(createWorld(7), 800).world;
    const raw = forecast(world, 800, { rollouts: 20, horizons: [40, 120, 300] });

    for (const entry of raw.values()) {
      const a = probabilityWithin(entry, 40);
      const b = probabilityWithin(entry, 120);
      const c = probabilityWithin(entry, 300);
      expect(b).toBeGreaterThanOrEqual(a);
      expect(c).toBeGreaterThanOrEqual(b);
    }
  });

  it('stejný svět a stejný tick dají stejné předpovědi', () => {
    const world = simulate(createWorld(3), 700).world;
    const a = selectPredictions(forecast(world, 700, OPTIONS), 700, 1, OPTIONS);
    const b = selectPredictions(forecast(world, 700, OPTIONS), 700, 1, OPTIONS);
    expect(a.map((p) => `${p.id}:${p.probability}`)).toEqual(
      b.map((p) => `${p.id}:${p.probability}`),
    );
  });

  it('vybírají se tvrzení, která něco riskují', () => {
    const world = simulate(createWorld(11), 600).world;
    const picks = selectPredictions(forecast(world, 600, OPTIONS), 600, 1, OPTIONS);

    expect(picks.length).toBeGreaterThan(0);
    for (const p of picks) {
      // Jistoty do panelu nepatří — nic by nesdělovaly a kalibraci by nafoukly.
      expect(p.probability).toBeGreaterThan(0);
      expect(p.probability).toBeLessThan(1);
      expect(p.resolveAtTick).toBeGreaterThan(p.madeAtTick);
      expect(p.text.length).toBeGreaterThan(8);
    }
  });
});

describe('vyhodnocování', () => {
  it('předpověď se uzavře v termínu podle toho, jestli věc nastala', () => {
    const campaign = createCampaign(5, 0);
    advanceCampaign(campaign, 300);

    // Tvrzení, které v tu chvíli určitě neplatí a platit nezačne.
    campaign.predictions.push({
      id: 'test:nikdy',
      claim: { type: 'population', direction: 'above', value: 1e12 },
      text: 'nikdy',
      probability: 0.3,
      madeAtTick: 300,
      resolveAtTick: 320,
      run: campaign.world.run,
      happened: false,
      outcome: 'pending',
    });

    advanceCampaign(campaign, 319);
    expect(campaign.predictions[0]?.outcome).toBe('pending');

    advanceCampaign(campaign, 320);
    expect(campaign.predictions[0]?.outcome).toBe('miss');
    expect(campaign.scoreboard.resolved).toBe(1);
  });

  it('tvrzení, které nastane, se zaznamená hned a uzavře jako zásah', () => {
    const campaign = createCampaign(5, 0);
    advanceCampaign(campaign, 200);

    campaign.predictions.push({
      id: 'test:jistota',
      claim: { type: 'population', direction: 'above', value: 1 },
      text: 'jistota',
      probability: 0.8,
      madeAtTick: 200,
      resolveAtTick: 260,
      run: campaign.world.run,
      happened: false,
      outcome: 'pending',
    });

    advanceCampaign(campaign, 205);
    expect(campaign.predictions[0]?.happened).toBe(true);

    advanceCampaign(campaign, 260);
    expect(campaign.predictions[0]?.outcome).toBe('hit');
    expect(campaign.scoreboard.hits).toBe(1);
  });

  it('zánik civilizace uzavře i předpovědi, které ještě nedozrály', () => {
    // Předpověď měla riziko zániku zahrnout; nesplněné tvrzení je minutí,
    // ne omluvitelná okolnost.
    const campaign = createCampaign(5, 0);
    advanceCampaign(campaign, 100);
    campaign.world.ending = { kind: 'extinction', cause: 'collapse', tick: campaign.world.tick, year: campaign.world.year };

    campaign.predictions.push({
      id: 'test:nedozraje',
      claim: { type: 'epoch', epoch: 13 },
      text: 'nedozraje',
      probability: 0.4,
      madeAtTick: 100,
      resolveAtTick: 9999,
      run: campaign.world.run,
      happened: false,
      outcome: 'pending',
    });

    advanceCampaign(campaign, 102);
    expect(campaign.predictions[0]?.outcome).toBe('miss');
  });
});

describe('kalibrace', () => {
  it('Brier trestá sebejistý omyl víc než opatrný', () => {
    const bold = emptyScoreboard();
    const cautious = emptyScoreboard();
    const base = {
      id: 'x', claim: { type: 'war' } as const, text: 'x',
      madeAtTick: 0, resolveAtTick: 1, run: 1, happened: false,
    };

    recordOutcome(bold, { ...base, probability: 0.95, outcome: 'miss' } as Prediction);
    recordOutcome(cautious, { ...base, probability: 0.55, outcome: 'miss' } as Prediction);

    expect(brierScore(bold)!).toBeGreaterThan(brierScore(cautious)!);
  });

  it('bezchybná předpověď má Brier nula, hod mincí zhruba čtvrtinu', () => {
    const perfect = emptyScoreboard();
    const base = {
      id: 'x', claim: { type: 'war' } as const, text: 'x',
      madeAtTick: 0, resolveAtTick: 1, run: 1, happened: false,
    };
    recordOutcome(perfect, { ...base, probability: 1, outcome: 'hit' } as Prediction);
    recordOutcome(perfect, { ...base, probability: 0, outcome: 'miss' } as Prediction);
    expect(brierScore(perfect)).toBe(0);

    const coin = emptyScoreboard();
    recordOutcome(coin, { ...base, probability: 0.5, outcome: 'hit' } as Prediction);
    recordOutcome(coin, { ...base, probability: 0.5, outcome: 'miss' } as Prediction);
    expect(brierScore(coin)).toBeCloseTo(0.25, 6);
  });

  it('koše řadí předpovědi podle desítek procent', () => {
    const board = emptyScoreboard();
    const base = {
      id: 'x', claim: { type: 'war' } as const, text: 'x',
      madeAtTick: 0, resolveAtTick: 1, run: 1, happened: false,
    };
    recordOutcome(board, { ...base, probability: 0.72, outcome: 'hit' } as Prediction);
    recordOutcome(board, { ...base, probability: 0.79, outcome: 'miss' } as Prediction);
    recordOutcome(board, { ...base, probability: 1, outcome: 'hit' } as Prediction);

    expect(board.buckets[7]).toEqual({ total: 2, hits: 1 });
    expect(board.buckets[9]).toEqual({ total: 1, hits: 1 });
  });

  it('tvrzení o milníku čte tentýž stav, jaký vidí simulace', () => {
    const world = simulate(createWorld(11), 900).world;
    const anyUnlocked = Object.keys(world.tech.unlocked)[0];
    expect(anyUnlocked).toBeDefined();
    expect(claimHolds({ type: 'milestone', id: anyUnlocked! }, world, [])).toBe(true);
    expect(claimHolds({ type: 'milestone', id: 'neexistuje' }, world, [])).toBe(false);
  });
});
