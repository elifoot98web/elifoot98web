/**
 * How a finger drives the game. `direct` is the layer this phase added: a tap lands under the
 * finger. `classic` is js-dos's own touchpad, kept as the opt-out (and as the switch to throw if
 * the real-device pass finds the direct model misbehaving).
 */
export type TouchMode = 'direct' | 'classic';

/**
 * Which touch mode applies, decided from the stored choice and from what the device can actually
 * run. Free of Angular and of the DOM, so the user-agent cases can be tested as strings.
 *
 * **Classic is only real where js-dos itself treats the device as a phone.** Its pointer binding
 * is a user-agent test (`/iPhone|iPad|iPod|Android/i`, read once at load): only a match gets the
 * touchpad. Everything else gets the desktop path (pointer lock on a mousedown), which gives touch
 * NO input at all. So on an iPad that reports itself as a Mac (the iPadOS default), or on a phone
 * whose browser is asked for the "desktop site", classic would leave a player with a dead screen.
 * There the stored choice is ignored and the setting is not offered; it is never a state a person
 * can end up stuck in.
 */
export class TouchModeHelper {

  /** A value out of storage, which is just another input: anything that is not 'classic' is the default. */
  static normalise(stored: unknown): TouchMode {
    return stored === 'classic' ? 'classic' : 'direct';
  }

  /** js-dos's own test for "this is a phone, give it the touchpad". Copied from its pointer binding. */
  static stockTouchWorks(userAgent: string): boolean {
    return /iPhone|iPad|iPod|Android/i.test(userAgent);
  }

  /** The mode that is actually in force: the choice, unless stock js-dos could not honour `classic`. */
  static effective(mode: TouchMode, userAgent: string): TouchMode {
    return mode === 'classic' && TouchModeHelper.stockTouchWorks(userAgent) ? 'classic' : 'direct';
  }

  /**
   * Whether the options menu should show the setting: a coarse primary pointer (touch is how this
   * device is used) AND a classic mode that would work.
   */
  static offersChoice(coarsePointer: boolean, userAgent: string): boolean {
    return coarsePointer && TouchModeHelper.stockTouchWorks(userAgent);
  }

  /** What the menu and the dialog call a mode. */
  static label(mode: TouchMode): string {
    return mode === 'direct' ? 'Direto (padrão)' : 'Touchpad (clássico)';
  }

  /** Both modes, default first. */
  static modes(): TouchMode[] {
    return ['direct', 'classic'];
  }
}
