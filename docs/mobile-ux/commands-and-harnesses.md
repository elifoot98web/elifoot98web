# Commands

> Design record for this area, moved out of `CLAUDE.md` (2026-10-30/31). The first section is the VERIFIED summary of the
> invariants (each checked against the code at the time by an independent pass); the second is the verbatim record written phase
> by phase while the area was built. The plan and the as-built history are in [../mobile-ux-study.md](../mobile-ux-study.md); what only
> real phones can confirm is in [../mobile-ux-device-pass.md](../mobile-ux-device-pass.md).

## Invariants (verified summary)

```bash
npm install              # first time only
npm start                # ng serve → http://localhost:4200
npm run build            # production build (default configuration) → www/
npm run build:githubpages # what CI deploys
npm run lint             # ng lint (eslint, src/**/*.ts + src/**/*.html)
npm test                 # ng test (karma + jasmine, visible Chrome, watch mode)
npm run test:ci          # ng test --watch=false --browsers=ChromeHeadlessCI: one headless run, exits non-zero on failure
npx ng test --include='**/my.spec.ts' --watch=false --browsers=ChromeHeadlessCI   # single spec
npm run mp:launch        # two browsers for a multiplayer session (see the harness README)
python3 scripts/resolution/build_bundle.py verify src/assets/elifoot/elifoot98.jsdos   # the resolution switch is in the bundle
node scripts/frame-fixtures/make-fixtures.mjs <out.ts> name=frame.png::note ...   # real guest frames -> a spec fixture
node scripts/pwa-icons/make-maskable.mjs <source.png> <out.png> --size 512 --check   # a maskable launcher icon from the shipped artwork
```

**Specs** are karma + jasmine. The builder globs `**/*.spec.ts` (its `include`, which `--include` overrides) and `tsconfig.spec.json` type-checks `src/**/*.spec.ts`: a spec needs no registration but must live under `src/` to be type-checked, and nothing in a spec reaches the bundle. A run that matches no spec prints `Executed 0 of 0 SUCCESS` and still exits 1, so a mistyped `--include` fails the run. Write specs for pure logic (helpers, planners, parsers, queues on a fake clock); the emulator, the screen-scrapers and the WebRTC paths have no karma coverage and are checked in a real browser with the harnesses below. `ChromeHeadlessCI` ([karma.conf.js](../../karma.conf.js)) is `ChromeHeadless --no-sandbox`, which a CI runner or container needs; plain `npm test` keeps the visible Chrome and the watcher. Rules that keep a spec honest, and the traps in writing one:

