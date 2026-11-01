import { EmulatorKeyCode } from './emulator-keycode.enum';

/** Press the keys together, then release them in reverse order. Modifiers come first. */
export interface ChordTask {
  kind: 'chord';
  keys: EmulatorKeyCode[];
}

/**
 * Hold Alt, press the four keypad digits of `code`, release Alt: Windows composes the ANSI
 * character on Alt-up. `code` is the Windows-1252 value, 1..255, typed zero-padded ("0227"),
 * which is what selects ANSI over the OEM code page.
 */
export interface AltCodeTask {
  kind: 'altCode';
  code: number;
}

export type KeyTask = ChordTask | AltCodeTask;

export interface TextPlan {
  /** What to send, in order: one task per code point, except an ellipsis, which folds to three. */
  tasks: KeyTask[];
  /** Code points the host was given, after normalisation. */
  characters: number;
  /** Code points the guest has no way to type, sent as a visible "?" instead. */
  substituted: number;
}

export interface CodePointPlan {
  tasks: KeyTask[];
  substituted: boolean;
}

/**
 * Code points that have an ASCII look-alike. Written as escapes because half of them are
 * invisible; the second column is what gets typed instead.
 */
const FOLD_TABLE: ReadonlyArray<readonly [codePoints: readonly number[], replacement: string]> = [
  // What iOS Smart Punctuation and some Android keyboards put in D'Alessandro and N'Golo:
  // left/right single quote, single high-reversed-9 quote, modifier letter apostrophe.
  [[0x2018, 0x2019, 0x201B, 0x02BC], '\''],
  // Left/right double quote, double low-9 quote, double high-reversed-9 quote.
  [[0x201C, 0x201D, 0x201E, 0x201F], '"'],
  // Hyphen, non-breaking hyphen, figure dash, en dash, em dash, horizontal bar, minus sign.
  [[0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212], '-'],
  // The one code point that expands to more than one guest character: a mirror of the host's
  // field has to ask planCodePoint how many, not assume one.
  [[0x2026], '...'],
  // No-break space, the en/em/thin/hair spaces (U+2000-U+200A), narrow no-break space, medium
  // mathematical space and ideographic space. Alt+0160 does type a blank, but a name holding
  // a no-break space never matches the same name typed with a plain one.
  [[0x00A0, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x202F, 0x205F, 0x3000], ' '],
  // Line and paragraph separators, which Notes and some web pages put in pasted text.
  [[0x2028, 0x2029], '\n'],
];

const FOLDS = new Map<number, string>();
for (const [codePoints, replacement] of FOLD_TABLE) {
  for (const codePoint of codePoints) FOLDS.set(codePoint, replacement);
}

const UNSHIFTED_PUNCTUATION = new Map<string, EmulatorKeyCode>([
  ['`', EmulatorKeyCode.KBD_grave],
  ['-', EmulatorKeyCode.KBD_minus],
  ['=', EmulatorKeyCode.KBD_equals],
  ['[', EmulatorKeyCode.KBD_leftbracket],
  [']', EmulatorKeyCode.KBD_rightbracket],
  ['\\', EmulatorKeyCode.KBD_backslash],
  [';', EmulatorKeyCode.KBD_semicolon],
  ['\'', EmulatorKeyCode.KBD_quote],
  [',', EmulatorKeyCode.KBD_comma],
  ['.', EmulatorKeyCode.KBD_period],
  ['/', EmulatorKeyCode.KBD_slash],
]);

const SHIFTED_PUNCTUATION = new Map<string, EmulatorKeyCode>([
  ['~', EmulatorKeyCode.KBD_grave],
  ['_', EmulatorKeyCode.KBD_minus],
  ['+', EmulatorKeyCode.KBD_equals],
  ['{', EmulatorKeyCode.KBD_leftbracket],
  ['}', EmulatorKeyCode.KBD_rightbracket],
  ['|', EmulatorKeyCode.KBD_backslash],
  [':', EmulatorKeyCode.KBD_semicolon],
  ['"', EmulatorKeyCode.KBD_quote],
  ['<', EmulatorKeyCode.KBD_comma],
  ['>', EmulatorKeyCode.KBD_period],
  ['?', EmulatorKeyCode.KBD_slash],
]);

/** The symbols above the number row, indexed by the digit key they share. */
const NUMBER_ROW_SHIFTED = ')!@#$%^&*(';

const QUESTION_MARK: EmulatorKeyCode[] = [EmulatorKeyCode.KBD_leftshift, EmulatorKeyCode.KBD_slash];

