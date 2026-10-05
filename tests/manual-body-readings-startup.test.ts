// @vitest-environment jsdom

import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PROFILE_ID = 'manual-body-readings-startup';

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  await vi.resetModules();
});

afterEach(() => {
  vi.doUnmock('../js/state.js');
  vi.restoreAllMocks();
});

async function bootWith(importedData: Record<string, unknown>) {
  const state = { currentProfile: PROFILE_ID, importedData };
  vi.doMock('../js/state.js', () => ({ state }));
  const { runPostProfileStartupMaintenance } = await import('../js/startup-maintenance.js');
  const store = await import('../js/wearables-store.js');
  return { state, store, boot: runPostProfileStartupMaintenance };
}

describe('a normal page load (not a profile switch)', () => {
  it('copies readings that predate the synced copy into it', async () => {
    const { state, store, boot } = await bootWith({ manualMetricTombstones: {}, wearableConnections: {} });
    await store.upsertDaily(PROFILE_ID, { source: 'manual', date: '2023-05-04', weight: 94.7 });

    boot();

    await vi.waitFor(() => {
      expect(state.importedData.manualBodyReadings).toEqual({ 'weight.2023-05-04': 94.7 });
    });
  });

  it('applies synced readings to this device\'s Reading store', async () => {
    const { store, boot } = await bootWith({
      manualMetricTombstones: {},
      wearableConnections: {},
      manualBodyReadings: { 'weight.2026-09-28': 82 },
    });

    boot();

    await vi.waitFor(async () => {
      expect(await store.getDaily(PROFILE_ID, 'manual', '2026-09-28')).toMatchObject({ weight: 82 });
    });
  });

  it('does nothing for a profile without manual readings', async () => {
    const { state, boot } = await bootWith({ manualMetricTombstones: {}, wearableConnections: {} });

    boot();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(state.importedData.manualBodyReadings).toBeUndefined();
  });
});
