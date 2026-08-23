import { Injectable } from '@angular/core';
import { MULTIPLAYER, STORAGE_KEY } from '../../models/constants';
import { LocalStorageService } from '../shared';

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
   * Picking at random rather than always defaulting to the first colour means two
   * players who never touch the picker still usually get distinguishable cursors.
   */
  private randomColor(): string {
    const palette = MULTIPLAYER.PLAYER_COLORS;
    const [randomValue] = crypto.getRandomValues(new Uint32Array(1));
    return palette[randomValue % palette.length];
  }
}
