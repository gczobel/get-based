// The lazy and already-loaded paths use the same routing and collision guards.
import { bindImportDropZone } from './import-drop-zone-events.js';
import { dispatchImportFiles } from './import-dispatch.js';
import { loadImportUI } from './import-loader.js';
export function setupDropZone() {
  bindImportDropZone(files => dispatchImportFiles(files, loadImportUI, 'drop-zone'));
}
