import {expect, it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {materializeWearableNativeFixture} from '../scripts/wearable-native-fixture.mjs';
import {qualifyWearableManualProfile, qualifyWearableManualDevice, wearableManualMirror} from './helpers/wearable-manual-sync-expectations.js';

it('extends every authenticated original whole-profile receipt without changing any historical field or serialization order', async () => {
  const fixture = await materializeWearableNativeFixture();
  try {
    const manifest = JSON.parse(await fs.readFile(fixture.manifestFile, 'utf8')) as {cases: Array<{capture: {file: string}}>};
    for (const entry of manifest.cases) {
      const capture = JSON.parse(await fs.readFile(path.join(fixture.directory, entry.capture.file), 'utf8')) as {
        oracle: {profileStates: Record<string, {live: Record<string, unknown>; stored: Record<string, unknown>; rawCommitted: string}>};
      };
      for (const [state, original] of Object.entries(capture.oracle.profileStates)) {
        const before = JSON.stringify(original), expected = qualifyWearableManualProfile(original, state);
        expect(JSON.stringify(original)).toBe(before);
        for (const key of ['live', 'stored'] as const) {
          const {manualBodyReadings, ...historical} = expected[key];
          expect(historical).toEqual(original[key]);
          expect(manualBodyReadings).toEqual(wearableManualMirror(state));
        }
        expect(JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(expected.rawCommitted) as Record<string, unknown>).filter(([key]) => key !== 'manualBodyReadings')))).toBe(original.rawCommitted);
        const corrupted = structuredClone(expected);
        corrupted.stored.contextNotes = 'lost unrelated data';
        expect(corrupted).not.toEqual(expected);
        (corrupted.stored.manualBodyReadings as Record<string, unknown>)['weight.2025-01-10'] = {value: 740, updatedAt: 0};
        expect(corrupted.stored.manualBodyReadings).not.toEqual(expected.stored.manualBodyReadings);
      }
    }
  } finally {await fixture.cleanup();}
});
it('requires known states and exact original serialization instead of accepting already changed historical inputs', () => {
  const original = {live: {wearableSummary: {}}, stored: {wearableSummary: {}}, rawCommitted: '{"wearableSummary":{}}'};
  expect(() => qualifyWearableManualProfile(original, 'unknown')).toThrow('Known original');
  expect(() => qualifyWearableManualProfile({...original, rawCommitted: '{}'}, 'migrated-baseline')).toThrow('Exact original');
  expect(() => qualifyWearableManualProfile({...original, live: {...original.live, manualBodyReadings: {}}}, 'migrated-baseline')).toThrow('predates manual Sync');
});
it('expects exactly the new backfill metadata and phase-specific clocks without mutating original device records', () => {
  const daily = {name: 'daily-metrics', keys: [['manual', '2025-01-10']], values: [{source: 'manual', date: '2025-01-10', weight: 74}]};
  const meta = {name: 'meta', keys: ['biometrics-migrated-v1'], values: [{k: 'biometrics-migrated-v1', v: {counts: 3}}]};
  const original = {stores: [daily, meta], dailyRows: daily, otherStores: [meta]};
  const before = JSON.stringify(original), warm = qualifyWearableManualDevice(original, 'migrated-baseline', 0), cold = qualifyWearableManualDevice(original, 'after-selected-pair-delete', 1);
  expect(warm.dailyRows).toEqual(daily);
  expect(cold.dailyRows).toEqual({...daily, values: [{...daily.values[0], _manualSyncAt: {weight: 0, bp_systolic: 0, bp_diastolic: 0, rhr: 0}}]});
  expect(warm.otherStores).toEqual([{...meta, keys: [...meta.keys, 'manual-body-readings-backfilled-v1'], values: [...meta.values, {k: 'manual-body-readings-backfilled-v1', v: {at: 1786104000000}, updatedAt: 1786104000000}]}]);
  expect(JSON.stringify(original)).toBe(before);
  expect(() => qualifyWearableManualDevice(original, 'migrated-baseline', 3)).toThrow('Known closed-client phase');
});
