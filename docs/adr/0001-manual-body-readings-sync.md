---
status: accepted
---

# Manual body readings sync; wearable readings stay device-local

Manual body readings (weight, blood pressure, pulse, with their tags and notes) now travel with the Profile to every device on the same Sync identity. Wearable readings keep the existing rule: raw rows stay in the Reading store, only the Summary syncs. The documented reason for device-local readings is that a stolen mnemonic must not grant continuous access to live vendor feeds; a typed value has no vendor account behind it, so that reason does not apply, and the deletion markers for these readings already sync while the readings themselves did not.

Each field syncs as its own row (`<date>:<field>`), so a blood pressure reading logged on one device and a weight logged on another for the same date both survive. The Reading store stays the source of truth on each device; inbound rows are written back into it.

## Considered options

- **Summary only.** Rejected: the strip lists Manual as connected only when local rows exist, so a fresh device would not show the synced Summary anyway.
- **Documentation only.** Rejected: leaves users with an empty history on every second device and contradicts the guide's statement that all Profile data syncs.
- **One row per date.** Rejected: concurrent edits to different fields on the same date would lose one of them.

## Consequences

- Manual readings are stored twice per device (Reading store and synced Profile data); the cost is a few hundred bytes a year.
- Other non-vendor sources in the Reading store (for example file-imported ones) remain device-local. That is an adjacent case, not decided here.
- This deviates from `ARCHITECTURE.md`'s "raw wearable stores remain device-local" wording for one source and needs that sentence updated with the change.
