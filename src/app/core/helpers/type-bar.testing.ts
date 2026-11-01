import { EmulatorKeyCode, KeyTask } from '../models/game';

/**
 * Stand-ins and readers for the type bar's specs. Nothing here is imported by the app, so none of
 * it reaches the bundle.
 */

const K = EmulatorKeyCode;

/**
 * A task as a short word, so a whole step reads as one line in a spec: `BS` Backspace, `_` Space,
 * `a` a letter, `A` Shift plus a letter, `alt227` an Alt code, `ENTER`, and the key codes joined
 * with `+` for anything else.
 */
export function label(task: KeyTask): string {
  if (task.kind === 'altCode') return `alt${task.code}`;
  const keys = task.keys;
  if (keys.length === 1) {
    const key = keys[0];
    if (key === K.KBD_backspace) return 'BS';
    if (key === K.KBD_space) return '_';
    if (key === K.KBD_enter) return 'ENTER';
    if (key === K.KBD_tab) return 'TAB';
    if (key === K.KBD_esc) return 'ESC';
    if (key >= K.KBD_f1 && key <= K.KBD_f12) return `F${key - K.KBD_f1 + 1}`;
    if (key >= K.KBD_a && key <= K.KBD_z) return String.fromCharCode(key).toLowerCase();
    if (key >= K.KBD_0 && key <= K.KBD_9) return String.fromCharCode(key);
    if (key === K.KBD_period) return '.';
    if (key === K.KBD_quote) return '\'';
  }
  if (keys.length === 2 && keys[0] === K.KBD_leftshift) {
    if (keys[1] >= K.KBD_a && keys[1] <= K.KBD_z) return String.fromCharCode(keys[1]);
    if (keys[1] === K.KBD_slash) return '?';
    if (keys[1] === K.KBD_tab) return 'SHIFT+TAB';
  }
  return keys.join('+');
}

/** Several tasks as one line. */
export function labels(tasks: readonly KeyTask[]): string {
  return tasks.map(label).join(' ');
}
