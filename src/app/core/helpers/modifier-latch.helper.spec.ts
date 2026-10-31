import { DECK } from '../models/constants';
import { EmulatorKeyCode } from '../models/game';
import { ModifierLatch } from './modifier-latch.helper';

const K = EmulatorKeyCode;
const WINDOW = DECK.LATCH_DOUBLE_TAP_MS;

describe('ModifierLatch', () => {
  let latch: ModifierLatch;

  beforeEach(() => { latch = new ModifierLatch(); });

  it('starts with nothing latched, and a key sent plain', () => {
    expect(latch.any).toBeFalse();
    expect(latch.latched).toEqual([]);
    expect(latch.consume()).toEqual([]);
  });

  describe('one-shot', () => {

    it('a tap latches the modifier for the next key', () => {
      latch.tap('shift', 0);

      expect(latch.state('shift')).toBe('once');
      expect(latch.any).toBeTrue();
    });

    it('is spent by the next key and not by the one after', () => {
      latch.tap('shift', 0);

      expect(latch.consume()).toEqual([K.KBD_leftshift]);
      expect(latch.state('shift')).toBe('off');
      expect(latch.consume()).toEqual([]);
    });

    it('lets go when tapped again after the double-tap window', () => {
      latch.tap('ctrl', 0);
      latch.tap('ctrl', WINDOW + 1);

      expect(latch.state('ctrl')).toBe('off');
    });
  });

  describe('lock', () => {

    it('a second tap inside the window locks the modifier', () => {
      latch.tap('alt', 1000);
      latch.tap('alt', 1000 + WINDOW);

      expect(latch.state('alt')).toBe('locked');
    });

    it('stays through any number of keys', () => {
      latch.tap('shift', 0);
      latch.tap('shift', 100);

      expect(latch.consume()).toEqual([K.KBD_leftshift]);
      expect(latch.consume()).toEqual([K.KBD_leftshift]);
      expect(latch.consume()).toEqual([K.KBD_leftshift]);
      expect(latch.state('shift')).toBe('locked');
    });

    it('is told from a one-shot by `locked`, which the "Mais" tab shows', () => {
      latch.tap('ctrl', 0);
      expect(latch.locked).toBeFalse();
      latch.tap('ctrl', 100);
      expect(latch.locked).toBeTrue();
      latch.tap('alt', 200);
      latch.tap('ctrl', 5000);
      expect(latch.locked).toBeFalse();
      expect(latch.any).toBeTrue();
    });

    it('is released by a tap', () => {
      latch.tap('shift', 0);
      latch.tap('shift', 100);
      latch.tap('shift', 5000);

      expect(latch.state('shift')).toBe('off');
      expect(latch.consume()).toEqual([]);
    });

    it('is not a lock when the first tap was long ago, whatever else happened between', () => {
      latch.tap('shift', 0);
      latch.tap('ctrl', 100);
      latch.tap('shift', WINDOW + 50);

      expect(latch.state('shift')).toBe('off');
      expect(latch.state('ctrl')).toBe('once');
    });
  });

  describe('several modifiers', () => {

    it('puts them round the key in chord order whichever was tapped first', () => {
      latch.tap('shift', 0);
      latch.tap('alt', 10);
      latch.tap('ctrl', 20);

      expect(latch.latched).toEqual(['ctrl', 'alt', 'shift']);
      expect(latch.consume()).toEqual([K.KBD_leftctrl, K.KBD_leftalt, K.KBD_leftshift]);
    });

    it('spends the one-shots and keeps the locks', () => {
      latch.tap('ctrl', 0);
      latch.tap('ctrl', 50);
      latch.tap('shift', 100);

      expect(latch.consume()).toEqual([K.KBD_leftctrl, K.KBD_leftshift]);
      expect(latch.state('ctrl')).toBe('locked');
      expect(latch.state('shift')).toBe('off');
      expect(latch.consume()).toEqual([K.KBD_leftctrl]);
    });

    it('keeps each modifier\'s own state', () => {
      latch.tap('shift', 0);

      expect(latch.state('ctrl')).toBe('off');
      expect(latch.state('alt')).toBe('off');
    });
  });

  describe('clear', () => {

    it('lets every modifier go, locks included, and says it had something to let go', () => {
      latch.tap('shift', 0);
      latch.tap('shift', 10);
      latch.tap('alt', 20);

      expect(latch.clear()).toBeTrue();
      expect(latch.any).toBeFalse();
      expect(latch.consume()).toEqual([]);
    });

    it('says so when there was nothing, so a blur does not repaint for nothing', () => {
      expect(latch.clear()).toBeFalse();
    });

    it('leaves a clean slate for the next tap, which is a first tap and not a double', () => {
      latch.tap('shift', 0);
      latch.clear();
      latch.tap('shift', 10);

      expect(latch.state('shift')).toBe('once');
    });
  });

  describe('a modifier can never be stuck in the guest', () => {

    it('only ever adds the modifier to a chord that the queue presses and releases whole', () => {
      latch.tap('shift', 0);
      latch.tap('shift', 10);

      // What reaches the guest is a chord, [shift, key]: the queue presses both and releases both.
      // Nothing in the latch sends a key, so "stuck" can only be a lit button, and clear() has no
      // release to send.
      const chord = ModifierLatch.chord(latch.consume(), [K.KBD_f5]);

      expect(chord).toEqual([K.KBD_leftshift, K.KBD_f5]);
    });
  });

  describe('chord', () => {

    it('puts the modifiers first', () => {
      expect(ModifierLatch.chord([K.KBD_leftctrl], [K.KBD_a])).toEqual([K.KBD_leftctrl, K.KBD_a]);
    });

    it('does not press a modifier twice when the key already carries it (Shift+Tab with Shift latched)', () => {
      expect(ModifierLatch.chord([K.KBD_leftshift], [K.KBD_leftshift, K.KBD_tab])).toEqual([K.KBD_leftshift, K.KBD_tab]);
    });

    it('is the key alone when nothing is latched', () => {
      expect(ModifierLatch.chord([], [K.KBD_up])).toEqual([K.KBD_up]);
    });
  });
});
