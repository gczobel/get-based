import { isDropZoneImportRunning, openDropZoneFilePicker, showDropZoneImportNotification } from './import-drop-zone-runtime.js';
import { isFileDrag } from './import-page-drop.js';
export function bindImportDropZone(importFiles: (files: File[]) => Promise<unknown>) {
  const zone = document.getElementById('drop-zone');
  if (!zone || zone.dataset.lazyDropZoneBound === 'true') return;
  zone.dataset.lazyDropZoneBound = 'true';
  zone.addEventListener('click', () => { if (!isDropZoneImportRunning()) openDropZoneFilePicker(); });
  zone.addEventListener('dragover', event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (!isDropZoneImportRunning()) zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', async event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    zone.classList.remove('drag-over');
    if (isDropZoneImportRunning()) { showDropZoneImportNotification('Import already in progress', 'info'); return; }
    await importFiles(Array.from(event.dataTransfer?.files || [])).catch(error => {
      console.error('[import-drop-zone] Import failed:', error);
      showDropZoneImportNotification('Import failed - check the file and try again.', 'error');
    });
  });
}
