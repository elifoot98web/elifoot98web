import { EmulatorKeyCode } from './emulator-keycode.enum';
import { EmulatorKeyCodeHelper, KeyTask } from './emulator-keycode.helper';

const K = EmulatorKeyCode;
const SHIFT = K.KBD_leftshift;

const chord = (...keys: EmulatorKeyCode[]): KeyTask => ({ kind: 'chord', keys });
const altCode = (code: number): KeyTask => ({ kind: 'altCode', code });
const QUESTION_MARK = chord(SHIFT, K.KBD_slash);

/** A US keyboard, one row of physical keys per line, with what each key types plain and shifted. */
const US_LAYOUT: ReadonlyArray<{ keys: EmulatorKeyCode[]; plain: string; shifted: string }> = [
  {
    keys: [K.KBD_grave, K.KBD_1, K.KBD_2, K.KBD_3, K.KBD_4, K.KBD_5, K.KBD_6, K.KBD_7, K.KBD_8, K.KBD_9, K.KBD_0, K.KBD_minus, K.KBD_equals],
    plain: '`1234567890-=',
    shifted: '~!@#$%^&*()_+',
  },
  {
    keys: [K.KBD_q, K.KBD_w, K.KBD_e, K.KBD_r, K.KBD_t, K.KBD_y, K.KBD_u, K.KBD_i, K.KBD_o, K.KBD_p, K.KBD_leftbracket, K.KBD_rightbracket, K.KBD_backslash],
    plain: 'qwertyuiop[]\\',
    shifted: 'QWERTYUIOP{}|',
  },
  {
    keys: [K.KBD_a, K.KBD_s, K.KBD_d, K.KBD_f, K.KBD_g, K.KBD_h, K.KBD_j, K.KBD_k, K.KBD_l, K.KBD_semicolon, K.KBD_quote],
    plain: 'asdfghjkl;\'',
    shifted: 'ASDFGHJKL:"',
  },
  {
    keys: [K.KBD_z, K.KBD_x, K.KBD_c, K.KBD_v, K.KBD_b, K.KBD_n, K.KBD_m, K.KBD_comma, K.KBD_period, K.KBD_slash],
    plain: 'zxcvbnm,./',
    shifted: 'ZXCVBNM<>?',
  },
];

describe('EmulatorKeyCodeHelper.getKeyStrokeForCharacter', () => {

  it('types every printable ASCII character the way a US keyboard does', () => {
    const covered = new Set<string>([' ']);
    for (const row of US_LAYOUT) {
      row.keys.forEach((key, index) => {
        expect(EmulatorKeyCodeHelper.getKeyStrokeForCharacter(row.plain[index])).toEqual([key]);
        expect(EmulatorKeyCodeHelper.getKeyStrokeForCharacter(row.shifted[index])).toEqual([SHIFT, key]);
        covered.add(row.plain[index]);
        covered.add(row.shifted[index]);
      });
    }

    // The table above has to cover the whole printable range, or the loop proves less than it says.
    for (let code = 0x20; code <= 0x7E; code++) {
      expect(covered.has(String.fromCharCode(code))).toBe(true, `U+${code.toString(16)} is missing from the layout table`);
    }
  });

  it('maps the control characters the dialog can send', () => {
    expect(EmulatorKeyCodeHelper.getKeyStrokeForCharacter(' ')).toEqual([K.KBD_space]);
    expect(EmulatorKeyCodeHelper.getKeyStrokeForCharacter('\n')).toEqual([K.KBD_enter]);
    expect(EmulatorKeyCodeHelper.getKeyStrokeForCharacter('\t')).toEqual([K.KBD_tab]);
    expect(EmulatorKeyCodeHelper.getKeyStrokeForCharacter('\b')).toEqual([K.KBD_backspace]);
  });

  it('has no chord for anything outside ASCII, or for more than one character', () => {
    for (const char of ['ã', 'ç', '€', '’', '⚽', '😀', '', 'ab', '\u0000', '\u007f', '\r']) {
      expect(EmulatorKeyCodeHelper.getKeyStrokeForCharacter(char)).toEqual([], JSON.stringify(char));
    }
  });
});

