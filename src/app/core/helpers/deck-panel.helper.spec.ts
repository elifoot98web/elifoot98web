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

  describe('the camera', () => {

    it('folds the panel that is open when the picture is magnified, and remembers which', () => {
      expect(DeckPanelHelper.withZoom(state('tactics'), true)).toEqual({ keys: null, chatOpen: false, foldedByZoom: 'tactics' });
      expect(DeckPanelHelper.withZoom(state('more'), true)).toEqual({ keys: null, chatOpen: false, foldedByZoom: 'more' });
    });

    it('brings it back at the fit when the band is still folded', () => {
      const zoomed = DeckPanelHelper.withZoom(state('arrows'), true);
      expect(DeckPanelHelper.withZoom(zoomed, false)).toEqual(state('arrows'));
    });

    it('does not bring it back over a panel the player chose meanwhile, and forgets it', () => {
      const zoomed = DeckPanelHelper.withZoom(state('arrows'), true);
      const chosen = DeckPanelHelper.tapKeys(zoomed, 'more').state;

      expect(chosen).toEqual(state('more'));
      expect(DeckPanelHelper.withZoom(chosen, false)).toBe(chosen);
    });

    it('does not bring it back when the player folded the band by hand', () => {
      const zoomed = DeckPanelHelper.withZoom(state('arrows'), true);
      const opened = DeckPanelHelper.tapKeys(zoomed, 'more').state;
      const folded = DeckPanelHelper.tapKeys(opened, 'more').state;

      expect(folded).toEqual(state(null));
      expect(DeckPanelHelper.withZoom(folded, false)).toBe(folded);
    });

    it('has nothing to fold when the band is folded already, or when the panel is the camera\'s', () => {
      const folded = state(null);
      const camera = state('camera');
      expect(DeckPanelHelper.withZoom(folded, true)).toBe(folded);
      expect(DeckPanelHelper.withZoom(camera, true)).toBe(camera);
      expect(DeckPanelHelper.withZoom(camera, false)).toBe(camera);
    });

    it('folds once: a second zoom does not overwrite what the first one remembered', () => {
      const zoomed = DeckPanelHelper.withZoom(state('tactics'), true);
      expect(DeckPanelHelper.withZoom(zoomed, true)).toBe(zoomed);
    });

    it('keeps the chat as it was: zooming does not close it, and what it covered is still remembered', () => {
      const zoomed = DeckPanelHelper.withZoom(state('arrows', true), true);
      expect(zoomed).toEqual({ keys: null, chatOpen: true, foldedByZoom: 'arrows' });
      expect(DeckPanelHelper.shown(zoomed)).toBe('chat');
      expect(DeckPanelHelper.withZoom(zoomed, false)).toEqual(state('arrows', true));
    });

    it('taps the Zoom tab like any other: opens it, folds it', () => {
      expect(DeckPanelHelper.tapKeys(state('tactics'), 'camera').state).toEqual(state('camera'));
      expect(DeckPanelHelper.tapKeys(state('camera'), 'camera').state).toEqual(state(null));
    });

    it('folds the camera\'s panel when the camera is switched off, and only that one', () => {
      expect(DeckPanelHelper.withoutCamera(state('camera'))).toEqual(state(null));
      const other = state('arrows');
      expect(DeckPanelHelper.withoutCamera(other)).toBe(other);
    });
  });

  it('opens on the tactics panel, the one the old FAB led with', () => {
    expect(DeckPanelHelper.DEFAULT).toBe('tactics');
  });

  it('names its panels in Portuguese', () => {
    expect(DeckPanelHelper.label('tactics')).toBe('Táticas');
    expect(DeckPanelHelper.label('arrows')).toBe('Setas');
    expect(DeckPanelHelper.label('more')).toBe('Mais teclas');
    expect(DeckPanelHelper.label('camera')).toBe('Zoom e movimento');
  });
});
