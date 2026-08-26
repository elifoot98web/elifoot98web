import { Component, Input } from '@angular/core';
import { map, Observable } from 'rxjs';
import { MultiplayerUserRole, PlayerInfo } from 'src/app/core/models/multiplayer';
import { MultiplayerPlayerInfoService } from 'src/app/core/services/multiplayer';
import { selfId } from 'trystero';

/**
 * The room roster, as a Win9x contact listing.
 *
 * Extracted from the participants modal so the chat's contact strip renders the same rows
 * from the same source of truth. Row chrome lives in src/theme/_win9x.scss as `.win9x-roster-*`.
 */
@Component({
  selector: 'app-participant-list',
  templateUrl: './participant-list.component.html',
  styleUrls: ['./participant-list.component.scss'],
  standalone: false
})
export class ParticipantListComponent {
  MultiplayerUserRole = MultiplayerUserRole;

  /** Tighter rows and no latency figure, for the 320px-wide chat panel. */
  @Input() compact = false;

  /** Host first, then guests by name, so the list does not reshuffle on every ping. */
  players$: Observable<PlayerInfo[]>;

  constructor(private playerInfoService: MultiplayerPlayerInfoService) {
    this.players$ = this.playerInfoService.playerList$.pipe(
      map(players => [...players].sort((a, b) => {
        if (a.role !== b.role) return a.role === MultiplayerUserRole.HOST ? -1 : 1;
        return a.playerName.localeCompare(b.playerName);
      }))
    );
  }

  /**
   * Latency is -1 until the first ping round completes, and 0 for the local player. A peer
   * whose link went bad keeps its last measured number, so the state has to be read from
   * `quality` rather than inferred from the figure.
   */
  latencyLabel(player: PlayerInfo): string {
    if (player.peerId === selfId) return 'você';
    if (player.quality === 'lost') return 'sem resposta';
    if (player.latency < 0) return 'medindo…';
    return `${Math.round(player.latency)} ms`;
  }

  /**
   * The bands themselves live in `MULTIPLAYER.PING_*` and are applied by
   * `MultiplayerPlayerInfoService`, so the roster, the pill and the instability notice
   * cannot disagree about what "poor" means. This only maps health onto a colour.
   */
  latencyColor(player: PlayerInfo): string {
    if (player.peerId === selfId) return 'medium';
    switch (player.quality) {
      case 'good': return 'success';
      case 'fair': return 'warning';
      case 'poor':
      case 'lost': return 'danger';
      case 'unknown': return 'medium';
    }
  }

  /** Spoken form of the link state, for the compact rows that drop the visible figure. */
  qualityLabel(player: PlayerInfo): string {
    if (player.peerId === selfId) return 'você';
    switch (player.quality) {
      case 'good': return 'conexão boa';
      case 'fair': return 'conexão razoável';
      case 'poor': return 'conexão instável';
      case 'lost': return 'sem resposta';
      case 'unknown': return 'medindo a conexão';
    }
  }

  trackByPeerId(_: number, player: PlayerInfo) {
    return player.peerId;
  }
}
