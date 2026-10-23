// File drags only. Specialized targets retain their own local import semantics.
import {isDropZoneImportRunning, showDropZoneImportNotification} from './import-drop-zone-runtime.js';
export function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types || []).includes('Files') || Boolean(event.dataTransfer?.files.length);
}
const SPECIALIZED = '#drop-zone, .chat-panel-conversation, #lens-local-drop, [data-wearable-settings-dropzone]';
function isSpecialized(event: DragEvent): boolean {
  return event.target instanceof Element && Boolean(event.target.closest(SPECIALIZED));
}
export function bindPageFileDrop(importFiles: (files: File[]) => Promise<unknown>): () => void {
  const view = document.defaultView;
  let active = false, disposed = false;
  let indicator: Awaited<ReturnType<typeof import('./import-page-drop-view.js')['createPageDropIndicator']>> | null = null;
  let loading: Promise<void> | null = null;
  const show = (next: boolean) => {
    active = next;
    if (indicator) { indicator.show(active); return; }
    if (active && !loading) loading = import('./import-page-drop-view.js')
      .then(module => module.createPageDropIndicator())
      .then(view => { if (disposed) view.dispose(); else { indicator = view; view.show(active); } })
      .catch(error => { loading = null; console.debug('[import-drop] Feedback unavailable:', error); });
  };
  const over = (event: DragEvent) => {
    if (!isFileDrag(event)) return;
    if (isSpecialized(event)) { show(false); return; }
    event.preventDefault();
    show(!isDropZoneImportRunning());
  };
  const drop = (event: DragEvent) => {
    show(false);
    if (!isFileDrag(event) || isSpecialized(event) || event.defaultPrevented) return;
    event.preventDefault();
    if (isDropZoneImportRunning()) { showDropZoneImportNotification('Import already in progress', 'info'); return; }
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length) void importFiles(files);
  };
  const enter = (event: DragEvent) => { if (isFileDrag(event) && isSpecialized(event)) show(false); };
  const leave = (event: DragEvent) => { if (!event.relatedTarget) show(false); };
  const hide = () => show(false);
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
  document.addEventListener('dragenter', enter, true);
  document.addEventListener('dragover', over, true);
  document.addEventListener('drop', hide, true);
  document.addEventListener('drop', drop);
  document.addEventListener('dragleave', leave);
  document.addEventListener('keydown', key);
  view?.addEventListener('blur', hide);
  return () => {
    disposed = true; active = false; indicator?.dispose();
    document.removeEventListener('dragenter', enter, true);
    document.removeEventListener('dragover', over, true);
    document.removeEventListener('drop', hide, true);
    document.removeEventListener('drop', drop);
    document.removeEventListener('dragleave', leave);
    document.removeEventListener('keydown', key);
    view?.removeEventListener('blur', hide);
  };
}
