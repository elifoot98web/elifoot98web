# The guest's resolution: 640x480, with a way back to 800x600

`build_bundle.py` adds the video-mode switch to the game bundle
(`src/assets/elifoot/elifoot98.jsdos`). It is a single standard-library Python file, deterministic
and idempotent: the same input gives the same bytes on any machine, and running it on its own
output changes nothing. Nothing in this directory reaches the app bundle (`angular.json`'s inputs
are all under `src/`).

## What it changes

Five things in the archive, and nothing else:

| Entry | Change |
| --- | --- |
| `.jsdos/dosbox.conf` | one line added to `[autoexec]`, right after `imgmount c`: `call d:\setres.bat` |
| `d/SETRES.BAT` | new. Copies `d:\res\s800.ini` over `C:\WINDOWS\SYSTEM.INI` if `d:\res\use800.flg` exists, `d:\res\s640.ini` otherwise, and only on a disk that has the drivers those files name (see below) |
| `d/res/s640.ini` | new. `SYSTEM.INI` with `screen-size=640` and the 640x480 driver description |
| `d/res/s800.ini` | new. `SYSTEM.INI` exactly as it is inside `hdd.img` (800x600) |
| `d/res/` | new directory entry |

Every other entry (the other 570, `hdd.img` included) is copied **byte for byte, compressed data
included**. The ZIP is written by hand rather than through `zipfile`, because `zipfile` cannot copy
a compressed entry without recompressing it; the entries it creates are *stored*, so their bytes do
not depend on the zlib build either.

`s640.ini` differs from `s800.ini` in two lines:

```
-display.drv=S3 864 1.41B5  800x600   64K colors SF       (in [boot.description], a label)
+display.drv=S3 864 1.41B5  640x480   64K colors
-screen-size=800                                          (in [DISPLAY], the mode itself)
+screen-size=640
```

The driver (`S3VSND.DRV`) is already on the disk and takes the mode from `screen-size=` and
`color-format=`; the description is the string its own `OEMSETUP.INF` uses for 640x480 at 64K colours.
`color-format=16` and `dpi=96` are unchanged, so the two greens the load-detection probe looks for
are the same.

`SETRES.BAT` tests seven files first (`SYSTEM_FILES` in the script) and leaves `SYSTEM.INI` alone if
any is missing from `C:\WINDOWS\SYSTEM`; the reason is under *Disks from older images*.

`use800.flg` is **not** in the bundle. The app creates and deletes it in the player's saved disk
(`PatchService.setDisplayMode`), and a bundle can only carry the default.

## Why `hdd.img` is not touched

The obvious fix, editing `SYSTEM.INI` inside the image, does not work for anyone who has played.
js-dos persists the *changed* part of the virtual disk in the browser's IndexedDB, and a session
always changes `hdd.img` (about 32 KB of it differ after one boot), so every player's stored layer
holds its own **full copy** of the image. When the game starts, js-dos lays the bundle down and the
layer on top of it; the layer's `hdd.img` wins. Measured: a bundle whose image said `screen-size=640`,
started against a stored layer, still booted 800x600.

`dosbox.conf` and the files under `d/` are different. The layer records only what changed, and
it holds none of `dosbox.conf`, `SETRES.BAT` or `d/res/` (checked: it carries the `.jsdos/`
folder entry and nothing in it), so the bundle's versions reach everyone, and `[autoexec]` runs on
every boot. That includes players whose layer carries `PatchService`'s overwritten `d/ELIFOOT.BAT`
and `d/PATCH.BAT`, because those run *after* `[autoexec]`.

The bundle's URL must also stay the same: the layer is stored under `<bundle URL>.changes` and
`PatchService` hardcodes the same string, so a renamed bundle strands every saved game.

## Disks from older images

