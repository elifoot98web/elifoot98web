import { MULTIPLAYER } from '../models/constants';

/**
 * Room codes are typed, pasted and read aloud by players, so they avoid characters
 * that are easily confused (O/0, I/1) and are always compared in upper case.
 */
export class RoomCodeHelper {
  private static get body(): RegExp {
    return new RegExp(`^[${MULTIPLAYER.ROOM_CODE_ALPHABET}]{${MULTIPLAYER.ROOM_CODE_LENGTH}}$`);
  }

  static generate(): string {
    const alphabet = MULTIPLAYER.ROOM_CODE_ALPHABET;
    const randomValues = new Uint32Array(MULTIPLAYER.ROOM_CODE_LENGTH);
    crypto.getRandomValues(randomValues);

    const code = Array.from(randomValues, value => alphabet[value % alphabet.length]).join('');
    return `${MULTIPLAYER.ROOM_CODE_PREFIX}${code}`;
  }

  /**
   * Coerce arbitrary user input into the canonical `ELI-XXXX` shape, as far as the
   * input allows. Accepts a bare code, a prefixed code, or a full share link.
   *
   * `toUpperCase`, not `toLocaleUpperCase`: under a Turkish locale the latter maps
   * `i` to a dotted capital that is not in the alphabet.
   */
  static sanitize(input: string): string {
    const fromLink = this.parse(input);
    const raw = (fromLink ?? input).trim().toUpperCase();

    // Strip any existing prefix before re-applying it, or a pasted `ELI-ABCD` would
    // sanitize to `ELI-ELIABCD`.
    const withoutPrefix = raw.replace(/^ELI-?/, '');
    const body = withoutPrefix
      .split('')
      .filter(char => MULTIPLAYER.ROOM_CODE_ALPHABET.includes(char))
      .join('')
      .slice(0, MULTIPLAYER.ROOM_CODE_LENGTH);

    return body ? `${MULTIPLAYER.ROOM_CODE_PREFIX}${body}` : '';
  }

  /**
   * Pull a room code out of a pasted share link. Returns undefined when the input
   * carries no `room` parameter, so callers can fall back to treating it as a code.
   */
  static parse(input: string): string | undefined {
    const match = input.match(/[?&]room=([^&\s]+)/i);
    if (!match) return undefined;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  static isValid(code: string): boolean {
    const raw = code.trim().toUpperCase();
    if (!raw.startsWith(MULTIPLAYER.ROOM_CODE_PREFIX)) return false;
    return this.body.test(raw.slice(MULTIPLAYER.ROOM_CODE_PREFIX.length));
  }

  static normalize(code: string): string {
    return code.trim().toUpperCase();
  }

  /**
   * Build a shareable join link for a room. The password is deliberately left out:
   * links get pasted into public group chats.
   */
  static buildJoinLink(code: string): string {
    const { origin, pathname } = window.location;
    return `${origin}${pathname}#/join-game?room=${encodeURIComponent(this.normalize(code))}`;
  }
}
