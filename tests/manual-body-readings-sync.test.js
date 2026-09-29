// @vitest-environment jsdom

import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { state } from '../js/state.js';
import { saveImportedData } from '../js/data.js';
import {
  deleteAllManualMetrics,
  deleteManualMetric,
  logManualBP,
  logManualMetric,
} from '../js/wearables-manual.js';
import { backfillManualBodyReadingsMirror } from '../js/wearables-manual-sync.js';
import { deleteWearablesDB, getDaily, upsertDaily } from '../js/wearables-store.js';
import { reconcilePulledManualWearables } from '../js/profile-runtime.js';
import { DELTA_MAPS, _planKeyedMapDelta } from '../js/sync-delta.js';

const PROFILE_ID = 'manual-body-readings-sync';
let previousProfile;
let previousImportedData;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  previousProfile = state.currentProfile;
  previousImportedData = state.importedData;
  state.currentProfile = PROFILE_ID;
  localStorage.setItem('labcharts-active-profile', PROFILE_ID);
  state.importedData = { entries: [], manualMetricTombstones: {} };
  expect(await saveImportedData()).toBe(true);
});

afterEach(async () => {
  await deleteWearablesDB(PROFILE_ID).catch(() => {});
  state.currentProfile = previousProfile;
  state.importedData = previousImportedData;
  localStorage.clear();
});

describe('manual body readings reach the synced Profile data', () => {
  it('logging a weight adds one synced entry keyed <field>.<date>', async () => {
    await logManualMetric(PROFILE_ID, 'weight', { date: '2026-09-28', value: 82 });

    expect(state.importedData.manualBodyReadings).toEqual({ 'weight.2026-09-28': 82 });
  });

  it('logging blood pressure and pulse adds one synced entry per field', async () => {
    await logManualBP(PROFILE_ID, { date: '2026-09-28', systolic: 120, diastolic: 80, pulse: 60 });

    expect(state.importedData.manualBodyReadings).toEqual({
      'bp_systolic.2026-09-28': 120,
      'bp_diastolic.2026-09-28': 80,
      'rhr.2026-09-28': 60,
    });
  });

  it('tags and the note travel with the reading', async () => {
    await logManualMetric(PROFILE_ID, 'weight', {
      date: '2026-09-28',
      value: 82,
      tags: ['resting'],
      note: 'after waking',
    });

    expect(state.importedData.manualBodyReadings).toEqual({
      'weight.2026-09-28': 82,
      'tags.2026-09-28': ['resting'],
      'note.2026-09-28': 'after waking',
    });
  });

  it('deleting one reading removes only that synced entry', async () => {
    await logManualMetric(PROFILE_ID, 'weight', { date: '2026-09-28', value: 82 });
    await logManualBP(PROFILE_ID, { date: '2026-09-28', pulse: 60 });

    await deleteManualMetric(PROFILE_ID, 'weight', '2026-09-28');

    expect(state.importedData.manualBodyReadings).toEqual({ 'rhr.2026-09-28': 60 });
  });

  it('deleting the last reading of a date also drops its tags and note', async () => {
    await logManualMetric(PROFILE_ID, 'weight', {
      date: '2026-09-28',
      value: 82,
      tags: ['resting'],
      note: 'after waking',
    });

    await deleteManualMetric(PROFILE_ID, 'weight', '2026-09-28');

    expect(state.importedData.manualBodyReadings).toEqual({});
  });

  it('deleting all manual readings empties the synced entries', async () => {
    await logManualMetric(PROFILE_ID, 'weight', { date: '2026-09-28', value: 82 });
    await logManualBP(PROFILE_ID, { date: '2026-09-27', systolic: 120, diastolic: 80 });

    await deleteAllManualMetrics(PROFILE_ID);

    expect(state.importedData.manualBodyReadings).toEqual({});
  });

  it('ships one CRDT row per field through the per-map sync surface', async () => {
    expect(DELTA_MAPS).toContain('manualBodyReadings');

    const plan = await _planKeyedMapDelta(PROFILE_ID, 'manualBodyReadings', {
      'weight.2026-09-28': 82,
      'tags.2026-09-28': ['resting'],
    });

    expect(plan.ops).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'insert',
        args: expect.objectContaining({ arrayName: 'manualBodyReadings', itemId: 'weight.2026-09-28' }),
      }),
      expect.objectContaining({
        kind: 'insert',
        args: expect.objectContaining({ arrayName: 'manualBodyReadings', itemId: 'tags.2026-09-28' }),
      }),
    ]));
  });
});

