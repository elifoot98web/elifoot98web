# Save safety nets

> Design record for this area, moved out of `CLAUDE.md` (2026-10-30/31). The first section is the VERIFIED summary of the
> invariants (each checked against the code at the time by an independent pass); the second is the verbatim record written phase
> by phase while the area was built. The plan and the as-built history are in [../mobile-ux-study.md](../mobile-ux-study.md); what only
> real phones can confirm is in [../mobile-ux-device-pass.md](../mobile-ux-device-pass.md).

## Invariants (verified summary)

What stops progress from vanishing without anyone choosing it, and what tells the player it is safe. [`SaveStatusService`](../../src/app/core/services/shared/save-status.service.ts) (main bundle; feeds the toolbar chip and the backup reminder), [`SaveSafetyService`](../../src/app/core/services/game/save-safety.service.ts) (game chunk: `saveNow`, `saveBeforeReload`, the page-hidden save, `beforeunload`) and [`GameExitWatcherService`](../../src/app/core/services/game/game-exit-watcher.service.ts), plus the pure helpers in `src/app/core/helpers/` (`save-policy`, `save-backup`, `save-status`, `navigation-guard`, `game-exit`). `GamePage.startSafetyNets()` (end of `loadConfig()`) attaches the nets and `stopSafetyNets()` takes them down, the idle pause first so the guest is awake for what follows.

