import {expect, test} from './coverage-fixture.js';
import {createDefaultProfileData} from '../../js/profile.js';

test('ordinary startup materializes incoming manual readings and the detail view survives a local-row reset', async ({page}) => {
  const date = '2026-09-21';
  const mirror = Object.fromEntries(Object.entries({weight: 80, bp_systolic: 120, bp_diastolic: 80, rhr: 60, note: 'Synthetic manual context'}).map(([field, value]) => [`${field}.${date}`, {value, updatedAt: 100}]));
  const seed = {...createDefaultProfileData(), entries: [{date, markers: {'biochemistry.glucose': 5.2}}], manualBodyReadings: mirror};
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00Z'));
  await page.addInitScript(seed => {
    localStorage.setItem('labcharts-profiles', JSON.stringify([{id: 'default', name: 'Synthetic profile'}]));
    localStorage.setItem('labcharts-active-profile', 'default');
    if (!localStorage.getItem('labcharts-default-imported')) localStorage.setItem('labcharts-default-imported', JSON.stringify(seed));
    for (const name of ['emptyTour', 'tour']) localStorage.setItem(`labcharts-default-${name}`, 'completed');
    localStorage.setItem('wearable-detail-range', 'all');
  }, seed);
  await page.goto('/app', {waitUntil: 'load'});
  const row = () => page.evaluate(async date => (await import('/js/wearables-store.js')).getDaily('default', 'manual', date), date);
  await expect.poll(row).toMatchObject({weight: 80, bp_systolic: 120, bp_diastolic: 80, rhr: 60, note: 'Synthetic manual context'});
  await expect.poll(() => page.evaluate(async () => (await import('/js/state.js')).state.importedData.wearableSummary?.metrics?.weight?.latest)).toBe(80);
  await page.evaluate(async () => {await (await import('/js/data.js')).saveImportedData(); await (await import('/js/wearables-store.js')).clearSource('default', 'manual');});
  expect(await row()).toBeNull();
  await page.reload({waitUntil: 'load'});
  await expect.poll(row).toMatchObject({weight: 80, bp_systolic: 120, bp_diastolic: 80, rhr: 60});
  await page.evaluate(async () => {(await import('/js/chat-panel.js')).closeChatPanel(); await (await import('/js/wearables.js')).openWearableDetail('weight');});
  await expect(page.locator('#detail-modal .wearable-manual-entry')).toHaveCount(1);
  await expect(page.locator('#detail-modal .wearable-manual-entry')).toContainText('Synthetic manual context');
  expect(await page.evaluate(async () => (await import('/js/state.js')).state.importedData.entries)).toEqual(seed.entries);
});


test('a manual-only portable share becomes visible immediately after import without a reload', async ({page}) => {
  const date = '2026-09-21', seed = createDefaultProfileData();
  await page.addInitScript(seed => {
    localStorage.setItem('labcharts-profiles', JSON.stringify([{id: 'default', name: 'Synthetic share origin'}]));
    localStorage.setItem('labcharts-active-profile', 'default');
    if (!localStorage.getItem('labcharts-default-imported')) localStorage.setItem('labcharts-default-imported', JSON.stringify(seed));
    for (const name of ['emptyTour', 'tour']) localStorage.setItem(`labcharts-default-${name}`, 'completed');
  }, seed);
  await page.goto('/app', {waitUntil: 'load'});
  const result = await page.evaluate(async date => {
    const {state} = await import('/js/state.js'), manual = await import('/js/wearables-manual.js');
    const store = await import('/js/wearables-store.js'), portable = await import('/js/export.js');
    const {encryptedGetItem} = await import('/js/crypto.js');
    const origin = state.currentProfile;
    await manual.logManualMetric(origin, 'weight', {date, value: 80, note: 'Synthetic shared manual reading'});
    await store.upsertDaily(origin, {source: 'withings', date, weight: 90, privateVendorSentinel: 'SYNTHETIC_RAW_VENDOR_ONLY'});
    const before = await encryptedGetItem(`labcharts-${origin}-imported`);
    const payload = await portable.buildClientExportObject(origin, false, false);
    await portable.importDataJSON(new File([JSON.stringify(payload)], 'manual-only-share.json'));
    return {origin, restored: state.currentProfile, entries: payload.entries, nutrition: payload.nutrition, chat: payload.chat,
      exportedRawVendor: JSON.stringify(payload).includes('SYNTHETIC_RAW_VENDOR_ONLY'),
      mirror: state.importedData.manualBodyReadings, expectedMirror: payload.manualBodyReadings,
      row: await store.getDaily(state.currentProfile, 'manual', date), summary: state.importedData.wearableSummary?.metrics?.weight?.latest,
      targetVendor: await store.getDaily(state.currentProfile, 'withings', date), originVendor: await store.getDaily(origin, 'withings', date),
      originUnchanged: before === await encryptedGetItem(`labcharts-${origin}-imported`)};
  }, date);
  expect(result.restored).not.toBe(result.origin); expect(result.entries).toEqual([]);
  expect(result.nutrition).toBeUndefined(); expect(result.chat).toBeUndefined(); expect(result.exportedRawVendor).toBe(false);
  expect(result.mirror).toEqual(result.expectedMirror); expect(result.row).toMatchObject({weight: 80, note: 'Synthetic shared manual reading'});
  expect(result.summary).toBe(80); expect(result.targetVendor).toBeNull(); expect(result.originVendor).toMatchObject({weight: 90, privateVendorSentinel: 'SYNTHETIC_RAW_VENDOR_ONLY'}); expect(result.originUnchanged).toBe(true);
  await page.evaluate(async () => {(await import('/js/chat-panel.js')).closeChatPanel(); await (await import('/js/wearables.js')).openWearableDetail('weight');});
  await expect(page.locator('#detail-modal .wearable-manual-entry')).toHaveCount(1);
  await expect(page.locator('#detail-modal .wearable-manual-entry')).toContainText('Synthetic shared manual reading');
});
