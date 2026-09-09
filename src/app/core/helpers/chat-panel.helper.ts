/**
 * Focus and labelling for the chat overlay drawer, shared by the host (game) and guest
 * (join-game) pages. Both pages own their own copy of the panel markup, so without this
 * the focus targets and the pt-BR accessible names would drift apart.
 */
export class ChatPanelHelper {
  /** The panel's DOM id. Also the toggle's aria-controls target. */
  static readonly PANEL_ID = 'chat-panel';

  /**
   * Focus the panel itself, not the compose field: focusing an input would raise the
   * mobile soft keyboard on every open. Deferred by a tick because Angular only drops
   * the panel's `visibility: hidden` in the change-detection pass that follows the click
   * handler, and a visibility:hidden subtree cannot take focus. `preventScroll` matters
   * because Ionic's scroll container would otherwise displace the emulator.
   */
  static focusPanel() {
    setTimeout(() => {
      const panel = document.getElementById(ChatPanelHelper.PANEL_ID);
      panel?.focus({ preventScroll: true });
    });
  }

  /**
   * ion-button does not set `delegatesFocus`, so the host element is not focusable — the
   * inner `.button-native` inside its shadow root is.
   */
  static focusToggle() {
    const toggle = document.querySelector('.chat-toggle-btn') as HTMLElement | null;
    const native = toggle?.shadowRoot?.querySelector('button') as HTMLElement | null;
    (native ?? toggle)?.focus({ preventScroll: true });
  }

  /**
   * Host only. js-dos binds keydown/keyup on the element passed to `Dos()` — verified in
   * the vendored bundle: `this.root = e; this.root.classList.add("emulator-root")`, and
   * `initKeyEvents` gives it `tabIndex = 0`. So `.emulator-root` IS `#game-container`,
   * and focusing it changes no geometry. Without this, focus stays in the chat and the
   * host's physical keyboard silently stops reaching the game until they click the
   * canvas; it also stops Enter from re-toggling the panel from the focused button.
   */
  static focusEmulator() {
    const root = document.querySelector('.emulator-root') as HTMLElement | null;
    root?.focus({ preventScroll: true });
  }

  /**
   * Accessible name for the toggle. The badge is aria-hidden, because an aria-label on
   * the button suppresses its descendants — so the unread count has to live in here.
   */
  static toggleAriaLabel(isOpen: boolean, unread: number | null = 0): string {
    if (isOpen) return 'Fechar o chat';
    const count = unread ?? 0;
    if (count === 1) return 'Abrir o chat (1 mensagem não lida)';
    if (count > 1) return `Abrir o chat (${count} mensagens não lidas)`;
    return 'Abrir o chat';
  }
}
