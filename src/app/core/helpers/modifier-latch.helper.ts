import { DECK } from '../models/constants';
import { EmulatorKeyCode } from '../models/game';

export type Modifier = 'shift' | 'ctrl' | 'alt';

/**
 * `off`: nothing. `once`: applies to the next key and lets go. `locked`: applies to every key
 * until it is tapped again.
 */
export type LatchState = 'off' | 'once' | 'locked';

/** In the order a chord presses them. Windows does not care; a person reading a diagnostics line does. */
export const MODIFIERS: readonly Modifier[] = ['ctrl', 'alt', 'shift'];

const CODES: Readonly<Record<Modifier, EmulatorKeyCode>> = {
  ctrl: EmulatorKeyCode.KBD_leftctrl,
  alt: EmulatorKeyCode.KBD_leftalt,
  shift: EmulatorKeyCode.KBD_leftshift,
};

/**
 * Shift, Ctrl and Alt for a keyboard with no keys to hold down: a modifier is LATCHED, which means
 * the deck remembers it and puts it round the next key's chord.
 *
 * - **A tap latches it for one key** (`once`). Pressing any key sends that key with the modifier
 *   and lets the modifier go, which is what a phone's Shift does.
 * - **A second tap soon after the first locks it** (`locked`), for several keys in a row (Shift
 *   and a run of arrows selects, in a list that knows how). A tap on a locked or a stale one-shot
 *   modifier lets it go.
 * - **Nothing is ever held down in the guest.** The modifier is added to the chord when a key is
 *   sent, so the guest sees it pressed and released inside that one chord, and a latch the page
 *   forgets about can only be a lit button, never a stuck Shift in the game. That is also why
 *   `clear()` can be called from anywhere without a release to send.
 * - **Whatever takes the player's attention away clears it.** The deck calls `clear()` when the
 *   window loses focus, the page is hidden, the layout or presentation changes, the launcher's
 *   sheet closes and the deck is torn down, so a modifier tapped and then forgotten cannot
 *   surprise the next key an hour later. A panel switch does NOT clear it, on purpose: the "Mais"
 *   tab names a waiting modifier from any other panel, which is how Shift is latched in Mais and
 *   spent on an arrow in Setas. A lock is deliberate and is shown (the lit key, and that tab), but
 *   it is cleared on the same events.
 *
 * Pure: it never reads a clock, every tap carries its own time, so the specs are plain calls.
 */
export class ModifierLatch {
  private readonly states: Record<Modifier, LatchState> = { shift: 'off', ctrl: 'off', alt: 'off' };
  private readonly armedAt: Record<Modifier, number> = { shift: 0, ctrl: 0, alt: 0 };

  constructor(private readonly doubleTapMs: number = DECK.LATCH_DOUBLE_TAP_MS) { }

  state(modifier: Modifier): LatchState {
    return this.states[modifier];
  }

  /** The modifiers that are latched in either way, in chord order. */
  get latched(): Modifier[] {
    return MODIFIERS.filter(modifier => this.states[modifier] !== 'off');
  }

  get any(): boolean {
    return this.latched.length > 0;
  }

  /** At least one modifier is locked (not merely waiting for the next key). */
  get locked(): boolean {
    return MODIFIERS.some(modifier => this.states[modifier] === 'locked');
  }

  /** The player tapped the modifier's keycap at time `at` (ms, any clock, as long as it is the same one). */
  tap(modifier: Modifier, at: number): void {
    switch (this.states[modifier]) {
      case 'off':
        this.states[modifier] = 'once';
        this.armedAt[modifier] = at;
        break;
      case 'once':
        this.states[modifier] = at - this.armedAt[modifier] <= this.doubleTapMs ? 'locked' : 'off';
        break;
      case 'locked':
        this.states[modifier] = 'off';
        break;
    }
  }

  /**
   * The next key is being sent: the key codes of the modifiers to put round it, in chord order,
   * and every one-shot latch is spent. Locked ones stay.
   */
  consume(): EmulatorKeyCode[] {
    const codes: EmulatorKeyCode[] = [];
    for (const modifier of MODIFIERS) {
      if (this.states[modifier] === 'off') continue;
      codes.push(CODES[modifier]);
      if (this.states[modifier] === 'once') this.states[modifier] = 'off';
    }
    return codes;
  }

  /** Let everything go. True when something was latched, so the caller knows to repaint. */
  clear(): boolean {
    const had = this.any;
    for (const modifier of MODIFIERS) this.states[modifier] = 'off';
    return had;
  }

  /** The chord for a key: the latched modifiers first, without repeating one the key already carries. */
  static chord(modifiers: readonly EmulatorKeyCode[], key: readonly EmulatorKeyCode[]): EmulatorKeyCode[] {
    return [...modifiers.filter(code => !key.includes(code)), ...key];
  }
}
