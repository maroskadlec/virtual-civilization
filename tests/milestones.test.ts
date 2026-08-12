/**
 * Integrita stromu milníků a to, že žádná vygenerovaná planeta nevytvoří
 * slepou uličku, ze které se civilizace nemá jak pohnout.
 */

import { describe, expect, it } from 'vitest';
import { MILESTONES, MILESTONE_BY_ID, EPOCH_COST_SCALE, milestonesOfEpoch } from '../engine/milestones.data.js';
import { EPOCHS, epochDef } from '../engine/epochs.js';
import { createWorld } from '../engine/world.js';
import { reachableIds } from '../engine/research.js';
import { generatePlanet } from '../engine/planet.js';

describe('data milníků', () => {
  it('id jsou unikátní', () => {
    const ids = MILESTONES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('všechny předpoklady odkazují na existující milník', () => {
    for (const m of MILESTONES) {
      for (const id of [...(m.requires?.all ?? []), ...(m.requires?.any ?? [])]) {
        expect(MILESTONE_BY_ID.has(id), `${m.id} → ${id}`).toBe(true);
      }
    }
  });

  it('předpoklad nikdy nepatří do pozdější epochy než milník sám', () => {
    for (const m of MILESTONES) {
      for (const id of [...(m.requires?.all ?? []), ...(m.requires?.any ?? [])]) {
        const parent = MILESTONE_BY_ID.get(id);
        expect(parent && parent.epoch <= m.epoch, `${m.id} (E${m.epoch}) → ${id}`).toBe(true);
      }
    }
  });

  it('graf předpokladů je acyklický', () => {
    const state = new Map<string, 'open' | 'done'>();
    const visit = (id: string, trail: string[]): void => {
      if (state.get(id) === 'done') return;
      expect(state.get(id), `cyklus: ${[...trail, id].join(' → ')}`).not.toBe('open');
      state.set(id, 'open');
      const m = MILESTONE_BY_ID.get(id);
      for (const dep of [...(m?.requires?.all ?? []), ...(m?.requires?.any ?? [])]) {
        visit(dep, [...trail, id]);
      }
      state.set(id, 'done');
    };
    for (const m of MILESTONES) visit(m.id, []);
  });

  it('každá epocha s obsahem má měřítko ceny a nenulový počet milníků', () => {
    const epochs = new Set(MILESTONES.map((m) => m.epoch));
    for (const e of epochs) {
      expect(milestonesOfEpoch(e).length).toBeGreaterThan(0);
      expect(EPOCH_COST_SCALE[e]).toBeGreaterThan(0);
    }
  });

  it('EPOCH_COST_SCALE pokrývá všechny definované epochy', () => {
    expect(EPOCH_COST_SCALE.length).toBe(EPOCHS.length);
  });

  it('poměr pro postup epochou je v rozumných mezích', () => {
    for (const e of EPOCHS) {
      expect(epochDef(e.index).advanceRatio).toBeGreaterThan(0.4);
      expect(epochDef(e.index).advanceRatio).toBeLessThanOrEqual(1);
    }
  });
});

describe('planety nevytvářejí slepé uličky', () => {
  it('na každé z 300 vygenerovaných planet je dosažitelné zemědělství i trvalá osada', () => {
    // Bez těchhle dvou se civilizace nikdy nedostane z paleolitu. Nesmí je
    // zablokovat žádná kombinace parametrů planety.
    for (let seed = 1; seed <= 300; seed++) {
      const reachable = reachableIds(createWorld(seed));
      expect(reachable.has('agriculture'), `seed ${seed}`).toBe(true);
      expect(reachable.has('settlement'), `seed ${seed}`).toBe(true);
    }
  });

  it('na každé planetě jde naplnit kvótu pro postup z epochy 0 a 1', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const world = createWorld(seed);
      const reachable = reachableIds(world);
      for (const e of [0, 1]) {
        const all = milestonesOfEpoch(e);
        const ok = all.filter((m) => reachable.has(m.id)).length;
        expect(ok / all.length, `seed ${seed}, epocha ${e}`).toBeGreaterThanOrEqual(
          epochDef(e).advanceRatio,
        );
      }
    }
  });

  it('generátor planety drží parametry ve fyzikálně smysluplných mezích', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const p = generatePlanet(seed);
      expect(p.gravity).toBeGreaterThan(0.4);
      expect(p.gravity).toBeLessThan(2);
      expect(p.oxygen).toBeGreaterThan(0.1);
      expect(p.hydrology).toBeGreaterThan(0);
      expect(p.hydrology).toBeLessThanOrEqual(1);
      expect(p.biosphere.plantYield).toBeGreaterThan(0);
      for (const value of Object.values(p.ores)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(2);
      }
    }
  });
});
