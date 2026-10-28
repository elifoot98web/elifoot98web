import { EmulatorKeyCode } from "./game";

export const STORAGE_KEY = {
  DISABLE_SMOOTH_FILTER: 'disableSmoothFilter',
  DISABLE_AUTO_SAVE: 'disableAutoSave',
  PERIODIC_SAVE: 'autoSave',
  HIDE_TUTORIAL: 'hideTutorial',
  PENDING_UPDATE: 'pendingUpdate',
  FAIL_COUNT: 'failCount',
  PLAYER_NAME: 'playerName',
  PLAYER_COLOR: 'playerColor',
  // Host-side escape hatch: hides every spectator cursor, label and click ping on the
  // game surface. Local and permanent, not a protocol change — nothing tells the
  // spectators, because there is nothing they need to do about it.
  HIDE_SPECTATOR_CURSORS: 'hideSpectatorCursors',
  // Host side: stop sending the game's sound to spectators. Absent means "send it". The track
  // stays in the stream either way and is only switched, never removed (see
  // MultiplayerAudioService), so this changes nothing about what is negotiated.
  DISABLE_SPECTATOR_AUDIO: 'disableSpectatorAudio',
  // Guest side: the spectator muted the game. Persisted because every rejoin is a fresh page
  // load (JoinGamePage.reloadSpectator), which would otherwise un-mute them on each retry.
  SPECTATOR_MUTED: 'spectatorMuted',
  // Host side: how many spectators the last room allowed. Remembered so the dialog opens on
  // the host's usual choice; clamped on read, because storage is just another input.
  MAX_SPECTATORS: 'maxSpectators',
  // Room CODES only, never passwords. A share link deliberately omits the password
  // (room-code.helper.ts), and persisting one here would undo that.
  RECENT_ROOMS: 'recentRooms',
}

export const GAME_INPUT_FN_BTNS = [
  { keyCode: EmulatorKeyCode.KBD_f1, label: '3-3-4', text: 'F1' },
  { keyCode: EmulatorKeyCode.KBD_f2, label: '3-4-3', text: 'F2' },
  { keyCode: EmulatorKeyCode.KBD_f3, label: '4-2-4', text: 'F3' },
  { keyCode: EmulatorKeyCode.KBD_f4, label: '4-3-3', text: 'F4' },
  { keyCode: EmulatorKeyCode.KBD_f5, label: '4-4-2', text: 'F5' },
  { keyCode: EmulatorKeyCode.KBD_f6, label: '4-5-1', text: 'F6' },
  { keyCode: EmulatorKeyCode.KBD_f7, label: '5-2-3', text: 'F7' },
  { keyCode: EmulatorKeyCode.KBD_f8, label: '5-3-2', text: 'F8' },
  { keyCode: EmulatorKeyCode.KBD_f9, label: '5-4-1', text: 'F9' },
  { keyCode: EmulatorKeyCode.KBD_f10, label: '5-5-0', text: 'F10' },
  { keyCode: EmulatorKeyCode.KBD_f11, label: '6-3-1', text: 'F11' },
  { keyCode: EmulatorKeyCode.KBD_f12, label: '6-4-0', text: 'F12' },
];

export const GAME_INPUT_FN_BTNS_REVERSED = [
  { keyCode: EmulatorKeyCode.KBD_f12, label: '6-4-0', text: 'F12' },
  { keyCode: EmulatorKeyCode.KBD_f11, label: '6-3-1', text: 'F11' },
  { keyCode: EmulatorKeyCode.KBD_f10, label: '5-5-0', text: 'F10' },
  { keyCode: EmulatorKeyCode.KBD_f9, label: '5-4-1', text: 'F9' },
  { keyCode: EmulatorKeyCode.KBD_f8, label: '5-3-2', text: 'F8' },
  { keyCode: EmulatorKeyCode.KBD_f7, label: '5-2-3', text: 'F7' },
  { keyCode: EmulatorKeyCode.KBD_f6, label: '4-5-1', text: 'F6' },
  { keyCode: EmulatorKeyCode.KBD_f5, label: '4-4-2', text: 'F5' },
  { keyCode: EmulatorKeyCode.KBD_f4, label: '4-3-3', text: 'F4' },
  { keyCode: EmulatorKeyCode.KBD_f3, label: '4-2-4', text: 'F3' },
  { keyCode: EmulatorKeyCode.KBD_f2, label: '3-4-3', text: 'F2' },
  { keyCode: EmulatorKeyCode.KBD_f1, label: '3-3-4', text: 'F1' },
];

