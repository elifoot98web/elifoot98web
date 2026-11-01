import { Component, Input } from '@angular/core';
import { map, Observable } from 'rxjs';
import { MultiplayerUserRole, PlayerInfo } from 'src/app/core/models/multiplayer';
import { MultiplayerPlayerInfoService } from 'src/app/core/services/multiplayer';
import { selfId } from 'trystero';

/** One rendered row: the player plus everything the template would otherwise compute. */
interface RosterRow {
  player: PlayerInfo;
  isSelf: boolean;
  name: string;
  /** A short peer-id suffix, present only when another row shows the same name. */
  disambiguator: string;
}

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
  players$: Observable<RosterRow[]>;

  constructor(private playerInfoService: MultiplayerPlayerInfoService) {
    this.players$ = this.playerInfoService.playerList$.pipe(
      map(players => [...players].sort((a, b) => {
        if (a.role !== b.role) return a.role === MultiplayerUserRole.HOST ? -1 : 1;
        return a.playerName.localeCompare(b.playerName);
      })),
      map(players => this.toRows(players))
    );
  }

  /**
   * Nothing stops two people picking the same nickname, or the same cursor colour, or both —
   * the setup dialog validates neither, and a room where two rows read "Leo" in the same
   * yellow is unreadable. Rather than rejecting duplicates at entry (which would mean telling
   * someone their name is taken in a four-person room), the roster disambiguates on display:
   * a short peer-id suffix is appended, but only to the rows that actually collide.
   */
  private toRows(players: PlayerInfo[]): RosterRow[] {
    const nameCounts = new Map<string, number>();
    for (const player of players) {
      const key = this.displayName(player).toLocaleLowerCase();
      nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
    }

    return players.map(player => {
      const name = this.displayName(player);
      const collides = (nameCounts.get(name.toLocaleLowerCase()) || 0) > 1;
      return {
        player,
        isSelf: player.peerId === selfId,
        name,
        // Only rendered when it earns its place.
        disambiguator: collides ? `#${player.peerId.slice(0, 4)}` : ''
      };
    });
  }

  private displayName(player: PlayerInfo): string {
    return player.playerName?.trim() || player.peerId.slice(0, 6);
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

  trackByPeerId(_: number, row: RosterRow) {
    return row.player.peerId;
  }
}
