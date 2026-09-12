# Versioned Storage for User-Authored Content

**Date:** 2026-09-13
**Base commit:** `6006a22` (`chore: release v1.4.0`)
**Status:** Approved, ready to implement

## Problem

The app stores 21 keys in `localStorage`, all reached through a single shared
gateway (`src/modules/shared/prefsStorage.ts`). That gateway handles storage
failures gracefully, but it has no notion of a stored value's shape or version.
Two consequences follow.

**Silent data loss on shape change.** A value's validator runs on read and
returns `undefined` for any field it no longer recognises. The caller then
applies its own default. Rename a field in a future release and every existing
user's setting quietly resets, with no migration and no signal that anything was
lost.

**Silent data loss on capacity.** `saveJSON` (`prefsStorage.ts:26-31`) catches
every error and returns `void`. The caller cannot distinguish a successful write
from a failed one.

The second is not hypothetical. `LetterFields.logo` is a base64 data URL stored
inside the letter draft and inside every entry of the letter archive.
`template-surat/index.tsx:139-149` reads the logo with a bare `readAsDataURL`
and no size bound; only the MIME type is checked. The archive caps itself at 50
entries **by count, not by bytes** (`storage.ts:22`). Fifty multi-megabyte logos
exceed the roughly 5 MB `localStorage` quota by a wide margin.

When that write fails, `saveToArchive` (`index.tsx:151-161`) runs
`setArchive(next)`, then `saveArchive(next)`, then unconditionally
`setInfo("Surat tersimpan ke riwayat.")`. The user sees the letter in the
archive and sees a success message. Nothing was persisted. On the next launch
the letter is gone.

## Goal

An app update must never silently destroy a user's authored content. Concretely:
change a stored shape in a future release and existing data migrates forward;
run out of storage and the user is told instead of being shown a success message
that isn't true.

## Non-Goals

- Versioning preferences that cannot meaningfully drift.
- Backup/restore UI.
- Asynchronous migrations.
- Any change to the other 16 stored keys.

## Architecture

One new shared module, `src/modules/shared/versionedStore.ts`. The existing
`prefsStorage` stays underneath it as the raw read gateway; `saveJSON` remains
available for low-stakes keys and is not modified.

### On-disk envelope

```json
{ "v": 2, "d": { } }
```

`v` is an integer schema version, `d` the payload. A stored value that is not
an envelope is legacy data and is version 1 by definition. This makes legacy
data unambiguous: there is no separate migration marker to keep in sync.

An envelope is detected by `typeof v === "number"` on a non-array object. No
current payload has a numeric `v` field, so legacy objects are never mistaken
for envelopes. A future payload field named `v` would create ambiguity; any
addition of a field with that name must bump the version and be handled inside
the migration chain.

### API

```ts
export type Migration = (input: unknown) => unknown;

export interface VersionedSpec<T> {
  key: string;
  version: number;
  migrations: Migration[];   // index i migrates v(i+1) -> v(i+2); length === version - 1
  validate: (value: unknown) => T | null;
}

export type ReadResult<T> =
  | { status: "empty"; value: null }
  | { status: "current"; value: T }
  | { status: "migrated"; value: T; from: number; previous: unknown }
  | { status: "future"; value: null; found: number }
  | { status: "invalid"; value: null; reason: "migration-failed" | "validation-failed" };

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: "quota" | "unavailable" };

export function readVersioned<T>(spec: VersionedSpec<T>): ReadResult<T>;
export function writeVersioned<T>(spec: VersionedSpec<T>, value: T): WriteResult;
```

`previous` on the `migrated` variant carries the pre-migration payload so a
module can report what the migration changed.

The module also exports small field-picking helpers (`pickString`,
`pickNumber`, `pickBoolean`, `pickNullableString`) so a validator for a wide
interface stays short and readable. Each returns the field when it has the
expected type and a caller-supplied fallback otherwise.

### Read path

1. `loadJSON(key)` returns the raw value. `null` means nothing is stored.
2. An envelope yields `v` and `d`; anything else is legacy v1 and the raw value
   is the payload.
3. If `v > spec.version`, return `{ status: "future", found: v }` without
   running migrations.
4. Otherwise run `spec.migrations[i]` for `i` from `v - 1` upward. A missing
   migration for a required step is an error.
5. Run `spec.validate` on the result. `null` rejects.

### Write path

`writeVersioned` serialises `{ v: spec.version, d: value }` and returns a
discriminated result. A `QuotaExceededError` (or its Firefox equivalent, or
legacy code 22) reports `"quota"`; every other failure reports `"unavailable"`.
It never throws.

### No automatic write-back

A migrated value stays in memory and is persisted on the next user save.
Writing back during a read would mean mutating storage inside a render or an
effect, and a failed write-back would be invisible, which is the failure mode
being eliminated. Migrations are pure and cheap, so re-running one on each read
until the user saves costs nothing meaningful.

### Migrations stay synchronous

Every read site calls its loader inside a `useState` initializer or an effect
(`template-surat/index.tsx:62`, `index.tsx:123`). An async chain would turn
`readVersioned` into a `Promise` and force every call site into a loading state.
Migrations are therefore total, synchronous functions. A migration that throws
is caught and produces `"migration-failed"`.

