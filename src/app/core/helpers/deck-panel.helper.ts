/**
 * The panels of the band: three of keys, and the camera's (Zoom, offered only while "Zoom e movimento" is on). The chat is one more
 * thing in the same place, owned by the page.
 */
export type DeckKeysPanel = 'tactics' | 'arrows' | 'more' | 'camera';
export type DeckPanel = DeckKeysPanel | 'chat';

/** What the deck remembers about which panel is up. */
export interface DeckPanelState {
  /** The keys panel the player last chose, or null when it is folded away. */
  keys: DeckKeysPanel | null;
  /** The chat is open; the page owns that, the deck only mirrors it. */
  chatOpen: boolean;
  /**
   * The panel that magnifying the picture folded away (see {@link DeckPanelHelper.withZoom}), to bring back when the picture is
   * back at the fit and the band is still folded. Absent, not null, when there is none.
   */
  foldedByZoom?: DeckKeysPanel;
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

  /**
   * The deck collapses to its taskbar while the picture is magnified, and comes back when it is not. In portrait the camera grows into the
   * free band under the picture, and a panel of keys left open would be that band: so zooming folds the panel (and remembers which),
   * and returning to the fit brings it back, if the band is still folded and nobody chose another panel meanwhile (a tap on a tab
   * is a choice and forgets what was folded). The camera's own panel is not folded: it is the one that is used while zoomed.
   */
  static withZoom(state: DeckPanelState, zoomed: boolean): DeckPanelState {
    if (zoomed) {
      if (state.keys === null || state.keys === 'camera' || state.foldedByZoom) return state;
      return { keys: null, chatOpen: state.chatOpen, foldedByZoom: state.keys };
    }
    if (!state.foldedByZoom) return state;
    const { foldedByZoom, ...rest } = state;
    return state.keys === null ? { ...rest, keys: foldedByZoom } : rest;
  }

  /** The panel on screen is one that is not on offer any more (the camera's, with the setting off): the band folds. */
  static withoutCamera(state: DeckPanelState): DeckPanelState {
    return state.keys === 'camera' ? { ...state, keys: null } : state;
  }

  static label(panel: DeckKeysPanel): string {
    switch (panel) {
      case 'tactics': return 'Táticas';
      case 'arrows': return 'Setas';
      case 'camera': return 'Zoom e movimento';
      default: return 'Mais teclas';
    }
  }
}
