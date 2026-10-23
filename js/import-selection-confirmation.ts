import { showConfirmDialog } from './utils.js';
import type { classifyImportFiles } from './pdf-import-file-utils.js';
type Buckets = Awaited<ReturnType<typeof classifyImportFiles>>;
/** No parser, AI, storage mutation or import runs until the selection is accepted. */
export async function confirmImportSelection(buckets: Buckets, always = false): Promise<boolean> {
  const types = [
    ['profile JSON', buckets.jsonFiles], ['PDF lab report', buckets.pdfFiles], ['lab image', buckets.imageFiles],
    ['DNA raw data (local processing)', buckets.dnaFiles], ['text/spreadsheet lab report', buckets.textFiles], ['Cycle export', buckets.cycleFiles],
  ] as const;
  const present = types.filter(([, files]) => files.length);
  const unclassifiedText = buckets.textFiles.some(file => /\.(txt|csv)$/i.test(file.name));
  if (!always && present.length < 2 && !buckets.dnaFiles.length && !unclassifiedText && !buckets.unsupportedCount) return true;
  const summary = present.map(([label, files]) => `${files.length} × ${label}`).join('\n');
  const skipped = buckets.unsupportedCount ? `\n${buckets.unsupportedCount} unsupported file(s) will be skipped.` : '';
  const warning = unclassifiedText ? '\n\nText/CSV files were not recognized as DNA. Continue only if they are lab reports: they may be analyzed by your configured AI provider. Cancel if they contain genetic data or another export type.' : '';
  return showConfirmDialog(`Import this selection?\n\n${summary}${skipped}${warning}`, {
    confirmLabel: unclassifiedText ? 'Treat text as lab reports' : 'Continue import', cancelLabel: 'Cancel', tone: 'primary', ariaLabel: 'Confirm import file types',
  });
}
