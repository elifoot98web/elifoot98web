import { DeckPanelHelper, DeckPanelState } from './deck-panel.helper';

const state = (keys: DeckPanelState['keys'], chatOpen = false): DeckPanelState => ({ keys, chatOpen });

describe('DeckPanelHelper', () => {

  describe('shown', () => {

    it('is the keys panel the player chose', () => {
      expect(DeckPanelHelper.shown(state('arrows'))).toBe('arrows');
    });

    it('is nothing when the band is folded', () => {
      expect(DeckPanelHelper.shown(state(null))).toBeNull();
    });

    it('is the chat whenever it is open, over a panel of keys or over nothing', () => {
      expect(DeckPanelHelper.shown(state('tactics', true))).toBe('chat');
      expect(DeckPanelHelper.shown(state(null, true))).toBe('chat');
    });
  });

  describe('tapKeys', () => {

    it('opens a panel from a folded band', () => {
      expect(DeckPanelHelper.tapKeys(state(null), 'more')).toEqual({ state: state('more'), closeChat: false });
    });

    it('switches from one panel to another', () => {
      expect(DeckPanelHelper.tapKeys(state('tactics'), 'arrows')).toEqual({ state: state('arrows'), closeChat: false });
    });

    it('folds the panel that is open when its own button is tapped again', () => {
      expect(DeckPanelHelper.tapKeys(state('arrows'), 'arrows')).toEqual({ state: state(null), closeChat: false });
    });

    it('closes the chat and opens the panel, instead of folding, when the chat is up', () => {
      // The panel that was behind the chat is the one tapped: that is not a second tap on it.
      expect(DeckPanelHelper.tapKeys(state('arrows', true), 'arrows')).toEqual({ state: state('arrows'), closeChat: true });
      expect(DeckPanelHelper.tapKeys(state(null, true), 'tactics')).toEqual({ state: state('tactics'), closeChat: true });
    });
  });

  describe('the chat', () => {

    it('asks to open when closed and to close when open', () => {
      expect(DeckPanelHelper.wantsChatOpen(state('tactics'))).toBeTrue();
      expect(DeckPanelHelper.wantsChatOpen(state('tactics', true))).toBeFalse();
    });

    it('keeps the panel it covered, so closing it brings that panel back', () => {
      const open = DeckPanelHelper.withChat(state('arrows'), true);
      const closed = DeckPanelHelper.withChat(open, false);

      expect(DeckPanelHelper.shown(open)).toBe('chat');
      expect(DeckPanelHelper.shown(closed)).toBe('arrows');
    });

    it('is mirrored without creating a new state when nothing changed', () => {
      const same = state('more');

      expect(DeckPanelHelper.withChat(same, false)).toBe(same);
    });
  });

  it('opens on the tactics panel, the one the old FAB led with', () => {
    expect(DeckPanelHelper.DEFAULT).toBe('tactics');
  });

  it('names its panels in Portuguese', () => {
    expect(DeckPanelHelper.label('tactics')).toBe('Táticas');
    expect(DeckPanelHelper.label('arrows')).toBe('Setas');
    expect(DeckPanelHelper.label('more')).toBe('Mais teclas');
  });
});
