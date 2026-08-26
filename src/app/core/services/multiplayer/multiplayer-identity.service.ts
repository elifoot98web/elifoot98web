import { Injectable } from '@angular/core';
import { MULTIPLAYER, STORAGE_KEY } from '../../models/constants';
import { LocalStorageService } from '../shared';

/** Enough to cover "the room I was in yesterday" without becoming a list to scroll. */
const MAX_RECENT_ROOMS = 4;

/**
 * Remembers who the player is between sessions, so joining a room does not mean
 * retyping a name every time. The colour is the player's identity in the cursor
 * overlay and the participants roster, so both roles need it before joining.
 */
@Injectable({
  providedIn: 'root'
})
export class MultiplayerIdentityService {
  constructor(private storageService: LocalStorageService) { }

  async getPlayerName(): Promise<string> {
    return await this.storageService.get<string>(STORAGE_KEY.PLAYER_NAME) || '';
  }

  async getPlayerColor(): Promise<string> {
    const stored = await this.storageService.get<string>(STORAGE_KEY.PLAYER_COLOR);
    return stored || this.randomColor();
  }

  async save(playerName: string, playerColor: string): Promise<void> {
    await this.storageService.set(STORAGE_KEY.PLAYER_NAME, playerName);
    await this.storageService.set(STORAGE_KEY.PLAYER_COLOR, playerColor);
  }

  /**
   * Room codes this device has joined, most recent first.
   *
   * Codes only, deliberately. A share link omits the password on purpose, and the same
   * reasoning applies harder to disk: a remembered password would turn a shared device into a
   * way into someone else's room.
   */
  async getRecentRooms(): Promise<string[]> {
    return await this.storageService.get<string[]>(STORAGE_KEY.RECENT_ROOMS) || [];
  }

  async rememberRoom(roomCode: string): Promise<void> {
    const code = roomCode.trim().toUpperCase();
    if (!code) return;

    const existing = await this.getRecentRooms();
    // Re-joining an old room promotes it rather than duplicating it.
    const next = [code, ...existing.filter(entry => entry !== code)].slice(0, MAX_RECENT_ROOMS);
    await this.storageService.set(STORAGE_KEY.RECENT_ROOMS, next);
  }

  /**
   * Picking at random rather than always defaulting to the first colour means two
   * players who never touch the picker still usually get distinguishable cursors.
   */
  private randomColor(): string {
    const palette = MULTIPLAYER.PLAYER_COLORS;
    const [randomValue] = crypto.getRandomValues(new Uint32Array(1));
    return palette[randomValue % palette.length];
  }
}