export const AUTO_SAVER = {
  // How often the framebuffer is sampled. A sample is a screenshot() plus a hash of a 132x20
  // region (about 1 ms together, measured), and OCR runs only when that hash changed, so it can
  // be fast. It has to be: the game's "A gravar o jogo..." dialog stays up for only about 1.7 s
  // (measured on a real save, 800x600). The old 1.5 s tick could land inside that window only
  // because 1.5 < 1.7, with nothing to spare for a phone whose OCR pass takes longer than 0.2 s.
  DEFAULT_TICK_INTERVAL_MS: 300,
  DEFAULT_PERIODIC_SAVE_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
  // Gap between two looks at the dialog while waiting for it to go away.
  DEFAULT_GAME_SAVING_DETECTED_TIMEOUT_MS: 1000, // 1 second
  MAX_WAITING_TIME_FOR_GAME_SAVE_DETECTED: 2 * 60 * 1000, // 2 minutes
  // The longest any single step of a tick may take: one screenshot, one OCR pass. It is not a
  // deadline for the tick, which lasts as long as the game takes to save. A step that overruns
  // is a hung one (an emulator that stopped answering), and the tick fails instead of waiting.
  HEARTBEAT_MS: 10 * 1000,
  // Ceiling on one persist of the emulator's disk, which has no deadline of its own. The loader
  // over the screen cannot be dismissed by the user, so a persist that never answered would
  // otherwise pin it there for good. A desktop takes about a second.
  PERSIST_TIMEOUT_MS: 30 * 1000,
  // How long to wait for Ionic to finish presenting or dismissing the loader before carrying on
  // without it. A page Chrome considers hidden runs no animation frames, so those promises never
  // settle there, and a hosting browser keeps ticking while hidden.
  OVERLAY_TIMEOUT_MS: 2000,
  // Wait before the next tick after the 1st, 2nd, 3rd... consecutive tick that threw; the last
  // entry repeats. A tick that worked puts it back to DEFAULT_TICK_INTERVAL_MS.
  RETRY_BACKOFF_MS: [5 * 1000, 15 * 1000, 60 * 1000],
}

export const APP_UPDATE = {
  // How long installing an update waits for the emulator's changes layer to reach IndexedDB
  // before reloading anyway: about a second on a desktop (a 5.4 MB zip), so this is a ceiling
  // for a persist that hangs, which must not be able to hold an update hostage. A persist cut
  // short loses what it was still writing and nothing else, because the write is one
  // IndexedDB put and the previous snapshot stays in place until it commits.
  SAVE_TIMEOUT_MS: 5000,
}

export const GAME_BOOT = {
  // How long loadGame() keeps looking for the game's own screen once the emulator is up. That
  // covers DOS, Windows 3.1 and the game's own start, because the screen it waits for is the
  // game's: measured on a desktop it is green 3.5 s after run() resolves, so this is a ceiling
  // chosen for a phone, not a measurement of one. The old 10 s ended a slow boot in silence.
  DETECTION_TIMEOUT_MS: 45 * 1000,
  // Wait before the first look, so js-dos has painted something, and between looks after it.
  DETECTION_SETTLE_MS: 500,
  DETECTION_POLL_MS: 500,
  // screenshot() is a round trip to the emulator's worker and has no deadline of its own. One
  // that never answers must cost a look, not the whole window.
  SCREENSHOT_TIMEOUT_MS: 5 * 1000,
  // The wipe is offered from the Nth failure in a row (a timeout is never one). Earlier than
  // this a failure is most likely a bad connection, and "Limpar todos os dados" is the one
  // button on the dialog that cannot be taken back.
  WIPE_OFFER_AFTER_FAILURES: 3,
}

