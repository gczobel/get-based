import {afterEach, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCoverageInventory, qualifyCoverageUnion, qualifyJobs, qualifyKitUnion, readKitReports} from '../scripts/ci-results.mjs';

afterEach(() => {vi.restoreAllMocks();});

function fixtureCase(title: string) {
  const project = 'kit-chromium', file = 'tests/pwa/sveltekit.spec.ts', titlePath = [project, file, title], repeatEachIndex = 0;
  return {id: JSON.stringify([project, file, titlePath, repeatEachIndex]), file, project, title, titlePath, repeatEachIndex, declaredExpectedStatus: 'passed', declaredAnnotations: []};
}
const report = (tests: ReturnType<typeof fixtureCase>[], execution: boolean) => ({schemaVersion: 1, execution, status: 'passed', context: {commit: 'source-a', runId: '1', runAttempt: '1'}, issues: [], tests: tests.map(test => execution ? {...test, status: 'passed', expectedStatus: 'passed', annotations: [], outcome: 'expected', attemptCount: 1} : test)});
function temp<T>(run: (directory: string) => T): T {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'getbased-ci-results-'));
  try {return run(directory);} finally {fs.rmSync(directory, {recursive: true, force: true});}
}
function raw(directory: string, name: string, url = '/js/main.js') {
  fs.mkdirSync(directory, {recursive: true}); fs.writeFileSync(path.join(directory, name), JSON.stringify({entries: [{url}]}));
}
function unit(directory: string): string {
  const file = path.join(directory, 'unit.json');
  fs.writeFileSync(file, JSON.stringify({'/checkout/js/main.js': {path: '/checkout/js/main.js', statementMap: {'0': {}}, s: {'0': 1}, fnMap: {}, f: {}, branchMap: {}, b: {}}}));
  return file;
}
describe('complete disjoint Kit execution qualification', () => {
  it('accepts exact independent shard union with stable portable identities', () => {
    const first = fixtureCase('first'), second = fixtureCase('second');
    expect(qualifyKitUnion(report([first, second], false), [report([second], true), report([first], true)])).toMatchObject({status: 'passed', collected: 2, reports: 2});
  });
  it('rejects missing, duplicate, uncollected, stale-context and forged-identity cases', () => {
    const first = fixtureCase('first'), second = fixtureCase('second'), collection = report([first, second], false);
    for (const reports of [[], [report([first], true)], [report([first], true), report([first], true)], [report([first, fixtureCase('other')], true)], [{...report([first, second], true), context: {commit: 'stale'}}], [report([{...first, id: 'forged'}, second], true)]]) expect(() => qualifyKitUnion(collection, reports)).toThrow();
  });
  it('accepts an exact capability-only shard only alongside genuinely executed acceptance', () => {
    const executed = fixtureCase('executed'), title = 'actual headless PWA install, standalone launch and zero-client offline launch retain local state';
    const project = 'kit-firefox', file = 'tests/pwa/sveltekit-install.spec.ts', titlePath = [project, file, title], repeatEachIndex = 0;
    const skipped = {...fixtureCase(title), project, file, titlePath, id: JSON.stringify([project, file, titlePath, repeatEachIndex])};
    const annotations = [{type: 'skip', description: 'The installed-app protocol is specific to Chromium; other engines have separate browser acceptance.'}];
    const skipReport = {...report([skipped], true), tests: [{...skipped, status: 'skipped', expectedStatus: 'skipped', annotations, outcome: 'skipped', attemptCount: 1}]};
    expect(qualifyKitUnion(report([executed, skipped], false), [report([executed], true), skipReport])).toMatchObject({status: 'passed', executed: 1});
    expect(() => qualifyKitUnion(report([skipped], false), [skipReport])).toThrow('across selected shards');
  });
  it('rejects unsuccessful, skipped, incomplete, retried and altered-declaration receipts', () => {
    const first = fixtureCase('first'), collection = report([first], false), accepted = report([first], true);
    for (const corrupt of [{...accepted, execution: false}, {...accepted, status: 'failed'}, {...accepted, issues: ['guard error']}, {...accepted, tests: [{...accepted.tests[0], status: 'skipped'}]}, {...accepted, tests: [{...accepted.tests[0], attemptCount: 2}]}, {...accepted, tests: [{...accepted.tests[0], declaredExpectedStatus: 'skipped'}]}, {...accepted, tests: [{...accepted.tests[0], status: undefined}]}]) expect(() => qualifyKitUnion(collection, [corrupt])).toThrow();
  });
});
describe('bounded hosted Kit job reruns', () => {
  const current = {commit: 'a'.repeat(40), runId: '42', runAttempt: '2'};
  const hosted = (tests: ReturnType<typeof fixtureCase>[], execution: boolean, runAttempt = '1') =>
    ({...report(tests, execution), context: {...current, runAttempt}});
  it('reuses earlier successful shards and selects only the newer identical shard, preserving failed history', () => {
    const first = fixtureCase('first'), second = fixtureCase('second'), collection = hosted([first, second], false);
    const failed = {...hosted([first], true), status: 'failed', issues: ['original timeout'], tests: [{...hosted([first], true).tests[0], status: 'timedOut'}]};
    const receipts = [failed, hosted([second], true), hosted([first], true, '2')];
    expect(qualifyKitUnion(collection, receipts, current)).toMatchObject({status: 'passed', collected: 2, executed: 2, reports: 2,
      provenance: {...current, collectionAttempt: '1', selectedAttempts: [1, 2], supersededReports: 1}});
    expect(qualifyKitUnion(collection, [...receipts].reverse(), current)).toMatchObject({status: 'passed', reports: 2});
    expect(() => qualifyKitUnion(collection, receipts)).toThrow();
    expect(failed.status).toBe('failed');
  });
  it('rejects stale revisions/runs, future or malformed attempts, incomplete contexts and forged context fields', () => {
    const first = fixtureCase('first'), collection = hosted([first], false), accepted = hosted([first], true);
    const contexts = [{...current, commit: 'b'.repeat(40)}, {...current, runId: '43'}, {...current, runAttempt: '3'},
      {...current, runAttempt: '0'}, {...current, runAttempt: '01'}, {...current, runAttempt: '9007199254740992'},
      {...current, runAttempt: 2}, {...current, extra: true}, {commit: current.commit}];
    for (const context of contexts) expect(() => qualifyKitUnion(collection, [{...accepted, context}], current)).toThrow();
    expect(() => qualifyKitUnion(hosted([first], false, '2'), [accepted], current)).toThrow();
    expect(() => qualifyKitUnion(hosted([first], false, '3'), [accepted], current)).toThrow();
    expect(() => qualifyKitUnion(collection, [accepted], {...current, runId: '43'})).toThrow();
    expect(() => qualifyKitUnion(collection, [accepted], {...current, commit: 'b'.repeat(40)})).toThrow();
    expect(() => qualifyKitUnion(collection, [accepted], {...current, runAttempt: null})).toThrow();
  });
  it('never falls back from a failed latest receipt or accepts a native case retry', () => {
    const first = fixtureCase('first'), collection = hosted([first], false), accepted = hosted([first], true);
    expect(() => qualifyKitUnion(collection, [accepted, {...hosted([first], true, '2'), status: 'failed'}], current)).toThrow();
    const retried = {...hosted([first], true, '2'), tests: [{...accepted.tests[0], attemptCount: 2}]};
    expect(() => qualifyKitUnion(collection, [accepted, retried], current)).toThrow();
  });
  it('rejects ambiguous, overlapping, missing, uncollected and altered declarations even in superseded receipts', () => {
    const first = fixtureCase('first'), second = fixtureCase('second'), collection = hosted([first, second], false);
    const accepted = hosted([first], true), secondReceipt = hosted([second], true);
    for (const receipts of [[accepted, accepted, secondReceipt], [accepted, hosted([first], true, '2'), accepted, secondReceipt], [accepted], [hosted([first, first], true), secondReceipt],
      [hosted([first, second], true), accepted], [hosted([fixtureCase('unknown')], true), hosted([first, second], true, '2')],
      [{...accepted, tests: [{...accepted.tests[0], declaredAnnotations: [{type: 'skip'}]}]}, hosted([first], true, '2'), secondReceipt]]) {
      expect(() => qualifyKitUnion(collection, receipts, current)).toThrow();
    }
  });
  it('keeps immutable attempt directories separate and checks their declared file/attempt owners', () => temp(directory => {
    const first = fixtureCase('first'), collection = hosted([first], false);
    for (const attempt of ['1', '2']) {
      const target = path.join(directory, `kit-receipt-kit-chromium-1-of-1-attempt-${attempt}`); fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, 'kit-chromium-1-of-1.json'), JSON.stringify(hosted([first], true, attempt)));
    }
    expect(qualifyKitUnion(collection, readKitReports(directory), current)).toMatchObject({reports: 1, provenance: {supersededReports: 1}});
    const target = path.join(directory, 'kit-receipt-kit-chromium-1-of-1-attempt-2', 'kit-chromium-1-of-1.json');
    fs.writeFileSync(target, JSON.stringify(hosted([first], true)));
    expect(() => readKitReports(directory)).toThrow('attempt differs');
    fs.writeFileSync(target, JSON.stringify(hosted([first], true, '2'))); fs.renameSync(target, target + '.json');
    expect(() => readKitReports(directory)).toThrow('contents');
  }));
  it('rejects symbolic receipt bodies and unknown artifact directory owners', () => temp(directory => {
    const artifact = path.join(directory, 'kit-receipt-kit-chromium-1-of-1-attempt-1'); fs.mkdirSync(artifact);
    const outside = path.join(directory, 'outside.txt'); fs.writeFileSync(outside, '{}');
    fs.symlinkSync(outside, path.join(artifact, 'kit-chromium-1-of-1.json'));
    expect(() => readKitReports(directory)).toThrow();
    fs.rmSync(artifact, {recursive: true}); fs.symlinkSync(directory, artifact);
    expect(() => readKitReports(directory)).toThrow('Symbolic');
    fs.unlinkSync(artifact); fs.mkdirSync(path.join(directory, 'unqualified-artifact'));
    expect(() => readKitReports(directory)).toThrow('artifact directory');
  }));
});
describe('coverage shard transport qualification', () => {
  it('qualifies every independently hashed readable browser shard and genuine unit coverage', () => temp(directory => {
    const rawDirectory = path.join(directory, 'raw'); raw(rawDirectory, 'one.json');
    const first = createCoverageInventory(rawDirectory, '1/2');
    fs.unlinkSync(path.join(rawDirectory, 'one.json')); raw(rawDirectory, 'two.json');
    const second = createCoverageInventory(rawDirectory, '2/2'); raw(rawDirectory, 'one.json');
    expect(qualifyCoverageUnion(rawDirectory, [second, first], 2, unit(directory))).toMatchObject({status: 'passed', shards: 2, rawFiles: 2, unit: {files: 1}});
  }));
  it('rejects malformed JSON, missing entries, empty data and symbolic links before collection', () => temp(directory => {
    const rawDirectory = path.join(directory, 'raw'); fs.mkdirSync(rawDirectory);
    expect(() => createCoverageInventory(rawDirectory, '1/1')).toThrow();
    for (const value of ['{', '{}', '{"entries":null}', '{"entries":[]}', '{"entries":[{}]}']) {
      fs.writeFileSync(path.join(rawDirectory, 'bad.json'), value); expect(() => createCoverageInventory(rawDirectory, '1/1')).toThrow();
    }
    fs.unlinkSync(path.join(rawDirectory, 'bad.json')); raw(directory, 'outside.json'); fs.symlinkSync(path.join(directory, 'outside.json'), path.join(rawDirectory, 'linked.json'));
    expect(() => createCoverageInventory(rawDirectory, '1/1')).toThrow();
  }));
  it('rejects missing/duplicate shards, overlapping filenames, tampered bodies, extra files and missing unit coverage', () => temp(directory => {
    const rawDirectory = path.join(directory, 'raw'); raw(rawDirectory, 'one.json'); const inventory = createCoverageInventory(rawDirectory, '1/1'), units = unit(directory);
    expect(() => qualifyCoverageUnion(rawDirectory, [], 1, units)).toThrow();
    expect(() => qualifyCoverageUnion(rawDirectory, [inventory, inventory], 2, units)).toThrow();
    expect(() => qualifyCoverageUnion(rawDirectory, [{...inventory, files: [...inventory.files, ...inventory.files]}], 1, units)).toThrow();
    raw(rawDirectory, 'one.json', '/js/other.js'); expect(() => qualifyCoverageUnion(rawDirectory, [inventory], 1, units)).toThrow();
    raw(rawDirectory, 'one.json'); raw(rawDirectory, 'extra.json'); expect(() => qualifyCoverageUnion(rawDirectory, [inventory], 1, units)).toThrow(); fs.unlinkSync(path.join(rawDirectory, 'extra.json'));
    expect(() => qualifyCoverageUnion(rawDirectory, [inventory], 1, path.join(directory, 'absent'))).toThrow();
    fs.writeFileSync(units, '{}'); expect(() => qualifyCoverageUnion(rawDirectory, [inventory], 1, units)).toThrow();
  }));
  it('rejects invalid shard pairs and nonnumeric unit counters', () => temp(directory => {
    const rawDirectory = path.join(directory, 'raw'); raw(rawDirectory, 'one.json');
    for (const pair of ['0/1', '2/1', '1/65', '1/0', '1x/2']) expect(() => createCoverageInventory(rawDirectory, pair)).toThrow();
    const inventory = createCoverageInventory(rawDirectory, '1/1'), units = unit(directory), contents = JSON.parse(fs.readFileSync(units, 'utf8'));
    contents['/checkout/js/main.js'].s['0'] = '1'; fs.writeFileSync(units, JSON.stringify(contents));
    expect(() => qualifyCoverageUnion(rawDirectory, [inventory], 1, units)).toThrow();
  }));
});
describe('always-running required CI result gate', () => {
  const selected = {prepare: true, unit: true, chromium: false, coverage: false};
  const needs = {prepare: {result: 'success'}, unit: {result: 'success'}, chromium: {result: 'skipped'}, coverage: {result: 'skipped'}};
  it('accepts only successful selected jobs and explicitly skipped unselected jobs', () => expect(qualifyJobs(needs, selected, false)).toMatchObject({status: 'passed'}));
  it('rejects failed/cancelled/skipped selected jobs and unexpected execution or missing job outcomes', () => {
    for (const result of ['failure', 'cancelled', 'skipped', null]) expect(() => qualifyJobs({...needs, unit: {result}}, selected, false)).toThrow();
    expect(() => qualifyJobs({...needs, chromium: {result: 'success'}}, selected, false)).toThrow();
    expect(() => qualifyJobs({...needs, extra: {result: 'success'}}, selected, false)).toThrow();
    expect(() => qualifyJobs({...needs, prepare: {result: 'failure'}}, selected, false)).toThrow();
    expect(() => qualifyJobs(needs, {...selected, prepare: false}, false)).toThrow();
  });
  it('requires successful combined coverage for every full run', () => {
    expect(() => qualifyJobs(needs, selected, true)).toThrow();
    expect(qualifyJobs({...needs, coverage: {result: 'success'}}, {...selected, coverage: true}, true)).toMatchObject({status: 'passed', full: true});
  });
});


