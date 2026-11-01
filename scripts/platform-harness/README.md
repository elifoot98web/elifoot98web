# Platform harness

Checks of the phone-platform work (P14: the screen lock, fullscreen, the game's sound, installing, storage) on the real page, in the
headless Chrome of [the touch harness](../touch-harness/README.md). It exists because most of this is the browser's to decide: the
page can only ask, so what is checked is that it asks at the right moments, says what the browser answered, and lets go. **Every
browser API that the headless shell lacks or refuses is faked in [fakes.mjs](fakes.mjs)**; nothing here says what a phone does.

No dependencies; nothing in `scripts/` reaches the bundle.

```bash
npx ng serve --port 4200 --live-reload=false   # a DEV build: the scripts read window.ng (see the touch harness's trap 3)
node scripts/touch-harness/driver.mjs &        # one headless Chrome on http://127.0.0.1:9444
APP=http://localhost:4200/ node scripts/platform-harness/wake-lock.mjs
```

Each script prints `PASS` / `FAIL` lines and sets the exit code; screenshots go to `$PLATFORM_HARNESS_OUT` (default
`$TMPDIR/elifoot-platform-harness`). `lib.mjs` has `boot()` (a fresh load of `/#/game` with a device emulated and an optional script run
BEFORE the page's own, to fake `navigator` members), `check()` and `shot()`.

| Script | What it checks |
| --- | --- |
| `wake-lock.mjs` | `WakeLockService` with a fake `navigator.wakeLock`: asked at game start, let go and asked again by the menu switch (a real tap), asked again when the page returns, a lock the system takes back is asked for once more, a refusal is not retried in a loop, a tap right after one does not ask again. |
| `room.mjs` | A hosted room holds the screen with the switch off, lets go when it closes; leaving to the menu lets go. |
| `spectator.mjs` | The spectator page holds the screen in a room and lets go when it ends (including the `HOST_LEFT` path) and when the page is left. |
| `audio.mjs` | `AudioHealthService` and the "Ativar som" chip, with the context's state forced: resume when the page returns, the chip after the grace period, a tap on the chip or on the game wakes it, a hidden page shows nothing. |
| `chip-layout.mjs` | The chip in the toolbar at 360 and 402 px with a live room (the pill is not clipped), and in the left rail of a landscape phone. |
| `volume.mjs` | The slider and "Silenciar o jogo" through the real menu: js-dos's gain, storage, reload, the wipe, and that `capture()` taps the script processor before the gain. |
| `fullscreen.mjs` | "Tela cheia" through a real tap: the document element goes fullscreen, the orientation locks and unlocks, the picture and the room's cursor overlay follow a viewport change. |
| `install.mjs` | The install entry and the one-time banner with a fake `beforeinstallprompt`, and that a tab opened from another app (an `android-app://` referrer) is still offered the install. |
| `ios.mjs` | An iPhone: no fullscreen entry, the silent-mode switch, the how-to dialog and its backup button, the "Como instalar" banner, an installed app offered nothing. |
| `howto-landscape.mjs` | The iOS dialog on a landscape phone. |
| `rotate-hint.mjs` | "Gire o aparelho": once on a phone upright, gone when it is turned, not repeated, not on a landscape phone or a tablet. |
| `menu.mjs` | Screenshots of the menu's volume group, and the "Armazenamento" line in the "Dados e avançado" window. |
| `manifest.mjs` | The manifest as Chrome reads it, installability errors, and the maskable icons under circle, squircle and square masks. |
| `content-hint.mjs` | What `contentHint` does to an animated canvas under a 120 kbps cap (measurement; the app sets none). |

## Traps that silently invalidate a run

1. **The page target outlives the process, and so do its init scripts.** A script registered with `Page.addScriptToEvaluateOnNewDocument`
   by an earlier run is still there in the next one (a fake `navigator.standalone` made a later run an "installed app" and a fake
   `beforeinstallprompt` made another offer an install). `boot()` forgets every script it registered before (`init-scripts.json` in the
   output folder); a script that registers its own (`spectator.mjs`) must remove it. Restart the driver when in doubt.
2. **The shell suspends the AudioContext by itself**, a few seconds after it runs, and `currentTime` does not advance (no audio device):
   so the level of a stream cannot be measured here, `resume()` from a tap works, and the chip would appear on a bare page. The state is
   forced in `audio.mjs`; the real thing is on the device checklist.
3. **CDP cannot emulate `display-mode`** in this shell (`Emulation.setEmulatedMedia` with that feature changed nothing), so an installed app is
   `navigator.standalone` here, and the media query is covered by a spec.
4. **A real `beforeinstallprompt` fires** in the shell on localhost (the page is installable). `ios.mjs` swallows it.
5. **The real wake lock is refused** with `NotAllowedError` in this shell, which the page logs and shows ("O aparelho não deixou agora").
6. **`requestFullscreen` and `screen.orientation.lock('landscape')` both work** here, but the emulated viewport is pinned, so the size a
   real fullscreen gives is emulated with `Emulation.setDeviceMetricsOverride` after it.
7. **`(display-mode: fullscreen)` matches the Fullscreen API too**: the page must not read it as "installed" (it did, until `fullscreen.mjs`
   showed the install entry vanishing).
8. The touch harness's traps apply: a boot that stays at the DOS prompt (it shows as "game page up after 46000 ms"), `ev` takes an
   expression and `evBody` a body, Ionic moves `aria-label` to the inner button, and a toast's buttons are in its shadow root.
