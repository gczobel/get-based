import {expect, test} from './coverage-fixture.js';
import {createDefaultProfileData} from '../../js/profile.js';

test('a populated Dashboard offers a page-wide import preview and cancellation has no side effects', async ({page}) => {
  const seed = {...createDefaultProfileData(), entries: [{date: '2026-09-01', markers: {'biochemistry.glucose': 5.2}}]};
  await page.addInitScript(seed => {
    localStorage.setItem('labcharts-default-imported', JSON.stringify(seed));
    for (const name of ['emptyTour', 'tour']) localStorage.setItem(`labcharts-default-${name}`, 'completed');
  }, seed);
  await page.goto('/app', {waitUntil: 'load'});
  await expect(page.locator('#drop-zone')).toBeHidden();
  await page.evaluate(async () => {
    const runtime = await import('/js/import-drop-zone-runtime.js');
    runtime.configureImportDropZoneRuntimeDeps({importDataJSON: () => {document.body.dataset.importedFiles = String(Number(document.body.dataset.importedFiles || 0) + 1);}});
    const transfer = new DataTransfer(); transfer.items.add(new File(['{}'], 'profile.json', {type: 'application/json'}));
    document.body.dispatchEvent(new DragEvent('dragover', {bubbles: true, cancelable: true, dataTransfer: transfer}));
  });
  await expect(page.locator('[data-page-import-drop]')).toBeVisible();
  expect(await page.locator('[data-page-import-drop]').evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
  const drop = () => page.evaluate(() => {
    const transfer = new DataTransfer(); transfer.items.add(new File(['{}'], 'profile.json', {type: 'application/json'}));
    document.body.dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer: transfer}));
  });
  await drop();
  await expect(page.getByRole('alertdialog', {name: 'Confirm import file types'})).toContainText('1 × profile JSON');
  expect(await page.locator('body').getAttribute('data-imported-files')).toBeNull();
  await page.keyboard.press('Tab'); await page.keyboard.press('Escape');
  await expect(page.locator('#confirm-dialog-overlay')).not.toHaveClass(/\bshow\b/);
  expect(await page.locator('body').getAttribute('data-imported-files')).toBeNull();
  await expect.poll(() => page.evaluate(async () => (await import('/js/pdf-import-progress.js')).importDispatch.busy)).toBe(false);
  await drop();
  await page.getByRole('button', {name: 'Continue import', exact: true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-imported-files', '1');
  await expect(page.locator('[data-page-import-drop]')).toHaveCount(0);
});

test('actual Chat drop ownership clears page feedback even when Chat stops propagation', async ({page}) => {
  await page.goto('/app', {waitUntil: 'load'});
  await page.evaluate(async () => {
    await (await import('/js/chat-panel.js')).openChatPanel();
    (await import('/js/import-drop-zone-runtime.js')).configureImportDropZoneRuntimeDeps({importDataJSON: () => {document.body.dataset.unwantedPageImport = 'yes';}});
  });
  await expect(page.locator('.chat-panel-conversation')).toBeVisible();
  const drag = (kind: string, chat = false) => page.evaluate(({kind, chat}) => {
    const transfer = new DataTransfer(); transfer.items.add(new File(['synthetic'], 'unsupported.bin', {type: 'application/octet-stream'}));
    const target = chat ? document.querySelector('.chat-panel-conversation')! : document.body;
    target.dispatchEvent(new DragEvent(kind, {bubbles: true, cancelable: true, dataTransfer: transfer}));
  }, {kind, chat});
  await drag('dragover'); await expect(page.locator('[data-page-import-drop]')).toBeVisible();
  await drag('dragover', true); await expect(page.locator('[data-page-import-drop]')).toHaveCount(0);
  await drag('dragover'); await expect(page.locator('[data-page-import-drop]')).toBeVisible();
  await drag('drop', true); await expect(page.locator('[data-page-import-drop]')).toHaveCount(0);
  expect(await page.locator('body').getAttribute('data-unwanted-page-import')).toBeNull();
});
