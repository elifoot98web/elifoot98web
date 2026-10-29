import { EmulatorKeyCode } from '../models/game';
import { labels } from './type-bar.testing';
import { MirrorStep, TypeMirror } from './type-mirror.helper';

const K = EmulatorKeyCode;

const line = (step: MirrorStep | null) => (step ? labels(TypeMirror.plan(step).tasks) : '(nothing)');

describe('TypeMirror', () => {

  describe('plain typing', () => {

    it('sends each letter as it arrives and nothing for a value it already has', () => {
      const mirror = new TypeMirror();
      expect(line(mirror.sync('j'))).toBe('j');
      expect(line(mirror.sync('jo'))).toBe('o');
      expect(line(mirror.sync('jo'))).toBe('(nothing)');
      expect(mirror.guestText).toBe('jo');
    });

    it('sends a capital as Shift plus the letter', () => {
      const mirror = new TypeMirror();
      const step = mirror.sync('Z');
      expect(TypeMirror.plan(step!).tasks).toEqual([{ kind: 'chord', keys: [K.KBD_leftshift, K.KBD_z] }]);
    });

    it('does nothing for an empty field', () => {
      expect(new TypeMirror().sync('')).toBeNull();
    });
  });

  describe('a suggestion tap and the keyboard\'s trailing space', () => {

    it('rewrites the word and holds the auto-space back', () => {
      const mirror = new TypeMirror();
      mirror.sync('Felipa');
      // Gboard swaps the word for its suggestion and adds a space: one value, two changes.
      const step = mirror.sync('Felipão ');
      expect(step).toEqual({ backspaces: 1, text: 'ão' });
      expect(line(step)).toBe('BS alt227 o');
      expect(mirror.guestText).toBe('Felipão');
    });

    it('sends that space when more text follows it, as part of the text', () => {
      const mirror = new TypeMirror();
      mirror.sync('Felipão ');
      expect(mirror.guestText).toBe('Felipão');
      const step = mirror.sync('Felipão S');
      expect(step).toEqual({ backspaces: 0, text: ' S' });
      expect(mirror.guestText).toBe('Felipão S');
    });

    it('does nothing at all for a space the player takes back, since the guest never got it', () => {
      const mirror = new TypeMirror();
      mirror.sync('Tite');
      expect(mirror.sync('Tite ')).toBeNull();
      expect(mirror.sync('Tite')).toBeNull();
      expect(mirror.guestText).toBe('Tite');
    });

    it('swallows the space iOS leaves before a full stop, so the stop lands against the word', () => {
      const mirror = new TypeMirror();
      mirror.sync('Dr');
      expect(mirror.sync('Dr ')).toBeNull();
      // QuickType removes the space it added when punctuation follows.
      expect(mirror.sync('Dr.')).toEqual({ backspaces: 0, text: '.' });
    });

    it('holds back every trailing space, and the exotic ones that fold to one', () => {
      const mirror = new TypeMirror();
      mirror.sync('Ze');
      expect(mirror.sync('Ze   ')).toBeNull();
      expect(mirror.sync('Ze ')).toBeNull();
      expect(mirror.sync('Ze 　')).toBeNull();
      expect(mirror.guestText).toBe('Ze');
    });

    it('sends nothing for a field that only holds spaces', () => {
      const mirror = new TypeMirror();
      expect(mirror.sync('  ')).toBeNull();
      expect(mirror.isEmpty).toBeTrue();
    });
  });

  describe('compositions and corrections', () => {

    it('follows a word as the IME rewrites it, in the fewest keys', () => {
      const mirror = new TypeMirror();
      expect(line(mirror.sync('Feli'))).toBe('F e l i');
      expect(mirror.sync('Felipao')).toEqual({ backspaces: 0, text: 'pao' });
      // The keyboard swaps the last two letters for "e": delete from the first difference.
      expect(mirror.sync('Felipe')).toEqual({ backspaces: 2, text: 'e' });
      expect(mirror.guestText).toBe('Felipe');
    });

    it('deletes through composed text one character at a time', () => {
      const mirror = new TypeMirror();
      mirror.sync('João');
      expect(mirror.sync('Joã')).toEqual({ backspaces: 1, text: '' });
      expect(mirror.sync('Jo')).toEqual({ backspaces: 1, text: '' });
      expect(mirror.sync('J')).toEqual({ backspaces: 1, text: '' });
      expect(mirror.sync('')).toEqual({ backspaces: 1, text: '' });
      expect(mirror.isEmpty).toBeTrue();
    });

    it('replaces the middle of the text by deleting from there to the end and retyping', () => {
      const mirror = new TypeMirror();
      mirror.sync('Silva');
      // The caret was moved into the word and a letter typed: the guest's caret is at the end,
      // so the honest thing is to rewrite the tail.
      expect(mirror.sync('Sixlva')).toEqual({ backspaces: 3, text: 'xlva' });
      expect(mirror.guestText).toBe('Sixlva');
    });

    it('lets a whole replacement be one step', () => {
      const mirror = new TypeMirror();
      mirror.sync('abc');
      expect(mirror.sync('xyz')).toEqual({ backspaces: 3, text: 'xyz' });
    });
  });

  describe('code points, not UTF-16 units', () => {

    it('counts an emoji as one character, typed and deleted as one "?"', () => {
      const mirror = new TypeMirror();
      const step = mirror.sync('a\u{1F600}b');
      expect(step).toEqual({ backspaces: 0, text: 'a\u{1F600}b' });
      expect(line(step)).toBe('a ? b');
      // Deleting the emoji and what follows: two guest characters, not three UTF-16 units.
      expect(mirror.sync('a')).toEqual({ backspaces: 2, text: '' });
    });

    it('does not split a surrogate pair when the common prefix ends inside it', () => {
      const mirror = new TypeMirror();
      mirror.sync('\u{1F600}');
      // Same high surrogate, different low one: a diff by UTF-16 units would keep half an emoji.
      expect(mirror.sync('\u{1F601}')).toEqual({ backspaces: 1, text: '\u{1F601}' });
    });

    it('composes a letter and its accent into one character', () => {
      const mirror = new TypeMirror();
      // "a" followed by a combining tilde is one "ã" in the guest.
      expect(line(mirror.sync('ã'))).toBe('alt227');
      expect(mirror.guestText).toBe('ã');
      expect(mirror.sync('ã')).toBeNull();
    });
  });

  describe('what the guest shows for a code point', () => {

    it('types the accents as Alt codes, 1:1', () => {
      const mirror = new TypeMirror();
      expect(line(mirror.sync('João Açores'))).toBe('J o alt227 o _ A alt231 o r e s');
    });

    it('deletes an ellipsis with three Backspaces, because the guest typed three dots', () => {
      const mirror = new TypeMirror();
      expect(line(mirror.sync('a…'))).toBe('a . . .');
      expect(mirror.sync('a')).toEqual({ backspaces: 3, text: '' });
    });

    it('folds a smart quote to a plain one and counts one guest character for it', () => {
      const mirror = new TypeMirror();
      expect(line(mirror.sync('D’A'))).toBe('D \' A');
      expect(mirror.sync('D')).toEqual({ backspaces: 2, text: '' });
    });

    it('reports how many code points the guest cannot show', () => {
      const plan = TypeMirror.plan({ backspaces: 0, text: 'a\u{1F600}€' });
      expect(plan.substituted).toBe(2);
    });

    it('puts the Backspaces first, then the text', () => {
      const plan = TypeMirror.plan({ backspaces: 2, text: 'ab' });
      expect(labels(plan.tasks)).toBe('BS BS a b');
      expect(plan.backspaces).toBe(2);
    });
  });

  describe('a paste', () => {

    it('is one step with one key per character', () => {
      const mirror = new TypeMirror();
      const pasted = 'Ronaldinho Gaúcho '.repeat(5).trim().slice(0, 80);
      expect(Array.from(pasted).length).toBe(80);
      const step = mirror.sync(pasted);
      expect(step!.backspaces).toBe(0);
      expect(TypeMirror.plan(step!).tasks.length).toBe(80);
      expect(mirror.guestText).toBe(pasted);
    });
  });

  describe('a pasted control character', () => {

    // An <input type=text> strips only CR and LF from a paste, so a tab-separated note arrives with its Tabs.
    it('types a Tab as the space it looks like, and never presses the key', () => {
      const mirror = new TypeMirror();
      const step = mirror.sync('Zé\tSilva');
      expect(line(step)).toBe('Z alt233 _ S i l v a');
      expect(mirror.guestText).toBe('Zé Silva');
    });

    it('does the same for the line and paragraph separators, which the planner would turn into Enter', () => {
      const mirror = new TypeMirror();
      expect(line(mirror.sync('Zé\u2028Silva'))).toBe('Z alt233 _ S i l v a');
      mirror.reset();
      expect(line(mirror.sync('Zé\u2029Silva'))).toBe('Z alt233 _ S i l v a');
      mirror.reset();
      expect(line(mirror.sync('a\bb'))).toBe('a _ b');
    });

    it('holds a trailing one back like any other space', () => {
      const mirror = new TypeMirror();
      expect(line(mirror.sync('Zé\t'))).toBe('Z alt233');
      expect(line(mirror.sync('Zé\tR'))).toBe('_ R');
    });

    it('lets the next value of the same field find the same text, so nothing is retyped', () => {
      const mirror = new TypeMirror();
      mirror.sync('Zé\tSilva');
      expect(mirror.sync('Zé\tSilva')).toBeNull();
      expect(line(mirror.sync('Zé\tSilvas'))).toBe('s');
    });
  });

  describe('reset', () => {

    it('forgets the guest, so the next value is all new', () => {
      const mirror = new TypeMirror();
      mirror.sync('Zé');
      mirror.reset();
      expect(mirror.isEmpty).toBeTrue();
      expect(mirror.sync('Zé')).toEqual({ backspaces: 0, text: 'Zé' });
    });
  });

  describe('settled', () => {

    it('is NFC code points without the trailing spaces', () => {
      expect(TypeMirror.settled('ãb  ')).toEqual(['ã', 'b']);
      expect(TypeMirror.settled('')).toEqual([]);
    });
  });
});
