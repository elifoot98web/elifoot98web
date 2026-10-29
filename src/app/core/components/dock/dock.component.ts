import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, HostBinding, HostListener, Input, NgZone, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
import { AlertController } from '@ionic/angular/lazy';
import { Subscription } from 'rxjs';
import { DeckKey, DeckKeyHelper } from '../../helpers/deck-keys.helper';
import { DeckKeysPanel, DeckPanel, DeckPanelHelper, DeckPanelState } from '../../helpers/deck-panel.helper';
import { KeyRepeatScheduler, KeyRepeatTimers } from '../../helpers/key-repeat.helper';
import { Modifier, ModifierLatch } from '../../helpers/modifier-latch.helper';
import { ChatPanelHelper } from '../../helpers/chat-panel.helper';
import { DECK } from '../../models/constants';
import { EmulatorControlService, GuestKeyQueueService } from '../../services/game';
import { DiagnosticsService } from '../../services/shared';

/** How a press began, for the diagnostics log and for the haptics (a repeat does not buzz). */
type PressOrigin = 'tap' | 'repeat' | 'confirmed';

/**
 * The control deck: the keyboard of a phone playing a game that was made for one with keys. It
 * replaced three FAB clusters, the header's keyboard / text / O Matic buttons and js-dos's own
 * on-screen keyboard (19 px keys, over 60% of the picture), which were four copies of the same
 * handful of actions that collided with each other, with the header and with the chat.
 *
 * **It is a SIBLING of `#game-container`, never a child, and never over the picture.** js-dos
 * re-lays-out its canvas whenever that element changes size, and the cursor overlay and every
 * remote cursor are measured against it, so the deck gets no say in the picture's box: in
 * portrait the picture is already pinned to a 4:3 height (75vw) and the band under it is free, so
 * the `band` presentation fills that band and the picture's rect is the same with and without it
 * (measured at ten viewports). Landscape has no such band, so the `launcher` presentation is a
 * sheet that opens OVER the page and closes again; opening it resizes nothing.
 *
 * **What the page owns, and what this owns.** The page owns the chat (it mounts the panel above the
 * deck and keeps the open/closed state, the unread count and the focus), the compose dialog and the
 * O Matic, and hears about them through outputs. This owns the keys: it takes the emulator's
 * command interface as an input (threaded through like everywhere else, never kept), sends through
 * `EmulatorControlService` (so through GuestKeyQueueService, the only key sender), keeps the sticky
 * modifiers and the hold-to-repeat, and keeps no state that outlives it.
 *
 * Keycaps are `appDeckKey` buttons (DeckKeyDirective): pointerdown, no focus, one release. They
 * are disabled until the emulator exists, and while the key queue is faulted.
 *
 * The look is Win9x: `.deck-key` (the keycaps and the taskbar's buttons) and `.deck-face` (the
 * grey of the panels), with the few seams _deck.scss paints in the same tokens. A flat skin is a
 * CSS-only change (decision D3 asked for exactly that) and no markup or class here changes for it;
 * `grep -n 'win9x-' src/theme/_deck.scss` lists the layout sheet's share of it.
 */
