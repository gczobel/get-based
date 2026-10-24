import type {StoredWearableRow} from './wearable-storage-types.js';
// Lazy inbound/catch-up service. Only explicit manual fields cross this boundary.
import type {ProfileData} from '../types/app-state.js';
import type {WearableProfileMutation} from './wearable-persistence-types.js';
import {state} from './state.js';
import {encryptedGetItem} from './crypto.js';
import {profileStorageKey, migrateProfileData} from './profile.js';
import {getSyncAppOwner} from './sync-runtime.js';
import {isProfileReadBlocked} from './profile-load-safety.js';
import {isoDay} from './wearable-adapters.js';
import {queueManualRowWrite} from './wearables-manual-lock.js';
import {getDaily, getDailyRange, getMeta, setMeta, upsertDaily, deleteDaily} from './wearables-store.js';
import {
  MANUAL_METRICS, MANUAL_MIRROR_FIELDS, MANUAL_HISTORY_START, MANUAL_HISTORY_END,
  persistManualMutation, updateManualConnection,
  isManualMetricTombstoned, manualMetricDeletionClock, manualMirror, manualMirrorKey, mirrorManualPatch, parseManualMirrorEntry,
} from './wearables-manual.js';
type ManualData = WearableProfileMutation & Partial<Pick<ProfileData, 'manualBodyReadings' | 'manualMetricTombstones'>>;
type Entry = NonNullable<ReturnType<typeof parseManualMirrorEntry>>;
const BACKFILL_FLAG = 'manual-body-readings-backfilled-v1';
function ownership(profileId: string) {
  const live = state.importedData, owner = getSyncAppOwner();
  return () => state.currentProfile === profileId && state.importedData === live
    && !isProfileReadBlocked(profileId) && getSyncAppOwner() === owner;
}

/** The caller owns the merged draft; never expose it as live state across an await. */
export async function applyPulledManualBodyReadings(profileId: string, data: ManualData, current = ownership(profileId)) {
  if (!current()) return {written: 0, connected: false};
  const byDate = new Map<string, Entry[]>();
  for (const [key, raw] of Object.entries(data.manualBodyReadings || {})) {
    const entry = parseManualMirrorEntry(key, raw);
    if (!entry) continue;
    const entries = byDate.get(entry.date) || []; entries.push(entry); byDate.set(entry.date, entries);
  }
  return queueManualRowWrite(profileId, async () => {
    let written = 0, hasReadings = false;
    for (const [date, entries] of byDate) {
      if (!current()) break;
      const existing = await getDaily(profileId, 'manual', date);
      if (!current()) break;
      // Deletion metadata commits outside the row lock. Read its latest
      // canonical intent INSIDE this boundary, not from the older pull draft.
      const raw = await encryptedGetItem(profileStorageKey(profileId, 'imported'), {throwOnDecryptError: true});
      if (!current()) break;
      const parsed: unknown = raw == null ? {} : JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Manual profile data is unavailable.');
      const latest = parsed as ManualData;
      const next: StoredWearableRow = {...existing, source: 'manual', date};
      const clocks = existing?._manualSyncAt && typeof existing._manualSyncAt === 'object' ? {...existing._manualSyncAt as Record<string, unknown>} : {};
      for (const incoming of entries) {
        const saved = parseManualMirrorEntry(manualMirrorKey(incoming.field, date), latest.manualBodyReadings?.[manualMirrorKey(incoming.field, date)]);
        const useSaved = !!saved && saved.updatedAt >= incoming.updatedAt;
        const entry = useSaved ? saved! : incoming, selected = useSaved ? latest : data;
        const deletionClock = Math.max(manualMetricDeletionClock(entry.field, date, latest), manualMetricDeletionClock(entry.field, date, data));
        const deleted = MANUAL_METRICS.includes(entry.field)
          && (isManualMetricTombstoned(entry.field, date, selected) || (deletionClock > 0 && deletionClock >= entry.updatedAt));
        const updatedAt = deleted ? Math.max(entry.updatedAt, deletionClock) : entry.updatedAt;
        const localClock = typeof clocks[entry.field] === 'number' ? clocks[entry.field] as number : -1;
        if (localClock > updatedAt) continue;
        if (deleted || entry.value === null) delete next[entry.field];
        else next[entry.field] = entry.value;
        clocks[entry.field] = updatedAt;
      }
      // A deleted metric may be absent from this draft's incoming fields.
      let hasDeletionIntent = false;
      for (const field of MANUAL_METRICS) {
        const deletedAt = Math.max(manualMetricDeletionClock(field, date, latest), manualMetricDeletionClock(field, date, data));
        hasDeletionIntent ||= deletedAt > 0;
        if (deletedAt > 0 && !(typeof clocks[field] === 'number' && clocks[field] > deletedAt)) {
          delete next[field]; clocks[field] = deletedAt;
        }
      }
      const measurable = MANUAL_METRICS.some(field => next[field] != null);
      if (!measurable && hasDeletionIntent) { delete next.tags; delete next.note; }
      hasReadings ||= measurable;
      if (!existing && !measurable) continue;
      next._manualSyncAt = clocks;
      if (JSON.stringify(next) === JSON.stringify(existing)) continue;
      // Preserve opaque future row fields; only known manual measurements/context are patched.
      const hasFutureFields = Object.keys(next).some(field => !['source', 'date', 'importedAt', '_manualSyncAt', ...MANUAL_MIRROR_FIELDS].includes(field));
      if (!measurable && !hasFutureFields) await deleteDaily(profileId, 'manual', date);
      else await upsertDaily(profileId, next);
      written++;
    }
    const connected = current() && hasReadings && !data.wearableConnections?.manual;
    if (connected) updateManualConnection(data);
    return {written, connected};
  });
}

