import ImportPageDrop, {mount, unmount, flushSync} from './components/ImportPageDrop.svelte.native.js';
import {loadImportStylesheet} from './import-stylesheet.js';
export async function createPageDropIndicator() {
  await loadImportStylesheet();
  const host = document.createElement('div');
  document.body.append(host);
  const owner = mount(ImportPageDrop, {target: host});
  flushSync();
  return {
    show: (active: boolean) => flushSync(() => owner.setActive(active)),
    dispose: () => { void unmount(owner); flushSync(); host.remove(); },
  };
}
