# Diagnostics log (opt-in, for real-device passes)

> Design record for this area, moved out of `CLAUDE.md` (2026-10-30/31). The first section is the VERIFIED summary of the
> invariants (each checked against the code at the time by an independent pass); the second is the verbatim record written phase
> by phase while the area was built. The plan and the as-built history are in [../mobile-ux-study.md](../mobile-ux-study.md); what only
> real phones can confirm is in [../mobile-ux-device-pass.md](../mobile-ux-device-pass.md).

## Invariants (verified summary)

[`DiagnosticsService`](../../src/app/core/services/shared/diagnostics.service.ts) is a bounded record of what the app did on THIS device, built so a phone can hand evidence back. **Off by default.** Entries are `{t, w, cat, msg, data?}` in a ring buffer ([`DiagnosticsLog`](../../src/app/core/helpers/diagnostics-log.helper.ts), `DIAGNOSTICS.CAPACITY`) that overwrites the OLDEST (the last minutes before a failure are what a report is for); `t` is `performance.now()`, which may not advance while a page is suspended, so only `w` (`Date.now()`) says how long a gap really was. `cat` is the closed set `DIAGNOSTICS_CATEGORIES` in [diagnostics.models.ts](../../src/app/core/models/diagnostics.models.ts), which the window filters by (a new area adds a category and its label, never an ad-hoc string): pointer, touch, key, ime, frame, boot, ocr, save, update, error, `page` (lifecycle and viewport: the trace an iOS tab eviction leaves), `power`, `platform` (what the browser or OS did that the game did not ask for) and `layout` (one line per change of the stage plan); each subsystem's own section says what it writes.
Switch: "Dados e avançado" > "Ferramentas" > "Diagnóstico" ([diagnostics-modal](../../src/app/pages/game/components/diagnostics-modal/diagnostics-modal.component.ts)) persists it in `STORAGE_KEY.DIAGNOSTICS`; `?diag=1` (before or after the `#`) turns it on for that tab's session only, `?diag=0` forces it off. `GamePage.debugMode` (which gates "Baixar disco virtual") just reads `DiagnosticsService.enabled`: one switch, no second mechanism. The service is root with no `clear()` on purpose (no per-room state; `clearEntries()` is the window's "Limpar").

- **Log through `DiagnosticsService.log(cat, msg, data?)`; never `console.log` in a hot path.** Off, `log()` is one boolean check, a `data` thunk is never called and nothing is serialized, so a call may sit on a pointer or key path; a console line costs a string and a write whether anyone looks and cannot be exported from a phone. When on, `data` becomes bounded text at the call (`DiagnosticsSerializer`: depth, key and length limits, cycles marked, never throws), because the log runs on code that is already misbehaving and must not add a failure. Log counts, kinds and timings, not what the player typed; the exception is `ime`, which records every event of the type bar's field while it is open, so typed text DOES appear and the window warns of it.
- **Off means no listeners and no timers.** `DiagnosticsCapture.install` (window `error`, `unhandledrejection`, `visibilitychange`, `pagehide`/`pageshow`, `freeze`/`resume` where they exist, resize/orientation/`visualViewport` coalesced into one `viewport` entry) and the persistence interval exist only between `enable()` and `disable()`; `install` is the only place a listener is added. Count them through zone.js's task lists: DevTools shows one native listener per type under zone.js and cannot see these.
- **Window listeners alone miss almost every app error.** Angular catches template and zone errors, and zone.js's `Promise` never raises the native `unhandledrejection`. [`DiagnosticsErrorHandler`](../../src/app/core/services/shared/diagnostics-error-handler.ts), provided in `AppModule`, logs `error` / `ErrorHandler` and then calls the default handler; keep both.
- **`?diag=1` does not survive in the address.** `<base href="/">` makes the router's first `replaceState('#/game')` drop the query, so the request lives in `sessionStorage` (`DIAGNOSTICS.SESSION_KEY`), which a reload and a restored tab keep, and a person's own choice in the window clears it (`?diag=` after the `#` stays in the URL). The address wins over the stored choice and never writes it, so a test link does not leave the log on for the next visit.
- **The tail of the log outlives the page, in two copies.** An evicted tab leaves nothing in memory, so while on, the last `PERSIST_ENTRIES` entries (also capped by `PERSIST_MAX_CHARS`) go to Ionic Storage every `PERSIST_INTERVAL_MS` when there is something new (a tab killed in the foreground gets no event at all) AND to `localStorage` when the page is hidden, frozen or going away (`STORAGE_KEY.DIAGNOSTICS_LOG` is homed in both): a transaction started in `pagehide` is not guaranteed to commit, and a reload lost everything after the last interval write. The next page with the log on reads both, keeps the newer, shows it as "página anterior"; writing waits for that read (`tailRestored`) so the old tail is never overwritten unread, and a clear during it wins (`clearEpoch`). A `?diag=1` visit stores no choice but writes a tail like any other, which stays until "Limpar", switching off or "Apagar todos os dados" (it is what explains an eviction of that same tab).
- **"Apagar todos os dados" must be final.** `LocalStorageService.clearAllData` removes the `localStorage` copy through `STORAGE_KEY_HOMES` (Ionic Storage does not know it), and `GamePage.wipeEverything` calls `diagnostics.disable({ persist: false })` BEFORE `storageService.clearAllData` empties storage: with the log on, the reload fires `pagehide`, which wrote the tail straight back.
- **Copy and share read a report built BEFORE the tap.** Safari honours `clipboard.writeText()` and `navigator.share()` only while the tap is the current user gesture, and the header (storage estimate, service-worker lookup) is asynchronous: the window collects it on open and on "Atualizar", a tap only appends the live log synchronously, and [`DiagnosticsExportHelper`](../../src/app/core/helpers/diagnostics-export.helper.ts) is routing only, with no `await` before the call. Share hands over a `.txt` file where the browser takes files (long text arrives truncated on iOS targets) and the text otherwise; a dismissed sheet is not an error. The report is always the whole log; the category filter changes only what is shown.
- **State in `main`, presentation in the lazy game chunk.** Service, ring buffer, serializer, capture and tail are in `main` (`AppComponent` injects the service so it exists before any page); the header, report and export helpers and the window are not, and the service must not import them.
- **The report header never carries the query** (a share link holds a room code): the route only, nothing that identifies a person. It records what js-dos itself decided (`dom.pointers.bind.mobile`, `canLock`, `autolock`, its user-agent regex tested against this device), the guest framebuffer, both viewports and the pointer capabilities; every fact is read on its own, a missing API prints `n/d`, and each asynchronous probe has its deadline (`HEADER_PROBE_TIMEOUT_MS`).
- **Unverified on real devices:** the Galaxy A07 and iPhone 15 Pro Max passes are pending, in particular that an iPhone's eviction leaves its `visibilitychange` line in the tail.

