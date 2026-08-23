import { Component } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { map, Observable } from 'rxjs';
import { MultiplayerUserRole, PlayerInfo } from 'src/app/core/models/multiplayer';
import { MultiplayerPlayerInfoService } from 'src/app/core/services/multiplayer';
import { selfId } from 'trystero';

@Component({
  selector: 'app-participants-modal',
  templateUrl: './participants-modal.component.html',
  styleUrls: ['./participants-modal.component.scss'],
  standalone: false
})
export class ParticipantsModalComponent {
  MultiplayerUserRole = MultiplayerUserRole;
  selfId = selfId;

  /** Host first, then guests by name, so the list does not reshuffle on every ping. */
  players$: Observable<PlayerInfo[]>;

  constructor(
    private modalController: ModalController,
    private playerInfoService: MultiplayerPlayerInfoService
  ) {
    this.players$ = this.playerInfoService.playerList$.pipe(
      map(players => [...players].sort((a, b) => {
        if (a.role !== b.role) return a.role === MultiplayerUserRole.HOST ? -1 : 1;
        return a.playerName.localeCompare(b.playerName);
      }))
    );
  }

  /**
   * Latency is -1 until the first ping round completes, and 0 for the local player.
   */
  latencyLabel(player: PlayerInfo): string {
    if (player.peerId === selfId) return 'você';
    if (player.latency < 0) return 'medindo…';
    return `${Math.round(player.latency)} ms`;
  }

  latencyColor(player: PlayerInfo): string {
    if (player.peerId === selfId || player.latency < 0) return 'medium';
    if (player.latency < 150) return 'success';
    if (player.latency < 400) return 'warning';
    return 'danger';
  }

  trackByPeerId(_: number, player: PlayerInfo) {
    return player.peerId;
  }

  async close() {
    await this.modalController.dismiss();
  }
}