describe('coverage file replacement races', () => {
  it.each(['raw', 'unit'])('keeps %s reads bound to the opened file when its path is replaced', kind => temp(directory => {
    const rawDirectory = path.join(directory, 'raw'); raw(rawDirectory, 'one.json');
    const inventory = createCoverageInventory(rawDirectory, '1/1'), units = unit(directory);
    const target = kind === 'raw' ? path.join(rawDirectory, 'one.json') : units, outside = path.join(directory, 'outside.txt');
    fs.writeFileSync(outside, 'invalid replacement JSON'); const open = fs.openSync.bind(fs); let swapped = false;
    vi.spyOn(fs, 'openSync').mockImplementation((...args) => {
      const descriptor = open(...args);
      if (args[0] === target && !swapped) {swapped = true; fs.unlinkSync(target); fs.symlinkSync(outside, target);}
      return descriptor;
    });
    if (kind === 'raw') expect(createCoverageInventory(rawDirectory, '1/1')).toEqual(inventory);
    else expect(qualifyCoverageUnion(rawDirectory, [inventory], 1, units)).toMatchObject({status: 'passed', rawFiles: 1, unit: {files: 1}});
    expect(swapped).toBe(true); expect(fs.readFileSync(outside, 'utf8')).toBe('invalid replacement JSON');
  }));

  it.each(['raw', 'unit'])('rejects a %s symlink introduced immediately before open', kind => temp(directory => {
    const rawDirectory = path.join(directory, 'raw'); raw(rawDirectory, 'one.json');
    const inventory = createCoverageInventory(rawDirectory, '1/1'), units = unit(directory);
    const target = kind === 'raw' ? path.join(rawDirectory, 'one.json') : units, outside = path.join(directory, 'outside.txt');
    fs.writeFileSync(outside, 'unqualified replacement'); const open = fs.openSync.bind(fs); let swapped = false;
    vi.spyOn(fs, 'openSync').mockImplementation((...args) => {
      if (args[0] === target && !swapped) {swapped = true; fs.unlinkSync(target); fs.symlinkSync(outside, target);}
      return open(...args);
    });
    expect(() => qualifyCoverageUnion(rawDirectory, [inventory], 1, units)).toThrow(); expect(swapped).toBe(true);
  }));

  it('closes every opened descriptor when unit validation rejects a directory', () => temp(directory => {
    const rawDirectory = path.join(directory, 'raw'); raw(rawDirectory, 'one.json');
    const inventory = createCoverageInventory(rawDirectory, '1/1'), open = fs.openSync.bind(fs), descriptors: number[] = [];
    vi.spyOn(fs, 'openSync').mockImplementation((...args) => {const descriptor = open(...args); descriptors.push(descriptor); return descriptor;});
    const close = vi.spyOn(fs, 'closeSync');
    expect(() => qualifyCoverageUnion(rawDirectory, [inventory], 1, directory)).toThrow('Unit coverage must be a regular file');
    expect(descriptors.length).toBeGreaterThan(0); for (const descriptor of descriptors) expect(close).toHaveBeenCalledWith(descriptor);
  }));
});
