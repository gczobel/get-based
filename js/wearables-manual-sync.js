// @ts-check
// wearables-manual-sync.js - Inbound half of manual body reading sync. Loaded
// lazily (see LAZY_SYNC_CHUNK_MODULES) so startup stays small; the write half
// lives beside the log/delete functions in wearables-manual.js.

import { queueManualRowWrite } from './wearables-manual-lock.js';
import { getDaily, getDailyRange, getMeta, setMeta, upsertDaily } from './wearables-store.js';
import {
  MANUAL_METRICS,
  MANUAL_MIRROR_FIELD,
  MIRROR_FIELDS,
  captureManualMutation,
  isManualMetricTombstoned,
  persistManualMutation,
  updateManualConnection,
} from './wearables-manual.js';

const MIRROR_BACKFILL_FLAG = 'manual-body-readings-backfilled-v1';
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HISTORY_START = '1970-01-01';
const HISTORY_END = '9999-12-31';

/** Write synced readings into this device's Reading store; returns dates written.
 * @param {import('../types/app-state.js').ProfileData} merged */
export async function applyPulledManualBodyReadings(profileId, merged) {
  const mirror = merged?.[MANUAL_MIRROR_FIELD];
  if (!profileId || !mirror || typeof mirror !== 'object' || Array.isArray(mirror)) return 0;
  const byDate = new Map();
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
      // Local wins, like typed lab values.
      const missing = Object.fromEntries(Object.entries(incoming).filter(([field]) => existing?.[field] == null));
      if (Object.keys(missing).length === 0) continue;
      await upsertDaily(profileId, { ...(existing || {}), ...missing, source: 'manual', date });
      written++;
    }
    if (written > 0) updateManualConnection(merged);
    return written;
  });
}

// One-time, add-only copy of pre-existing readings into the synced entries.
export async function backfillManualBodyReadingsMirror(profileId) {
  if (await getMeta(profileId, MIRROR_BACKFILL_FLAG)) return { skipped: 'already-backfilled' };
  const { imported, baseData } = captureManualMutation(profileId);
  const rows = await getDailyRange(profileId, 'manual', HISTORY_START, HISTORY_END);
  // An empty read may be a locked store: keep the one run.
  if (rows.length === 0) return { added: 0 };
  const mirror = imported[MANUAL_MIRROR_FIELD] || (imported[MANUAL_MIRROR_FIELD] = {});
  let added = 0;
  for (const row of rows) {
    for (const field of MIRROR_FIELDS) {
      const key = `${field}.${row.date}`;
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
