import {afterEach, expect, it, vi} from 'vitest';
import {getRelaySelfServiceUrl, normalizeRelaySelfServiceUrl, resolveRelaySelfServiceUrl, setRelaySelfServiceUrl, SELF_URL_OVERRIDE_KEY} from '../js/sync-relay-self-service.js';
import {configureRelayHealth, fetchOwnerStorageFromRelay, compactOwnerSelfServe} from '../js/sync-relay-health.js';
afterEach(() => {localStorage.clear(); configureRelayHealth({getAppOwner: () => null, getSyncRelay: () => null}); vi.unstubAllGlobals();});
it.each([
  ['ws://localhost:4000/path', 'http://localhost:4003'], ['ws://127.0.0.1:4000', 'http://127.0.0.1:4003'],
  ['ws://[::1]:4000', 'http://[::1]:4003'], ['wss://relay.example:8443/ws?x=1', 'https://relay.example:8443'],
  ['wss://192.168.1.50:4000', 'https://192.168.1.50:4000'], ['wss://relay.example', 'https://relay.example'],
])('preserves compatible automatic routing for %s', (relay, expected) => expect(resolveRelaySelfServiceUrl(relay)).toBe(expected));
it('stores an explicit base URL on this device and blank restores automatic routing', () => {
  expect(setRelaySelfServiceUrl(' https://storage.example:4443/relay/ ')).toBe('https://storage.example:4443/relay');
  expect(localStorage.getItem(SELF_URL_OVERRIDE_KEY)).toBe('https://storage.example:4443/relay');
  expect(getRelaySelfServiceUrl()).toBe('https://storage.example:4443/relay');
  expect(resolveRelaySelfServiceUrl('wss://192.168.1.50:4000', getRelaySelfServiceUrl())).toBe('https://storage.example:4443/relay');
  expect(setRelaySelfServiceUrl('')).toBe('');
  expect(localStorage.getItem(SELF_URL_OVERRIDE_KEY)).toBeNull();
});
it.each(['ws://relay.example', '/relative', 'javascript:alert(1)', 'https://user:secret@example.test', 'https://example.test?token=secret', 'https://example.test#fragment', 'https://example.test?', 'https://example.test#'])('rejects unsafe or ambiguous settings without overwriting a valid URL: %s', value => {
  setRelaySelfServiceUrl('https://self.example');
  expect(() => normalizeRelaySelfServiceUrl(value)).toThrow();
  expect(() => setRelaySelfServiceUrl(value)).toThrow();
  expect(getRelaySelfServiceUrl()).toBe('https://self.example');
  localStorage.setItem(SELF_URL_OVERRIDE_KEY, value);
  expect(getRelaySelfServiceUrl()).toBe('');
});
it('uses the explicit endpoint for both signed quota reads and confirmed compaction requests', async () => {
  const key = new Uint8Array([1, 2, 3, 4]);
  configureRelayHealth({getAppOwner: () => ({id: 'synthetic-owner', writeKey: key}), getSyncRelay: () => 'wss://192.168.1.50:4000'});
  setRelaySelfServiceUrl('https://storage.example:4443/relay');
  const fetcher = vi.fn().mockResolvedValue({ok: true, json: async () => ({storedBytes: 1024, afterStoredBytes: 0})});
  vi.stubGlobal('fetch', fetcher);
  await fetchOwnerStorageFromRelay(); await compactOwnerSelfServe();
  const storageUrl = new URL(fetcher.mock.calls[0]![0] as string);
  expect(storageUrl.origin + storageUrl.pathname).toBe('https://storage.example:4443/relay/self/owner-storage');
  expect(storageUrl.searchParams.get('ownerId')).toBe('synthetic-owner');
  expect(storageUrl.searchParams.get('signature')).toMatch(/^[a-f0-9]{64}$/);
  expect(fetcher.mock.calls[1]![0]).toBe('https://storage.example:4443/relay/self/compact-owner');
  const body = JSON.parse((fetcher.mock.calls[1]![1] as RequestInit).body as string) as {ownerId: string; signature: string};
  expect(body.ownerId).toBe('synthetic-owner'); expect(body.signature).toMatch(/^[a-f0-9]{64}$/);
  expect(body.signature).not.toBe(storageUrl.searchParams.get('signature'));
});