@Component({
  selector: 'app-dock',
  templateUrl: './dock.component.html',
  styleUrls: ['./dock.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class DockComponent implements OnInit, OnChanges, OnDestroy {

  /** `band`: taskbar and panel under the picture. `launcher`: a sheet the page's button opens. */
  @Input() presentation: 'band' | 'launcher' = 'band';
  /** The emulator's command interface (`any`, as on the page); null until the game has booted. */
  @Input() dosCI: any = null;
  /** The page says no (it is leaving, or restarting). */
  @Input() disabled = false;
  /** The Vibração setting. The device still has to be able to. */
  @Input() vibrate = true;

  /** The chat is something the page has: whether there is a room, whether it is open, how many are unread. */
  @Input() chatAvailable = false;
  @Input() chatOpen = false;
  @Input() unread = 0;

  /** The launcher's sheet. Two-way: the page's button opens it and this one closes it. */
  @Input() sheetOpen = false;
  @Output() sheetOpenChange = new EventEmitter<boolean>();

  /** The chat button was tapped; the value is the state it asks for. */
  @Output() chatToggle = new EventEmitter<boolean>();
  @Output() textRequest = new EventEmitter<void>();
  @Output() omaticRequest = new EventEmitter<void>();
  /** A key could not be sent. The page words it and rate-limits it. */
  @Output() keyFailure = new EventEmitter<unknown>();

  readonly formations = DeckKeyHelper.formations();
  readonly shortcuts = DeckKeyHelper.tacticShortcuts();
  readonly arrows = DeckKeyHelper.arrows();
  readonly functionKeys = DeckKeyHelper.functionKeys();
  readonly keypad = DeckKeyHelper.keypad();
  readonly quit = DeckKeyHelper.quit();
  readonly space = DeckKeyHelper.byId('space');
  readonly backspace = DeckKeyHelper.byId('backspace');
  readonly del = DeckKeyHelper.byId('delete');
  readonly navigation = ['tab', 'shift-tab', 'page-up', 'page-down', 'home', 'end'].map(id => DeckKeyHelper.byId(id));
  readonly modifierKeys: ReadonlyArray<{ modifier: Modifier; label: string }> = [
    { modifier: 'shift', label: 'Shift' },
    { modifier: 'ctrl', label: 'Ctrl' },
    { modifier: 'alt', label: 'Alt' },
  ];
  readonly panels: ReadonlyArray<{ id: DeckKeysPanel; label: string; icon: string }> = [
    { id: 'tactics', label: 'Táticas', icon: 'football-outline' },
    { id: 'arrows', label: 'Setas', icon: 'game-controller-outline' },
  ];
  readonly chatPanelId = ChatPanelHelper.PANEL_ID;

  panelState: DeckPanelState = { keys: DeckPanelHelper.DEFAULT, chatOpen: false };
  readonly latch = new ModifierLatch();
  private faulted = false;
  private quitPromptOpen = false;

  private readonly repeats = new Map<string, KeyRepeatScheduler>();
  private readonly subscriptions = new Subscription();

  /**
   * Timers outside Angular's zone: a held arrow ticks eighteen times a second, and each tick would
   * otherwise be a change-detection pass over the whole app for a key that changes nothing on screen.
   */
  private readonly timers: KeyRepeatTimers = {
    setTimeout: (handler, ms) => this.zone.runOutsideAngular(() => setTimeout(handler, ms)),
    clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };

  constructor(
    private emulator: EmulatorControlService,
    private keyQueue: GuestKeyQueueService,
    private diagnostics: DiagnosticsService,
    private alertController: AlertController,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
  ) { }

  @HostBinding('class.deck-band') get isBand(): boolean {
    return this.presentation === 'band';
  }

  @HostBinding('class.deck-launcher') get isLauncher(): boolean {
    return this.presentation === 'launcher';
  }

  /** A panel of keys is up in the band, so the deck takes the band; with the chat or nothing up it is only the taskbar. */
  @HostBinding('class.deck-band--open') get isOpen(): boolean {
    return this.isBand && this.shownKeys !== null;
  }

  /** Keycaps work only with an emulator, a page that is not leaving, and a queue that is not faulted. */
  get keysDisabled(): boolean {
    return this.disabled || !this.dosCI || this.faulted;
  }

  /** The panel of keys on screen in the band: null when the chat or nothing is. */
  get shownKeys(): DeckKeysPanel | null {
    const shown: DeckPanel | null = DeckPanelHelper.shown(this.panelState);
    return shown === 'chat' ? null : shown;
  }

  /** The sheet has no folded state: with nothing chosen it shows the first panel. */
  get sheetKeys(): DeckKeysPanel {
    return this.panelState.keys ?? DeckPanelHelper.DEFAULT;
  }

  get chatLabel(): string {
    return ChatPanelHelper.toggleAriaLabel(this.chatOpen, this.unread);
  }

  /** "Shift + Ctrl", with "(travado)" on a lock: what the next key will carry, for a screen reader. */
  get latchSummary(): string {
    return this.latch.latched
      .map(modifier => `${this.modifierLabel(modifier)}${this.latch.state(modifier) === 'locked' ? ' (travado)' : ''}`)
      .join(' + ');
  }

  /**
   * The "Mais" tab's label. While a modifier waits and the panel that holds it is not the one on
   * screen, the tab names it ("Shift", "Ctrl+Alt"), so a latched key is never invisible. The
   * name goes in the tab and not in a bar of its own: a bar moved the keys under the finger.
   */
  moreTabLabel(morePanelShown: boolean): string {
    if (!this.latch.any || morePanelShown) return 'Mais';
    return this.latch.latched.map(modifier => this.modifierLabel(modifier)).join('+');
  }

  get moreAriaLabel(): string {
    return this.latch.any ? `Mais teclas. Próxima tecla com ${this.latchSummary}` : 'Mais teclas';
  }

  ngOnInit(): void {
    this.subscriptions.add(this.keyQueue.faulted$.subscribe(faulted => {
      this.faulted = faulted;
      if (faulted) this.stopRepeats('faulted');
      this.repaint();
    }));
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['chatOpen']) {
      this.panelState = DeckPanelHelper.withChat(this.panelState, this.chatOpen);
    }
    if (changes['dosCI'] || changes['disabled'] || changes['presentation']) {
      // A hold must not outlive the emulator it was typing into, nor the layout it was pressed in.
      this.stopRepeats('inputs changed');
    }
    if (changes['presentation'] || (changes['sheetOpen'] && !this.sheetOpen)) {
      this.letGo('layout');
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.stopRepeats('destroyed');
    this.latch.clear();
  }

  /** The window lost the focus or the page was hidden: no key stays repeating and no modifier stays lit. */
  @HostListener('window:blur')
  onWindowBlur(): void {
    this.letGo('blur');
  }

  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (document.hidden) this.letGo('hidden');
  }

  // ---- the taskbar ----

  onPanelTab(panel: DeckKeysPanel): void {
    const change = DeckPanelHelper.tapKeys(this.panelState, panel);
    this.changePanel(change.state);
    if (change.closeChat) this.chatToggle.emit(false);
  }

  /** In the sheet a tab picks a panel and never folds it: there is nothing to fold it to. */
  onSheetTab(panel: DeckKeysPanel): void {
    this.changePanel({ ...this.panelState, keys: panel });
  }

  onChatTab(): void {
    this.diagnostics.log('page', 'deck chat', () => ({ wants: DeckPanelHelper.wantsChatOpen(this.panelState) }));
    this.chatToggle.emit(DeckPanelHelper.wantsChatOpen(this.panelState));
  }

  onTextTab(): void {
    this.diagnostics.log('page', 'deck text');
    this.textRequest.emit();
  }

  closeSheet(): void {
    this.sheetOpenChange.emit(false);
  }

  // ---- keys ----

  keyDown(key: DeckKey): void {
    if (this.keysDisabled) return;
    if (!key.repeat) {
      this.press(key, 'tap');
      return;
    }
    this.repeatOf(key).start();
  }

  keyUp(key: DeckKey): void {
    this.repeats.get(key.id)?.stop('release');
  }

  modifierDown(modifier: Modifier): void {
    if (this.keysDisabled) return;
    this.latch.tap(modifier, performance.now());
    this.buzz();
    this.diagnostics.log('key', 'deck modifier', () => ({ modifier, state: this.latch.state(modifier) }));
    this.repaint();
  }

  modifierLabel(modifier: Modifier): string {
    return this.modifierKeys.find(entry => entry.modifier === modifier)?.label ?? modifier;
  }

  /** The O Matic is not a key; its button is here because the old header had one a thumb away. */
  openOmatic(): void {
    this.omaticRequest.emit();
  }

  trackKey(_: number, key: DeckKey): string {
    return key.id;
  }

  // ---- internals ----

  /** One scheduler per key id, created the first time it is held and kept: they are cheap and hold no timer while idle. */
  private repeatOf(key: DeckKey): KeyRepeatScheduler {
    let scheduler = this.repeats.get(key.id);
    if (!scheduler) {
      scheduler = new KeyRepeatScheduler(
        {
          delayMs: DECK.REPEAT_DELAY_MS,
          intervalMs: DECK.REPEAT_INTERVAL_MS,
          maxPending: DECK.REPEAT_MAX_PENDING,
          maxHoldMs: DECK.REPEAT_MAX_HOLD_MS,
        },
        // The landing is a press like any other (it buzzes); only the repeats after it are not.
        { fire: repeats => this.press(key, repeats === 0 ? 'tap' : 'repeat'), pending: () => this.keyQueue.pending },
        this.timers,
        // A forced stop is logged once for all the keys it ended, by stopRepeats, with its cause.
        (reason, fired, skipped) => {
          if (reason !== 'cancel') this.diagnostics.log('key', 'deck repeat stopped', () => ({ key: key.id, reason, repeats: fired, skipped }));
        },
      );
      this.repeats.set(key.id, scheduler);
    }
    return scheduler;
  }

  /** End every hold that is running, for a reason other than the finger lifting. */
  private stopRepeats(cause: string): void {
    const running = [...this.repeats.entries()].filter(([, scheduler]) => scheduler.running);
    if (running.length === 0) return;
    this.diagnostics.log('key', 'deck repeat cancelled', () => ({ cause, keys: running.map(([id]) => id) }));
    running.forEach(([, scheduler]) => scheduler.stop('cancel'));
  }

  /** Let go of everything a hand could have left behind: held repeats and latched modifiers. */
  private letGo(reason: string): void {
    this.stopRepeats(reason);
    if (this.latch.clear()) {
      this.diagnostics.log('key', 'deck modifiers cleared', () => ({ reason }));
      this.repaint();
    }
  }

  private press(key: DeckKey, origin: PressOrigin): void {
    if (this.keysDisabled) return;
    if (key.guarded && origin !== 'confirmed') {
      void this.confirmGuarded(key);
      return;
    }

    const latched = this.latch.latched;
    const modifiers = this.latch.consume();
    if (latched.length > 0) this.repaint();
    const codes = ModifierLatch.chord(modifiers, key.codes);

    this.diagnostics.log('key', 'deck press', () => ({ key: key.id, mods: latched, depth: this.keyQueue.pending, origin }));
    if (origin !== 'repeat') this.buzz();
    this.emulator.sendKey(this.dosCI, ...codes)
      .catch(error => this.zone.run(() => this.keyFailure.emit(error)));
  }

  /**
   * Alt+F4 closes Elifoot and leaves the Program Manager, from which only a restart comes back. The
   * app notices within a few seconds and offers it (GameExitWatcherService), so the way back
   * exists, but it must not be one stray tap away: a confirm in the same Win9x dialog as the rest.
   */
  private async confirmGuarded(key: DeckKey): Promise<void> {
    if (this.quitPromptOpen) return;
    this.quitPromptOpen = true;
    this.diagnostics.log('key', 'deck guarded key asked', () => ({ key: key.id }));
    try {
      const alert = await this.alertController.create({
        header: 'Fechar o Elifoot?',
        cssClass: 'win9x-alert alert-whitespace',
        message: 'Alt+F4 fecha o jogo e leva você ao Gerenciador de Programas do Windows. O Elifoot só volta se for reiniciado, e o aplicativo oferece isso logo em seguida.\n\nO que ainda não foi gravado dentro do jogo se perde.',
        backdropDismiss: false,
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          { text: 'Fechar o jogo', role: 'confirm', cssClass: 'alert-danger' },
        ],
      });
      await alert.present();
      const { role } = await alert.onDidDismiss();
      if (role === 'confirm') this.press(key, 'confirmed');
    } finally {
      this.quitPromptOpen = false;
    }
  }

  private changePanel(state: DeckPanelState): void {
    const before = DeckPanelHelper.shown(this.panelState);
    this.panelState = state;
    this.stopRepeats('panel changed');
    const after = DeckPanelHelper.shown(state);
    if (before !== after) {
      this.diagnostics.log('page', 'deck panel', () => ({ from: before, to: after, presentation: this.presentation }));
    }
  }

  /** navigator.vibrate(), where there is one and the player has not turned it off. A pure feel, so it never throws. */
  private buzz(): void {
    if (!this.vibrate || typeof navigator.vibrate !== 'function') return;
    try {
      navigator.vibrate(DECK.VIBRATE_MS);
    } catch {
      // A browser that refuses (no user activation yet): the key was sent all the same.
    }
  }

  /**
   * OnPush, and some changes come from outside the zone (a repeat tick that spent a modifier, the
   * queue going faulted): this is what makes the view hear about them.
   */
  private repaint(): void {
    this.zone.run(() => this.cdr.markForCheck());
  }
}
