// @vitest-environment jsdom

import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PROFILE_ID = 'manual-body-readings-profile-load';

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  await vi.resetModules();
});

afterEach(() => {
  vi.doUnmock('../js/state.js');
  vi.doUnmock('../js/wearables-connect.js');
  vi.restoreAllMocks();
});

describe('opening a profile that received manual body readings while inactive', () => {
  it('applies the synced readings to this device\'s Reading store', async () => {
    const importedData = {
      manualMetricTombstones: {},
      wearableConnections: {},
      manualBodyReadings: { 'weight.2026-09-28': 82, 'rhr.2026-09-28': 60 },
    };
    const state = { currentProfile: PROFILE_ID, importedData };
    vi.doMock('../js/state.js', () => ({ state }));
    vi.doMock('../js/wearables-connect.js', () => ({
      listConnectedSources: () => ({}),
      recoverPendingWearableDisconnect: vi.fn(async () => false),
      syncStaleWearablesNow: vi.fn(async () => undefined),
    }));

    const { refreshProfileWearables } = await import('../js/profile-runtime.js');
    const { getDaily } = await import('../js/wearables-store.js');

    await refreshProfileWearables(PROFILE_ID, null);

    expect(await getDaily(PROFILE_ID, 'manual', '2026-09-28')).toMatchObject({ weight: 82, rhr: 60 });
  });

  it('copies readings that predate the synced copy into it, once history exists', async () => {
    const importedData = { manualMetricTombstones: {}, wearableConnections: {} };
    const state = { currentProfile: PROFILE_ID, importedData };
    vi.doMock('../js/state.js', () => ({ state }));
    vi.doMock('../js/wearables-connect.js', () => ({
      listConnectedSources: () => ({}),
      recoverPendingWearableDisconnect: vi.fn(async () => false),
      syncStaleWearablesNow: vi.fn(async () => undefined),
    }));

    const { refreshProfileWearables } = await import('../js/profile-runtime.js');
    const { upsertDaily } = await import('../js/wearables-store.js');
    await upsertDaily(PROFILE_ID, { source: 'manual', date: '2026-09-01', weight: 80 });

    await refreshProfileWearables(PROFILE_ID, null);

    expect(state.importedData.manualBodyReadings).toEqual({ 'weight.2026-09-01': 80 });
  });
});