describe('synced manual body readings arrive on another device', () => {
  it('a pull writes the readings into this device\'s Reading store', async () => {
    const merged = {
      manualMetricTombstones: {},
      wearableConnections: {},
      manualBodyReadings: {
        'weight.2026-09-28': 82,
        'rhr.2026-09-28': 60,
        'tags.2026-09-28': ['resting'],
        'note.2026-09-28': 'after waking',
      },
    };

    const changed = await reconcilePulledManualWearables(PROFILE_ID, merged);

    expect(changed).toBe(true);
    expect(await getDaily(PROFILE_ID, 'manual', '2026-09-28')).toMatchObject({
      weight: 82,
      rhr: 60,
      tags: ['resting'],
      note: 'after waking',
    });
  });

  it('does not resurrect a reading that carries a synced deletion marker', async () => {
    const merged = {
      manualMetricTombstones: { 'weight.2026-09-28': Date.now() },
      wearableConnections: {},
      manualBodyReadings: { 'weight.2026-09-28': 82, 'rhr.2026-09-28': 60 },
    };

    await reconcilePulledManualWearables(PROFILE_ID, merged);

    const row = await getDaily(PROFILE_ID, 'manual', '2026-09-28');
    expect(row).toMatchObject({ rhr: 60 });
    expect(row.weight).toBeUndefined();
  });

  it('writes no stub row when only tags or a note remain for a date', async () => {
    const merged = {
      manualMetricTombstones: { 'weight.2026-09-28': Date.now() },
      wearableConnections: {},
      manualBodyReadings: {
        'weight.2026-09-28': 82,
        'tags.2026-09-28': ['resting'],
        'note.2026-09-28': 'after waking',
      },
    };

    await reconcilePulledManualWearables(PROFILE_ID, merged);

    expect(await getDaily(PROFILE_ID, 'manual', '2026-09-28')).toBeFalsy();
  });

  it('follows an edit that arrives for a reading this device already has', async () => {
    await upsertDaily(PROFILE_ID, { source: 'manual', date: '2026-09-28', weight: 80, rhr: 58 });
    const merged = {
      manualMetricTombstones: {},
      wearableConnections: {},
      manualBodyReadings: { 'weight.2026-09-28': 81 },
    };

    await reconcilePulledManualWearables(PROFILE_ID, merged);

    expect(await getDaily(PROFILE_ID, 'manual', '2026-09-28')).toMatchObject({ weight: 81, rhr: 58 });
  });

  it('marks Manual as connected on this device, since connections never sync', async () => {
    const merged = {
      manualMetricTombstones: {},
      wearableConnections: {},
      manualBodyReadings: { 'weight.2026-09-28': 82 },
    };

    await reconcilePulledManualWearables(PROFILE_ID, merged);

    expect(merged.wearableConnections.manual).toMatchObject({ source: 'manual', needsReauth: false });
  });
});

describe('first-run backfill of readings that predate the synced copy', () => {
  it('adds existing Reading store rows to the synced entries', async () => {
    await upsertDaily(PROFILE_ID, {
      source: 'manual',
      date: '2026-09-01',
      weight: 80,
      rhr: 58,
      tags: ['resting'],
      note: 'baseline',
    });

    await backfillManualBodyReadingsMirror(PROFILE_ID);

    expect(state.importedData.manualBodyReadings).toEqual({
      'weight.2026-09-01': 80,
      'rhr.2026-09-01': 58,
      'tags.2026-09-01': ['resting'],
      'note.2026-09-01': 'baseline',
    });
  });

  it('runs once: rows written straight to the store later are not swept in', async () => {
    await upsertDaily(PROFILE_ID, { source: 'manual', date: '2026-09-01', weight: 80 });
    await backfillManualBodyReadingsMirror(PROFILE_ID);
    await upsertDaily(PROFILE_ID, { source: 'manual', date: '2026-09-02', weight: 81 });

    await backfillManualBodyReadingsMirror(PROFILE_ID);

    expect(state.importedData.manualBodyReadings).toEqual({ 'weight.2026-09-01': 80 });
  });

  it('does not use up its one run on an empty store', async () => {
    await backfillManualBodyReadingsMirror(PROFILE_ID);
    await upsertDaily(PROFILE_ID, { source: 'manual', date: '2026-09-01', weight: 80 });

    await backfillManualBodyReadingsMirror(PROFILE_ID);

    expect(state.importedData.manualBodyReadings).toEqual({ 'weight.2026-09-01': 80 });
  });

  it('skips a reading that carries a deletion marker and never removes received entries', async () => {
    await upsertDaily(PROFILE_ID, { source: 'manual', date: '2026-09-01', weight: 80, rhr: 58 });
    state.importedData.manualMetricTombstones = { 'weight.2026-09-01': Date.now() };
    state.importedData.manualBodyReadings = { 'weight.2026-08-01': 70 };

    await backfillManualBodyReadingsMirror(PROFILE_ID);

    expect(state.importedData.manualBodyReadings).toEqual({
      'weight.2026-08-01': 70,
      'rhr.2026-09-01': 58,
    });
  });
});
