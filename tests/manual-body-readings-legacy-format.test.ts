// @vitest-environment jsdom
// The fork shipped bare-value rows (`weight.2026-09-28: 82.5`) before upstream's
// `{value, updatedAt}` format. These keep that data readable after adopting it.
import {IDBFactory} from 'fake-indexeddb';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {state} from '../js/state.js';
import {createDefaultProfileData} from '../js/profile.js';
import {saveImportedData} from '../js/data.js';
import {logManualMetric, parseManualMirrorEntry, upgradeLegacyManualMirror} from '../js/wearables-manual.js';
import {applyPulledManualBodyReadings, catchUpManualBodyReadings} from '../js/wearables-manual-sync.js';
import {getDaily, deleteWearablesDB} from '../js/wearables-store.js';
const profile = 'manual-legacy-test', date = '2026-09-28', key = (metric: string) => `${metric}.${date}`;
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory(); localStorage.clear();
  state.currentProfile = profile; state.importedData = createDefaultProfileData();
  state.profiles = [{id: profile, name: 'Synthetic legacy profile'}];
  localStorage.setItem('labcharts-active-profile', profile);
  expect(await saveImportedData()).toBe(true);
});
afterEach(async () => {vi.restoreAllMocks(); await deleteWearablesDB(profile); localStorage.clear();});
it('wraps valid bare rows at clock 0 and leaves invalid, current and null rows alone', () => {
  const current = {value: 70, updatedAt: 5};
  const data = {manualBodyReadings: {
    [key('weight')]: 82.5, [key('tags')]: ['resting'], [key('note')]: 'legacy note',
    [key('rhr')]: 'sixty', 'bogus.2026-09-28': 1, [key('bp_systolic')]: current, [key('bp_diastolic')]: null,
  }} as unknown as Parameters<typeof upgradeLegacyManualMirror>[0];
  expect(upgradeLegacyManualMirror(data)).toBe(3);
  const mirror = data.manualBodyReadings as Record<string, unknown>;
  expect(mirror[key('weight')]).toEqual({value: 82.5, updatedAt: 0});
  expect(parseManualMirrorEntry(key('tags'), mirror[key('tags')])).toMatchObject({value: ['resting']});
  expect(mirror[key('rhr')]).toBe('sixty');
  expect(mirror['bogus.2026-09-28']).toBe(1);
  expect(mirror[key('bp_systolic')]).toBe(current);
  expect(mirror[key('bp_diastolic')]).toBeNull();
  expect(upgradeLegacyManualMirror(data)).toBe(0);
});
it('applies a pulled bare-value mirror to this device\'s manual row', async () => {
  const draft = {...createDefaultProfileData(), manualBodyReadings: {[key('weight')]: 82.5, [key('rhr')]: 60}} as unknown as Parameters<typeof applyPulledManualBodyReadings>[1];
  await applyPulledManualBodyReadings(profile, draft);
  expect(await getDaily(profile, 'manual', date)).toMatchObject({weight: 82.5, rhr: 60});
});
it('upgrades bare rows already saved in the profile on catch-up, without overriding newer edits', async () => {
  await logManualMetric(profile, 'rhr', {date, value: 58});
  const newer = state.importedData.manualBodyReadings![key('rhr')]!;
  (state.importedData.manualBodyReadings as Record<string, unknown>)[key('weight')] = 82.5;
  await saveImportedData();
  await catchUpManualBodyReadings(profile);
  expect(state.importedData.manualBodyReadings![key('weight')]).toEqual({value: 82.5, updatedAt: 0});
  expect(state.importedData.manualBodyReadings![key('rhr')]).toEqual(newer);
  expect(await getDaily(profile, 'manual', date)).toMatchObject({weight: 82.5, rhr: 58});
});
