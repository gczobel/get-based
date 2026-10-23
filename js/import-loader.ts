// import-loader.js — shared lazy loaders for heavyweight import flows

import { hasImportReviewDraft } from './import-review-draft.js';
import { loadDataProtectionStylesheet } from './modal-lifecycle.js';
import { prepareDnaFileImport } from './health-data-loader.js';

import { loadImportStylesheet } from './import-stylesheet.js';
export { loadImportStylesheet };
let _pdfImportLoad: Promise<typeof import('./pdf-import.js')> | null = null;

export function loadPdfImport(): Promise<typeof import('./pdf-import.js')> {
  if (!_pdfImportLoad) {
    _pdfImportLoad = Promise.all([
      import('./pdf-import.js'),
      prepareDnaFileImport(),
    ])
      .then(([module]) => module)
      .catch(err => {
        _pdfImportLoad = null;
        throw err;
      });
  }
  return _pdfImportLoad;
}

export async function loadImportUI(): Promise<typeof import('./pdf-import.js')> {
  const [importModule] = await Promise.all([
    loadPdfImport(),
    loadImportStylesheet(),
    loadDataProtectionStylesheet(),
  ]);
  return importModule;
}

export async function restorePendingImportReviewDraft() {
  if (!hasImportReviewDraft()) return false;
  await Promise.all([
    loadImportStylesheet(),
    loadDataProtectionStylesheet(),
  ]);
  const review = await import('./pdf-import-review.js');
  return review.restoreImportReviewDraft();
}