- **"Saved" means one thing: the changes layer reached IndexedDB.** Every persist of the running game goes through `SaveGameService.saveGame()`, one flush at a time (a second `layers.save()` over one still reading the disk is not promised to survive), which reports to `SaveStatusService`; a new path around it makes the chip lie. The only ones that skip it end in a reload: `PatchService`'s own `saveGameFileSystem()` calls and the update prompt's. The game's in-memory state is not on disk (Elifoot writes its `.e98` at kickoffs), so the status also tracks `dirty`, input since the last persist: a *counter*, cleared only if nothing moved during the flush (a click mid-persist is not "saved"), fed by document-level capture listeners for pointer/key aimed at `#game-container` (a finger the touch layer takes over is still seen) and by `keyActivity$` (virtual keys are no DOM event). It errs towards "not saved".
- **The chip is app shell: flat, not Win9x** (a tap is `GamePage.saveNow()`; it renders in the page toolbar, like the room pill; mobile landscape has no toolbar, so the menu's first entry "Salvar agora" carries its words). While a room is live it shares the title slot with the pill, so it drops its words under 600 px and steps aside under 402 px: the pill is what a host must see. The data wipe stops the savers and the nets, then calls `SaveStatusService.freeze()`, before it deletes anything, so a persist finishing after it cannot write its timestamp back into a wiped store.
- **`isGameSaving` is three-valued everywhere, and `null` ("OCR could not read") is never "not saving".** `SavePolicyHelper.decide` holds the table; rows differ by the price of being wrong. `hidden` (nobody asked) persists only on a proven `false`. `reload` (throws the page away) persists on `false`, refuses on `true`, and on `null` asks the person ("Recarregar sem salvar"). `manual` and `leave` (the player asked; the leave dialog promises a save) persist on `false` and `null`, because with the OCR down the button is the only manual save there is; only a seen dialog waits (`manual` says the auto-saver will take it; `leave` waits at most `GAME_IDLE_WAIT_MS`). A `null` save returns `verified: false` and the toast says it could not confirm (amber), never the plain "Jogo salvo". The idle pause sleeps the guest only on `false` for the same reason.
- **The look needs the auto-saver running, so the leave flushes BEFORE it stops the auto-saver.** `SaveSafetyService.look()` rides the auto-saver's OCR worker, does not ask when auto-save is off (it would start the 5 MB worker download), and counts that, a throw and an overrun of `HEARTBEAT_MS` as `null`. Stopped first, the leave's look is `null` and its wait for the game's dialog never happens (it was dead code once, and its spec passed because the rig set `autoSaver.running`). `leaveGameToMenu` flushes, then stops tickers and nets, then exits the emulator; with the nets never attached (`no-emulator`) it falls back to a plain `saveGame()`.
- **Every persist behind a loader is bounded by `AUTO_SAVER.PERSIST_TIMEOUT_MS` and ends as a failed save.** The loader cannot be dismissed and IndexedDB stalls after a phone has been in the background; the deadline stops the *wait*, not the flush, so `saveGame()` keeps its queue and a persist behind a stuck one times out the same way (the chip stays "Salvando…" while the flush truly is in flight). The export refuses only a proven `true` (`isGameWriting`: a copy under the game's write holds a half file). The update prompt is the one path outside the table: it waits (`APP_UPDATE.IDLE_WAIT_MS`) for a dialog the auto-saver has *seen* (`SaveStatusService.setGameWriting`), then persists whatever the OCR could read, because the reload is certain; with the OCR down it can race a write, as the forced periodic save can.
- **The page going hidden persists, a little.** `visibilitychange` to hidden is the last event a mobile browser reliably delivers (`pagehide` leaves no time for an async write). `SavePolicyHelper.gateHidden` checks cheapest first: an emulator, input since the last persist, no hide-persist within `HIDDEN_PERSIST_MIN_GAP_MS` (a failed attempt counts, so a broken disk is not retried on every tab flip), the auto-saver running; only then the look, and only a `false` persists (and not if the page is visible again by then). After the first persist that worked, `navigator.storage.persist()` is asked once per page; no copy promises protection the browser may refuse.
- **Flows that rewrite the layer stop the savers, and give them back only if nothing was written.** A patch, the save import and the resolution switch stop the auto-saver, the periodic save and the nets first (a persist of the running VM would write the old disk over what they are about to write); if one fails BEFORE the write, `GamePage.restoreSaving()` turns them back on, so a failed patch does not leave a game with no chip, no hidden save and no `beforeunload`. Once written (`written` in `applyPatch`/`applySaveGamePatch`) they stay off: the reload is coming and persisting the running VM would undo it. Known gap: `clearCustomPatch` stops and restores only the nets, so the auto-saver keeps running over the rewritten layer.
- **Leaving the game page goes through `canDeactivate`** (`GamePage.canLeave` → `NavigationGuardHelper.verdict`): a navigation that stays on `/game` (`?host=1` is stripped by one), one the page started (`leaving`) and one with no emulator and no open window pass; an open window takes the Back first (see *The options menu*); anything else opens "Voltar ao menu?" once (a Back with it open changes nothing). Only the game page is guarded. **`AppRoutingModule` must keep `canceledNavigationResolution: 'computed'`:** the default `'replace'` rewrites the history entry the browser already moved to and loses a level, so the first Back asks and the next leaves with no question; `'computed'` walks the pointer back and pushes nothing, so nothing is trapped.
- **Every reload the app starts from a booted game goes through `GamePage.reloadPage()` (or calls `SaveStatusService.allowExit()` first).** `beforeunload` asks the browser to confirm when `dirty` or hosting, and `allowExit` keeps a deliberate reload from asking again right after the player answered; a bare `window.location.reload()` in the game page asks twice (the boot-failure retries are exempt: the nets are not attached yet, so nothing asks). "Salvar e recarregar" confirms, runs `saveBeforeReload()`, and reloads only on a proven all-clear.
- **The backup is one file format with both ends in `SaveBackupHelper`** (its spec feeds one to the other): export is a flat zip of `NAME.E98`; import takes `.e98` files and `.zip`s, several at once, and from a zip every `.e98` wherever it sits (so the boot-failure dialog's full-disk copy restores its saves; a Mac zip's `__MACOSX` shadows are skipped, and unreadable zips or unusable files are named, not fatal). The confirm flags saves that replace an existing one, read from the live `dosCI.persist()` (the bundle ships none). Every download is stamped by `SaveBackupHelper.fileStamp`. **Both file inputs (the saves import and "Carregar Patch") are emptied in `finally`**, after the files are copied out of `input.files`: `change` fires only when the value changes, so re-choosing the same file after "Cancelar" did nothing. **Sharing is a button, not a side effect:** Safari honours `navigator.share()` only inside the tap and the zip outlasts a gesture, so on a coarse pointer whose browser says `canShare({files})` the page builds the zip first, offers "Baixar arquivo" / "Compartilhar…", and `deliverBackup('share')` calls `navigator.share` before awaiting anything; a desktop downloads at once, an `AbortError` is not a backup, any other failure downloads.
- **The backup reminder is one dismissible dialog, ever (either answer is stored), due `BACKUP_NUDGE_AFTER_MS` after the last backup (after the first save if there never was one), and only when the disk holds an `.e98`** (`PatchService.existingSaveNames`): a visit that only looked around also persists the layer, and a reminder answered with nothing to back up would be spent for good.
- **Elifoot exiting to the Program Manager is recognised from the desktop, not from the green probe.** The boot chain leaves Windows with the game as its only program, so when it quits (Esc or Cancelar in its first dialog, a crash) the player is on a blue desktop with no way back but a reload. At 640x480 "green lost" is the normal state (see *Screen-scraping*), so `GameExitHelper` requires nearly the whole frame to be the flat `(0, 64, 128)` on an 8 px grid (a few stray samples allowed for the drawn-in mouse cursor) plus the Program Manager's icon, in a box measured from the bottom-left corner so it holds at 640x480 and 800x600 (`GAME_EXIT_SIGNATURE`). Strict on purpose: Elifoot never draws that colour, the team editor and the Program Manager window leave only part of the frame, and a second icon (a minimised Elifoot) fails the grid; loosen it and ordinary screens raise the dialog.
- **`GameExitWatcherService` says it once per episode, and only once the game has been seen.** One look a second, `LOOKS_NEEDED` in a row; any other frame, or a `screenshot()` that throws or hangs, resets the run; "Agora não" is not asked again until something else has been on screen; a hidden page is not looked at. Windows draws this very desktop while the game loads, so it is armed only after the boot saw the game, or via `armWhen` (the boot's green probe) when the boot window ran out first. Every flow that rewrites the layer or leaves stops it (`leaveGameToMenu` first, so a game on its way out cannot raise it). The dialog is a `win9x-alert`, not a docked banner (the game behind it is gone): "Reiniciar jogo" leaves a live room (the dialog says so), saves with no `isGameSaving` check (the game is not running; still bounded), asks the emulator to exit for at most `GAME_EXIT_WATCH.EXIT_TIMEOUT_MS`, and reloads. The FAQ's team-editor recipe quits the game on purpose and says to answer "Agora não".

Unverified on real devices (the Galaxy A07 and iPhone 15 Pro Max passes are pending): Safari's `navigator.share`, `storage.persist()`, `beforeunload` and edge-swipe Back, the Android Back button in an installed PWA, a real background/foreground switch for the hidden save, and importing a zip from Files or Drive.

## Full record (verbatim)

> Written phase by phase. Where it disagrees with the summary above or with the code, those win: later phases changed some earlier facts
> (for example, which root services keep a `DosCI`, and that two-peer sessions at 640x480 were later run).

What stops progress from vanishing without anyone choosing it, and what tells the player it is safe. It is the
work of P5; the design record is [docs/mobile-ux-study.md](../../docs/mobile-ux-study.md).

**What "saved" means.** One thing: the emulator's changes layer was written to IndexedDB (`layers.save()`). Every
persist in the app goes through `SaveGameService.saveGame()`, which runs **one flush at a time** (a second
`layers.save()` started while the first reads the disk is not something the emulator promises to survive; the
auto-saver's own serialisation composes with it) and reports start and end to
[`SaveStatusService`](../../src/app/core/services/shared/save-status.service.ts). The layer holds whatever the game had written to its own
files by then; it does not hold the game's state in memory (Elifoot writes its `.e98` at kickoffs). That is why the
status also tracks **input since the last persist**: `dirty` is set by any pointer-down or key aimed at
`#game-container` (document-level capture listeners, so a finger the touch layer takes over is still seen) and by the
key queue's `activity$` (virtual keys never become a DOM event), and it is a *counter*, not a flag: a persist
remembers the count as it began, and only clears `dirty` if nothing moved meanwhile, so a click that lands during
the second a persist takes is not called saved. It is conservative by nature (it cannot tell a click on a tab from a
click that changed the game) and errs towards "not saved".

**The chip** (`app-save-status-chip`, `.save-chip` in `global.scss`) sits in the game toolbar's end slot and says
`Salvo às 14:32` / `Salvo ontem 21:14` / `Salvo em 20/10 21:14` / `Salvando…` / `Sem salvar há 12 min` (unsaved
input older than 10 minutes, amber) / `Falha ao salvar` / `Ainda não salvo`, in `SaveStatusHelper`'s words; a tap is
`GamePage.saveNow()`. **It is shell, flat, not Win9x**, for the reason the room pill is: it renders inside a page
toolbar. It shares that toolbar's title slot with the pill, and the pill needs 119 px of a title that has 168 at 360 px
(the title has 20 px of padding each side), so while a room is live the chip drops its words below 600 px and
steps aside altogether below 402 px (measured: with the dot only the pill was still cut to 78 px at 360 and its
code with it). Mobile landscape has no toolbar; the menu's first entry, "Salvar agora", carries the same words as its
subtitle. `lastPersistedAt`, `firstPersistedAt`, `lastBackupAt` and the nudge's answer are `STORAGE_KEY`s in Ionic
Storage, and `GamePage.clearAllData` calls `freeze()` before the wipe so a persist that finishes after it cannot
write its timestamp back (the diagnostics tail had the same bug through `pagehide`).

**`isGameSaving` is three-valued everywhere, and `null` is never "not saving".** [`SavePolicyHelper`](../../src/app/core/helpers/save-policy.helper.ts)
holds the table, and what differs between rows is the price of being wrong. `hidden` (nobody asked) persists only on
a proven `false`. `reload` (throws the page away) persists only on a proven `false`, refuses on `true` ("O jogo está
gravando": try again in a moment), and on `null` **asks the person** ("Recarregar sem salvar") rather than pretend. `manual` and `leave` (the player asked, and the
leave dialog promises a save) persist on `false` and on `null`, because with the OCR down the button is the only
manual save there is and the forced periodic save runs just as unguarded; only a seen dialog waits (`manual` says the
auto-saver will take it as the dialog closes; `leave` waits for it, at most 15 s). Such a save is not passed off as a
clean one: `saveNow` returns `verified: false` and the toast says it could not confirm whether the game was writing
(amber, 5 s) instead of the plain "Jogo salvo". `SaveSafetyService.look()` does
not ask at all when the auto-saver is not running (asking starts the OCR worker's 5 MB download for a page that
switched auto-save off) and counts that, a throw and a look that overruns the heartbeat as `null`. **So the leave
has to flush BEFORE it stops the auto-saver**: stopped first, the look is `null` and the wait for the dialog never
happens (it was dead code in the first cut). `leaveGameToMenu` flushes, then stops the tickers and the nets, then exits
the emulator; if the nets were never attached (`no-emulator`) it falls back to a plain `saveGame()`, as the old path did. Every persist
the safety service starts is **bounded to `AUTO_SAVER.PERSIST_TIMEOUT_MS`** and ends as a failed save, because each
sits behind a loader the player cannot dismiss and IndexedDB is known to stall after a phone has been in the
background; the deadline stops the *wait*, not the flush, so `saveGame()` keeps its queue and a later persist behind a
stuck one times out the same way (the chip says "Salvando…" for as long as the flush is truly in flight). The export refuses
only a proven `true` (`isGameWriting`): it copies the disk without writing it, but a copy made under the game's write
holds a half file. The update prompt is the one path that does not use the table: `AutoSaverService` tells
`SaveStatusService.setGameWriting()` for as long as it has *seen* the dialog, `installUpdate()` waits that out for
at most `APP_UPDATE.IDLE_WAIT_MS` and then persists whatever the OCR could read, because the reload is certain and
what is not saved is lost for sure. With the OCR down that path can still race a write, as the forced periodic save can.

**The page going hidden persists, a little.** `visibilitychange` to hidden (the last event a mobile browser reliably
delivers before it may freeze the tab; `pagehide` leaves no time for an asynchronous write) runs
`SavePolicyHelper.gateHidden` in the order that spares the most work: an emulator, input since the last persist,
no hide-persist in the last `HIDDEN_PERSIST_MIN_GAP_MS` (3 min; a failed attempt counts, so a broken disk is not retried
on every tab flip), the auto-saver running; only then does it look at the screen, and only a `false` persists. It gives
up if the page is visible again by the time the look comes back. Every decision is a `save` line in the diagnostics
log (`hidden: no persist {"reason":…}`). After the first persist that worked the app asks `navigator.storage.persist()`
once per page (feature-detected; the answer is logged and kept in `SaveStatusService.durable`, and no copy promises
protection the browser may refuse).

**Flows that rewrite the layer stop the savers, and give them back only if nothing was written.** A patch, a clear of
a patch, the save import and the resolution switch each stop the auto-saver, the periodic save and the nets first
(a persist of the running VM would write the old disk over what they are about to write), and when one fails BEFORE the
write `GamePage.restoreSaving()` turns them back on, so a failed patch does not leave a game that plays on with no
chip, no page-hidden save and no `beforeunload`. Once the layer is written they stay off whatever happens next
(`written` in `applyPatch` and `applySaveGamePatch`): the reload is coming, and persisting the running VM would undo it.

**The ways out of the game page.** `GamePageRoutingModule` has a `canDeactivate` that asks the page
([`NavigationGuardHelper`](../../src/app/core/helpers/navigation-guard.helper.ts)): a navigation that stays on `/game`
(`?host=1` is stripped by one), one the page started (`leaving`), and one with no emulator to lose pass; anything else
opens the existing "Voltar ao menu?" dialog once (a Back pressed while it is open changes nothing). Only the game page is guarded. **The router
has to be told how to put the address back:** its default (`canceledNavigationResolution: 'replace'`) rewrites the
history entry the browser already moved to, which loses a level: measured, the first Back asked and the next one left
the page with no question. `AppRoutingModule` sets `'computed'`, which walks the history pointer back, and the same
sequence (Back, Back with the dialog open, Cancelar, Back, `router.navigate`) was one dialog each time with
`history.length` constant. Nothing is pushed, so nothing is trapped. `beforeunload` asks the browser to confirm only when
`dirty` or hosting, and **every reload the app starts goes through `GamePage.reloadPage()` (or calls
`SaveStatusService.allowExit()` first)**, which is what keeps a deliberate reload from asking: the player has just
answered. A new `window.location.reload()` in the game page that skips it would ask twice. "Recarregar" is now "Salvar e
recarregar": confirm, then `saveBeforeReload()`, then reload only on a proven all-clear.

**The backup is one file format with both ends in one place** ([`SaveBackupHelper`](../../src/app/core/helpers/save-backup.helper.ts)).
Export writes a flat zip of `NAME.E98` named `elifoot98_saves_YYYY-MM-DD_HH-mm-ss.zip` (the older names counted
the month from 0; every download is now stamped by `SaveBackupHelper.fileStamp`). Import takes `.e98` files and
`.zip` backups, several at once, and from a zip takes every `.e98` wherever it sits (so the full-disk copy of the
boot-failure dialog restores its saves, and a Mac zip's `__MACOSX/._NAME.E98` shadows are skipped). The confirm lists
what will be added and flags the ones that replace a save the guest already has (read from the live `dosCI.persist()`,
since the bundle ships no `.E98`); unreadable zips and unusable files are named, not fatal. **Both file inputs are
emptied in `finally`** (a `change` fires only when the value changes, so choosing the same file again after "Cancelar"
did nothing), after the files are copied out of `input.files`, and an empty selection is a no-op. Import stops the
auto-saver and the safety nets first, like a patch: a persist of the running VM would write the imported saves out again.
**Sharing is a button, not a side effect:** Safari honours `navigator.share()` only inside the tap, and the zip takes longer
than a gesture, so on a coarse pointer whose browser says `canShare({files})` the page builds the backup, then offers
"Baixar arquivo" / "Compartilhar…", and `deliverBackup('share')` calls `navigator.share` before awaiting anything
(checked: `navigator.userActivation.isActive` was true inside the call). A desktop downloads at once. A share closed by the
player (`AbortError`) is not a backup; any other failure downloads instead. A week without a backup (counted from the
first save when there never was one) earns **one** dismissible reminder, ever: answering it, either way, is stored.
It is shown only when the disk holds at least one `.e98` (`PatchService.existingSaveNames`): a visit that only looked
around persists the layer too, and a reminder that is answered with nothing to back up is spent for good.

**Recovery: telling that Elifoot has exited to the Program Manager.** The boot chain leaves Windows with the game as its
only program, so when it quits (Esc or Cancelar in its first dialog, Enter before a choice, a crash) the player is on a
blue desktop with no way back but a reload. **The green probe cannot tell** (see *Screen-scraping*: at 640x480 "green lost"
is the normal state), so [`GameExitHelper`](../../src/app/core/helpers/game-exit.helper.ts) recognises the desktop itself, and the
signature is nearly the whole frame: a flat `(0, 64, 128)` at every sample of an 8 px grid (all but 8, for the mouse
cursor, which is drawn into the frame) outside the Program Manager's icon, and in that icon's box, a fixed distance from the
bottom-left corner (x 16-61, 60 px tall, 10 px above the edge, identical at 640x480 and 800x600), white text and ink. Measured: the real frame is
99.3% desktop colour; across 127 real frames at 640x480 (every dialog, tab, menu, list and live match of the P4 walk,
the team-colour standings, the team editor and the Program Manager) the desktop colour never appears in any of Elifoot's own screens, not even within a
tolerance of 25, the fewest stray samples in any of them was 3,268 against the 8 allowed, and the only two frames that
matched were the Program Manager's. The programs that share the screen with it leave it 31% (the team editor) and 44%
(the Program Manager window) of the frame, and a second icon (a minimised Elifoot) fails the grid, so none of
them is an exit. A live walk of 20 screens (new game, countries, draw, the main window's five tabs, menus, modals) with the
watcher running never saw a desktop sample. [`GameExitWatcherService`](../../src/app/core/services/game/game-exit-watcher.service.ts)
looks once a second, needs `LOOKS_NEEDED` (3) in a row (so ~3 s, as the roadmap asks; measured 2.9 s from Esc to the dialog),
resets on anything else, on a `screenshot()` that throws or hangs, and says it **once per episode**: "Agora não" is not
asked again until something else has been on screen. It is armed only once the game's own screen has been seen, because
Windows draws this very desktop while the game loads: the page starts it armed after a boot that saw the game, and
with `armWhen` (the boot's own green probe) when the 45 s window ran out first, so a slow phone is not left without the
dialog for the whole session (checked: the bare desktop never arms it, the splash does, and Esc then raised the dialog
in 2.9 s). It is stopped by every flow that rewrites the layer or leaves. The
banner is a `win9x-alert` ("O Elifoot foi fechado" / "Reiniciar jogo?"); its action leaves the room if one is live
(the dialog says it ends), saves (no isGameSaving check: the game is not running; bounded like every persist), asks the
emulator to exit for at most 3 s, and reloads. The FAQ's team-editor recipe quits the game on purpose and tells
the reader to answer "Agora não". It is a dialog, not a docked banner, because it is
the one thing on screen worth reading and the game behind it is gone. The load-detection pixels are unchanged.
