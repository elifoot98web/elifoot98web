import { EmulatorKeyCode } from '../models/game';

/** A key the type bar sends to the guest as itself, instead of as text. */
export interface TypedKey {
  /** Pressed together, modifiers first: the chord the key queue sends. */
  codes: EmulatorKeyCode[];
  /** Shown in the diagnostics log. */
  name: string;
  /**
   * The guest's focus or caret moves, or the form acts, so the text in the bar no longer describes
   * the field the guest is on: the bar clears itself. Backspace is the one key that does not.
   */
  resets: boolean;
  /** Holding the key down may repeat it. Enter, Esc and Tab never do: a held Enter is a stampede. */
  repeatable: boolean;
}

/** The part of a `KeyboardEvent` that decides what a key is. A plain object in the specs. */
export interface KeyboardEventLike {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

const K = EmulatorKeyCode;

const NAMED: ReadonlyMap<string, EmulatorKeyCode> = new Map([
  ['Enter', K.KBD_enter],
  ['Escape', K.KBD_esc],
  ['ArrowLeft', K.KBD_left],
  ['ArrowRight', K.KBD_right],
  ['ArrowUp', K.KBD_up],
  ['ArrowDown', K.KBD_down],
  ['Home', K.KBD_home],
  ['End', K.KBD_end],
  ['Delete', K.KBD_delete],
  ['PageUp', K.KBD_pageup],
  ['PageDown', K.KBD_pagedown],
]);

/** The navigation and deletion keys that a held key may repeat, as the deck's do. */
const REPEATABLE: ReadonlySet<EmulatorKeyCode> = new Set([
  K.KBD_left, K.KBD_right, K.KBD_up, K.KBD_down, K.KBD_delete, K.KBD_pageup, K.KBD_pagedown,
]);

const FUNCTION_KEYS: readonly EmulatorKeyCode[] = [
  K.KBD_f1, K.KBD_f2, K.KBD_f3, K.KBD_f4, K.KBD_f5, K.KBD_f6,
  K.KBD_f7, K.KBD_f8, K.KBD_f9, K.KBD_f10, K.KBD_f11, K.KBD_f12,
];

/**
 * Which keydowns of the type bar's field are the game's keys, and which belong to the keyboard that
 * produced them. Pure, so the table is a spec and not a guess.
 *
 * A NAMED key (Enter, Tab, Esc, an arrow, F1-F12...) is authoritative from its `keydown`: that is
 * what a hardware keyboard and iOS's software one report, and it is the only place such a key is
 * visible at all (it changes no text, so there is no `input` event to diff). Letters are never
 * read from a `keydown`: an Android IME reports them as `keyCode 229` / `key: "Unidentified"`, and
 * even where the key is named, the typed text is the field's `value` and not a key (TypeMirror).
 *
 * **Backspace is the exception that needs the field.** In a field with text it is an edit, and the
 * `input` event that follows carries it (a keydown AND an input would delete twice). In an empty one
 * nothing changes, so no `input` event fires at all (iOS delivers only the keydown), and that
 * keydown is the only trace of a Backspace meant for the guest's own field, whose text the bar
 * never held: "Backspace past empty".
 *
 * Anything an IME is in the middle of (`isComposing`, `keyCode 229`) is the IME's, and a key with
 * Ctrl, Alt or Meta held is the browser's (paste, select all) and is left alone. Shift matters
 * only for Tab.
 */
export class TypeKeyHelper {

  static fromKeyboardEvent(event: KeyboardEventLike, fieldIsEmpty: boolean): TypedKey | null {
    if (event.isComposing || event.keyCode === 229) return null;
    if (event.ctrlKey || event.altKey || event.metaKey) return null;

    if (event.key === 'Tab') {
      return event.shiftKey
        ? { codes: [K.KBD_leftshift, K.KBD_tab], name: 'Shift+Tab', resets: true, repeatable: false }
        : { codes: [K.KBD_tab], name: 'Tab', resets: true, repeatable: false };
    }

    if (event.key === 'Backspace') {
      return fieldIsEmpty ? { codes: [K.KBD_backspace], name: 'Backspace', resets: false, repeatable: true } : null;
    }

    const named = NAMED.get(event.key);
    if (named !== undefined) return { codes: [named], name: event.key, resets: true, repeatable: REPEATABLE.has(named) };

    const match = /^F([1-9]|1[0-2])$/.exec(event.key);
    if (match) return { codes: [FUNCTION_KEYS[Number(match[1]) - 1]], name: event.key, resets: true, repeatable: false };

    return null;
  }

  /** Whether a chord from the strip moves the guest's focus or caret: all of them but Backspace. */
  static resetsField(codes: readonly EmulatorKeyCode[]): boolean {
    return !codes.includes(K.KBD_backspace);
  }
}