describe('EmulatorKeyCodeHelper.planCodePoint', () => {

  it('types U+00A1..U+00FF as the Alt code of the same number', () => {
    for (let codePoint = 0xA1; codePoint <= 0xFF; codePoint++) {
      const plan = EmulatorKeyCodeHelper.planCodePoint(String.fromCodePoint(codePoint));
      expect(plan.tasks).toEqual([altCode(codePoint)], `U+${codePoint.toString(16)}`);
      expect(plan.substituted).toBe(false);
    }
  });

  it('knows the Portuguese letters by their Windows-1252 numbers', () => {
    const expected: Record<string, number> = {
      'ã': 227, 'õ': 245, 'á': 225, 'é': 233, 'í': 237, 'ó': 243, 'ú': 250, 'â': 226, 'ê': 234,
      'ô': 244, 'à': 224, 'ç': 231, 'Ã': 195, 'Õ': 213, 'Á': 193, 'É': 201, 'Ç': 199, 'ü': 252,
    };
    for (const [char, code] of Object.entries(expected)) {
      expect(EmulatorKeyCodeHelper.planCodePoint(char).tasks).toEqual([altCode(code)], char);
    }
  });

  it('folds iOS Smart Punctuation and its relatives to ASCII', () => {
    expect(EmulatorKeyCodeHelper.planCodePoint('‘').tasks).toEqual([chord(K.KBD_quote)]);
    expect(EmulatorKeyCodeHelper.planCodePoint('’').tasks).toEqual([chord(K.KBD_quote)]);
    expect(EmulatorKeyCodeHelper.planCodePoint('ʼ').tasks).toEqual([chord(K.KBD_quote)]);
    expect(EmulatorKeyCodeHelper.planCodePoint('“').tasks).toEqual([chord(SHIFT, K.KBD_quote)]);
    expect(EmulatorKeyCodeHelper.planCodePoint('”').tasks).toEqual([chord(SHIFT, K.KBD_quote)]);
    expect(EmulatorKeyCodeHelper.planCodePoint('–').tasks).toEqual([chord(K.KBD_minus)]);
    expect(EmulatorKeyCodeHelper.planCodePoint('—').tasks).toEqual([chord(K.KBD_minus)]);
    expect(EmulatorKeyCodeHelper.planCodePoint('−').tasks).toEqual([chord(K.KBD_minus)]);
  });

  it('folds an ellipsis to three periods, the one code point that is more than one character', () => {
    const plan = EmulatorKeyCodeHelper.planCodePoint('…');
    expect(plan.tasks).toEqual([chord(K.KBD_period), chord(K.KBD_period), chord(K.KBD_period)]);
    expect(plan.substituted).toBe(false);
  });

  it('folds the no-break space and the typographic spaces to a plain space', () => {
    for (const codePoint of [0xA0, 0x2000, 0x2003, 0x2009, 0x200A, 0x202F, 0x205F, 0x3000]) {
      expect(EmulatorKeyCodeHelper.planCodePoint(String.fromCodePoint(codePoint)).tasks).toEqual([chord(K.KBD_space)], `U+${codePoint.toString(16)}`);
    }
  });

  it('turns the Unicode line and paragraph separators into Enter', () => {
    expect(EmulatorKeyCodeHelper.planCodePoint('\u2028').tasks).toEqual([chord(K.KBD_enter)]);
    expect(EmulatorKeyCodeHelper.planCodePoint('\u2029').tasks).toEqual([chord(K.KBD_enter)]);
  });

  it('types a visible "?" for what the guest cannot show, and says it was a substitution', () => {
    const unsupported = [
      '€',        // euro: Alt+0128 is accepted but the field's font draws a box
      'Š',        // S with caron, same block
      '™',        // trade mark, same block
      '\u0080',        // a C1 control
      '\u009F',
      '\u0000',
      '\u007F',
      '\u200B',       // zero-width space: invisible, so a drop would be silent
      'Α',        // Greek capital alpha
      '中',        // CJK
      '⚽',        // soccer ball
      '\u{1F600}',     // an astral emoji
      '\uD800',        // a lone surrogate
    ];
    for (const char of unsupported) {
      const plan = EmulatorKeyCodeHelper.planCodePoint(char);
      expect(plan.tasks).toEqual([QUESTION_MARK], JSON.stringify(char));
      expect(plan.substituted).toBe(true, JSON.stringify(char));
    }
  });

  it('plans nothing for the empty string', () => {
    expect(EmulatorKeyCodeHelper.planCodePoint('')).toEqual({ tasks: [], substituted: false });
  });

  it('never produces an empty chord or an Alt code the queue would refuse, for any code point in the BMP', () => {
    for (let codePoint = 0; codePoint <= 0xFFFF; codePoint++) {
      const { tasks } = EmulatorKeyCodeHelper.planCodePoint(String.fromCharCode(codePoint));
      expect(tasks.length).toBeGreaterThan(0);
      for (const task of tasks) {
        if (task.kind === 'chord') {
          if (task.keys.length === 0) fail(`empty chord for U+${codePoint.toString(16)}`);
        } else if (!(task.code >= 1 && task.code <= 255)) {
          fail(`Alt code ${task.code} for U+${codePoint.toString(16)}`);
        }
      }
    }
  });

  it('hands out a fresh "?" chord each time, so a caller mutating one cannot change the next', () => {
    const first = EmulatorKeyCodeHelper.planCodePoint('⚽').tasks[0] as { keys: EmulatorKeyCode[] };
    first.keys.length = 0;
    expect(EmulatorKeyCodeHelper.planCodePoint('⚽').tasks).toEqual([QUESTION_MARK]);
  });
});

