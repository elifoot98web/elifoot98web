import { MULTIPLAYER } from '../models/constants';
import { RoomCodeHelper } from './room-code.helper';

const ALPHABET = MULTIPLAYER.ROOM_CODE_ALPHABET;
const PREFIX = MULTIPLAYER.ROOM_CODE_PREFIX;
const LENGTH = MULTIPLAYER.ROOM_CODE_LENGTH;

/** A body of the right length that is made only of alphabet characters. */
const BODY = ALPHABET.slice(0, LENGTH);
const CODE = `${PREFIX}${BODY}`;

/**
 * Replace `crypto.getRandomValues` with one that fills the buffer from `values`, so the
 * mapping from random words to alphabet characters can be asserted exactly.
 */
function stubRandomValues(values: number[]): void {
  spyOn(crypto, 'getRandomValues').and.callFake(((array: Uint32Array) => {
    array.set(values.slice(0, array.length));
    return array;
  }) as typeof crypto.getRandomValues);
}

describe('RoomCodeHelper', () => {

  describe('alphabet', () => {
    // The sanitiser strips a leading `ELI` and the docs promise players cannot confuse
    // O/0 or I/1 when reading a code aloud. Both rest on these characters being absent:
    // an `I` in the alphabet would let a body start with `ELI` and be eaten as a prefix.
    it('leaves out the characters that are easily confused', () => {
      for (const confusable of ['O', '0', 'I', '1']) {
        expect(ALPHABET).not.toContain(confusable);
      }
    });

    it('is upper case only, because codes are compared in upper case', () => {
      expect(ALPHABET).toBe(ALPHABET.toUpperCase());
    });

    it('has no repeated characters', () => {
      expect(new Set(ALPHABET.split('')).size).toBe(ALPHABET.length);
    });
  });

  describe('generate', () => {
    it('maps each random word to an alphabet character by modulo', () => {
      // Words far beyond the alphabet length, so a missing `%` would index past the end.
      const words = Array.from({ length: LENGTH }, (_, i) => ALPHABET.length * 1000 + i);
      stubRandomValues(words);

      const expectedBody = words.map(word => ALPHABET[word % ALPHABET.length]).join('');
      expect(RoomCodeHelper.generate()).toBe(`${PREFIX}${expectedBody}`);
    });

    it('covers the whole alphabet, first to last character', () => {
      stubRandomValues([0, ALPHABET.length - 1]);

      const body = RoomCodeHelper.generate().slice(PREFIX.length);
      expect(body[0]).toBe(ALPHABET[0]);
      expect(body[1]).toBe(ALPHABET[ALPHABET.length - 1]);
    });

    it('always produces a code the app itself accepts and would not rewrite', () => {
      for (let i = 0; i < 500; i++) {
        const code = RoomCodeHelper.generate();

        expect(code.startsWith(PREFIX)).toBeTrue();
        expect(code.length).toBe(PREFIX.length + LENGTH);
        expect(RoomCodeHelper.isValid(code)).withContext(code).toBeTrue();
        expect(RoomCodeHelper.sanitize(code)).withContext(code).toBe(code);
      }
    });
  });

  describe('parse', () => {
    it('returns undefined when there is no room parameter', () => {
      expect(RoomCodeHelper.parse('')).toBeUndefined();
      expect(RoomCodeHelper.parse(CODE)).toBeUndefined();
      expect(RoomCodeHelper.parse('https://host/app/#/join-game')).toBeUndefined();
      expect(RoomCodeHelper.parse('https://host/app/#/join-game?room=')).toBeUndefined();
    });

    it('finds the parameter first, last or in the middle of the query', () => {
      expect(RoomCodeHelper.parse(`#/join-game?room=${CODE}`)).toBe(CODE);
      expect(RoomCodeHelper.parse(`#/join-game?room=${CODE}&x=1`)).toBe(CODE);
      expect(RoomCodeHelper.parse(`#/join-game?x=1&room=${CODE}&y=2`)).toBe(CODE);
    });

    it('stops at whitespace, so a link pasted inside a sentence yields only the code', () => {
      expect(RoomCodeHelper.parse(`entra aqui: https://host/#/join-game?room=${CODE} valeu!`)).toBe(CODE);
    });

    it('matches the parameter name case-insensitively but hands the value back untouched', () => {
      expect(RoomCodeHelper.parse('?ROOM=eli-abcd')).toBe('eli-abcd');
    });

    it('does not mistake a parameter that merely ends in "room" for the room', () => {
      expect(RoomCodeHelper.parse(`?bedroom=${CODE}`)).toBeUndefined();
    });

    it('decodes percent-escapes', () => {
      expect(RoomCodeHelper.parse('?room=ELI%2DABCD')).toBe('ELI-ABCD');
    });

    it('returns the raw value instead of throwing on a malformed escape', () => {
      expect(() => RoomCodeHelper.parse('?room=ELI-%E0%A4%A')).not.toThrow();
      expect(RoomCodeHelper.parse('?room=ELI-%E0%A4%A')).toBe('ELI-%E0%A4%A');
    });
  });

  describe('sanitize', () => {
    it('upper-cases and prefixes a bare code', () => {
      expect(RoomCodeHelper.sanitize(BODY.toLowerCase())).toBe(CODE);
    });

    it('accepts an already prefixed code in any case, with or without the dash', () => {
      expect(RoomCodeHelper.sanitize(CODE)).toBe(CODE);
      expect(RoomCodeHelper.sanitize(CODE.toLowerCase())).toBe(CODE);
      expect(RoomCodeHelper.sanitize(`${PREFIX.replace('-', '')}${BODY}`)).toBe(CODE);
    });

    it('trims surrounding whitespace', () => {
      expect(RoomCodeHelper.sanitize(`  ${CODE}\n`)).toBe(CODE);
    });

    it('extracts the code from a full share link', () => {
      expect(RoomCodeHelper.sanitize(`https://host/app/#/join-game?room=${CODE}`)).toBe(CODE);
      expect(RoomCodeHelper.sanitize(`https://host/app/#/join-game?room=${CODE.toLowerCase()}&x=1`)).toBe(CODE);
      expect(RoomCodeHelper.sanitize(`?room=${CODE.replace('-', '%2D')}`)).toBe(CODE);
    });

    it('drops characters outside the alphabet', () => {
      expect(RoomCodeHelper.sanitize(`${PREFIX}${BODY[0]}-${BODY[1]} ${BODY[2]}!${BODY[3]}`)).toBe(CODE);
      // The confusable characters are not in the alphabet, so they vanish rather than
      // being "corrected" to O/I: the player typed something that cannot be a code.
      expect(RoomCodeHelper.sanitize(`${PREFIX}${BODY[0]}0O1I${BODY[1]}`)).toBe(`${PREFIX}${BODY[0]}${BODY[1]}`);
    });

    it('cuts the body at the code length', () => {
      expect(RoomCodeHelper.sanitize(`${CODE}${ALPHABET}`)).toBe(CODE);
    });

    it('returns an empty string rather than a bare prefix when nothing usable is left', () => {
      expect(RoomCodeHelper.sanitize('')).toBe('');
      expect(RoomCodeHelper.sanitize('   ')).toBe('');
      expect(RoomCodeHelper.sanitize(PREFIX)).toBe('');
      expect(RoomCodeHelper.sanitize('0O1I')).toBe('');
    });

    it('is idempotent', () => {
      const inputs = [
        '', CODE, CODE.toLowerCase(), BODY, `${CODE}${CODE}`, `  eli-${BODY.slice(0, 2)}`,
        `https://host/#/join-game?room=${CODE}`, '?room=%E0%A4%A', '!!!',
      ];
      for (const input of inputs) {
        const once = RoomCodeHelper.sanitize(input);
        expect(RoomCodeHelper.sanitize(once)).withContext(JSON.stringify(input)).toBe(once);
      }
    });

    it('never throws on a malformed escape in a link', () => {
      expect(() => RoomCodeHelper.sanitize('?room=%E0%A4%A')).not.toThrow();
    });

    it('yields a valid code exactly when the input carried a complete one', () => {
      expect(RoomCodeHelper.isValid(RoomCodeHelper.sanitize(CODE))).toBeTrue();
      expect(RoomCodeHelper.isValid(RoomCodeHelper.sanitize(CODE.slice(0, -1)))).toBeFalse();
    });
  });

  describe('isValid', () => {
    it('accepts a prefixed code of the right length', () => {
      expect(RoomCodeHelper.isValid(CODE)).toBeTrue();
    });

    it('is case- and whitespace-insensitive', () => {
      expect(RoomCodeHelper.isValid(CODE.toLowerCase())).toBeTrue();
      expect(RoomCodeHelper.isValid(` ${CODE} `)).toBeTrue();
    });

    it('rejects a missing prefix', () => {
      expect(RoomCodeHelper.isValid(BODY)).toBeFalse();
    });

    it('rejects a body that is too short or too long', () => {
      expect(RoomCodeHelper.isValid(CODE.slice(0, -1))).toBeFalse();
      expect(RoomCodeHelper.isValid(`${CODE}${BODY[0]}`)).toBeFalse();
    });

    it('rejects characters outside the alphabet', () => {
      expect(RoomCodeHelper.isValid(`${PREFIX}${BODY.slice(0, -1)}0`)).toBeFalse();
      expect(RoomCodeHelper.isValid(`${PREFIX}${BODY.slice(0, -1)}O`)).toBeFalse();
      expect(RoomCodeHelper.isValid(`${PREFIX}${BODY.slice(0, -1)}-`)).toBeFalse();
    });

    it('rejects the empty string and the bare prefix', () => {
      expect(RoomCodeHelper.isValid('')).toBeFalse();
      expect(RoomCodeHelper.isValid(PREFIX)).toBeFalse();
    });

    it('is not fooled by a full share link, which sanitize must unwrap first', () => {
      expect(RoomCodeHelper.isValid(`https://host/#/join-game?room=${CODE}`)).toBeFalse();
    });
  });

  describe('normalize', () => {
    it('trims and upper-cases without otherwise touching the text', () => {
      expect(RoomCodeHelper.normalize(`  ${CODE.toLowerCase()}\t`)).toBe(CODE);
      expect(RoomCodeHelper.normalize('abc def')).toBe('ABC DEF');
    });
  });

  describe('buildJoinLink', () => {
    it('points at the join route of the page that is running, with the code normalised', () => {
      const { origin, pathname } = window.location;
      expect(RoomCodeHelper.buildJoinLink(` ${CODE.toLowerCase()} `))
        .toBe(`${origin}${pathname}#/join-game?room=${CODE}`);
    });

    it('survives a round trip through parse and sanitize', () => {
      const link = RoomCodeHelper.buildJoinLink(CODE);

      expect(RoomCodeHelper.parse(link)).toBe(CODE);
      expect(RoomCodeHelper.sanitize(link)).toBe(CODE);
    });

    it('escapes the code, so odd input cannot add a second query parameter', () => {
      const link = RoomCodeHelper.buildJoinLink('abc&password=x');

      expect(link).toContain('room=ABC%26PASSWORD%3DX');
      expect(link.split('?')[1]).not.toContain('&');
    });
  });
});
