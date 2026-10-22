import {beforeEach, afterEach, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({read: vi.fn(), range: vi.fn(), write: vi.fn(), remove: vi.fn(), meta: vi.fn(), flag: vi.fn(), save: vi.fn()}));
vi.mock('../js/wearables-store.js', async original => ({...await original<typeof import('../js/wearables-store.js')>(), getDaily: mocks.read, getDailyRange: mocks.range, upsertDaily: mocks.write, deleteDaily: mocks.remove, getMeta: mocks.meta, setMeta: mocks.flag, upsertDailyBatch: vi.fn(), clearSource: vi.fn(), countSource: vi.fn()}));
vi.mock('../js/data.js', () => ({saveImportedDataForProfile: mocks.save, saveImportedData: vi.fn()}));
vi.mock('../js/wearables-summary.js', () => ({syncWearableSummary: vi.fn()}));
import {state} from '../js/state.js';
import {encryptedGetItem, encryptedSetItem, encryptedRemoveItem} from '../js/crypto.js';
import {createDefaultProfileData} from '../js/profile.js';
import {setSyncAppOwner} from '../js/sync-runtime.js';
import {applyPulledManualBodyReadings, catchUpManualBodyReadings, refreshRestoredManualSummary} from '../js/wearables-manual-sync.js';
const date = '2026-09-21';
beforeEach(async () => {
  vi.resetAllMocks(); state.currentProfile = 'origin'; state.importedData = createDefaultProfileData();
  localStorage.clear(); await encryptedRemoveItem('labcharts-origin-imported');
  await encryptedSetItem('labcharts-origin-imported', JSON.stringify(state.importedData));
  setSyncAppOwner({id: 'owner-a'}); mocks.save.mockResolvedValue(true); mocks.range.mockResolvedValue([]); mocks.meta.mockResolvedValue(null);
});
afterEach(async () => {setSyncAppOwner(null); await encryptedRemoveItem('labcharts-origin-imported');});
it.each(['profile', 'data', 'owner'])('does not write retired incoming data when %s changes during row lookup', async kind => {
  const destination = createDefaultProfileData();
  mocks.read.mockImplementation(async () => {
    if (kind === 'profile') {state.currentProfile = 'other'; state.importedData = destination;}
    if (kind === 'data') state.importedData = destination;
    if (kind === 'owner') setSyncAppOwner({id: 'owner-b'});
    return null;
  });
  await applyPulledManualBodyReadings('origin', {manualBodyReadings: {[`weight.${date}`]: {value: 80, updatedAt: 100}}});
  expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  expect(destination).toEqual(createDefaultProfileData());
});
it('does not overwrite a newer local row while its metadata save is pending', async () => {
  mocks.read.mockResolvedValue({source: 'manual', date, weight: 82, _manualSyncAt: {weight: 200}});
  await applyPulledManualBodyReadings('origin', {manualBodyReadings: {[`weight.${date}`]: {value: 80, updatedAt: 100}}});
  expect(mocks.write).not.toHaveBeenCalled();
});
it.each(['profile', 'data', 'owner'])('does not persist an obsolete backfill after %s changes during its scan', async kind => {
  mocks.range.mockImplementation(async () => {
    if (kind === 'profile') state.currentProfile = 'other';
    if (kind === 'data') state.importedData = createDefaultProfileData();
    if (kind === 'owner') setSyncAppOwner({id: 'owner-b'});
    return [{source: 'manual', date, weight: 80}];
  });
  await catchUpManualBodyReadings('origin');
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.flag).not.toHaveBeenCalled();
});
it('does not mark the upgrade complete after profile metadata persistence fails', async () => {
  mocks.range.mockResolvedValue([{source: 'manual', date, weight: 80}]); mocks.save.mockResolvedValue(false);
  await expect(catchUpManualBodyReadings('origin')).rejects.toThrow(/save/i);
  expect(mocks.flag).not.toHaveBeenCalled();
});

it('bounds retries when peer changes keep invalidating the upgrade snapshot', async () => {
  mocks.range.mockResolvedValue([{source: 'manual', date, weight: 80}]);
  mocks.save.mockImplementation(async () => {
    const stored = JSON.parse((await encryptedGetItem('labcharts-origin-imported'))!) as typeof state.importedData;
    stored.contextNotes += 'peer edit'; await encryptedSetItem('labcharts-origin-imported', JSON.stringify(stored));
    return false;
  });
  await expect(catchUpManualBodyReadings('origin')).rejects.toThrow(/save/i);
  expect(mocks.save).toHaveBeenCalledTimes(3); expect(mocks.flag).not.toHaveBeenCalled();
});


it.each(['profile', 'data', 'owner'])('does not write retired incoming data when %s changes during canonical intent lookup', async kind => {
  const crypto = await import('../js/crypto.js'), read = crypto.encryptedGetItem, destination = createDefaultProfileData();
  mocks.read.mockResolvedValue(null);
  const lookup = vi.spyOn(crypto, 'encryptedGetItem').mockImplementationOnce(async (...args) => {
    const raw = await read(...args);
    if (kind === 'profile') {state.currentProfile = 'other'; state.importedData = destination;}
    if (kind === 'data') state.importedData = destination;
    if (kind === 'owner') setSyncAppOwner({id: 'owner-b'});
    return raw;
  });
  try {
    await applyPulledManualBodyReadings('origin', {manualBodyReadings: {[`weight.${date}`]: {value: 80, updatedAt: 100}}});
    expect(lookup).toHaveBeenCalledOnce(); expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
    expect(destination).toEqual(createDefaultProfileData());
  } finally {lookup.mockRestore();}
});
it('fails closed without row writes when canonical deletion intent cannot be read', async () => {
  const crypto = await import('../js/crypto.js'); mocks.read.mockResolvedValue(null);
  const lookup = vi.spyOn(crypto, 'encryptedGetItem').mockRejectedValueOnce(new Error('Synthetic locked canonical profile'));
  try {
    await expect(applyPulledManualBodyReadings('origin', {manualBodyReadings: {[`weight.${date}`]: {value: 80, updatedAt: 100}}})).rejects.toThrow('locked canonical profile');
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  } finally {lookup.mockRestore();}
});


it.each(['profile', 'data', 'owner'])('does not publish a restored summary when %s retires during its row read', async kind => {
  const destination = createDefaultProfileData();
  mocks.range.mockImplementation(async () => {
    if (kind === 'profile') {state.currentProfile = 'other'; state.importedData = destination;}
    if (kind === 'data') state.importedData = destination;
    if (kind === 'owner') setSyncAppOwner({id: 'owner-b'});
    return [{source: 'manual', date, weight: 80}];
  });
  expect(await refreshRestoredManualSummary('origin')).toBe(false);
  expect(mocks.save).not.toHaveBeenCalled(); expect(destination).toEqual(createDefaultProfileData());
});