describe('EmulatorKeyCodeHelper.planText', () => {

  it('types an accented name the way the dialog needs it', () => {
    const plan = EmulatorKeyCodeHelper.planText('João');
    expect(plan.tasks).toEqual([chord(SHIFT, K.KBD_j), chord(K.KBD_o), altCode(227), chord(K.KBD_o)]);
    expect(plan.characters).toBe(4);
    expect(plan.substituted).toBe(0);
  });

  it('plans one task per code point for ordinary text, so host and guest stay one to one', () => {
    const text = 'João André Açores, D’Alessandro (nº 10) - 100%\tZé\nRomário';
    const plan = EmulatorKeyCodeHelper.planText(text);
    expect(plan.tasks.length).toBe(plan.characters);
    expect(plan.characters).toBe(Array.from(text).length);
  });

  it('counts code points, not UTF-16 units: an astral character is one "?"', () => {
    const plan = EmulatorKeyCodeHelper.planText('a\u{1F600}b');
    expect('a\u{1F600}b'.length).toBe(4);
    expect(plan.characters).toBe(3);
    expect(plan.tasks).toEqual([chord(K.KBD_a), QUESTION_MARK, chord(K.KBD_b)]);
    expect(plan.substituted).toBe(1);
  });

  it('types one "?" per code point of a joined emoji, because each is a code point', () => {
    // man + ZWJ + woman + ZWJ + girl: five code points. Honest rather than clever.
    const plan = EmulatorKeyCodeHelper.planText('\u{1F468}\u200D\u{1F469}\u200D\u{1F467}');
    expect(plan.characters).toBe(5);
    expect(plan.tasks).toEqual(Array(5).fill(QUESTION_MARK));
    expect(plan.substituted).toBe(5);
  });

  it('composes a decomposed accent so it types as one letter', () => {
    const decomposed = EmulatorKeyCodeHelper.planText('Joa\u0303o');
    const composed = EmulatorKeyCodeHelper.planText('João');
    expect(decomposed).toEqual(composed);
    expect(decomposed.characters).toBe(4);
  });

  it('types a combining mark with nothing to attach to as "?"', () => {
    const plan = EmulatorKeyCodeHelper.planText('\u0303');
    expect(plan.tasks).toEqual([QUESTION_MARK]);
    expect(plan.substituted).toBe(1);
  });

  it('treats CRLF, a lone CR and LF alike: one Enter', () => {
    for (const text of ['a\r\nb', 'a\rb', 'a\nb']) {
      expect(EmulatorKeyCodeHelper.planText(text).tasks).toEqual([chord(K.KBD_a), chord(K.KBD_enter), chord(K.KBD_b)], JSON.stringify(text));
    }
  });

  it('plans a curly-apostrophe name exactly like the straight one', () => {
    expect(EmulatorKeyCodeHelper.planText('D’Alessandro')).toEqual(EmulatorKeyCodeHelper.planText('D\'Alessandro'));
    expect(EmulatorKeyCodeHelper.planText('N‘Golo').tasks).toEqual(EmulatorKeyCodeHelper.planText('N\'Golo').tasks);
  });

  it('does not count folded characters as substitutions', () => {
    const plan = EmulatorKeyCodeHelper.planText('“ola” – nº…');
    expect(plan.substituted).toBe(0);
  });

  it('counts only the characters that became "?"', () => {
    const plan = EmulatorKeyCodeHelper.planText('R$ 5€ ⚽');
    expect(plan.substituted).toBe(2);
  });

  it('expands an ellipsis to three tasks while counting it as one character', () => {
    const plan = EmulatorKeyCodeHelper.planText('a…b');
    expect(plan.characters).toBe(3);
    expect(plan.tasks.length).toBe(5);
  });

  it('plans nothing for the empty string', () => {
    expect(EmulatorKeyCodeHelper.planText('')).toEqual({ tasks: [], characters: 0, substituted: 0 });
  });

  it('survives text a phone might send: lone surrogates, a BOM, an empty line', () => {
    const plan = EmulatorKeyCodeHelper.planText('\uFEFFa\uD83Db\n\n');
    expect(plan.characters).toBe(6);
    expect(plan.substituted).toBe(2);
  });
});

describe('EmulatorKeyCodeHelper.typesLetters', () => {

  it('is true when a letter key is pressed, shifted or not', () => {
    expect(EmulatorKeyCodeHelper.typesLetters(EmulatorKeyCodeHelper.planText('a').tasks)).toBe(true);
    expect(EmulatorKeyCodeHelper.typesLetters(EmulatorKeyCodeHelper.planText('Z').tasks)).toBe(true);
    expect(EmulatorKeyCodeHelper.typesLetters(EmulatorKeyCodeHelper.planText('1a').tasks)).toBe(true);
  });

  it('is false for what CapsLock cannot invert', () => {
    for (const text of ['', '1234', ' .,;-', '!@#', 'ãçé', '\n\t', '⚽']) {
      expect(EmulatorKeyCodeHelper.typesLetters(EmulatorKeyCodeHelper.planText(text).tasks)).toBe(false, JSON.stringify(text));
    }
  });
});