/**
 * Turns text into the key tasks that type it into the guest, a Windows 3.1 machine with a
 * plain US layout: no dead keys, no AltGr, and no way to install ABNT2 from the shipped image.
 * Pure on purpose — it neither touches the emulator nor needs Angular — so the tables are
 * covered by specs and the queue only has to send what it is given.
 *
 * Every code point lands as one visible character in the guest (the ellipsis, which lands as
 * three, is the one exception), and one with no way in lands as "?" — never as a space and
 * never as nothing — so the host's string and the guest's field stay in step and Backspace
 * stays correct:
 *
 *  - printable ASCII is a plain or Shift chord;
 *  - U+00A1..U+00FF are Alt+0nnn. Elifoot's edit fields draw them, in the coach-name fields
 *    and in the new-game filename field;
 *  - typographic punctuation and exotic spaces fold to their ASCII look-alike (FOLD_TABLE);
 *  - everything else is "?". That includes the euro sign and the rest of Windows-1252's
 *    0x80-0x9F block (Š, ž, ™...): Alt+0128 and friends are accepted, but the edit fields'
 *    font has no glyph there and draws a solid box, which is worse than a "?". It also
 *    includes emoji, CJK, and every invisible code point (a zero-width space types a "?" too:
 *    the alternative is a silent drop).
 *
 * Input is NFC-normalised first so a name pasted in decomposed form ("a" + U+0303) types as one
 * "ã", and CR / CRLF become a single Enter. Code points are counted with Array.from, not
 * UTF-16 units, so an astral character is one "?" and not two.
 */
export class EmulatorKeyCodeHelper {

  /**
   * The key chord for one printable ASCII character (plus space, newline, tab and backspace),
   * or an empty array for anything else.
   */
  static getKeyStrokeForCharacter(char: string): EmulatorKeyCode[] {
    if (char === ' ') return [EmulatorKeyCode.KBD_space];
    if (char === '\n') return [EmulatorKeyCode.KBD_enter];
    if (char === '\t') return [EmulatorKeyCode.KBD_tab];
    if (char === '\b') return [EmulatorKeyCode.KBD_backspace];
    if (char.length !== 1) return [];

    if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')) {
      return [EmulatorKeyCode[('KBD_' + char) as keyof typeof EmulatorKeyCode]];
    }
    if (char >= 'A' && char <= 'Z') {
      return [EmulatorKeyCode.KBD_leftshift, EmulatorKeyCode[('KBD_' + char.toLowerCase()) as keyof typeof EmulatorKeyCode]];
    }

    const numberRow = NUMBER_ROW_SHIFTED.indexOf(char);
    if (numberRow >= 0) {
      return [EmulatorKeyCode.KBD_leftshift, EmulatorKeyCode[('KBD_' + numberRow) as keyof typeof EmulatorKeyCode]];
    }

    const unshifted = UNSHIFTED_PUNCTUATION.get(char);
    if (unshifted !== undefined) return [unshifted];

    const shifted = SHIFTED_PUNCTUATION.get(char);
    if (shifted !== undefined) return [EmulatorKeyCode.KBD_leftshift, shifted];

    return [];
  }

  /** The tasks for one code point, as produced by `Array.from`. */
  static planCodePoint(char: string): CodePointPlan {
    if (char.length === 0) return { tasks: [], substituted: false };

    const direct = this.getKeyStrokeForCharacter(char);
    if (direct.length > 0) {
      return { tasks: [{ kind: 'chord', keys: direct }], substituted: false };
    }

    const codePoint = char.codePointAt(0)!;
    const folded = FOLDS.get(codePoint);
    if (folded !== undefined) {
      return {
        tasks: Array.from(folded).map(ascii => ({ kind: 'chord', keys: this.getKeyStrokeForCharacter(ascii) })),
        substituted: false,
      };
    }

    // U+00A0 was folded above, so this starts one past it.
    if (codePoint >= 0xA1 && codePoint <= 0xFF) {
      return { tasks: [{ kind: 'altCode', code: codePoint }], substituted: false };
    }

    return { tasks: [{ kind: 'chord', keys: [...QUESTION_MARK] }], substituted: true };
  }

  static planText(text: string): TextPlan {
    const tasks: KeyTask[] = [];
    let substituted = 0;
    const characters = Array.from(text.normalize('NFC').replace(/\r\n?/g, '\n'));

    for (const char of characters) {
      const plan = this.planCodePoint(char);
      tasks.push(...plan.tasks);
      if (plan.substituted) substituted++;
    }

    return { tasks, characters: characters.length, substituted };
  }

  /**
   * Whether typing these tasks depends on CapsLock: it inverts a letter key's case, so the
   * queue checks the guest's CapsLock before sending them. Alt codes, digits and punctuation
   * do not care.
   */
  static typesLetters(tasks: readonly KeyTask[]): boolean {
    return tasks.some(task =>
      task.kind === 'chord' && task.keys.some(key => key >= EmulatorKeyCode.KBD_a && key <= EmulatorKeyCode.KBD_z));
  }
}
