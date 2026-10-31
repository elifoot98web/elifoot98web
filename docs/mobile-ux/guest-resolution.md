# The guest's resolution

> Design record for this area, moved out of `CLAUDE.md` (2026-10-30/31). The first section is the VERIFIED summary of the
> invariants (each checked against the code at the time by an independent pass); the second is the verbatim record written phase
> by phase while the area was built. The plan and the as-built history are in [../mobile-ux-study.md](../mobile-ux-study.md); what only
> real phones can confirm is in [../mobile-ux-device-pass.md](../mobile-ux-device-pass.md).

## Invariants (verified summary)

The guest boots at **640x480** (`screen-size=640` in `SYSTEM.INI`), the size Elifoot was designed for, so its ~634x474 window fills the frame instead of floating on an 800x600 desktop (a free 1.25x on every glyph); `d/res/use800.flg` in the saved disk returns a player to 800x600. `dosbox.conf` `[autoexec]` runs `call d:\setres.bat` right after `imgmount c` (C: must be mounted to be written, and the `c:`/`autoexec.bat` that start Windows come after it; `verify` enforces the position), which copies `d/res/s640.ini` (or `s800.ini` when the flag exists) over `C:\WINDOWS\SYSTEM.INI` before Windows starts.

- **The mode is set from `dosbox.conf` and `d/`, never from `hdd.img`.** Every persisted layer carries its OWN full copy of `hdd.img` (a session always dirties it) and that copy shadows the bundle's, so a `SYSTEM.INI` edited inside the image reached new visitors only (an edited bundle plus an old layer still booted 800x600). `dosbox.conf` and `d/` are read from the bundle at every boot, so `SETRES.BAT` reaches everyone, including layers holding `PatchService`'s `ELIFOOT.BAT`/`PATCH.BAT` (those run after `[autoexec]`). **The bundle URL must still never change** (the layer key is `<url>.changes`, which `PatchService` also hardcodes, so a rename strands every saved game).
- **The bundle is rebuilt by [scripts/resolution/build_bundle.py](../../scripts/resolution/README.md)** (stdlib only, deterministic, idempotent): it adds the `[autoexec]` line, `d/SETRES.BAT`, `d/res/s640.ini` and `s800.ini`, copies every other zip entry byte for byte (`hdd.img` is never rewritten) and refuses an image whose `SYSTEM.INI` is not the 800x600 one. Check with `python3 scripts/resolution/build_bundle.py verify <bundle> --base <the bundle it was built from>`. Nothing under `scripts/` reaches the app bundle.
- **`SETRES.BAT` only touches a disk that has the drivers its `SYSTEM.INI` files name:** it tests seven files in `C:\WINDOWS\SYSTEM` (`SYSTEM_FILES` in the script) and does nothing if one is missing. A layer keeps the `hdd.img` it first got and older images shipped (the 256-colour `ce6eb4a` lacks the sound drivers); an unconditional copy stopped Windows at "Cannot find a device file ... vsbd.386", leaving the guest at the DOS prompt, which the page counts as a failed boot. Such a player keeps their old mode, the menu cannot change it (it only writes the flag) and "Apagar todos os dados" gives them the current image. `verify` fails if the seven files are not on the bundle's image and named in both INIs, so the guard cannot silently pin everyone to 800x600.
- **Reverting the `dosbox.conf` line is a one-way door for the LFS file.** `SETRES.BAT` rewrites `SYSTEM.INI` at every boot (the first boot after the switch ships does it for every player on the current image), so a 640x480 player's last persisted copy stays 640x480 and, with the script gone, nothing would switch it back. A session open when a new bundle is served keeps its old mode until it reloads.
- **The mode in force is the framebuffer's size, never a stored flag.** `GamePage.currentDisplayMode` asks `DisplayModeHelper.fromFrameSize(dosCI.width(), dosCI.height())` (sizes in `DISPLAY_MODE.SIZES`); `null` is anything that is neither size (DOS text mode, 640x400; or 0x0 before the first frame). A stored flag would lie after a restored backup, a reload not yet done or a boot that failed to switch, so there is deliberately no `STORAGE_KEY` for it.
- **The only persisted fact is `DISPLAY_MODE.FLAG_PATH` (`d/res/use800.flg`) in the changes layer (never in the bundle, which can only carry the default), and it says what the NEXT boot does.** `PatchService.setDisplayMode` writes it (or removes it, for 640x480) with the same fake-CI trick as a patch (see *Patching*), so the same rule holds: `applyDisplayMode` stops the auto-saver and safety nets, the page exits the emulator (`EXIT_TIMEOUT_MS`) and reloads, and nobody plays on, because a later `layers.save()` would no longer persist the running VM. The flag survives patches and their removal because `getClearLocalChanges` matches by name and nothing under `d/res/` matches (a new filter must not either); "Apagar todos os dados" deletes it, which restores the default.
- **The "Resolução do jogo" entry is disabled while a room is live or starting** (`inRoom || hostStarting` in `menu.helper.ts`; `promptDisplayMode` and `applyDisplayMode` also refuse on their own): a change is a reload and a host's reload ends the room for everyone. A spectator is unaffected (no emulator) and the stream stays 4:3 in either mode, so every ratio-based fit holds. The dialog copy says 640x480 is "larger but softer" on a desktop, never sharper: the canvas box does not change, so the same picture is just magnified more.
- **At 640x480 the Elifoot window hides the green backdrop that load detection samples:** see *Screen-scraping* for why the probe still passes at boot and what must not be built on "the green went away".

