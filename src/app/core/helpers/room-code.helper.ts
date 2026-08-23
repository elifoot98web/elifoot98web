import { MULTIPLAYER } from '../models/constants';

/**
 * Room codes are typed and read aloud by players, so they avoid characters that are
 * easily confused (O/0, I/1) and are always compared in upper case.
 */
export class RoomCodeHelper {
  static generate(): string {
    const alphabet = MULTIPLAYER.ROOM_CODE_ALPHABET;
    const randomValues = new Uint32Array(MULTIPLAYER.ROOM_CODE_LENGTH);
    crypto.getRandomValues(randomValues);

    const code = Array.from(randomValues, value => alphabet[value % alphabet.length]).join('');
    return `${MULTIPLAYER.ROOM_CODE_PREFIX}${code}`;
  }

  static normalize(code: string): string {
    return code.trim().toLocaleUpperCase();
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
