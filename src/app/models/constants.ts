import { EmulatorKeyCode } from "./emulator-keycodes";

export const STORAGE_KEY = {
  DISABLE_SMOOTH_FILTER: 'disableSmoothFilter',
  AUTO_SAVE: 'autoSave',
  HIDE_TUTORIAL: 'hideTutorial',
  PENDING_UPDATE: 'pendingUpdate',
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
