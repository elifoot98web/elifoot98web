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
  DEFAULT_TICK_INTERVAL_MS: 1500,
  DEFAULT_PERIODIC_SAVE_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
  DEFAULT_GAME_SAVING_DETECTED_TIMEOUT_MS: 1000, // 1 second
  MAX_WAITING_TIME_FOR_GAME_SAVE_DETECTED: 2 * 60 * 1000, // 2 minutes
}

export const EMULATOR_CONTROL_CONFIG = {
  DEFAULT_AREA_OF_INTEREST: {
    top: 275,
    left: 332,
    width: 132,
    height: 20
  },
  DEFAULT_TOLERANCE_GAME_SAVING_DETECTION: 4,
  KEYSTROKE_DELAY: 30,
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
  // Room codes use an alphabet without easily confused characters (no O/0, I/1).
  ROOM_CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  ROOM_CODE_PREFIX: 'ELI-',
  ROOM_CODE_LENGTH: 4,
  // Palette offered in the join/host dialogs for the player's cursor colour.
  PLAYER_COLORS: [
    '#aa00aa', '#e6194b', '#f58231', '#ffe119',
    '#3cb44b', '#42d4f4', '#4363d8', '#911eb4',
  ],
}