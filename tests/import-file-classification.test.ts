import {expect, it} from 'vitest';
import {classifyImportFiles} from '../js/pdf-import-file-utils.js';
import {isDNAFile, isDNAFileByContent} from '../js/dna-file-detection.js';
it('classifies explicitly formatted files once even if their names resemble a raw DNA export', async () => {
  const files = [new File(['%PDF'], 'genome.PDF'), new File(['{}'], 'genome.JSON'), new File(['image'], 'genome.png')];
  const result = await classifyImportFiles(files, {isDNAFile, isDNAFileByContent});
  expect(result.pdfFiles).toEqual([files[0]]); expect(result.jsonFiles).toEqual([files[1]]); expect(result.imageFiles).toEqual([files[2]]);
  expect(result.dnaFiles).toEqual([]); expect(result.unsupportedCount).toBe(0);
});
it('keeps recognized DNA text local and leaves unknown text for explicit user classification', async () => {
  const dna = new File(['#AncestryDNA\nrsid\tchromosome\tposition\tallele1\tallele2'], 'genome.txt');
  const unknown = new File(['Unrecognized data format'], 'export.csv');
  const result = await classifyImportFiles([dna, unknown], {isDNAFile, isDNAFileByContent});
  expect(result.dnaFiles).toEqual([dna]); expect(result.textFiles).toEqual([unknown]); expect(result.unsupportedCount).toBe(0);
});