## The downgrade hazard

`network-printer/index.tsx:78-80` is
`useEffect(() => savePrinters(printers), [printers])`. That effect fires on
mount, writing whatever `loadPrinters()` returned straight back to storage. If a
future-version payload causes the read to return nothing, that effect
immediately writes an empty array and destroys the user's newer data.

The app ships as a sideloaded APK with an auto-update flow, so an older build
running against newer stored data is a realistic scenario.

Handling this is therefore load-bearing, not defensive polish. Each module
derives a single `locked` flag from `status === "future"`. Every save path
checks that flag before writing. When locked, the module tells the user the data
was written by a newer version and leaves storage untouched.

## Keys in scope

Five keys were nominated. Three are versioned.

| Key | Shape | Gate added |
|---|---|---|
| `printifya.letter-draft` | `LetterFields \| null` | Field-level type gate; `loadDraft` currently accepts anything |
| `printifya.letter-archive` | `ArchiveEntry[]` | Per-entry `{id, savedAt, data}` gate plus per-letter field gate; currently `Array.isArray` only (`storage.ts:40-42`) |
| `printifya.network-printers` | `Printer[]` | Per-entry `{id, name, host, port, path}` gate, port within 1-65535, non-empty host; currently `Array.isArray` only (`network-printer/index.tsx:35-40`) |

The remaining two are excluded, with reasons.

**`printifya.letter-paper`** is a preference, not authored content: a paper size
id whose fallback is A4, which is the correct answer anyway. Versioning it is
actively risky rather than merely pointless. It is stored as a bare string
through `loadString`/`saveString`, not JSON, so `JSON.parse("a4")` throws.
Moving it to a JSON envelope naively would make every existing user's stored
paper choice read as empty and reset. Every key kept in scope is already JSON,
which is exactly why this one is the exception.

**`printifya.printHistory`** had no writers. Nothing in the repository called
`addPrintRecord`; the only match was its own definition, so no released build
had ever written that key and versioning it was busywork. The missing write was
the actual defect and belonged in a separate change.

**Resolved afterwards** in `945ad5b`: every user-initiated print now records an
entry, and the key is versioned in `print-history/printHistoryStorage.ts` on the
same pattern. It is a log rather than authored content, so recording failures
deliberately never surface as print errors.

## Migrations

Two constants govern both:

- `MAX_LOGO_CHARS = 400_000`. A stored logo string above this is removed.
- `MAX_ARCHIVE_BYTES = 2 * 1024 * 1024` (2 MB). The archive's total budget.

New uploads are downscaled to a maximum side of 512 px and re-encoded as JPEG
at quality 0.85, which lands well under 120 KB and therefore under
`MAX_LOGO_CHARS` by a wide margin. The migration threshold is sized for legacy
data only; nothing the fixed upload path produces can trip it.

### `letter-draft`: v1 to v2, strip an oversized logo

The draft holds one optional logo. If the stored logo exceeds
`MAX_LOGO_CHARS`, the migration removes it and keeps every other field.
`LetterFields` has 14 fields; the migration touches exactly one.

### `letter-archive`: v1 to v2, strip oversized logos and prune to fit

Applies the same per-entry rule to `entry.data.logo`. This is where the quota
damage accumulates, since the logo is duplicated across up to 50 entries.

Stripping oversized logos alone does not close the hole. Fifty logos of 300 KB
each sit under `MAX_LOGO_CHARS` and still total 15 MB, far past the quota. The
migration therefore runs `pruneArchive` after stripping, evicting oldest entries
until the list fits both the count limit and `MAX_ARCHIVE_BYTES`. The evicted
count is reported alongside the removed-logo count so the user learns what
happened rather than finding letters missing.

Both migrations leave `version: 2` with a single-element chain.

### `network-printers`: version 1, no migrations

No shape change has occurred, so there is nothing to migrate. The empty chain is
deliberate rather than a placeholder.

### Why a sync migration drops logos instead of downscaling them

Downscaling needs canvas and is therefore async, which the synchronous read path
rules out. Dropping an oversized logo keeps the letter's actual content intact
and removes only the field that made the write fail. Both migrations receive the
pre-migration payload through the `migrated` result, so the storage module
counts how many logos were removed and the UI reports it. The user learns that a
logo was retired and why.

New uploads are downscaled at input time, where the flow is already async and
canvas is available. The lossy path therefore only ever touches data that was
already stranded.

### Reporting

Each storage module exposes the count of removed logos, the count of evicted
entries, and a `locked` flag alongside the loaded value. The UI surfaces all
three.

## Byte-aware archive cap

`MAX_ARCHIVE = 50` caps entry count. Storage is a shared ~5 MB across all 21
keys, so 50 entries carrying embedded logos can exhaust the budget long before
the count limit is reached. The archive gains `MAX_ARCHIVE_BYTES` (2 MB) in
addition to the count limit.

`pruneArchive(entries)` walks the list newest-first, keeping an entry while both
the count and the byte budget allow. An entry that would exceed the byte budget
is skipped rather than terminating the walk, so one oversized letter does not
discard every letter behind it. Byte size is estimated as the length of the
serialised entry, which is accurate for base64 payloads.

