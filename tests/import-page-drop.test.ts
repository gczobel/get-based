// @vitest-environment jsdom
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({busy: false, notify: vi.fn(), show: vi.fn(), dispose: vi.fn(), confirm: vi.fn()}));
vi.mock('../js/import-drop-zone-runtime.js', () => ({isDropZoneImportRunning: () => mocks.busy, showDropZoneImportNotification: mocks.notify}));
vi.mock('../js/import-page-drop-view.js', () => ({createPageDropIndicator: async () => ({show: mocks.show, dispose: mocks.dispose})}));
vi.mock('../js/utils.js', () => ({showConfirmDialog: mocks.confirm}));
import {bindPageFileDrop} from '../js/import-page-drop.js';
import {confirmImportSelection} from '../js/import-selection-confirmation.js';
const file = new File(['sample'], 'lab.pdf', {type: 'application/pdf'});
let dispose = () => {};
beforeEach(() => {vi.clearAllMocks(); mocks.busy = false; mocks.confirm.mockResolvedValue(false); document.body.replaceChildren();});
afterEach(() => dispose());
function drag(target: Element, type: string, files = [file], types = ['Files']) {
  const event = new Event(type, {bubbles: true, cancelable: true});
  Object.defineProperty(event, 'dataTransfer', {value: {types, files}});
  target.dispatchEvent(event);
  return event;
}
it('imports a populated page drop once, leaving non-file widget drags untouched', async () => {
  const importFiles = vi.fn().mockResolvedValue(undefined);
  dispose = bindPageFileDrop(importFiles);
  expect(drag(document.body, 'dragover', [], ['text/plain']).defaultPrevented).toBe(false);
  expect(drag(document.body, 'drop', [], ['text/plain']).defaultPrevented).toBe(false);
  expect(drag(document.body, 'dragover').defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(mocks.show).toHaveBeenCalledWith(true));
  expect(drag(document.body, 'drop').defaultPrevented).toBe(true);
  expect(importFiles).toHaveBeenCalledExactlyOnceWith([file]);
  expect(mocks.show).toHaveBeenLastCalledWith(false);
});
it.each(['<div id="drop-zone"></div>', '<div class="chat-panel-conversation"></div>', '<div id="lens-local-drop"></div>', '<div data-wearable-settings-dropzone="apple-health"></div>'])('leaves specialized targets in control: %s', async markup => {
  document.body.innerHTML = markup;
  const target = document.body.firstElementChild!, importFiles = vi.fn();
  dispose = bindPageFileDrop(importFiles);
  drag(target, 'dragover'); drag(target, 'drop');
  await Promise.resolve();
  expect(importFiles).not.toHaveBeenCalled();
  expect(mocks.show).not.toHaveBeenCalledWith(true);
});
it('rejects a busy drop and hides feedback on Escape or leaving the window', async () => {
  const importFiles = vi.fn(); dispose = bindPageFileDrop(importFiles);
  drag(document.body, 'dragover');
  await vi.waitFor(() => expect(mocks.show).toHaveBeenCalledWith(true));
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
  expect(mocks.show).toHaveBeenLastCalledWith(false);
  drag(document.body, 'dragover'); window.dispatchEvent(new Event('blur'));
  expect(mocks.show).toHaveBeenLastCalledWith(false);
  mocks.busy = true; drag(document.body, 'drop');
  expect(importFiles).not.toHaveBeenCalled();
  expect(mocks.notify).toHaveBeenCalledWith('Import already in progress', 'info');
});
const buckets = () => ({jsonFiles: [] as File[], pdfFiles: [] as File[], imageFiles: [] as File[], dnaFiles: [] as File[], textFiles: [] as File[], cycleFiles: [] as File[], unsupportedCount: 0});
it('confirms every page drop and DNA/mixed selections before continuing', async () => {
  for (const selection of [{...buckets(), pdfFiles: [file]}, {...buckets(), dnaFiles: [file]}, {...buckets(), pdfFiles: [file], jsonFiles: [file]}]) {
    expect(await confirmImportSelection(selection, true)).toBe(false);
    expect(mocks.confirm).toHaveBeenLastCalledWith(expect.stringContaining('1 ×'), expect.objectContaining({ariaLabel: 'Confirm import file types'}));
  }
});
it('requires explicit lab classification for unrecognized text/CSV instead of silently sending it to AI', async () => {
  const selection = {...buckets(), textFiles: [new File(['unknown genome format'], 'export.csv')]};
  expect(await confirmImportSelection(selection)).toBe(false);
  expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining('Cancel if they contain genetic data'), expect.objectContaining({confirmLabel: 'Treat text as lab reports'}));
  mocks.confirm.mockResolvedValue(true);
  expect(await confirmImportSelection(selection)).toBe(true);
});
it('keeps ordinary single-type picker imports direct', async () => {
  expect(await confirmImportSelection({...buckets(), pdfFiles: [file]})).toBe(true);
  expect(mocks.confirm).not.toHaveBeenCalled();
});

it('clears page feedback when a specialized target stops drag and drop propagation', async () => {
  document.body.innerHTML = '<div class="chat-panel-conversation"></div>';
  const target = document.body.firstElementChild!, ownDrop = vi.fn(), importFiles = vi.fn();
  for (const name of ['dragenter', 'dragover', 'drop']) target.addEventListener(name, event => {event.preventDefault(); event.stopPropagation(); if (name === 'drop') ownDrop();});
  dispose = bindPageFileDrop(importFiles);
  drag(document.body, 'dragover'); await vi.waitFor(() => expect(mocks.show).toHaveBeenLastCalledWith(true));
  drag(target, 'dragenter'); expect(mocks.show).toHaveBeenLastCalledWith(false);
  drag(document.body, 'dragover'); expect(mocks.show).toHaveBeenLastCalledWith(true);
  drag(target, 'dragover'); expect(mocks.show).toHaveBeenLastCalledWith(false);
  drag(document.body, 'dragover'); expect(mocks.show).toHaveBeenLastCalledWith(true);
  drag(target, 'drop'); expect(mocks.show).toHaveBeenLastCalledWith(false);
  expect(ownDrop).toHaveBeenCalledOnce(); expect(importFiles).not.toHaveBeenCalled();
});