// What the framebuffer must look like for BootStageHelper to call a frame "the game's screen".
// The pixels, the two greens and the tolerance are the ones load detection has always used
// (Elifoot's backdrop on the splash and in play); they are coordinate- and colour-sensitive, see
// CLAUDE.md before touching them. The desktop blue is Windows 3.1's own, seen while ELIFOOT.EXE
// loads: it is only used to label a stage, never to decide the game is ready.
export const GAME_SCREEN_PROBE = {
  POINTS: [
    { x: 0, y: 25 },
    { x: 200, y: 25 },
    { x: 400, y: 25 },
    { x: 10, y: 250 },
  ],
  GAME_COLORS: [
    { r: 0, g: 128, b: 0, a: 255 },
    { r: 0, g: 170, b: 85, a: 255 },
  ],
  WINDOWS_DESKTOP_COLOR: { r: 0, g: 64, b: 128, a: 255 },
  // Adjust this value as needed (depends on the color range of the monitor)
  TOLERANCE: 25,
  // A match is one (colour, point) pair. The game's screen needs at least 3 of the 8 pairs (the
  // old `greenCount > 2`), the desktop 3 of its 4 points.
  GAME_MATCHES_NEEDED: 3,
  DESKTOP_MATCHES_NEEDED: 3,
  // DOS draws text at 640x400 (80x25 characters); every Windows frame is 640x480 or 800x600.
  GRAPHICS_MIN_HEIGHT: 480,
}

export const EMULATOR_CONTROL_CONFIG = {
  // Where the title of the game's "A gravar o jogo..." dialog is, as an offset from the CENTRE of
  // the frame: the dialog is centred and its size does not depend on the video mode (cropped at
  // 800x600 and at 640x480 the two are byte-identical, 0 of 10560 bytes differ). Anchored to the
  // centre the same four numbers give left=332, top=275 at 800x600 and left=252, top=215 at
  // 640x480; the old absolute (332, 275) silently matched nothing at 640x480. See
  // OcrRegionHelper.savingDialogRegion, which applies them.
  SAVING_DIALOG_REGION: {
    OFFSET_X: -68,
    OFFSET_Y: -25,
    WIDTH: 132,
    HEIGHT: 20,
  },
  DEFAULT_TOLERANCE_GAME_SAVING_DETECTION: 4,
  // How long the tesseract worker may take to come up. Its start is three downloads (the worker
  // script, the 3.9 MB core, the 1.4 MB Portuguese model) from a CDN and createWorker() has no
  // deadline of its own: with the model unreachable it stays pending forever (measured), so
  // without this the auto-save would wait on it for good.
  OCR_WORKER_TIMEOUT_MS: 20 * 1000,
  // Wait before another attempt after the 1st, 2nd and 3rd failed start. Past the last the host
  // stops trying until auto-save is switched off and on again: tesseract.js hands out the Worker
  // only once it is fully initialised, so a start that stalls or fails leaves a worker behind
  // that cannot be reached to terminate, and an endless retry would leak one per minute.
  OCR_RETRY_BACKOFF_MS: [5 * 1000, 15 * 1000, 60 * 1000],
  // Gap between two groups of raw key events sent to the guest: keys down, gap, keys up, gap.
  // It is a lower bound (a timer can only be late), and it exists because dosCI.simulateKeyPress
  // stamps its release 16 ms in the future, so two calls closer than that wedge the guest
  // keyboard for good. The queue never calls it: raw sendKeyEvent down/up with this gap held
  // 141 characters at 5 ms and 384 at 8 ms on a desktop, and 10 is the margin for slower phones
  // (not yet measured on a low-end Android). A chord costs two gaps, an Alt code ten, so about
  // 20 ms per ordinary character and 100 ms per accented one.
  KEY_PACING_MS: 10,
  // DOSBox's keyboard buffer silently drops events past this many arriving without a pause in
  // between (129 characters in one synchronous burst delivered 14). The only synchronous burst
  // the queue produces is a chord's presses or releases, so this caps the chord length.
  MAX_SYNC_KEY_EVENTS: 14,
  // The BIOS keyboard flags byte (0040:0017). Verified on the real bundle that it follows the
  // NumLock (0x20) and CapsLock (0x40) toggles and agrees with Windows' own idea of them: keypad
  // digits type only after a NumLock tap, and letters invert case after a CapsLock tap. Both
  // are off at boot. Only CapsLock is guarded: Alt+0nnn composes the same character with
  // NumLock off or on, and an Alt-composed letter ignores CapsLock.
  BIOS_KEYBOARD_FLAGS_ADDRESS: 0x417,
  BIOS_CAPS_LOCK_FLAG: 0x40,
  // readMemory is a round trip to the emulator's worker and has no deadline of its own. The
  // queue is a single consumer, so a read that never answered would stop every key behind it.
  KEYBOARD_STATE_TIMEOUT_MS: 500,
  // A text shorter than this goes out without the "Enviando n/N" toast. At about 20 ms a
  // character it is done before the toast has finished sliding in, and the typing showing up
  // in the game is feedback enough.
  PROGRESS_MIN_CHARACTERS: 24,
}

