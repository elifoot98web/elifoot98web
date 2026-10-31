import { WAKE_LOCK } from '../models/constants';

/**
 * Why the last request for the screen lock failed. `unsupported`: the browser has no Screen Wake
 * Lock API (Safari before 16.4, Firefox before 126), so nothing will ever change that. `not-allowed`:
 * it said no to this page right now (battery saver, a browser that wants a gesture first, a
 * permissions policy), which a later tap or a return to the page can change. `failed`: anything else.
 */
export type WakeLockDenial = 'unsupported' | 'not-allowed' | 'failed';

/** What made the service look at the situation again. */
export type WakeLockTrigger =
  /** The wish changed: the game started, the switch was flipped, a room opened or closed. */
  | 'wish'
  /** The page became visible: the browser released the lock when it hid. */
  | 'visible'
  /** The person touched the page while a refusal was waiting for a gesture. */
  | 'gesture'
  /** The browser took the lock back while the page was visible. */
  | 'released';

export interface WakeLockSituation {
  wanted: boolean;
  visible: boolean;
  /** A sentinel is held. */
  holding: boolean;
  /** A request is in flight. */
  requesting: boolean;
  denial: WakeLockDenial | null;
  trigger: WakeLockTrigger;
  /** Milliseconds since the last request was made, for the retry on a gesture. */
  sinceAttemptMs: number;
}

export type WakeLockStep = 'request' | 'release' | 'none';

/**
 * The rules of WakeLockService, as functions of numbers and flags: no navigator, no clock, no
 * timer. The service owns the sentinel and the listeners; this owns what to do about them.
 */
export class WakeLockHelper {

  /** The stored choice, or the default for a player who never made one (an explicit boolean, so a new default reaches only them). */
  static setting(stored: unknown): boolean {
    return typeof stored === 'boolean' ? stored : WAKE_LOCK.DEFAULT_ENABLED;
  }

  /**
   * Whether the screen should be held. A room overrides the switch: a hosting phone that locks
   * freezes the picture of everyone watching, and a watching phone that locks leaves the room.
   */
  static wanted(state: { running: boolean; setting: boolean; inRoom: boolean }): boolean {
    return state.running && (state.inRoom || state.setting);
  }

  /**
   * What to do now.
   *
   * - Not wanted: let go of a held lock, otherwise nothing. A request still in flight is dealt
   *   with when it lands (the service asks again then).
   * - Wanted and already held, or in flight: nothing.
   * - Wanted on a hidden page: nothing. The API refuses a hidden page, and `visible` asks again.
   * - Wanted, free, visible: ask, unless an earlier refusal says the answer cannot have changed.
   *   An unsupported API never changes. A `failed` one is asked again only when the page comes back
   *   or the wish changes. A `not-allowed` one is also asked again on a tap (some browsers want a
   *   gesture, and the page's own first request comes long after the one that opened it), but not
   *   on every tap: a battery saver says no to each of them.
   */
  static decide(situation: WakeLockSituation): WakeLockStep {
    if (!situation.wanted) return situation.holding ? 'release' : 'none';
    if (situation.holding || situation.requesting || !situation.visible) return 'none';

    switch (situation.denial) {
      case 'unsupported':
        return 'none';
      case 'failed':
        return situation.trigger === 'visible' || situation.trigger === 'wish' ? 'request' : 'none';
      case 'not-allowed':
        if (situation.trigger === 'visible' || situation.trigger === 'wish') return 'request';
        if (situation.trigger === 'gesture') return situation.sinceAttemptMs >= WAKE_LOCK.GESTURE_RETRY_MIN_MS ? 'request' : 'none';
        return 'none';
      default:
        return 'request';
    }
  }

  /** `NotAllowedError` is the browser's no (battery saver, policy, a missing gesture); anything else is a failure. */
  static denialOf(error: unknown): WakeLockDenial {
    const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
    return name === 'NotAllowedError' ? 'not-allowed' : 'failed';
  }

  /**
   * Whether the browser's taking the lock back is the system's ordinary doing (the page was hidden,
   * the battery saver came on) or an unstable lock. A release soon after the grant counts against
   * the lock, and `QUICK_RELEASE_LIMIT` of them in a row stop the asking.
   */
  static quickRelease(heldMs: number): boolean {
    return heldMs < WAKE_LOCK.QUICK_RELEASE_MS;
  }

  /** What the menu says under "Manter a tela ligada". */
  static describe(state: { supported: boolean; wanted: boolean; holding: boolean; denial: WakeLockDenial | null; inRoom: boolean }): string {
    if (!state.supported) return 'Este navegador não permite manter a tela ligada.';
    if (state.holding) return state.inRoom ? 'Ligada: a tela fica acesa enquanto a sala estiver aberta.' : 'Ligada: a tela não apaga durante o jogo.';
    if (!state.wanted) return 'Desligada: a tela apaga como de costume, menos numa sala multiplayer.';
    if (state.denial === 'not-allowed') return 'O aparelho não deixou agora (economia de bateria?). O app tenta de novo.';
    if (state.denial === 'failed') return 'Não foi possível manter a tela ligada agora.';
    return 'Ligando…';
  }
}
