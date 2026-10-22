const IMPORT_STYLESHEET_URL = new URL('../css/import.css', import.meta.url).href;

let _importStylesheetLoad: Promise<HTMLLinkElement> | null = null;
let _useImportStylesheetRetryUrl = false;

function importStylesheetUrl() {
  if (!_useImportStylesheetRetryUrl) return IMPORT_STYLESHEET_URL;
  const retryUrl = new URL(IMPORT_STYLESHEET_URL);
  retryUrl.searchParams.set('lazy-retry', '1');
  return retryUrl.href;
}

export function loadImportStylesheet(): Promise<HTMLLinkElement> {
  if (!_importStylesheetLoad) {
    if (typeof document === 'undefined') {
      return Promise.reject(new Error('Import stylesheet requires a document'));
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = importStylesheetUrl();
    link.dataset.importStylesheet = '';
    _importStylesheetLoad = new Promise<HTMLLinkElement>((resolve, reject) => {
      link.addEventListener('load', () => resolve(link), { once: true });
      link.addEventListener('error', () => {
        reject(new Error('Import stylesheet could not be loaded'));
      }, { once: true });
      const anchor = document.querySelector('[data-import-stylesheet-anchor]');
      const parent = anchor?.parentNode || document.head;
      parent.insertBefore(link, anchor || null);
    }).catch(err => {
      link.remove();
      _importStylesheetLoad = null;
      _useImportStylesheetRetryUrl = true;
      throw err;
    });
  }
  return _importStylesheetLoad;
}
