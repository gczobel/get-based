# getbased: health data and cross-device sync

A private, browser-first health dashboard. This glossary fixes the words used when deciding what data moves between a person's devices and what stays on the device where it was created.

## Language

**Profile**:
One person's complete health record: labs, notes, supplements, and everything derived from them. Cross-device sync moves a Profile between devices that share a Sync identity.
_Avoid_: account, client, user

**Sync identity**:
The 24-word mnemonic-derived owner that ties a person's devices to one encrypted copy on a relay.
_Avoid_: login, account

**Relay**:
The server that stores the encrypted, synced copy of a Profile for a Sync identity. It only ever sees ciphertext.
_Avoid_: backend, cloud

### Readings

**Manual lab value**:
A lab marker result the person typed by hand instead of importing from a report.
_Avoid_: manual entry, manual metric

**Manual body reading**:
A weight, blood pressure or pulse measurement the person typed by hand. It has no vendor account behind it.
_Avoid_: manual entry, manual metric, manual row, biometric

**Wearable reading**:
A daily measurement supplied by a connected vendor (Oura, Withings, and similar), so it depends on a per-device authorisation.
_Avoid_: device data, sensor data

### Storage layers

**Reading store**:
The per-device, per-Profile store of raw daily readings. It does not sync.
_Avoid_: L1, wearables database

**Summary**:
The compact values derived from readings (latest value, baselines, weekly trends) that travel with the Profile and do sync.
_Avoid_: L2, rollup