Details and measurements: [docs/mobile-ux/guest-resolution.md](../../docs/mobile-ux/guest-resolution.md).

## Full record (verbatim)

> Written phase by phase. Where it disagrees with the summary above or with the code, those win: later phases changed some earlier facts
> (for example, which root services keep a `DosCI`, and that two-peer sessions at 640x480 were later run).

The guest boots at **640x480** (`screen-size=640` in `SYSTEM.INI`), the size Elifoot (a Delphi 1 app)
was designed for: its window is ~634x474, so it used to float on a green 800x600 desktop and now
fills the frame, which is a free 1.25x on every glyph. `use800.flg` returns a player to the old
800x600. Load-bearing:

- **The mode is set from `dosbox.conf`, never from `hdd.img`.** Every persisted layer carries its
  OWN full copy of `hdd.img` (a session always dirties it), and that copy shadows the bundle's, so
  a `SYSTEM.INI` edited inside the bundle's image reached new visitors only: measured, an edited
  bundle plus an old layer still booted 800x600. `dosbox.conf` and the files under `d/` are read
  from the bundle at every boot, which is why `SETRES.BAT` reaches everyone, including a layer
  holding `PatchService`'s overwritten `ELIFOOT.BAT`/`PATCH.BAT`. **The bundle URL must still never
  change** (the layer key is `<url>.changes`).
- **The bundle is rebuilt by [scripts/resolution/build_bundle.py](../../scripts/resolution/README.md)**
  (standard library only, deterministic, idempotent), which adds `call d:\setres.bat`,
  `d/SETRES.BAT`, `d/res/s640.ini` and `d/res/s800.ini` and copies every other zip entry byte for
  byte; `hdd.img` is never rewritten. Check a bundle with
  `python3 scripts/resolution/build_bundle.py verify <bundle> --base <the bundle it was built from>`.
  `s800.ini` is the image's own `SYSTEM.INI`, so the script refuses an image that is not the
  800x600 one. Nothing under `scripts/` reaches the bundle.
- **`SETRES.BAT` only touches a disk that has the drivers its `SYSTEM.INI` files name.** It tests
  seven files in `C:\WINDOWS\SYSTEM` (`SYSTEM_FILES` in the script) and does nothing if any is
  missing. *Why:* a layer keeps the `hdd.img` it first got, and the repo has shipped others: the
  256-colour image of `ce6eb4a` was on `main` for about a day (2025-04-19 to 04-20) and lacks
  `vsbd.386`, `vadlibd.386`, `sndblst2.drv` and `msadlib.drv`. The first version of the script
  copied unconditionally, and on such a layer Windows stopped at "Cannot find a device file that may
  be needed to run Windows in 386 enhanced mode ... vsbd.386", leaving the guest at the DOS prompt
  (reproduced on a bare js-dos page; the app would never see the green and count a failed boot).
  Guarded, the same layer boots at 800x600 as it always did and its save loads. Such a player keeps
  their mode, and the menu cannot change it (it only writes the flag); "Apagar todos os dados" gives
  them the current image. `verify` checks the seven files exist on the bundle's image and are named
  in both INIs, so the guard cannot silently pin everyone to 800x600.
- **The first boot after this update rewrites `SYSTEM.INI` on the `C:` of every player whose disk is
  the current image** (a 1.8 KB file; `hdd.img` was already dirty). A session that is open when the
  new bundle is served keeps 800x600 until it reloads. Tested on a real layer: a long-time user's
  save (made on the old bundle) loads at 640x480 after the bundle is replaced at the same URL, and
  so does a layer patched through `PatchService`. **It is a one-way door for the LFS file:**
  reverting `dosbox.conf` leaves every player's last persisted `SYSTEM.INI` (640x480) in their disk
  with nothing to switch it.
- **The mode in force is the framebuffer's size, never a stored flag.** `GamePage.currentDisplayMode`
  asks `DisplayModeHelper.fromFrameSize(dosCI.width(), dosCI.height())`; `null` is anything that is
  neither size (DOS text mode). The only persisted fact is `d/res/use800.flg` in the changes layer,
  which says what the NEXT boot does, written by `PatchService.setDisplayMode` with the same
  fake-CI trick as a patch (and so with the same rule: stop the auto-saver, do not play on, reload).
  The flag survives patches and their removal (their filters match by name); "Apagar todos os
  dados" deletes it, which restores the default. There is deliberately no `STORAGE_KEY` for it.
- **The menu entry is disabled while a room is live** (`isStreaming || isHosting`): the change is a
  reload, and a host's reload ends the room for everyone. A spectator is unaffected (it has no
  emulator) and the stream stays 4:3 in either mode, so every ratio-based fit holds; a
  same-page loopback of the host's canvas stream at 640x480 arrived as 320x240 (WebRTC ramping up)
  with the ratio intact. The two-peer harness has not been run against a 640x480 host (it needs
  the public nostr relays, which the sandbox that built this blocks).
- **At 640x480 the Elifoot window hides the green backdrop that load detection samples.** See
  *Screen-scraping*.