/** Restore only manual projections; foreign raw histories are not on this device. */
export async function refreshRestoredManualSummary(profileId: string): Promise<boolean> {
  const current = ownership(profileId), key = profileStorageKey(profileId, 'imported');
  if (!current()) return false;
  const raw = await encryptedGetItem(key, {throwOnDecryptError: true});
  if (!current() || raw == null) return false;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const base = parsed as ProfileData;
  const rows = await getDailyRange(profileId, 'manual', MANUAL_HISTORY_START, isoDay());
  if (!current()) return false;
  const {computeWearableSummary} = await import('./wearables-summary-model.js');
  if (!current()) return false;
  const derived = computeWearableSummary({manual: rows}, {manual: base.wearableConnections?.manual || {}});
  const summary = {...base.wearableSummary, summaryUpdatedAt: derived.summaryUpdatedAt,
    sources: {...base.wearableSummary?.sources}, metrics: {...base.wearableSummary?.metrics}};
  const manualSource = derived.sources.manual;
  if (manualSource && (base.wearableConnections?.manual || Object.keys(derived.metrics).length)) summary.sources.manual = manualSource;
  else delete summary.sources.manual;
  const primaryOf = (value: unknown) => value && typeof value === 'object' && 'primarySource' in value ? value.primarySource : undefined;
  for (const [metric, existing] of Object.entries(summary.metrics)) {
    if (primaryOf(existing) === 'manual' && !derived.metrics[metric]) delete summary.metrics[metric];
  }
  for (const [metric, value] of Object.entries(derived.metrics)) {
    const existing = summary.metrics[metric];
    // A portable non-manual projection remains authoritative when its raw
    // history is unavailable. Never replace it with an incomplete local view.
    const primary = primaryOf(existing);
    if (typeof primary !== 'string' || !primary || primary === 'manual'
      || base.wearablePrimaryOverride?.[metric] === 'manual') summary.metrics[metric] = value;
  }
  try {
    await persistManualMutation(profileId, {...base, wearableSummary: summary}, base, {expectedData: raw, notifyOnStaleSnapshot: false});
  } catch (error) {
    if (!current()) return false;
    const latest = await encryptedGetItem(key, {throwOnDecryptError: true});
    if (!current() || latest !== raw) return false;
    throw error;
  }
  return current();
}

/** Page load and profile switch share one add-only upgrade; empty/locked IDB never implies deletion. */
export async function catchUpManualBodyReadings(profileId: string, attempt = 0): Promise<{skipped: 'obsolete' | 'profile-missing' | 'profile-unavailable'} | {written: number; added: number}> {
  const current = ownership(profileId);
  if (!current()) return {skipped: 'obsolete' as const};
  const storageKey = profileStorageKey(profileId, 'imported');
  const raw = await encryptedGetItem(storageKey, {throwOnDecryptError: true});
  if (!current()) return {skipped: 'obsolete' as const};
  if (raw == null) return {skipped: 'profile-missing' as const};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {skipped: 'profile-unavailable' as const};
  const baseData = migrateProfileData(parsed as ProfileData), imported = structuredClone(baseData);
  const applied = await applyPulledManualBodyReadings(profileId, imported);
  if (!current()) return {skipped: 'obsolete' as const};
  const backfilled = await getMeta(profileId, BACKFILL_FLAG);
  if (!current()) return {skipped: 'obsolete' as const};
  let added = 0, markBackfilled = false;
  if (!backfilled) {
    const rows = await getDailyRange(profileId, 'manual', MANUAL_HISTORY_START, MANUAL_HISTORY_END);
    if (!current()) return {skipped: 'obsolete' as const};
    const mirror = manualMirror(imported);
    for (const row of rows) {
      // A peer may have committed deletion intent before its row purge finishes.
      // Date-level context belongs only to a surviving manual measurement.
      if (!MANUAL_METRICS.some(field => row[field] != null && !isManualMetricTombstoned(field, row.date, imported))) continue;
      for (const field of MANUAL_MIRROR_FIELDS) {
        if (row[field] == null || Object.hasOwn(mirror, manualMirrorKey(field, row.date))
            || (MANUAL_METRICS.includes(field) && isManualMetricTombstoned(field, row.date, imported))) continue;
        const key = manualMirrorKey(field, row.date);
        mirrorManualPatch(imported, row.date, {[field]: row[field]}, 0);
        if (Object.hasOwn(mirror, key)) added++;
      }
    }
    // A locked read may be empty. Retry later rather than recording a false successful upgrade.
    markBackfilled = rows.length > 0;
  }
  if (added || applied.connected) {
    if (!imported.wearableConnections?.manual && added) updateManualConnection(imported);
    try {
      // The canonical read/merge/write checks this exact snapshot while holding
      // the profile lock. A user edit/deletion after the scan must win.
      await persistManualMutation(profileId, imported, baseData, {expectedData: raw, notifyOnStaleSnapshot: false});
    } catch (error) {
      const latest = await encryptedGetItem(storageKey, {throwOnDecryptError: true});
      if (current() && latest !== raw && attempt < 2) return catchUpManualBodyReadings(profileId, attempt + 1);
      throw error;
    }
  }
  if (!current()) return {skipped: 'obsolete' as const};
  if (markBackfilled) await setMeta(profileId, BACKFILL_FLAG, {at: Date.now()});
  return {written: applied.written, added};
}
