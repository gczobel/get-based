// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { closeImportModal, getExcludedImportIndices, showImportPreview, revealImportReviewErrors, setImportReviewFilter, toggleImportRow } from '../js/pdf-import-review.js';
import { closeModalOverlay, openAppendedModalOverlay, openModalOverlay, removeModalOverlay } from '../js/modal-lifecycle.js';

const ownedOverlays: HTMLElement[] = [];

afterEach(async () => {
  closeImportModal();
  for (const overlay of ownedOverlays.splice(0)) removeModalOverlay(overlay);
  // Let detached child traps release their independent locks before removing the remaining DOM.
  await Promise.resolve();
  document.body.replaceChildren();
  document.body.style.overflow = '';
  localStorage.clear();
});

describe('PDF import review boundaries', () => {
  it('keeps repeated review and nested modal scroll locks until each owner closes', async () => {
    document.body.style.overflow = 'scroll';
    document.body.innerHTML = '<div id="import-modal-overlay"><div id="import-modal"></div></div>';
    const preview = {date: '2026-07-31', fileName: 'safe.pdf', markers: []};
    showImportPreview(preview);
    showImportPreview(preview);
    const review = document.getElementById('import-modal-overlay')!;
    expect(review.classList.contains('show')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');

    const child = document.createElement('div');
    child.className = 'modal-overlay';
    child.innerHTML = '<div role="dialog"><button type="button">Close nested picker</button></div>';
    ownedOverlays.push(child);
    openAppendedModalOverlay(child, () => removeModalOverlay(child), {
      autoFocus: false, focusTrapOptions: {autoFocus: false},
    });
    expect(document.body.style.overflow).toBe('hidden');
    removeModalOverlay(child);
    await Promise.resolve();
    expect(child.isConnected).toBe(false);
    expect(review.classList.contains('show')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');

    const other = document.createElement('div');
    other.className = 'modal-overlay';
    document.body.append(other);
    ownedOverlays.push(other);
    openModalOverlay(other, {scrollLock: true, autoFocus: false});
    closeImportModal();
    expect(review.classList.contains('show')).toBe(false);
    expect(other.classList.contains('show')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    closeModalOverlay(other);
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('ignores malformed excluded-row indices', () => {
    document.body.innerHTML = `
      <table class="import-table">
        <tbody>
          <tr class="import-excluded" data-import-idx="2"></tr>
          <tr class="import-excluded" data-import-idx="3x"></tr>
          <tr class="import-excluded" data-import-idx="-1"></tr>
        </tbody>
      </table>`;

    expect([...getExcludedImportIndices()]).toEqual([2]);
  });

  it('does not prepare a preview after its modal DOM is removed', () => {
    const unusableResult = { markers: null };

    expect(() => (showImportPreview as (result: unknown) => ReturnType<typeof showImportPreview>)(unusableResult)).not.toThrow();
  });

  it('renders configurable debug model labels as text instead of markup', () => {
    localStorage.setItem('labcharts-debug', 'true');
    localStorage.setItem('labcharts-ollama-model', '<img src=x onerror=alert(1)>');
    document.body.innerHTML = `
      <div id="import-modal-overlay">
        <div id="import-modal"></div>
      </div>`;

    showImportPreview({
      date: '2026-07-31',
      fileName: 'safe.pdf',
      markers: [],
      privacyMethod: 'ollama',
      timings: { pii: 1, analysis: 2 },
    });

    const debugNote = document.querySelector('.import-debug-note');
    expect(debugNote?.querySelector('img')).toBeNull();
    expect(debugNote?.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

it('reveals every duplicate row and clears errors immediately after correction or exclusion', () => {
  document.body.innerHTML = '<div id="import-modal-overlay"><div id="import-modal"></div></div>';
  const preview = {date: '2026-07-31', fileName: 'safe.pdf', markers: [
    {rawName: 'first', matched: true, mappedKey: 'iron.ferritin', value: 12, unit: 'ng/ml'},
    {rawName: 'second', matched: false, suggestedKey: 'iron.ferritin', value: 13, unit: 'ng/ml'},
  ]};
  showImportPreview(preview);
  const matched = document.querySelector<HTMLElement>('[data-filter="matched"]')!;
  setImportReviewFilter(matched);
  const rows = [...document.querySelectorAll<HTMLElement>('tr[data-import-idx]')];
  expect(rows.map(row => row.hidden)).toEqual([false, true]);
  revealImportReviewErrors();
  expect(rows.map(row => row.hidden)).toEqual([false, false]);
  expect(rows.map(row => row.getAttribute('aria-invalid'))).toEqual(['true', 'true']);
  toggleImportRow(rows[1]!.querySelector<HTMLElement>('.import-exclude-btn')!);
  expect(rows.every(row => !row.hasAttribute('aria-invalid'))).toBe(true);
  toggleImportRow(rows[1]!.querySelector<HTMLElement>('.import-exclude-btn')!);
  expect(rows.every(row => row.getAttribute('aria-invalid') === 'true')).toBe(true);
  preview.markers[1]!.suggestedKey = 'custom.second';
  const input = rows[1]!.querySelector<HTMLInputElement>('.import-value-input')!;
  input.value = '15';
  input.dispatchEvent(new Event('change', {bubbles: true}));
  expect(rows.every(row => !row.hasAttribute('aria-invalid'))).toBe(true);
  expect(rows.map(row => row.querySelector('.import-row-number')?.textContent)).toEqual(['1', '2']);
});