- **`fakeAsync` drains leftover timers by default (`flush: true`), which hides a timer that was never cleared.** Pass `{ flush: false }` whenever "nothing is left scheduled" is part of what a spec asserts, and end the spec with `stop()`/`detach()` so it can prove it ([timeout.helper.spec.ts](../../src/app/core/helpers/timeout.helper.spec.ts), [auto-saver.service.spec.ts](../../src/app/core/services/game/auto-saver.service.spec.ts), [key-repeat.helper.spec.ts](../../src/app/core/helpers/key-repeat.helper.spec.ts)).
- **zone.js fakes `Date`, not `performance.now`.** Code timed with `performance.now` needs a clock handed in (`now: () => Date.now()`, as [guest-pointer.helper.spec.ts](../../src/app/core/helpers/guest-pointer.helper.spec.ts) does) or a spy; [deck-key.directive.spec.ts](../../src/app/core/components/dock/deck-key.directive.spec.ts) spies it and must **never reset it between specs**, because the guard it tests keeps its clock in a static.
- **Build a rejected promise inside the fake, never up front** (`outcomes()` in the auto-saver spec), or it has no handler yet and fails the spec as unhandled. The same goes for a rig whose `attach()` starts timers: build it inside `fakeAsync` and detach it in a `finally` (`scenario()` in [touch-input.service.spec.ts](../../src/app/core/services/game/touch-input.service.spec.ts)).
- **TestBed is zoneless (Angular 21's default) although `main.ts` boots the app with zone change detection.** `fixture.detectChanges()` refreshes only a view that was marked dirty and a plain field a spec writes is not a signal, so `markForCheck()` first or the dev-mode check throws NG0100.
- **Never dispatch a synthetic `beforeunload` on the real `window`:** it reaches Karma's own handler and fails the whole run ("Some of your tests did a full page reload!"). `SaveSafetyService.unloadTarget()` is overridable for exactly this.
- **Hand an emulator-facing service a stub `DosCI`, never the real one** (the key queue, `PatchService.setDisplayMode` against a stand-in `dosInstance`). A service that takes a `DiagnosticsService` gets a double from [diagnostics.testing.ts](../../src/app/core/services/shared/diagnostics.testing.ts) (`silentDiagnostics()`, `recordingDiagnostics()`, `memoryStorage()`). `PatchService`'s `Error` messages are shown verbatim by the game page, so its spec pins the Portuguese wording and fails on the English JSZip and HttpClient reject with.
- **Check a rule against an independent model of the world, not a copy of the code.** The pointer engine runs against a fake guest written from the measured rules (one case is a control showing the fake really does punish a spacing below a frame); the detectors ([game-exit.helper.spec.ts](../../src/app/core/helpers/game-exit.helper.spec.ts), [ibeam.helper.spec.ts](../../src/app/core/helpers/ibeam.helper.spec.ts)) run on real 640x480 frames of the guest, made by `scripts/frame-fixtures/` from `dosCI.screenshot()` PNGs and inflated by the fixtures module's `loadFrame()` with `DecompressionStream`, a spec paints on a copy and never on the shared frame, and the set holds the look-alikes (the arrow over a white list, for the I-beam) so a case can only pass by telling them apart; typing engines get REAL `InputEvent`/`CompositionEvent`/`KeyboardEvent`s at a real `<input>` ([type-bar-session.helper.spec.ts](../../src/app/core/helpers/type-bar-session.helper.spec.ts)) because Chrome's and Safari's orders differ; layout runs a whole device matrix ([stage.helper.spec.ts](../../src/app/core/helpers/stage.helper.spec.ts)) and the overlay's geometry runs in REAL layout, no mocks ([overlay-sync.helper.spec.ts](../../src/app/core/helpers/overlay-sync.helper.spec.ts), `getBoundingClientRect`); CSS is probed on the real `src/global.scss` karma loads ([win9x-palette.spec.ts](../../src/theme/win9x-palette.spec.ts)), never a second copy of the hex values; browser stores are real ([save-game.service.spec.ts](../../src/app/core/services/game/save-game.service.spec.ts) builds `js-dos-cache (spec …)` IndexedDB databases and deletes every `js-dos-cache*` one before and after each case).
- **[storage-keys.spec.ts](../../src/app/core/services/shared/storage-keys.spec.ts) writes every `STORAGE_KEY` to every home `STORAGE_KEY_HOMES` lists, runs the real wipe against the real Ionic Storage** and fails if any survives; a key with no `STORAGE_KEY_HOMES` entry does not compile. Nothing is meant to survive the wipe: a key that must is a decision to name in both `clearAllData` and this spec.
- **A fake of a browser API must answer the way the real one does.** [wake-lock.service.spec.ts](../../src/app/core/services/shared/wake-lock.service.spec.ts) lets each case choose the next answer of a fake `navigator.wakeLock` (a grant, a refusal, a request held in flight); a fake that answers synchronously is a trap, because the real browser dispatches `statechange` as a task, which is why `AudioHealthService` queues a re-entrant look. A service that holds something open around its awaits ([cheat-omatic.service.spec.ts](../../src/app/core/services/game/cheat-omatic.service.spec.ts)) is tested by failing the read and the write: it must still let go.
- **Code that must cost nothing while it is off** ([diagnostics.service.spec.ts](../../src/app/core/services/shared/diagnostics.service.spec.ts)): spy the real `window` before the service exists, assert the data thunk is never called, and end with a `finish()` that switches the service off, so a failing case cannot leave listeners on the karma page. For "did it log this", hand in a two-line recorder that reads each data thunk at the call, as the real one does.
- **A decision gets a table, a machine gets its time as an argument, a file format gets both ends.** [save-policy.helper.spec.ts](../../src/app/core/helpers/save-policy.helper.spec.ts) writes the table out row by row and asserts the rule it exists for (`null`, "OCR could not read it", is never the all-clear) again on its own. A state machine with no clock of its own ([gesture-recognizer.helper.spec.ts](../../src/app/core/helpers/gesture-recognizer.helper.spec.ts), [emulator-power.helper.spec.ts](../../src/app/core/helpers/emulator-power.helper.spec.ts)) is driven by plain calls with made-up timestamps, and its interval-driven service ([emulator-power.service.spec.ts](../../src/app/core/services/game/emulator-power.service.spec.ts)) gets its timeline in absolute time from `start()`, because the interval ticks on those instants. [save-backup.roundtrip.spec.ts](../../src/app/core/services/game/save-backup.roundtrip.spec.ts) feeds the export to the import through the two services the page calls, against a stand-in emulator that keeps its changed files in a zip like js-dos's.
- **A guard whose spec has never failed proves nothing.** Break the rule on purpose and watch a case fail; the stage, camera and platform helpers were checked this way, and two stage cases had passed for the wrong reason (a strict `>` where two columns fit exactly; a keyboard so tall the service refused to write).

**The harnesses** drive Chrome over CDP with no dependencies (the touch and platform ones headless, the multiplayer one with windows unless `--headless`), and nothing in `scripts/` reaches the bundle (`angular.json`'s inputs are all under `src/`). Each README lists the traps that silently invalidate a run: read it before driving one by hand.

- **Multiplayer** needs two or more peers, so [scripts/multiplayer-harness/](../../scripts/multiplayer-harness/README.md) (launcher, driver, scenario checklist) covers it. A covered window reports `visibilityState: 'hidden'`, which throttles its timers and stalls Ionic's overlay animations, so the join dialog hangs with nothing in the console: run `front <port>` before driving a dialog. Peers need separate profiles (two tabs in one profile share save games and confuse every observation); one `watch` per port (two redirected to one file truncate each other).
- **Touch** is blind dead reckoning, so [scripts/touch-harness/](../../scripts/touch-harness/README.md) reads the guest's cursor out of its RAM from outside (`oracle.js`, verify-then-scan: never hard-code the address) and holds the tables the `TOUCH_INPUT` constants rest on. **Re-run it after any change to the video mode, the Windows mouse settings (`WIN.INI`/`SYSTEM.INI`), js-dos or the disk image:** the gain, the corner and the frame period are properties of the guest, not of the app. Its per-feature scripts (`deck`, `typebar`, `idle-pause`, `stage`, `camera`, `menu`, `room`) cover the control deck, the type bar, the battery saver, the stage, the camera, the options menu and a two-browser room; the README table says what each answers.
- **The touch and platform harnesses need a DEV build served with `--live-reload=false`:** the scripts read `window.ng` and private members, so they do not work on a production build, and a source edit reloads the page mid-run. Start `node scripts/touch-harness/driver.mjs &` first (headless Chrome on :9444) and point `APP` at `http://localhost:4200/`, not `127.0.0.1` (`ng serve` may listen on `::1` only).
- **Touch-harness runs that measure nothing:** the guest sometimes stays at the DOS prompt (now and then, not understood; `boot.mjs` retries up to three times, but a run on a guest that never reached Windows is void); the oracle talks to the guest directly and so does not wake a sleeping one (calibrate with the battery saver off); `gain`/`spacing`/`homecheck` detach the touch layer and a script that dies leaves it off (`__g.applyTouchMode()` in the page restores it).
- **Platform** ([scripts/platform-harness/](../../scripts/platform-harness/README.md): screen lock, fullscreen, the game's sound, installing) runs on the touch harness's driver with every API the headless shell lacks or refuses faked, so it shows what the PAGE does with an answer, never what a phone answers. An init script outlives the process that registered it (restart the driver when in doubt); the shell suspends the audio context by itself; CDP cannot emulate `display-mode`.
- **Unverified:** every harness is desktop Chromium with synthetic input (the touch and platform ones headless); no real finger, IME, iOS/WebKit or phone CPU has been tried, and the Galaxy A07 / iPhone 15 Pro Max passes are pending ([docs/mobile-ux-device-pass.md](../../docs/mobile-ux-device-pass.md)).

Git LFS is required: `*.jsdos` is LFS-tracked (`src/assets/elifoot/elifoot98.jsdos`, ~6.7 MB holding the entire Windows 3.1 + game environment). Without LFS the game bundle is a pointer file and the app will not boot.

## Full record (verbatim)

> Written phase by phase. Where it disagrees with the summary above or with the code, those win: later phases changed some earlier facts
> (for example, which root services keep a `DosCI`, and that two-peer sessions at 640x480 were later run).

```bash
npm install              # first time only
npm start                # ng serve → http://localhost:4200
npm run build            # production build (default configuration) → www/
npm run build:githubpages # what CI deploys
npm run lint             # ng lint (eslint, src/**/*.ts + src/**/*.html)
npm test                 # ng test (karma + jasmine, visible Chrome, watch mode)
npm run test:ci          # ng test --watch=false --browsers=ChromeHeadlessCI: one headless run, exits non-zero on failure
npx ng test --include='**/my.spec.ts' --watch=false --browsers=ChromeHeadlessCI   # single spec
npm run mp:launch        # two browsers for a multiplayer session (see the harness README)
python3 scripts/resolution/build_bundle.py verify src/assets/elifoot/elifoot98.jsdos   # the resolution switch is in the bundle
node scripts/frame-fixtures/make-fixtures.mjs <out.ts> name=frame.png::note ...   # real guest frames -> a spec fixture
node scripts/pwa-icons/make-maskable.mjs <source.png> <out.png> --size 512 --check   # a maskable launcher icon from the shipped artwork
```

Specs are karma + jasmine. The builder globs `**/*.spec.ts` (its `include` option, which is also
what `--include` overrides); [src/test.ts](../../src/test.ts) only initialises the TestBed and
`tsconfig.spec.json` type-checks `src/**/*.spec.ts`, so a spec needs no registration but must live
under `src/` to be type-checked. Nothing in a spec reaches the bundle. There are **eighty-eight spec files so
far**. [room-code.helper.spec.ts](../../src/app/core/helpers/room-code.helper.spec.ts) is there as
much to prove the harness as to cover `RoomCodeHelper`: `ng test` with **zero** specs
prints `Executed 0 of 0 SUCCESS` and still exits 1, so a `test:ci` could never pass before the
first spec existed. [timeout.helper.spec.ts](../../src/app/core/helpers/timeout.helper.spec.ts) is the
first to use a fake clock, and shows the one trap in doing so: Angular's `fakeAsync` drains
whatever timers are left when the body ends (`flush: true` is its default), which hides a timer
that was never cleared, so pass `{ flush: false }` whenever "nothing is left scheduled" is part
of what a spec asserts. [emulator-keycode.helper.spec.ts](../../src/app/core/models/game/emulator-keycode.helper.spec.ts)
(the text planner) and [guest-key-queue.service.spec.ts](../../src/app/core/services/game/guest-key-queue.service.spec.ts)
(the key queue, against a fake emulator that records every raw key event with the fake clock)
are the model for "a service that talks to the emulator": hand it a stub `DosCI`, never the real
one. [auto-saver.service.spec.ts](../../src/app/core/services/game/auto-saver.service.spec.ts) is the model
for "a loop that must survive its own failures": the collaborators are plain fakes cast to the
constructor's types, the clock is `fakeAsync`, and every spec ends with `stop()` so
`{ flush: false }` can prove nothing is left scheduled. One trap there: build a rejected promise
*inside* the fake (`outcomes()`), never up front, or it has no handler yet and fails the spec as
unhandled. [patch.service.spec.ts](../../src/app/core/services/game/patch.service.spec.ts) is the model for
"a service whose `Error` messages are the UI": the game page shows them verbatim, so the spec pins
the Portuguese wording and fails on the English that JSZip and HttpClient reject with; it also
pins `setDisplayMode` against a stand-in `dosInstance`, reading back the layer the fake CI would
write.
[diagnostics.service.spec.ts](../../src/app/core/services/shared/diagnostics.service.spec.ts) is the model for
"code that must cost nothing while it is off": the thunk spy that is never called, no listeners on the
real `window` (spied before the service exists), nothing on the fake clock, and a `finish()` that switches
the service off so a failing case cannot leave listeners on the karma page. Its doubles
([diagnostics.testing.ts](../../src/app/core/services/shared/diagnostics.testing.ts): `silentDiagnostics()`,
`recordingDiagnostics()`, `memoryStorage()`) are what every other spec passes where a service now takes
a `DiagnosticsService`; for "did it log this" the specs of the key queue and the auto-saver hand in a
two-line recorder that reads each data thunk at the call, as the real one does.
[guest-pointer.helper.spec.ts](../../src/app/core/helpers/guest-pointer.helper.spec.ts) is the model for "an engine whose
worst failure only shows against the real guest": it drives the engine against a fake guest written from the
measured rules, independently of the code under test (the gain, the clip, the wrap and, the part that matters, sends
inside one frame being summed), under `fakeAsync` with `Date.now` handed in as the clock, because zone.js fakes `Date`
and not `performance.now`; one spec is a control that shows the fake really does punish a spacing below a frame.
[gesture-recognizer.helper.spec.ts](../../src/app/core/helpers/gesture-recognizer.helper.spec.ts) is the model for a state
machine with no clock of its own: every sample carries its time, so the specs are plain calls with made-up timestamps.
[touch-input.service.spec.ts](../../src/app/core/services/game/touch-input.service.spec.ts) is the one DOM spec worth copying:
real elements, js-dos's handlers stood in for by a bubbling listener, a `scenario()` helper that builds the rig INSIDE
`fakeAsync` (attaching starts the engine's timers) and detaches in a `finally`.
[win9x-palette.spec.ts](../../src/theme/win9x-palette.spec.ts) is the model for asserting CSS: karma loads
`src/global.scss`, so it probes the real `.win9x-roster-*` rules and `:root` tokens for contrast
instead of keeping a second copy of the hex values. [save-game.service.spec.ts](../../src/app/core/services/game/save-game.service.spec.ts)
is the model for "code that reads a browser store": karma's Chrome has a real IndexedDB, so the spec
builds `js-dos-cache (spec …)` databases shaped like js-dos's and deletes every `js-dos-cache*`
database before and after each case. [save-policy.helper.spec.ts](../../src/app/core/helpers/save-policy.helper.spec.ts)
is the model for a decision that must not drift: the table is written out row by row (purpose x answer), and the
rule the table exists for (`null`, "OCR could not read it", is never the all-clear) is asserted again on its own.
[save-backup.roundtrip.spec.ts](../../src/app/core/services/game/save-backup.roundtrip.spec.ts) is the model for both ends of
a file format: the export is fed to the import through the two services the page calls, against a stand-in emulator
that keeps its changed files in a zip like js-dos's. [game-exit.helper.spec.ts](../../src/app/core/helpers/game-exit.helper.spec.ts)
is the model for "real pixel data as a fixture": the frames in [game-exit.fixtures.ts](../../src/app/core/helpers/game-exit.fixtures.ts)
are captures of the live guest (`dosCI.screenshot()` via the touch harness), stored as a palette plus one deflated
index per pixel (1 to 9 KB a frame, 54 KB for ten) by [scripts/frame-fixtures/](../../scripts/frame-fixtures/make-fixtures.mjs)
and inflated in the spec with `DecompressionStream`; the specs then paint on copies of them (a cursor over the icon, a second icon).
[key-repeat.helper.spec.ts](../../src/app/core/helpers/key-repeat.helper.spec.ts) is the model for "a timer-driven helper that must
leave nothing scheduled": zone.js's fake timers, a queue depth the spec moves, `{ flush: false }` on the cases that assert it.
[deck-key.directive.spec.ts](../../src/app/core/components/dock/deck-key.directive.spec.ts) is the model for "a directive whose worst bug
only shows with real events": a host component with real buttons, real `PointerEvent`s and a spied `performance.now` that is
**never reset between specs**, because the guard it tests keeps its clock in a static. One trap there: this repo's TestBed is
zoneless, where `fixture.detectChanges()` refreshes only a view that was marked dirty and a plain field a spec writes is not a
signal, so the change is never applied and the dev-mode check throws NG0100 (mark the fixture, then detect).
[type-mirror.helper.spec.ts](../../src/app/core/helpers/type-mirror.helper.spec.ts) is the model for "an engine that has to absorb
what real keyboards do differently": scripted value sequences (a suggestion tap with the keyboard's trailing space, a
composition that rewrites a word, an emoji, a paste of 80 characters) read back as a line of words (`BS alt227 o`) through
[type-bar.testing.ts](../../src/app/core/helpers/type-bar.testing.ts). [type-bar-session.helper.spec.ts](../../src/app/core/helpers/type-bar-session.helper.spec.ts)
is the model for "events whose order differs per browser": REAL `InputEvent`, `CompositionEvent` and `KeyboardEvent`s dispatched
at a real `<input>`, a fake queue that records what it was handed, and Chrome's and Safari's orders of `compositionend` and the
last `input` both scripted. [ibeam.helper.spec.ts](../../src/app/core/helpers/ibeam.helper.spec.ts) is the model for "a detector that
must tell a look-alike apart": real 640x480 frames of the guest with its cursor in different shapes
([field-hint.fixtures.ts](../../src/app/core/helpers/field-hint.fixtures.ts), made by `scripts/frame-fixtures/`), the arrow over a
white list among them, and a case that moves the lookup so that only the serif can reject it (mutation-checked: without the
serif, two cases fail). [stage.helper.spec.ts](../../src/app/core/helpers/stage.helper.spec.ts) is the model for "a layout that has to hold on every real screen": the table
is the devices (a phone with and without a notch, both iPhones, tablets, laptops) with the insets a notch really has, the stages that matter are
written out as numbers, and the invariants (exactly 4:3, between the rails, never under the minimum) run over the whole matrix times deck, chat and view
mode; [stage-layout.service.spec.ts](../../src/app/core/services/shared/stage-layout.service.spec.ts) drives the service with a host element whose size the spec moves and a
viewport it moves with it, and the chat's give-back with a fake clock. Mutation-checked when the phase was built: thirteen deliberate breaks, thirteen failing cases (two
survived their first run and were closed: a strict `>` where two columns fit EXACTLY, and a 336 px keyboard that left less than the minimum stage, which the service refuses to
write, so the spec passed for that reason; it uses 120 px now). [storage-keys.spec.ts](../../src/app/core/services/shared/storage-keys.spec.ts) writes every `STORAGE_KEY` to every place the
registry says it lives, runs the real wipe against the real Ionic Storage and fails if anything is left. One trap in a
service spec: a synthetic `beforeunload` on the real `window` reaches Karma's own handler and fails the whole run
("Some of your tests did a full page reload!"), so `SaveSafetyService.unloadTarget()` is overridable and the spec dispatches
on a stand-in. [emulator-power.helper.spec.ts](../../src/app/core/helpers/emulator-power.helper.spec.ts) is the model for "a rule that
needs the world's answer before it acts": the state machine is driven by a script of (time, event) calls with no clock of its own,
including the handshake (it asks, the caller answers later, and an answer overtaken by a frame is dropped), and
[emulator-power.service.spec.ts](../../src/app/core/services/game/emulator-power.service.spec.ts) runs the service over the real `document`
listeners and a recording fake emulator under `fakeAsync`, with the timeline written in absolute time from `start()` because the
interval ticks on those instants. [cheat-omatic.service.spec.ts](../../src/app/core/services/game/cheat-omatic.service.spec.ts) is the model for
"a service that must hold something open around its awaits": the door is a recording stand-in on `globalThis`, and a read or a write that
fails must still let go. [wake-lock.service.spec.ts](../../src/app/core/services/shared/wake-lock.service.spec.ts) is the model for "a service whose
whole job is to ask a browser API that may say no": a fake `navigator.wakeLock` whose next answer the spec chooses (a grant, a refusal, or
a request held in flight until the spec settles it), the page's visibility and the clock as overridable members, and `fakeAsync(…, { flush:
false })` so that a listener or timer left behind fails the case; [audio-health.service.spec.ts](../../src/app/core/services/game/audio-health.service.spec.ts)
adds the trap of a fake that answers synchronously (the real browser dispatches `statechange` as a task), which is why the service queues a
re-entrant look. Both service specs and the helpers behind them (`WakeLockHelper`, `AudioHealthHelper`, `InstallHelper`, `NudgeHelper`,
`FullscreenHelper`, `StorageHealthHelper`) were mutation-checked when the phase was built: thirteen deliberate breaks, thirteen failing cases.
[viewport-transform.helper.spec.ts](../../src/app/core/helpers/viewport-transform.helper.spec.ts) is the model for "maths that everything else trusts": the camera's scale, clamp,
zoom-about-a-point, pinch step, snap to the device pixel grid and page-to-guest mapping are written as numbers (a 393x295 phone, its tall view, a landscape phone), the mapping is
round-tripped for every column and row of the 640x480 frame at 1x, 1.5x, 2x and 3x and across a sweep of scales and focal points, and [overlay-sync.helper.spec.ts](../../src/app/core/helpers/overlay-sync.helper.spec.ts)
checks `OverlaySyncHelper` under a transform in REAL layout (no mocks: a container, a letterboxed canvas, an overlay, `getBoundingClientRect`). Twelve deliberate breaks of the camera's
rules (the covering clamp, the focal point, the grid rounding, `scale(1)` at the fit, the dead band, the dead-until-every-finger-is-up rule, the settle near the fit, the
rotation store, the clip as a listener, the folded panel coming back, a write per pinch step, the click reaching the camera) each failed at least one case. Write specs for pure logic (helpers,
planners, parsers, queues driven by a fake clock); the emulator, the screen-scrapers and the WebRTC
paths have no karma coverage and are checked in a real browser (see the harness above). `ChromeHeadlessCI` in
[karma.conf.js](../../karma.conf.js) is `ChromeHeadless --no-sandbox`, which a CI runner or container
needs; plain `npm test` keeps the visible Chrome and the file watcher.

Multiplayer needs two or more peers to test at all, so that part is covered by a CDP-driven
browser harness in [scripts/multiplayer-harness/](../../scripts/multiplayer-harness/README.md) —
launcher, driver and the scenario checklist, plus the traps that silently invalidate a run (a
covered window throttles timers and stalls Ionic's overlay animations, which hangs the join
dialog). Read its README before doing multiplayer work by hand. Nothing in `scripts/` reaches
the bundle: `angular.json`'s inputs are all under `src/`.

Direct touch has the same problem in another shape: it is blind dead reckoning, so the only way to know a tap
landed where the finger was is to read the guest's cursor out of its RAM from outside. That is
[scripts/touch-harness/](../../scripts/touch-harness/README.md): a driver, a RAM oracle, and the checks (tap accuracy over 18
screens per send spacing, the gain table, the frame period, drift, stuck buttons, the Macintosh-user-agent iPad matrix,
the "Modo de toque" UI, and the edge cases a review found: a fast second tap, a retry after a miss, a drag past the send
budget, the audio wake; `typebar.mjs`, the live type bar on the real game against a SIMULATED OS keyboard and CDP's IME
events; and `idle-pause.mjs`, the battery saver on the real game: CPU on a still screen, whole Elifoot rounds with the setting on and off,
and taps and keys sent to a sleeping guest, see *Letting the guest sleep*; and `stage.mjs`, the picture's box at 19 windows with every input the contract names and every one it
does not, the rails' keys, and a spectator's picture against the host's in a real two-browser room, see *The stage*; and `camera.mjs`, the in-app camera on the real game:
the picture's box at 12 windows and 4 zooms, the unzoomed page byte for byte, real two-finger touches, tap accuracy at each zoom against the RAM oracle, the host's overlay and
stream, the deck while zoomed, rotation and the battery saver, see *The camera*; and `menu.mjs`, the options sheet at 8 windows, "Dados e avançado", the old stored switches, the wipe, Back, the first-run
coach, the boot screen, `?host=1` and the spectator's waiting card, see *The options menu*), with the tables the constants rest on. **Re-run it after any change to the video mode, the
Windows mouse settings, js-dos or the disk image.** It needs a dev build (`window.ng`) served with `--live-reload=false`.

The phone-platform work (the screen lock, fullscreen, the game's sound, installing) is checked the same way in
[scripts/platform-harness/](../../scripts/platform-harness/README.md), on the touch harness's driver: every browser API that the headless shell lacks or refuses
is faked there, so it shows what the PAGE does with an answer, never what a phone answers. Its README lists the traps (an init script outlives the
process that registered it; the shell suspends the audio context by itself; CDP cannot emulate `display-mode`).

Git LFS is required: `*.jsdos` is LFS-tracked (`src/assets/elifoot/elifoot98.jsdos`, ~6.7 MB holding
the entire Windows 3.1 + game environment). Without LFS the game bundle is a pointer file and the app
will not boot.
