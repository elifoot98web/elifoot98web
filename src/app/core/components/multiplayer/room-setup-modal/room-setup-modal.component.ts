import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular/lazy';
import { MULTIPLAYER } from 'src/app/core/models/constants';
import { RoomCodeHelper } from 'src/app/core/helpers/room-code.helper';
import { QuickHostHelper } from 'src/app/core/helpers/quick-host.helper';
import { MultiplayerIdentityService } from 'src/app/core/services/multiplayer';

export interface RoomSetupResult {
  playerName: string;
  roomCode: string;
  password: string;
  playerColor: string;
  /** Host only: how many spectators the room accepts. Absent for a guest. */
  maxSpectators?: number;
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
  /** Opens the guide at the multiplayer chapter. Lent by the page that carries the guide; without it the title bar has no "?". */
  @Input() help?: () => void;

  colors = MULTIPLAYER.PLAYER_COLORS;

  /** 1 to the ceiling, offered as buttons: six choices do not need a stepper or a select. */
  spectatorLimits = Array.from(
    { length: MULTIPLAYER.MAX_SPECTATORS - MULTIPLAYER.MIN_SPECTATORS + 1 },
    (_, i) => MULTIPLAYER.MIN_SPECTATORS + i
  );
  maxSpectators = MULTIPLAYER.DEFAULT_MAX_SPECTATORS;

  /**
   * The host's short form is showing: "Transmitir agora" and a line that says what it will do. "Alterar" opens the whole form, and
   * a guest has it from the start.
   */
  expanded = false;
  /**
   * The name is asked for on the short form: the host has none remembered. Decided once, when the dialog opens, and not from what
   * is typed, or the field would vanish under the first letter.
   */
  askName = false;
  /** The remembered name, colour and limit have been read: until then the short form would flash an empty identity. */
  loaded = false;

  playerName = '';
  roomCode = '';
  password = '';
  playerColor = MULTIPLAYER.DEFAULT_CURSOR_COLOR;

  constructor(
    private modalController: ModalController,
    private identityService: MultiplayerIdentityService
  ) { }

  /**
   * Rooms this device has joined before, offered as one-tap fills.
   *
   * They live here rather than on the join page so that a single surface owns joining: the
   * guest used to meet an inline code field on the card AND this dialog, which read as two
   * different apps disagreeing about where you type a room code. Guest-only — a host is
   * creating a room, not returning to one.
   */
  recentRooms: string[] = [];

  async ngOnInit() {
    this.playerName = await this.identityService.getPlayerName();
    this.playerColor = await this.identityService.getPlayerColor();
    this.askName = QuickHostHelper.needsName(this.playerName);
    // A host gets a fresh code to hand out; a guest gets whatever the share link carried.
    this.roomCode = this.presetRoomCode
      ? RoomCodeHelper.sanitize(this.presetRoomCode)
      : (this.mode === 'host' ? RoomCodeHelper.generate() : '');

    if (this.isHost) {
      this.maxSpectators = await this.identityService.getMaxSpectators();
    } else {
      this.recentRooms = await this.identityService.getRecentRooms();
    }
    this.loaded = true;
  }

  get isHost(): boolean {
    return this.mode === 'host';
  }

  get title(): string {
    return this.isHost ? 'Criar Sala Multiplayer' : 'Entrar em Sala Multiplayer';
  }

  /** What "Transmitir agora" will do: the code, whether there is a password, how many may watch. Never the password. */
  get summary(): string {
    return QuickHostHelper.summary({ roomCode: this.roomCode, hasPassword: this.password.length > 0, maxSpectators: this.maxSpectators });
  }

  get identity(): string {
    return QuickHostHelper.identity(this.playerName);
  }

  expand() {
    this.expanded = true;
  }

  showHelp() {
    this.help?.();
  }

  get isValid(): boolean {
    return this.playerName.trim().length > 0 && RoomCodeHelper.isValid(this.roomCode);
  }

  /**
   * A malformed code is only worth pointing out to a guest, who typed or pasted it.
   * A host's code comes from the generator and is corrected on blur.
   */
  get showCodeError(): boolean {
    return !this.isHost && this.roomCode.trim().length > 0 && !RoomCodeHelper.isValid(this.roomCode);
  }

  /**
   * Sanitizing on blur rather than on every keystroke: rewriting the value through
   * ngModel while typing fights ion-input's internal value and jumps the caret to the
   * end, which is worst on mobile. A pasted share link is reduced to its code here.
   */
  onCodeBlur() {
    const sanitized = RoomCodeHelper.sanitize(this.roomCode);
    if (sanitized) this.roomCode = sanitized;
  }

  /** Fill the field from history rather than making them retype a code they already used. */
  useRecentRoom(code: string) {
    this.roomCode = RoomCodeHelper.sanitize(code);
  }

  regenerateCode() {
    this.roomCode = RoomCodeHelper.generate();
  }

  selectColor(color: string) {
    this.playerColor = color;
  }

  selectSpectatorLimit(limit: number) {
    this.maxSpectators = limit;
  }

  async confirm() {
    this.onCodeBlur(); // covers submitting straight from the field without blurring
    if (!this.isValid) return;

    await this.identityService.save(this.playerName.trim(), this.playerColor);
    if (this.isHost) await this.identityService.saveMaxSpectators(this.maxSpectators);

    const result: RoomSetupResult = {
      playerName: this.playerName.trim(),
      roomCode: RoomCodeHelper.normalize(this.roomCode),
      password: this.password,
      playerColor: this.playerColor,
      ...(this.isHost ? { maxSpectators: this.maxSpectators } : {}),
    };
    await this.modalController.dismiss(result, 'confirm');
  }

  async cancel() {
    await this.modalController.dismiss(null, 'cancel');
  }
}