`saveArchive` persists exactly what it is given. The caller prunes first, then
saves, then mirrors the pruned list into component state, so the UI and storage
cannot disagree.

## Error surface

`saveJSON` swallowing failures is why the UI currently lies. Every one of these
call sites must distinguish success from failure.

| Site | Today | After |
|---|---|---|
| `index.tsx:130-134` draft autosave, 500 ms debounce | ignores the result | persistent inline state, "Tersimpan" or "Penyimpanan penuh, draf tidak tersimpan". Never a per-keystroke toast |
| `index.tsx:151-161` `saveToArchive` | shows "Surat tersimpan ke riwayat." unconditionally | that message is a lie on a quota failure. Show it only when the write reports `ok`; otherwise an actionable error |
| `index.tsx:170-174` `deleteEntry` | `setArchive` then `saveArchive`, no check | on failure restore the entry in memory so the UI matches storage. A delete whose write fails otherwise returns on reload |
| `network-printer` save effect | writes on mount, no check | future-version guard, plus an error on quota failure |

Failure modes and their handling:

- **Quota or unavailable storage.** The write reports it. The module shows an
  error and, for archive mutations, reverts the in-memory list so what the user
  sees matches what is stored.
- **Migration throws.** Caught, reported as `"migration-failed"`, and storage is
  left byte-identical. The module falls back to defaults and tells the user
  stored data could not be read, rather than presenting a fresh install.
- **Validation rejects.** Reported as `"validation-failed"`. For the archive,
  rejection is per entry: a malformed entry is dropped and the rest survive. The
  dropped count is reported.
- **Future version.** Reported as `"future"`. The module locks its save paths
  and tells the user to update the app. Nothing is written.

## Testing

Vitest runs in Node without a DOM, as `src/modules/shared/downloadUrl.test.ts`
documents in its own comment. Tests must therefore stub `localStorage` with
`vi.stubGlobal`, following that file's convention, rather than assuming jsdom.

New file `src/modules/shared/versionedStore.test.ts`:

1. Empty storage yields `empty`.
2. Legacy JSON with no envelope is treated as v1, validated, and returned.
3. An envelope is read from `v` and `d`.
4. A two-step chain applies in order: a spec at version 3 with stored v1 applies
   both migrations, in sequence, with the first's output feeding the second.
5. A value already at the current version runs no migration.
6. A stored version above the spec yields `future`, runs no migration, and
   **performs no write**.
7. A throwing migration is caught, yields `migration-failed`, and leaves the
   stored bytes unchanged.
8. A validator returning `null` yields `validation-failed`.
9. A successful write stores `{ v, d }`.
10. A `setItem` that throws `QuotaExceededError` yields
    `{ ok: false, reason: "quota" }` without throwing.
11. A non-quota `setItem` failure yields `reason: "unavailable"`.

Module-level tests assert that one malformed archive entry is dropped while the
valid entries survive, that the v1-to-v2 logo migration removes only the
oversized logo and preserves sibling fields, that a logo under `MAX_LOGO_CHARS`
survives the migration, that an archive of many mid-sized logos is pruned to
`MAX_ARCHIVE_BYTES` with the oldest evicted, and that `pruneArchive` skips an
oversized entry without discarding the entries behind it.

## Verification

```
npx tsc --noEmit
npx vitest run
npx vite build
```

All three must pass, with the existing suite still green.

## Out of scope

- `printifya.letter-paper` and the other 16 stored keys.

(`printifya.printHistory` versioning and wiring `addPrintRecord` were later
added in `945ad5b`, outside this spec's scope.)
- Backup/restore UI.
- Async migrations.

## Findings reported, not fixed here

**`addPrintRecord` was dead code.** It was exported from
`print-history/index.tsx:142` and called from nowhere, so print history was
always empty and the Home dashboard's "Terakhir Dicetak" section could never
populate. Wired up in `945ad5b`.

**`print-history/index.tsx:25` wrote raw `localStorage` with no try/catch.**
This violated the documented convention that all storage access goes through
`prefsStorage`, and it would have thrown inside a print flow once
`addPrintRecord` was wired up. Fixed in `945ad5b`, which moved the key onto the
versioned store.

**Two modules bypassed the shared gateway.** `print-history/index.tsx` called
`localStorage` directly on both read and write, and `pages/Home.tsx:19` read
`printifya.printHistory` directly. Both now go through the shared helper
(`945ad5b`). The direct read in `Home.tsx` was the sharper bug of the two: once
the value gained a version envelope, a raw `JSON.parse` would have returned an
object rather than an array and the dashboard would have stayed empty forever.

**A registry group still has a null component.** `registry.ts:290` sets
`Component: null as unknown as ComponentType` for the "Fitur Cepat" group,
which has a real `path` (`/tools`) but no landing page. Because `App.tsx`
builds `element={<m.Component />}` for every group eagerly, React logs "type is
invalid ... got: null" on every render of every page, and visiting `/tools`
renders a blank content area. Pre-existing since `68fbddc` and untouched here.
