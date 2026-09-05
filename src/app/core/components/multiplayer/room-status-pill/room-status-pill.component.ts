import { Component, Input } from '@angular/core';
import { map, Observable } from 'rxjs';
import { MultiplayerPlayerInfoService } from 'src/app/core/services/multiplayer';
import { MultiplayerUiService } from 'src/app/core/services/multiplayer';

/** What the broadcast dot is saying. */
export type RoomStatusState = 'live' | 'reconnecting';

/**
 * The ambient answer to "am I still live, in which room, locked, with how many people".
 *
 * Deliberately NOT Win9x, unlike the chat and the modals: this renders inside the page
 * toolbar, which the retro boundary rule in CLAUDE.md keeps as app shell. The landscape
 * instance rides the game surface but keeps the same flat look, because one component
 * changing identity by position would read as a bug.
 */
@Component({
  selector: 'app-room-status-pill',
  templateUrl: './room-status-pill.component.html',
  styleUrls: ['./room-status-pill.component.scss'],
  standalone: false
})
export class RoomStatusPillComponent {
  /** The room code, shown verbatim so it can be read out loud. */
  @Input() roomCode = '';

  /** Whether the room has a password. */
  @Input() locked = false;

  @Input() state: RoomStatusState = 'live';

  /** Shown to spectators, who care whose game this is. Omitted on the host. */
  @Input() hostName = '';

  /** Drops the count and the host name, for the narrow landscape gutter. */
  @Input() compact = false;

  /** Live roster size, self included — the same source the chat's titlebar counts from. */
  count$: Observable<number>;

  constructor(
    private playerInfoService: MultiplayerPlayerInfoService,
    private multiplayerUiService: MultiplayerUiService
  ) {
    this.count$ = this.playerInfoService.playerList$.pipe(map(players => players.length));
  }

  /**
   * Carries everything the compact variant drops visually, so nothing is conveyed by
   * position or colour alone.
   */
  ariaLabel(count: number): string {
    const parts = [
      this.state === 'reconnecting' ? 'Reconectando' : 'Transmitindo',
      `sala ${this.roomCode}`,
      this.locked ? 'com senha' : 'sem senha',
      count === 1 ? '1 pessoa na sala' : `${count} pessoas na sala`
    ];
    if (this.hostName) parts.push(`anfitrião ${this.hostName}`);
    return `${parts.join(', ')}. Toque para copiar o link.`;
  }

  /**
   * The code must never be recoverable only from a toast that has already expired.
   *
   * Copies rather than opening the share sheet: this is an ambient indicator, and a tap on it
   * should do one predictable thing on every platform. The panel offers explicit
   * Copiar/Compartilhar buttons where a share sheet is what you expect.
   */
  async copyLink() {
    if (!this.roomCode) return;
    await this.multiplayerUiService.copyRoomLink(this.roomCode);
  }
}
