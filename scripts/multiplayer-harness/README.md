# Multiplayer test harness

Two or more browsers, driven over the Chrome DevTools Protocol, for the parts of multiplayer
that cannot be exercised with one peer: stream delivery, host identity, presence, the room
code collision tie-break, the host grace period, and every failure path around joining.

It exists because those are exactly the behaviours nobody could check.
[docs/multiplayer-ux-study.md](../../docs/multiplayer-ux-study.md) §5 planned all of this as
manual work and recorded that **nothing needing two peers had been verified at all**. The
first session with this harness confirmed six behaviours and found four defects, including one
where a rejoining spectator was shown a frozen picture as if it were live.

There are no dependencies: node 22 has a global `WebSocket`, and Chrome is whatever is already
installed. Nothing here is shipped — see [Why this is not in the bundle](#why-this-is-not-in-the-bundle).

## Running a session

```bash
npm start                                             # dev server on :4200, in its own terminal
npm run mp:launch                                     # peer 0 hosts, peer 1 spectates
npm run mp:launch -- --peers 3                        # add a second spectator, or a rival host
node scripts/multiplayer-harness/launch.mjs --help    # the rest of the options
```

`launch.mjs` prints a port per peer. Peer 0 opens `#/game?host=1` (an emulator, ~10 s to boot);
the rest open `#/join-game`. Each gets a throwaway profile under
`$TMPDIR/elifoot-mp-harness`, wiped on every launch unless you pass `--keep`.

Then drive and observe:

```bash
HARNESS="node scripts/multiplayer-harness/cdp.mjs"

$HARNESS watch 9222 > /tmp/host.log &     # console + exceptions; ONE watcher per port
$HARNESS watch 9223 > /tmp/guest.log &
$HARNESS front 9223                       # raise the window before touching any dialog
$HARNESS state 9223                        # room, roster, transcript, video, overlays
$HARNESS click 9223 'app-room-setup-modal button[type=submit]'
$HARNESS shot  9223 /tmp/guest.png
```

`state` is the one to reach for: it reports the game state by name, the pill, the headcount,
the roster, the transcript, the `<video>` (resolution, box, `currentTime`, paused) and every
visible overlay. Most assertions in the checklist below are a diff of two `state` calls.

Filling a form means setting the value *and* dispatching `input`, or Angular never sees it:

```bash
$HARNESS eval 9223 "(() => {
  const modal = document.querySelector('app-room-setup-modal');
  const set = (sel, value) => { const el = modal.querySelector(sel); el.value = value;
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('blur', {bubbles: true})); };
  set('input[name=playerName]', 'Espectador1');
  set('input[name=roomCode]', 'ELI-TSTA');
  set('input[name=password]', 'senha123');
  return 'filled';
})()"
```

Stop everything with `pkill -f elifoot-mp-harness`.

## Traps that silently invalidate a run

Each of these cost an hour the first time.

1. **A covered window is a broken window.** Chrome reports an occluded window as
   `visibilityState: 'hidden'`, which throttles its timers *and* suspends its animation
   frames. Throttling turns the 13 s host grace, the 20 s stream wait and the 1.5 s
   auto-saver tick into noise — one game boot took 112 s. Suspended frames leave Ionic
   overlays mid-animation, so an awaited `modalController.dismiss()` never settles: the room
   dialog sits there and the join never starts, with nothing in the console.
   `launch.mjs` passes the flags that fix the timers; **animations still need the window
   frontmost, so run `front <port>` before driving a dialog.**
2. **Separate profiles are mandatory.** `selfId` is per page load and IndexedDB is per
   profile, so two tabs in one profile share save games and confuse every observation.
3. **Synthetic `.click()` is not enough inside `ion-modal`** — the room dialog's submit
   swallows it. Use the `click` command, which dispatches real mouse events.
4. **One `watch` per port.** Two of them redirected to the same file truncate each other.
5. **Read component state through `window.ng.getComponent(el)`** rather than scraping text
   where it matters; it exists in development builds, which is all this harness targets.
6. **A guest page load is single-use.** The app now enforces this (`reloadSpectator`), but
   when driving the page directly, remember that a spectator cannot rejoin in the same page
   load and get video — see the invariant in [CLAUDE.md](../../CLAUDE.md).
7. **Signalling is flaky under churn.** trystero's default nostr relays include dead ones,
   and the first join right after a guest reload often fails with `connection-failed`,
   succeeding on the next attempt ~a minute later. Retry before believing a failure, and
   check `/tmp/*.log` for `Trystero:` warnings.

## What to check with two peers

Verified on 2026-08-27; the "pass" column is what was actually observed.

| Scenario | Pass |
| --- | --- |
| Host creates a room, guest joins by code | ident + host announce + stream in ~1.5 s |
| Stream delivery | `state` shows a live resolution and `currentTime` advancing |
| Host identity comes from the stream | `anfitrião` on the peer that delivered video, nobody else |
| `#stream-target` box equals the picture | `box` ratio equals the frame ratio, no letterbox inside the element |
| Chat both ways, emoticons | `:)` renders, both senders named correctly |
| Presence vs history | after a guest leaves, their old messages keep their name; headcount drops |
| Wrong password | specific message within seconds; the host only toasts and keeps hosting |
| Retry after a failed join | reloads to `#/join-game?room=…`, prefilled, then joins |
| Guest leaves and rejoins | reloads, then gets a live picture — never a frozen one |
| Zombie room | host ends and immediately re-hosts the same code; a guest can still join |
| Room code collision | younger host yields with `Código de sala já em uso`; older keeps the room; spectators never notice; no stray "no ar" toast |
| Host grace period | 13.0 s from peer-leave to expiry, reconnect copy throughout |
| Forged host claim | see below — the badge must not move, and that peer leaving must not end the room |

### Game audio

Launch with `--mute-audio` so two browsers are not both playing the game through the speakers,
and do **not** add `--autoplay-policy=no-user-gesture-required`: how a spectator is treated by
autoplay policy is one of the things under test.

`state` reports `video.trackKinds`, `video.audioTracks`, `video.muted` and a `sound` block;
`audio <port> [ms]` reads RTP stats over a window (default 1 s) and prints the deltas. Use a
window of several seconds: each `cdp.mjs` call has its own start-up delay, so a short beep
triggered from another call can land outside a 1 s window and read as a failure.

**The game is usually silent**, so `energyDelta` stays 0 unless you make it speak. Real game
sounds were not reproducible on demand (see below), so feed a tone through js-dos's own sound
queue, which exercises everything after the emulator: its script node, the tap, WebRTC and the
spectator.

```bash
$HARNESS eval 9222 "(async () => {
  const ci = window.ng.getComponent(document.querySelector('app-game')).dosCI;
  const ev = ci.events(), rate = ci.soundFrequency(), chunk = 2048; let phase = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 3000) {
    const s = new Float32Array(chunk);
    for (let i = 0; i < chunk; i++) { s[i] = 0.3 * Math.sin(phase); phase += 2 * Math.PI * 440 / rate }
    ev.fireSoundPush(s);
    await new Promise(r => setTimeout(r, chunk / rate * 1000));
  }
})()" &
$HARNESS audio 9223 5000      # in the same breath: bytes jump and energy rises
```

Be careful what else you drive in the game. Sending `Tab`, `Esc` and clicks at the emulator
while probing for a beep navigated Windows 3.1 out of Elifoot into Program Manager. Harmless in
a throwaway profile, but easy to leave the game somewhere you did not intend.

**Observed 2026-10-26.** Chromium only, host and one spectator, tone injected as above.

| Scenario | Observed |
| --- | --- |
| Guest receives sound | `trackKinds` `["audio","video"]` (audio first) and the stream was still accepted, so the first-`ontrack` ordering did not bite; no `Ignoring stream` line in either log |
| Audio is moving | ~50 packets/s both ends. Silence is 3 B/packet (~150 B/s); with the tone ~19 KB per 5 s window, energy 0.56 sender / 0.61 receiver |
| Host switch off / on | off: guest energy 0 at silence bytes, remote track still present and `live`; on: energy back (0.31). Nothing renegotiated |
| Rejoin as a late joiner, host switch off | the reloaded guest got the track (`hasAudio: true`) and a live picture (`300x225`) |
| Autoplay (Chromium) | after the join click: `muted: false`, `audioBlocked: false` |
| Guest mute persists | muted, reloaded via `retryAfterFailure`: `video.muted: true` on attach, stored `true`; unmuting stores `false` |
| Sound button | bottom-left, bevelled, icon flips mute/high, `aria-label` names the action, `aria-pressed` follows |
| No audio node | with `getDosAudioNode()` returning `null`: hosting reaches `streaming`, one `[AUDIO]` warning, the spectator gets `["video"]`, `hasAudio: false`, no button |
| Console | no exceptions, no `NotAllowedError`, no guard warnings; only the dead nostr relays |

**Reported by the maintainer, 2026-10-26** (not observed through this harness): a Chrome host and a
Firefox guest, with real in-game sound audible on the guest. That settles real game sound and a
Firefox spectator receiving the stream; the order of the tracks Firefox saw was not recorded.

**Not run. Do not treat these as passing:**

- The `Ativar som` fallback: Chromium allowed sound on the join click, so a refusal never
  happened. It needs Safari/iOS, or a spectator page with no prior gesture.
- Hearing the host's own speakers unchanged (the session ran `--mute-audio`).
- A host network blip re-attaching with the spectator's mute intact; an audio-only stream from
  an impostor being ignored; a second spectator joining mid-match (the rejoin above is the
  closest thing run).
- Safari, phones, a Firefox *host*, the button's landscape layout, and audio/video drift.

### Forging a host claim

The regression this guards against is a spectator with devtools taking the host badge and
ending the room by leaving. To play the attacker, pull trystero out of the webpack module
cache in a spare browser and join without any video:

```bash
$HARNESS eval 9224 "(() => {
  const chunkKey = Object.keys(window).find(k => k.startsWith('webpackChunk'));
  let require_; window[chunkKey].push([['probe'], {}, r => { require_ = r; }]);
  const id = Object.keys(require_.m).find(id => /joinRoom/.test(require_.m[id].toString()));
  const { joinRoom } = require_(id);
  const room = joinRoom({ appId: 'br.com.elifoot98.multiplayer', password: 'senha123' }, 'ELI-TSTA');
  const ident = room.makeAction('Ident');
  room.onPeerJoin = peerId => ident.send({ name: 'Impostor', color: '#ff0000', host: true }, { target: peerId });
  window.__attacker = room;
  return 'joined as an impostor claiming host';
})()"
```

Then check `state` on the real guest: `Impostor` must appear in the roster with no badge. Run
`$HARNESS eval 9224 "window.__attacker.leave()"` and the guest must keep watching, with no
`HOST_RECONNECTING`.

## What still needs a human

- **A real network drop.** `offline` cuts HTTP and WebSocket traffic, which breaks
  signalling, but does not reliably stop media on an established WebRTC connection. Testing
  "the host fell off the network" means turning Wi-Fi off for 8 s (expect recovery) and for
  30 s (expect the room to end).
- **Phones.** Real iOS Safari keyboard behaviour, rotation, and the js-dos virtual keyboard.
- **Anything about how it looks.** `shot` gives you the pixels; judging them is yours.

## Why this is not in the bundle

Not by convention — by construction. `angular.json`'s build inputs are `src/main.ts`,
`src/polyfills.ts`, `src/global.scss`, `src/theme/variables.scss`, `src/scripts/game.js`,
`src/index.html`, `src/manifest.webmanifest` and `src/assets/**`. Nothing outside `src/` can
reach the output, which is why `scripts/version-config.js` has always lived here too.

It is also outside the checks, deliberately: ESLint is scoped to `src/**/*.ts` and
`tsconfig.app.json` lists only `src` entry points, so these `.mjs` files are neither linted
with Angular rules nor type-checked. `npm run lint`, `npm run build` and the service worker
manifest are all unaffected by anything in this directory.
