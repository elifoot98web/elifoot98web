import { AUDIO_HEALTH } from '../models/constants';

/**
 * The states of the game's AudioContext this app tells apart. `interrupted` is WebKit's own: a call,
 * Siri, a lock or a Bluetooth change put the context to sleep, and only a `resume()` from a gesture
 * brings it back (recalled, unverified: the device pass is where it is seen). `closed` is js-dos's
 * doing when the game exits.
 */
export type AudioContextStateName = 'running' | 'suspended' | 'interrupted' | 'closed';

/** What made the service look at the context again. */
export type AudioTrigger =
  /** The game page started the service. */
  | 'start'
  /** The page became visible (a lock, an app switch, a call that ended). */
  | 'visible'
  /** The person touched or typed something while the context was not running. */
  | 'gesture'
  /** The context changed state by itself. */
  | 'statechange'
  /** The person tapped the "Ativar som" chip. */
  | 'chip'
  /** The grace period after the context was found not running has ended. */
  | 'grace';

/** What the game page shows of the audio: the context's state, and whether the sound is blocked and needs a tap. */
export interface AudioStatus {
  state: AudioContextStateName | null;
  blocked: boolean;
}

export const NO_AUDIO: AudioStatus = { state: null, blocked: false };

/**
 * The decision table of AudioHealthService, as functions of the state and the trigger: no context,
 * no clock, no timer.
 */
export class AudioHealthHelper {

  /** A state name as the app knows it; anything else (no context, a browser's new word) is no state. */
  static normalise(raw: unknown): AudioContextStateName | null {
    return raw === 'running' || raw === 'suspended' || raw === 'interrupted' || raw === 'closed' ? raw : null;
  }

  /** Whether the context is asleep in a way a `resume()` could end. `closed` cannot be woken; `running` needs nothing. */
  static asleep(state: AudioContextStateName | null): boolean {
    return state === 'suspended' || state === 'interrupted';
  }

  /**
   * Whether to call `resume()` now. It is asked on the moments that could carry a user activation or
   * a change of circumstances (starting, the page returning, a gesture, the chip), never on the
   * context's own state changes (a resume answered by another state change is a loop with the browser)
   * and never for a page that is hidden (the browser refuses, and the page coming back asks again).
   */
  static shouldResume(state: AudioContextStateName | null, trigger: AudioTrigger, visible: boolean): boolean {
    if (!AudioHealthHelper.asleep(state) || !visible) return false;
    return trigger === 'start' || trigger === 'visible' || trigger === 'gesture' || trigger === 'chip';
  }

  /**
   * Whether the sound is blocked for the person's purposes: the context has been asleep, on a visible
   * page, for longer than the page had to fix it by itself. Muting with the volume control never makes
   * a context sleep (it is a gain of 0 on a running context), so "muted by the player" and "blocked by
   * the browser" cannot be mistaken for each other.
   */
  static blocked(state: AudioContextStateName | null, visible: boolean, asleepForMs: number): boolean {
    return AudioHealthHelper.asleep(state) && visible && asleepForMs >= AUDIO_HEALTH.BLOCKED_GRACE_MS;
  }

  /** Whether a gesture listener is worth having: only while the context is asleep on a visible page. */
  static wantsGesture(state: AudioContextStateName | null, visible: boolean): boolean {
    return AudioHealthHelper.asleep(state) && visible;
  }

  /** The chip's accessible name; a host is told that the people watching are silent too. */
  static chipLabel(hosting: boolean): string {
    return hosting
      ? 'Ativar som. Enquanto estiver sem som, quem assiste a sua sala também não ouve o jogo.'
      : 'Ativar som';
  }
}

/** The game's volume on this device: a slider in percent and a mute switch, and what js-dos is told. */
export class GameVolumeHelper {

  /** The stored volume, or the default for anything that is not a number from 0 to 1. Storage is just another input. */
  static normalise(stored: unknown): number {
    return typeof stored === 'number' && Number.isFinite(stored) ? Math.min(1, Math.max(0, stored)) : AUDIO_HEALTH.DEFAULT_VOLUME;
  }

  static toPercent(volume: number): number {
    return Math.round(GameVolumeHelper.normalise(volume) * 100);
  }

  static fromPercent(percent: number): number {
    return GameVolumeHelper.normalise(percent / 100);
  }

  /** What js-dos's gain is set to: a mute is a gain of 0, and the context keeps running. */
  static gain(volume: number, muted: boolean): number {
    return muted ? 0 : GameVolumeHelper.normalise(volume);
  }

  /**
   * The slider moved. Moving it above zero while the game is muted unmutes it (a slider that changes
   * nothing you can hear is a bug report), and moving it to zero leaves the mute switch as it was:
   * a volume of zero and a mute are different things to come back from.
   */
  static afterSlider(state: { volume: number; muted: boolean }, percent: number): { volume: number; muted: boolean } {
    const volume = GameVolumeHelper.fromPercent(percent);
    return { volume, muted: volume > 0 ? false : state.muted };
  }

  static label(volume: number, muted: boolean): string {
    if (muted) return 'Silenciado';
    const percent = GameVolumeHelper.toPercent(volume);
    return percent === 0 ? 'Mudo' : `${percent}%`;
  }
}