## Full record (verbatim)

> Written phase by phase. Where it disagrees with the summary above or with the code, those win: later phases changed some earlier facts
> (for example, which root services keep a `DosCI`, and that two-peer sessions at 640x480 were later run).

[diagnostics.service.ts](../../src/app/core/services/shared/diagnostics.service.ts) is a bounded record of
what the app did on THIS device, built so a phone can hand evidence back: pointer, touch, key, ime,
frame, boot, ocr, save, update, error, `page` (lifecycle and viewport; added to the plan's list, because it is
the evidence an iOS tab eviction leaves), `power` (the emulator going to sleep and waking, see *Letting the
guest sleep*) `platform` (what the browser and the operating system did that the game did not ask for: the screen lock, the audio
context put to sleep, fullscreen, the install prompt, a one-time banner; see *Mobile platform polish*) and `layout` (the stage plan each time it changes: the window
it was made from, the columns of keys, the width of each side, the picture's box and place, and what the chat cost it; see *The stage*). **Off by default.**

**How to turn it on:** "Dados e avançado" > "Ferramentas" > "Diagnóstico" opens the window
([diagnostics-modal](../../src/app/pages/game/components/diagnostics-modal/diagnostics-modal.component.ts));
its switch persists the choice in `STORAGE_KEY.DIAGNOSTICS`. Or put `?diag=1` on the address (before
or after the `#`), which turns it on for that **tab's session** (`?diag=0` forces it off for one).
`GamePage.debugMode`, the old hard-coded `false` that gated "Baixar Disco Virtual", now reads
`DiagnosticsService.enabled`: one switch, no second mechanism.

**Log through `DiagnosticsService.log(cat, msg, data?)`; never `console.log` in a hot path.** A console
line costs a string and a write whether anyone looks, and cannot be exported from a phone. `data` is a
value or a thunk, and a thunk is not called while the log is off: `log()` is one boolean check and a
return, so a call may sit on a hot path (the pointer/touch/type-bar/camera phases are expected to log
there). When on, `data` is turned into bounded text at the call (`DiagnosticsSerializer`: depth, key and
length limits, cycles marked, `NaN`/`Infinity` named, never throws), and the ring buffer holds 5000
entries and overwrites the OLDEST. Call sites log counts, kinds and timings, not what a player typed; the
panel still warns that typed text may appear, because later phases will log input.

Load-bearing, each measured or a decision that looks wrong without its reason:

- **Off means no listeners and no timers.** `DiagnosticsCapture.install` (window `error`,
  `unhandledrejection`, `visibilitychange`, `pagehide`/`pageshow`, `freeze`/`resume` where the document has
  them, and `resize`/`orientationchange`/`visualViewport` resize coalesced into one `viewport` entry) and
  the persistence interval exist only between `enable()` and `disable()`. Checked in a browser through
  zone.js's own task lists, because DevTools counts one native listener per type under zone.js and so
  cannot see an added one.
- **The window listeners alone miss almost every app error.** Angular catches template and zone errors,
  and zone.js's `Promise` never raises the native `unhandledrejection` (of four rejections only the
  native `async` one reached a listener).
  [`DiagnosticsErrorHandler`](../../src/app/core/services/shared/diagnostics-error-handler.ts) is provided in
  `AppModule`, logs `error` / `ErrorHandler`, and then calls the default handler.