export const BASE_SAVEGAME_DIR = 'd/eli98/jogos/'

export enum Endianness {
  BIG_ENDIAN = 'big',
  LITTLE_ENDIAN = 'little',
}

export const EMULATOR_RAM_SIZE = 0x800000; // 8MB

export const MEMORY_SEARCH_PARAMS = {
  CHUNK_SIZE: 0x100000, // 1MB
  MAX_RESULTS: 10000,
}

export const MULTIPLAYER = {
  APP_ID: 'br.com.elifoot98.multiplayer',
  DEFAULT_CURSOR_COLOR: '#aa00aa',
  EVENTS: { // WARNING: names must be unique and at most 32 bytes (trystero's action-wire typeByteLimit)
    PLAYER_IDENT: 'Ident',
    PLAYER_CURSOR_POS: 'pPosition',
    PLAYER_CLICK: 'pClick',
    CHAT_MESSAGE: 'chatMsg',
    // Ask a peer what it is. Registered by both roles: a host uses it to notice
    // another host, a guest to pull the host's identity without waiting.
    ROLE_QUERY: 'roleQuery',
    // Sent once, targeted, by a host to each joining peer.
    HOST_ANNOUNCE: 'hostAnnounce',
    // "I am composing". Fire and forget: never retried, never acknowledged.
    TYPING: 'typing',
  },
  ROLE_QUERY_TIMEOUT: 5000, // 5 seconds
  // When two hosts collide, the one that has been hosting longer keeps the room. Each
  // side reports its own elapsed time, so there is no shared clock to skew — but the
  // two samples are taken moments apart, so differences under this tolerance are
  // treated as simultaneous and settled by selfId instead.
  HOST_AGE_TOLERANCE: 2000, // 2 seconds
  PING_TIMEOUT: 5000, // 5 seconds
  PING_REFRESH_INTERVAL: 10000, // 10 seconds
  // Latency bands for PlayerInfo.quality. Owned here rather than in the roster component so
  // the pill, the roster and the instability warning cannot disagree about what "poor" is.
  PING_GOOD_MAX: 150, // under this, 'good'
  PING_FAIR_MAX: 400, // under this, 'fair'; at or above, 'poor'
  // Minimum gap between two "connection is unstable" notices about the same peer. The
  // notice is edge-triggered as well, so this only bounds a peer that keeps flapping.
  CONNECTION_WARNING_COOLDOWN: 30000, // 30 seconds
  // How long a guest holds the last frame, waiting for a dropped host to come back, before
  // giving up and reporting the room as over. Long enough to ride out a WiFi handover or a
  // brief tunnel, short enough that a genuinely closed room does not feel hung.
  HOST_GRACE_TIMEOUT: 13000, // 13 seconds
  // Minimum gap between outgoing "I am typing" pings, so a fast typist sends a handful of
  // them rather than one per keystroke.
  TYPING_SEND_THROTTLE_MS: 2000,
  // How long a received typing ping stands before it is assumed stale. Must exceed the
  // throttle above, or a peer that keeps typing would flicker in and out.
  TYPING_EXPIRY_MS: 5000,
  // How long an arrival must last before "Fulano entrou na sala." is written to the
  // transcript. A second host that tries a code already in use joins, loses the tie-break
  // and yields within a few hundred milliseconds; without this, every spectator in the
  // established room reads a join and a leave for someone who was never in their room.
  // The line is stamped with the moment of arrival, not of flushing, so ordering holds.
  SYSTEM_JOIN_LINE_DELAY: 1500,
  CURSOR_Z_INDEX: 10, // Cursors should be above the game elements
  CURSOR_CLICK_Z_INDEX: 9, // Click pings should be below the cursors
  // How long a guest waits for the host's video stream before giving up.
  // A room code that nobody is hosting is indistinguishable from an empty room —
  // trystero joins a room name, not a host — so silence is the only signal there is.
  // Failures trystero *can* report (a wrong password, a dead relay) arrive via
  // onJoinError and cut this short.
  STREAM_WAIT_TIMEOUT: 20000, // 20 seconds
  // Minimum interval between outgoing cursor position broadcasts (~20/s).
  CURSOR_SEND_THROTTLE_MS: 50,
  // How long a cursor may sit still before its name label fades out, leaving the arrow.
  // A pointer that is being used moves; one that is parked is either forgotten or
  // deliberate cover over the game. Since only a *changed* position re-shows the label,
  // re-sending the same coordinates cannot hold a name on screen.
  CURSOR_LABEL_IDLE_MS: 2000,
  // Hard ceiling on the rendered width of a cursor name, in characters. Equal to
  // WIRE_MAX_NAME_LENGTH, so it elides nothing a peer can currently send — it is the
  // backstop that keeps one label's footprint bounded if that cap ever moves, since the
  // label sits on top of the game and every pixel of it is occlusion.
  CURSOR_LABEL_MAX_CHARS: 20,
  // Room codes use an alphabet without easily confused characters (no O/0, I/1).
  ROOM_CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  ROOM_CODE_PREFIX: 'ELI-',
  ROOM_CODE_LENGTH: 4,
  // Palette offered in the join/host dialogs for the player's cursor colour.
  PLAYER_COLORS: [
    '#aa00aa', '#e6194b', '#f58231', '#ffe119',
    '#3cb44b', '#42d4f4', '#4363d8', '#911eb4',
  ],
  // Ceilings applied to anything arriving off the wire. A peer is not the dialog: the
  // `maxlength` attributes in the chat composer (200) and the room-setup name field (20)
  // bind our own UI and nothing else, so these mirror them on the receiving side. Sized
  // to match rather than to be generous — a value a peer's own UI could not have produced
  // is not one we need to render.
  WIRE_MAX_TEXT_LENGTH: 200,
  WIRE_MAX_NAME_LENGTH: 20,
  WIRE_MAX_ID_LENGTH: 64,
  // Ceiling on a peer's self-reported hosting duration, used by the host-collision
  // tie-break. Generous (24h) because a real host may legitimately run for hours and
  // disbelieving a marathon session would be a worse failure than the forgery it guards
  // against.
  WIRE_MAX_HOSTING_MS: 86400000,
  // How many spectators a room may hold, the host not counted. The ceiling is Elifoot's own
  // limit of six players; the host picks anything from 1 up to it, and the default leaves
  // existing hosts' behaviour unchanged. Each spectator costs the host a WebRTC encode and
  // upload of the canvas, so this is the one lever against a room filling up.
  MIN_SPECTATORS: 1,
  MAX_SPECTATORS: 6,
  DEFAULT_MAX_SPECTATORS: 6,
  // How long a spectator keeps waiting for a stream after being told the room is full,
  // before believing it. The refusal arrives as a claim from an unverified peer, so a
  // stream that shows up inside this window wins — see MultiplayerService.onRoomFullClaim.
  ROOM_FULL_GRACE_MS: 5000,
  // How long after the first peer connection is built, with no relay candidate seen, before the
  // relay is called unavailable. A working relay hands out its first candidate within a second or
  // two, so this is generous; it exists because the other signal, a connection finishing its
  // gathering, takes ~40s when some servers simply do not answer, and a spectator gives up on a
  // join after 20s — a verdict that arrives later than that can never reach the message it is for.
  RELAY_VERDICT_MS: 10000,
  // How long a refusing host listens for the other side's answer before tearing the
  // handshake down. Only a rival host answers; a spectator never does, so for the common
  // case this is simply how long the refusal takes to complete.
  HOST_REPLY_WAIT_MS: 1000,
  // How long an admitted-but-not-yet-active peer keeps holding a slot. trystero abandons a
  // handshake after 10s (`handshakeTimeoutMs`), and a peer that dies mid-handshake fires
  // no event of its own, so the slot has to expire by itself.
  ADMISSION_HOLD_MS: 11000,
}