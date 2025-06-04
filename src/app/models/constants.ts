import { EmulatorKeyCode } from "./emulator-keycodes";

export const STORAGE_KEY = {
  DISABLE_SMOOTH_FILTER: 'disableSmoothFilter',
  DISABLE_AUTO_SAVE: 'disableAutoSave',
  PERIODIC_SAVE: 'autoSave',
  HIDE_TUTORIAL: 'hideTutorial',
  PENDING_UPDATE: 'pendingUpdate',
  FAIL_COUNT: 'failCount',
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
  EVENTS: {
    PLAYER_IDENT: 'Ident',
    PLAYER_POINTER: 'Pointer',
    PLAYER_LIST: 'pList',
    HOST_CLAIM: 'hostClaim',
  },
  HOST_CLAIM_TIMEOUT: 5000, // 5 seconds
}