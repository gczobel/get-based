# Relay self-service routing

Sync uses a WebSocket relay URL. Storage Refresh and Reduce storage use the
relay's separate HTTP(S) `/self/owner-storage` and `/self/compact-owner` endpoints.
Successful WebSocket sync does not establish that these HTTP routes are reachable.

By default the app converts `wss:` to `https:` (or `ws:` to `http:`), removes the
WebSocket path/query, and preserves the hostname and explicit port. Loopback
hosts use port 4003 for local relay development. Other hosts keep their port:
a reverse proxy on a custom port may already route `/self/*` correctly.

For a relay exposing self-service on another origin or port, open Settings →
Data → Sync → Relay & device options and set **Self-service URL (optional)** to
the HTTP(S) base URL supplied by the operator. The app appends `/self/...`; do
not enter an individual endpoint, query, credentials or fragment. A base path
is supported when the proxy routes that prefix. Save applies immediately on
this device; use Refresh in Sync status & storage to verify it. Clear and save
the field to restore automatic routing. This setting does not change the
WebSocket relay or the Sync identity, and does not sync to other devices.

Operators should terminate TLS and route the self-service endpoints to the
relay's self-service listener. An HTTPS application needs a browser-accessible
HTTPS endpoint; cross-origin endpoints also need the relay's appropriate CORS
configuration. Keep administrative services protected and internal listeners
bound as documented by the relay deployment. Changing the client URL is not a
reason to expose an unprotected listener or broaden its bind address.

Requests retain their owner-specific HMAC authorization; the client sends a
signature, never the write key. URL validation rejects embedded credentials,
queries and fragments. Timeouts, relay-version support, connectivity and proxy
routing can all make storage unavailable while WebSocket sync still works.

[Focused endpoint tests](../tests/sync-relay-self-service.test.ts) cover automatic
custom-port compatibility, explicit overrides, resetting, validation and both
signed endpoints. [Settings acceptance](../tests/playwright/settings-sync-panel.spec.ts)
covers saving and clearing the independent device-local setting.