- **`?diag=1` does not survive in the address.** The document has `<base href="/">`, so the router's
  first `history.replaceState('#/game')` resolves against the base and drops the query. The request is
  therefore kept in `sessionStorage` (`DIAGNOSTICS.SESSION_KEY`), which a reload and a restored tab keep;
  a person's own choice in the window clears it. `?diag=` after the `#` is the form that stays in the URL.
- **The tail of the log outlives the page, in two copies.** An evicted tab leaves no memory behind and the
  events that explain it are in the page that dies, so while on, the last 1000 entries (at most 200K
  characters) go to Ionic Storage every 5 s when there is something new, and ALSO to `localStorage` when
  the page is hidden, frozen or going away: with only IndexedDB a reload lost everything after the last
  interval write, because a transaction started in `pagehide` does not finish. The next page that has the
  log on reads both, keeps the newer, and shows it as "página anterior". That includes a `?diag=1`
  visit: it stores no *choice*, but it writes a tail like any other, and the tail stays until "Limpar",
  switching the log off or "Apagar todos os dados" (the copy is what explains an eviction of that same
  tab, so it is kept while the visit is alive and not guessed at afterwards). Not verified: that an
  iPhone's eviction leaves its `visibilitychange` line (it is on the device checklist).
- **"Apagar todos os dados" must be final.** `LocalStorageService.clearAllData` also removes the
  `localStorage` copy (Ionic Storage does not know it), and `GamePage.clearAllData` switches the log off
  FIRST: with it on, the reload fires `pagehide`, which wrote the tail straight back (measured).
- **Copy and share read a report built BEFORE the tap.** Safari honours `clipboard.writeText()` and
  `navigator.share()` only while the tap is the current user gesture, and the header (storage estimate,
  service-worker lookup) is asynchronous, so the window collects it on open and on "Atualizar" and a tap
  only appends the live log, synchronously. Share hands over a `.txt` file where the browser takes files
  and the text otherwise; a dismissed sheet is not an error. The report is always the whole log: the
  window's category filter changes only what is shown.
- **The state lives in the main bundle, the presentation in the lazy game chunk.** The service, ring
  buffer, serializer, capture and tail are in `main` (`AppComponent` injects the service so it exists
  before any page); the header, report and export helpers and the window are not. Do not import the
  report or header helpers into the service.
- **The header never carries the query** (a share link holds a room code): the route only. It names
  js-dos's own detection (`dom.pointers.bind.mobile`, `canLock`, `autolock`, and its user-agent regex
  tested against this device), the guest framebuffer, the viewports, pointer capabilities, the service
  worker and the storage estimate, each asynchronous probe with its own deadline.

Hooked today (one-line calls, no behaviour change): `GuestKeyQueueService` (`key`: enqueue, start, flush
with how far the device stretched the 10 ms pacing, cancel, fail, refused, the CapsLock read), the boot
(`boot`: js-dos's loading text once per phase and ten percent, the stage changes, detection, failures;
`frame`: the guest's size), `OcrWorkerHost` and `EmulatorControlService` (`ocr`: the worker's life, each
recognition pass, the saving verdict when it changes), `AutoSaverService` and `SaveGameService` (`save`:
the dialog seen and gone, each persist with its reason and duration, tick failures, hidden-page pauses,
`layers.save()` time) and `AppComponent` (`update`: the prompt, the choice, the save before the reload).
`TouchInputService` and `GuestPointer` log into `touch` (the layer attached or detached; each finger landing with its
guest position and whether the cursor was sent ahead; every decision: tap, double-tap, drag start and end, aim start
and end, cancel with its reason, a palm or an extra finger ignored; the first compat mouse event dropped) and `pointer`
(each move with its from, to, sends, units, duration and the smallest and largest gap between sends, which is the
number that says whether a device stretches the spacing; each home with its reason; each click with how long it waited
behind the cursor and how long it held; each abort with what it dropped; a refused send). `CameraService` logs the camera into `touch` too (its attach and detach, a pinch's start, throttled steps, clamps and end, the presets, the pad, the follow, a rotation, a restore; see *The camera*). `EmulatorPowerService` logs every change of state into `power` (see *Letting the guest sleep*). `DockComponent` logs the control deck's presses, modifiers, repeats and panel changes into `key` and `page` (see *The control deck*). The live type bar logs every event of its field into `ime` while it is open,
and the field hint into `frame` (see *The live type bar*); typed text therefore does appear in the log, and the panel says so.