"A player's layer keeps its own `hdd.img`" cuts both ways. It is why the image cannot carry the
switch, and it is also why `SETRES.BAT` cannot assume that the disk it is overwriting `SYSTEM.INI`
on is the one `s640.ini` and `s800.ini` were taken from. The repo has shipped other images: the
256-colour one of `ce6eb4a` was on `main` for about a day (2025-04-19 to 04-20, PR #15 until PR #22
replaced it, fixing issues #21 and #18), and the VGA one of `e6084fe` was in the history of PR #15.
Diffing them against the current image, they lack the files the current `SYSTEM.INI` names:

| Image | Missing from `WINDOWS\SYSTEM` |
| --- | --- |
| `e6084fe` (VGA) | all seven of `SYSTEM_FILES` |
| `ce6eb4a` (256 colours) | `vsbd.386`, `vadlibd.386`, `sndblst2.drv`, `msadlib.drv` |
| `af63c64` and every commit since | nothing (one image, `hdd.img` sha256 `206bd79a…`) |

Measured on a real `ce6eb4a` layer (that bundle booted in a fresh profile and persisted, with a game
save from another layer put into `jogos/`, because the scripted navigation cannot play that image's
mouse): the first version of this script, which copied unconditionally, left the guest at the DOS
prompt with `Cannot find a device file that may be needed to run Windows in 386 enhanced mode ...
vsbd.386`. The page never sees the game's green after that, which it counts as a failed boot, and
after three the app offers to wipe everything. With the check in `SETRES.BAT` the same layer boots
Windows 3.1 and Elifoot at 800x600, exactly as before the update, and its save loads.

Such a player **keeps their old mode**: nothing here can move them to 640x480, and the
"Resolução do jogo" menu cannot either (it reads the mode off the live frame, so it keeps saying
800x600). "Apagar todos os dados" gives them the current image, and the game saves are theirs to
download first. `verify` fails if any of the seven files is missing from the bundle's own image or
no longer named in `s640.ini`/`s800.ini`, because the check would then never pass and every new
visitor would be pinned to 800x600 without an error.

## Rebuilding and checking

```bash
# the bundle in the repo -> a new file (never edits in place; -o may be the same path)
python3 scripts/resolution/build_bundle.py build -o /tmp/new.jsdos

# a bundle without the switch (the previous commit's) -> the one with it
git show <rev>:src/assets/elifoot/elifoot98.jsdos | git lfs smudge > /tmp/base.jsdos
python3 scripts/resolution/build_bundle.py build /tmp/base.jsdos -o src/assets/elifoot/elifoot98.jsdos

# what is checked: CRCs, the four managed entries, s800.ini == the image's SYSTEM.INI,
# s640.ini == it with the two lines above, the call straight after `imgmount c`, SETRES.BAT's seven
# files on the image and named in both INIs, rebuild(bundle) == bundle, and with --base that
# nothing else changed (hdd.img included)
python3 scripts/resolution/build_bundle.py verify src/assets/elifoot/elifoot98.jsdos --base /tmp/base.jsdos
```

`build` refuses an image whose `SYSTEM.INI` is not the 800x600 / 64K one it was written for, so it
cannot be run on a bundle someone already moved to another mode. It needs Python 3 and nothing else
(run here with 3.14).

The bundle is a Git LFS object. After `build`, `git add` stores the new object; without LFS the file
is a pointer and the app will not boot.

## What was tested before this shipped

On a real layer, in a browser with a persistent profile, with the same bundle URL throughout:

1. The old bundle, a new game played to its first kickoff (a real `.E98` in the layer), layer persisted.
2. The new bundle put at the same URL, same profile reloaded: the guest comes up at 640x480, Windows
   3.1 and Elifoot start, "Jogos gravados" lists the old save and it loads.
3. The same with a layer patched through `PatchService` (`ELIFOOT.BAT`, `PATCH.BAT` and the
   `PATCH` folder in the layer): 640x480, `PATCH.BAT` still runs, the save loads.
4. `use800.flg` written through the app's own menu: the next boot is 800x600; the way back removes it.
5. A fresh profile boots at 640x480.
6. A layer from the `ce6eb4a` image (see above): with the unguarded script it stops at `vsbd.386`; with
   the final bundle it boots at 800x600 and its save loads. Steps 2 to 5 were run again on the final
   bundle, which differs from the first build in `d/SETRES.BAT` alone.

The screenshots and framebuffer sizes are in the research folder, outside the repo
(`ux-research-2026-10-27/p4-upgrade/`).

## Consequences to know about

- **The first boot after the update rewrites `SYSTEM.INI`** on the `C:` of every player whose disk is
  the current image (all but the `ce6eb4a`/`e6084fe` ones above). A session that is open when the new
  bundle is served stays at 800x600 until it reloads.
- **It is a one-way door for the LFS file.** Reverting `dosbox.conf` leaves every player's last
  persisted `SYSTEM.INI` (640x480) in their disk with nothing left to switch it back.
- Program Manager is only visible after the game exits. It was opened at 640x480 and its windows fit.
