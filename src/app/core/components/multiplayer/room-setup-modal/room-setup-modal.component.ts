import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { MULTIPLAYER } from 'src/app/core/models/constants';
import { RoomCodeHelper } from 'src/app/core/helpers/room-code.helper';
import { MultiplayerIdentityService } from 'src/app/core/services/multiplayer';

export interface RoomSetupResult {
  playerName: string;
  roomCode: string;
  password: string;
  playerColor: string;
}

/**
 * Single form used both to create a room (host) and to enter one (guest). Replaces the
 * two bare alert dialogs so the colour picker and the generated room code have somewhere
 * to live, and so the name/colour can be remembered between sessions.
 */
@Component({
  selector: 'app-room-setup-modal',
  templateUrl: './room-setup-modal.component.html',
  styleUrls: ['./room-setup-modal.component.scss'],
  standalone: false
})
export class RoomSetupModalComponent implements OnInit {
  @Input() mode: 'host' | 'guest' = 'guest';
  /** Room code prefilled from a share link, when the guest arrived via one. */
  @Input() presetRoomCode = '';

  colors = MULTIPLAYER.PLAYER_COLORS;

  playerName = '';
  roomCode = '';
  password = '';
  playerColor = MULTIPLAYER.DEFAULT_CURSOR_COLOR;

  constructor(
    private modalController: ModalController,
    private identityService: MultiplayerIdentityService
  ) { }

  async ngOnInit() {
    this.playerName = await this.identityService.getPlayerName();
    this.playerColor = await this.identityService.getPlayerColor();
    // A host gets a fresh code to hand out; a guest gets whatever the share link carried.
    this.roomCode = this.presetRoomCode || (this.mode === 'host' ? RoomCodeHelper.generate() : '');
  }

  get isHost(): boolean {
    return this.mode === 'host';
  }

  get title(): string {
    return this.isHost ? 'Criar Sala Multiplayer' : 'Entrar em Sala Multiplayer';
  }

  get isValid(): boolean {
    return this.playerName.trim().length > 0 && this.roomCode.trim().length > 0;
  }

  regenerateCode() {
    this.roomCode = RoomCodeHelper.generate();
  }

  selectColor(color: string) {
    this.playerColor = color;
  }

  async confirm() {
    if (!this.isValid) return;

    await this.identityService.save(this.playerName.trim(), this.playerColor);

    const result: RoomSetupResult = {
      playerName: this.playerName.trim(),
      roomCode: RoomCodeHelper.normalize(this.roomCode),
      password: this.password,
      playerColor: this.playerColor,
    };
    await this.modalController.dismiss(result, 'confirm');
  }

  async cancel() {
    await this.modalController.dismiss(null, 'cancel');
  }
}
