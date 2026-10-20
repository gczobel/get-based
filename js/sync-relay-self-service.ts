// Device-local endpoint configuration; transport and signing remain with relay health.
export const SELF_URL_OVERRIDE_KEY = 'labcharts-self-url';
export function normalizeRelaySelfServiceUrl(value: string): string {
  const text = value.trim();
  if (!text) return '';
  let url: URL;
  try { url = new URL(text); } catch { throw new Error('Enter an absolute http:// or https:// self-service URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.includes('?') || url.href.includes('#')) {
    throw new Error('Use an http:// or https:// base URL without credentials, query parameters or a fragment.');
  }
  return url.toString().replace(/\/+$/, '');
}
export function getRelaySelfServiceUrl(): string {
  try { return normalizeRelaySelfServiceUrl(localStorage.getItem(SELF_URL_OVERRIDE_KEY) || ''); } catch { return ''; }
}
export function setRelaySelfServiceUrl(value: string): string {
  const url = normalizeRelaySelfServiceUrl(value);
  if (url) localStorage.setItem(SELF_URL_OVERRIDE_KEY, url);
  else localStorage.removeItem(SELF_URL_OVERRIDE_KEY);
  return url;
}
/** Preserve reverse-proxy/custom-port deployments; never guess a LAN service port. */
export function resolveRelaySelfServiceUrl(relay: string | null | undefined, override = ''): string | null {
  if (override) return normalizeRelaySelfServiceUrl(override);
  if (!relay) return null;
  try {
    const url = new URL(relay);
    if (url.protocol === 'wss:') url.protocol = 'https:';
    else if (url.protocol === 'ws:') url.protocol = 'http:';
    else return null;
    url.pathname = ''; url.search = ''; url.hash = '';
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.port = '4003';
    return url.toString().replace(/\/$/, '');
  } catch { return null; }
}
