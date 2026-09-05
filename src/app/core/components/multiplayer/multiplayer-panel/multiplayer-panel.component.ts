import { Component, Input } from '@angular/core';
import { ModalController } from '@ionic/angular/lazy';
import { map, Observable } from 'rxjs';
import { MultiplayerPlayerInfoService } from 'src/app/core/services/multiplayer';

/** What the caller should do once the panel closes. */
export type MultiplayerPanelAction = 'copy' | 'share' | 'leave' | 'close';

/**
 * One window for everything about the current room.
 *
 * Replaces three separate popover entries (Compartilhar sala / Participantes / Chat) and
 * absorbs the old participants modal: presence, the code, and the two things you might want
 * to do about them were spread across a 13-item menu and a modal reached from it.
 *
 * Dismisses with an action rather than calling back into a page: both pages host it, and
 * neither's internals belong in here.
 */
@Component({
  selector: 'app-multiplayer-panel',
  templateUrl: './multiplayer-panel.component.html',
  styleUrls: ['./multiplayer-panel.component.scss'],
  standalone: false
})
export class MultiplayerPanelComponent {
  @Input() mode: 'host' | 'guest' = 'host';
  @Input() roomCode = '';
  @Input() locked = false;

  count$: Observable<number>;

  constructor(
    private modalController: ModalController,
    playerInfoService: MultiplayerPlayerInfoService
  ) {
    this.count$ = playerInfoService.playerList$.pipe(map(players => players.length));
  }

  get isHost(): boolean {
    return this.mode === 'host';
  }

  get leaveLabel(): string {
    return this.isHost ? 'Encerrar sala' : 'Sair da sala';
  }

  async close(action: MultiplayerPanelAction = 'close') {
    await this.modalController.dismiss(undefined, action);
  }
}
