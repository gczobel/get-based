// wearables-manual-sync.ts - Inbound half of manual body reading sync. Loaded
// lazily (see LAZY_SYNC_CHUNK_MODULES) so startup stays small; the write half
// lives beside the log/delete functions in wearables-manual.ts.

import type { ProfileData } from '../types/app-state.js';
import { queueManualRowWrite } from './wearables-manual-lock.js';
import { getDaily, getDailyRange, getMeta, setMeta, upsertDaily } from './wearables-store.js';
import {
  ISO_DAY_RE,
  MANUAL_HISTORY_END,
  MANUAL_HISTORY_START,
  MANUAL_METRICS,
  MANUAL_MIRROR_FIELD,
  MIRROR_FIELDS,
  captureManualMutation,
  ensureManualConnection,
  hasManualData,
  isManualMetricTombstoned,
  manualMirror,
  manualMirrorKey,
  persistManualMutation,
  updateManualConnection,
} from './wearables-manual.js';

const MIRROR_BACKFILL_FLAG = 'manual-body-readings-backfilled-v1';

/** Write synced readings into this device's Reading store; returns the number of dates written.
 */
export async function applyPulledManualBodyReadings(profileId: string, merged: ProfileData) {
  const mirror = merged?.[MANUAL_MIRROR_FIELD];
  if (!profileId || !mirror || typeof mirror !== 'object' || Array.isArray(mirror)) return 0;
  const byDate = new Map<string, Record<string, unknown>>();
  for (const [key, value] of Object.entries(mirror)) {
    const dot = key.indexOf('.');
    const field = key.slice(0, dot);
    const date = key.slice(dot + 1);
    if (dot < 1 || !ISO_DAY_RE.test(date) || !MIRROR_FIELDS.includes(field)) continue;
    if (MANUAL_METRICS.includes(field) && isManualMetricTombstoned(field, date, merged)) continue;
    byDate.set(date, { ...byDate.get(date), [field]: value });
  }
  return queueManualRowWrite(profileId, async () => {
    let written = 0;
    for (const [date, incoming] of byDate) {
      if (!MANUAL_METRICS.some((m) => incoming[m] != null)) continue;
      const existing = await getDaily(profileId, 'manual', date);
      // The pull already merged these entries, so they are the resolved value.
      const changed = Object.entries(incoming).some(([field, value]) => JSON.stringify(existing?.[field]) !== JSON.stringify(value));
      if (!changed) continue;
      await upsertDaily(profileId, { ...(existing || {}), ...incoming, source: 'manual', date });
      written++;
    }
    if (written > 0) updateManualConnection(merged);
    return written;
  });
}

// One-time, add-only copy of pre-existing readings into the synced entries.
export async function backfillManualBodyReadingsMirror(profileId: string) {
  if (await getMeta(profileId, MIRROR_BACKFILL_FLAG)) return { skipped: 'already-backfilled' };
  const { imported, baseData } = captureManualMutation(profileId);
  const rows = await getDailyRange(profileId, 'manual', MANUAL_HISTORY_START, MANUAL_HISTORY_END);
  // Skip the flag on an empty read: a locked store looks empty, and the run must survive it.
  if (rows.length === 0) return { added: 0 };
  const mirror = manualMirror(imported);
  let added = 0;
  for (const row of rows) {
    for (const field of MIRROR_FIELDS) {
      const key = manualMirrorKey(field, row.date);
      if (MANUAL_METRICS.includes(field) && isManualMetricTombstoned(field, row.date, imported)) continue;
      if (row[field] != null && mirror[key] == null) {
        mirror[key] = row[field];
        added++;
      }
    }
  }
  if (added > 0) await persistManualMutation(profileId, imported, baseData);
  await setMeta(profileId, MIRROR_BACKFILL_FLAG, { at: Date.now(), added });
  return { added };
}

/** Open-time catch-up shared by profile switch and page load: apply what
 * arrived while this profile was inactive, then copy local history out once.
 */
export async function catchUpManualBodyReadings(profileId: string, data: ProfileData) {
  const synced = Object.keys(data?.[MANUAL_MIRROR_FIELD] || {}).length > 0;
  if (!synced && !await hasManualData(profileId)) return;
  await applyPulledManualBodyReadings(profileId, data);
  await backfillManualBodyReadingsMirror(profileId);
  if (!data.wearableConnections?.manual) await ensureManualConnection();
}
