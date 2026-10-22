import assert from 'node:assert/strict';
import {wearableAcceptanceTime} from './wearable-detail-pwa-receipt.js';

const at = Date.parse(wearableAcceptanceTime);
const states = ['migrated-baseline', 'after-bp-save', 'after-same-date-merge', 'after-selected-pair-delete'];
/** An authored additive contract, independent of runtime mirror/backfill code.
 * Historical receipts stay immutable; every old field and raw storage byte is
 * retained in the complete expected receipt alongside these exact new fields. */
export function wearableManualMirror(state: string) {
  assert(states.includes(state), 'Known original manual journey state');
  const mirror: Record<string, {value: number | string | string[] | null; updatedAt: number}> = {};
  for (const [date, weight, systolic, diastolic, pulse] of [
    ['2025-01-10', 74, 124, 82, 64],
    ['2026-07-31', 73, 122, 80, 62],
    ['2026-08-05', 72, 120, 78, 60],
  ] as const) {
    for (const [field, value] of [['weight', weight], ['bp_systolic', systolic], ['bp_diastolic', diastolic], ['rhr', pulse]] as const)
      mirror[`${field}.${date}`] = {value, updatedAt: 0};
  }
  if (state !== 'migrated-baseline') {
    const deleted = state === 'after-selected-pair-delete';
    for (const [field, value] of Object.entries({bp_systolic: deleted ? null : 121, bp_diastolic: deleted ? null : 79, rhr: 61, tags: ['resting'], note: 'Synthetic note <&> "paired"'}))
      mirror[`${field}.2026-08-06`] = {value, updatedAt: at};
    if (state !== 'after-bp-save') mirror['weight.2026-08-06'] = {value: 71.5, updatedAt: at};
  }
  return mirror;
}
interface ProfileReceipt {
  live: Record<string, unknown>; stored: Record<string, unknown>; rawCommitted: string;
}
export function qualifyWearableManualProfile<T extends ProfileReceipt>(original: T, state: string): T {
  assert.equal(original.rawCommitted, JSON.stringify(original.stored), 'Exact original committed serialization');
  const extend = (data: Record<string, unknown>) => {
    assert(!Object.hasOwn(data, 'manualBodyReadings'), 'Original receipt predates manual Sync');
    assert(Object.hasOwn(data, 'wearableSummary'), 'Original summary insertion boundary');
    return Object.fromEntries(Object.entries(data).flatMap(([key, value]) => key === 'wearableSummary'
      ? [['manualBodyReadings', wearableManualMirror(state)], [key, structuredClone(value)]]
      : [[key, structuredClone(value)]]));
  };
  const stored = extend(original.stored);
  return {...structuredClone(original), live: extend(original.live), stored, rawCommitted: JSON.stringify(stored)};
}
interface StoreReceipt {name: string; keys: unknown[]; values: Array<Record<string, unknown>>}
function store(value: unknown): StoreReceipt {
  assert(value && typeof value === 'object' && 'name' in value && 'keys' in value && 'values' in value, 'Original complete store receipt');
  return structuredClone(value) as StoreReceipt;
}
export function qualifyWearableManualDaily(original: unknown, state: string, phase: number): unknown {
  wearableManualMirror(state); assert([0, 1, 2].includes(phase), 'Known closed-client phase');
  const daily = store(original);
  for (const row of daily.values) {
    assert.equal(row.source, 'manual'); assert(!Object.hasOwn(row, '_manualSyncAt'), 'Original rows predate edit clocks');
    if (row.date === '2026-08-06') {
      const clocks: Record<string, number> = {bp_systolic: at, bp_diastolic: at, rhr: at, tags: at, note: at};
      if (state !== 'after-bp-save') clocks.weight = at;
      row._manualSyncAt = clocks;
    } else if (phase > 0) row._manualSyncAt = {weight: 0, bp_systolic: 0, bp_diastolic: 0, rhr: 0};
  }
  return daily;
}
interface DeviceReceipt {stores: unknown; dailyRows: unknown; otherStores: unknown}
export function qualifyWearableManualDevice<T extends DeviceReceipt>(original: T, state: string, phase: number): T {
  assert(Array.isArray(original.stores) && Array.isArray(original.otherStores), 'Original full device stores');
  const qualifyStore = (value: unknown) => {
    const result = store(value);
    if (result.name === 'daily-metrics') return qualifyWearableManualDaily(value, state, phase);
    assert.equal(result.name, 'meta', 'Only original known store owners');
    const key = 'manual-body-readings-backfilled-v1';
    assert(!result.keys.includes(key), 'Original metadata predates backfill');
    result.keys.push(key); result.values.push({k: key, v: {at}, updatedAt: at});
    return result;
  };
  return {...structuredClone(original), stores: original.stores.map(qualifyStore),
    dailyRows: qualifyWearableManualDaily(original.dailyRows, state, phase), otherStores: original.otherStores.map(qualifyStore)};
}
