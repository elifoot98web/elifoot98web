/** The three panels of keys. The chat is a fourth thing in the same place, owned by the page. */
export type DeckKeysPanel = 'tactics' | 'arrows' | 'more';
export type DeckPanel = DeckKeysPanel | 'chat';

/** What the deck remembers about which panel is up. */
export interface DeckPanelState {
  /** The keys panel the player last chose, or null when it is folded away. */
  keys: DeckKeysPanel | null;
  /** The chat is open; the page owns that, the deck only mirrors it. */
  chatOpen: boolean;
}

export interface DeckPanelChange {
  state: DeckPanelState;
  /** The tap needs the page to close the chat (a keys panel is taking its place). */
  closeChat: boolean;
}

/**
 * Which panel is on screen under the picture. The band holds ONE thing at a time: a panel of keys,
 * the chat, or nothing (folded, which hands the band back to the green). Pure, so the rules that
 * the taskbar's buttons follow can be read as a table:
 *
 * - a taskbar button for a panel of keys opens it, and a second tap on the open one folds it;
 * - opening a panel of keys while the chat is up closes the chat, and the tap does not fold;
 * - the chat button opens the chat OVER whatever panel was up, and closing it brings that panel back
 *   (the choice is kept while the chat is open, so "check the chat, then back to the arrows" is two taps);
 * - the chat is the page's: `chatOpen` is mirrored from it, so a chat opened from the menu shows here too.
 */
export class DeckPanelHelper {

  static readonly DEFAULT: DeckKeysPanel = 'tactics';

  /** The panel on screen, or null when the band is folded. */
  static shown(state: DeckPanelState): DeckPanel | null {
    return state.chatOpen ? 'chat' : state.keys;
  }

  /** A taskbar button for a panel of keys was tapped. */
  static tapKeys(state: DeckPanelState, tapped: DeckKeysPanel): DeckPanelChange {
    if (state.chatOpen) {
      return { state: { keys: tapped, chatOpen: false }, closeChat: true };
    }
    return { state: { keys: state.keys === tapped ? null : tapped, chatOpen: false }, closeChat: false };
  }

  /** What the chat button asks the page for: the inverse of what the chat is now. */
  static wantsChatOpen(state: DeckPanelState): boolean {
    return !state.chatOpen;
  }

  /** The page says the chat is now open or closed (from the deck's button or from anywhere else). */
  static withChat(state: DeckPanelState, chatOpen: boolean): DeckPanelState {
    return state.chatOpen === chatOpen ? state : { ...state, chatOpen };
  }

  static label(panel: DeckKeysPanel): string {
    switch (panel) {
      case 'tactics': return 'Táticas';
      case 'arrows': return 'Setas';
      default: return 'Mais teclas';
    }
  }
}
