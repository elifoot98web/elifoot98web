import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AUDIO_HEALTH } from '../../models/constants';
import { AudioContextStateName, AudioHealthHelper, AudioStatus, AudioTrigger, GameVolumeHelper, NO_AUDIO } from '../../helpers/audio-health.helper';
import { DiagnosticsService } from '../shared/diagnostics.service';

/** The part of js-dos's `AudioContext` this service uses; a spec stands in for it. */
export interface AudioContextLike {
  readonly state: string;
  resume(): Promise<void>;
  addEventListener(type: 'statechange', listener: () => void): void;
  removeEventListener(type: 'statechange', listener: () => void): void;
}

/** The part of `navigator.audioSession` (Safari 16.4+) this service uses. */
export interface AudioSessionLike {
  type: string;
}

/** The part of js-dos's instance this service uses. */
export interface VolumeTargetLike {
  setVolume?: (volume: number) => Promise<void> | void;
}

/**
 * Keeps the game's sound alive and under the player's hand, on the host's own device.
 *
 * **The context is js-dos's, and this creates none.** js-dos builds its `AudioContext` privately
 * inside `run()`, before any gesture, and wakes it from a one-shot `click`/`touchstart`/`keydown`
 * listener on `document` that only knows `suspended`. `game.js` keeps the one `ScriptProcessorNode`
 * it creates (`getDosAudioNode`), and `node.context` is the way in. After a call, a lock or a
 * Bluetooth change the context can be `suspended` again, or `interrupted` (WebKit), and then the
 * game is silent, and so is the stream a hosting phone sends, until something resumes it.
 *
 * - **It asks the context to resume** when the page becomes visible and on the first gesture while
 *   the context is not running (the decision table is {@link AudioHealthHelper}); a gesture
 *   listener exists only while the context is asleep on a visible page.
 * - **It says so when that does not work**: `status$` is `blocked` once the context has been asleep
 *   on a visible page for `BLOCKED_GRACE_MS`, and the "Ativar som" chip (shell, flat) offers the tap
 *   that resumes it. A chip tap is a gesture; `activate()` calls `resume()` inside it.
 * - **The volume is a gain on a running context.** `dosInstance.setVolume` sets the node js-dos puts
 *   between its script processor and the speakers. "Silenciar" is a gain of 0, never a suspended
 *   context, so muted-by-the-player and blocked-by-the-browser cannot be mistaken for each other.
 *   **It does not change what spectators hear**: `MultiplayerAudioService` connects the script
 *   processor straight to its `MediaStreamAudioDestinationNode`, BEFORE that gain, and the host's
 *   "Enviar o som do jogo aos espectadores" switch is the track's own `enabled`. (`dosCI.mute()` would
 *   silence the stream too, because it stops the emulator pushing samples; it is not used.)
 * - **`navigator.audioSession.type = 'playback'`** (Safari 16.4+) makes the game audible with the
 *   iPhone's ringer switch on silent, at the cost of interrupting other apps' audio, so it is an
 *   explicit setting and off unless the player chose it.
 *
 * Everything is feature-detected: no context (a browser without Web Audio, a game with no sound)
 * is `state: null` and nothing is shown. It lives between `start()` and `stop()` (the game page's
 * life), runs its listeners outside Angular's zone and logs into the diagnostics log under `platform`.
 */
@Injectable({
  providedIn: 'root'
})
export class AudioHealthService {
  private readonly statusSubject = new BehaviorSubject<AudioStatus>(NO_AUDIO);
  private context: AudioContextLike | null = null;
  private watching = false;
  private gestureListening = false;
  private asleepSince: number | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;
  private lastState: AudioContextStateName | null = null;
  private evaluating = false;
  private again: AudioTrigger | null = null;
  private lastResumeLogAt = -Infinity;

  /** What the page shows of the audio. Emits on a change only. */
  readonly status$: Observable<AudioStatus> = this.statusSubject.asObservable();

  constructor(private zone: NgZone, private diagnostics: DiagnosticsService) { }

  /** js-dos's script processor, or null. The seam a spec replaces; the global is `game.js`'s. */
  protected node(): { context: unknown } | null {
    return typeof getDosAudioNode === 'function' ? getDosAudioNode() : null;
  }

  protected visible(): boolean {
    return document.visibilityState === 'visible';
  }

  /** Milliseconds; a spec under `fakeAsync` leaves it on `Date.now`, which zone.js fakes. */
  protected clock(): number {
    return Date.now();
  }

  protected audioSession(): AudioSessionLike | undefined {
    return typeof navigator === 'undefined' ? undefined : (navigator as { audioSession?: AudioSessionLike }).audioSession;
  }

  /** js-dos's instance, which `game.js` publishes as a global once it exists. */
  protected jsdos(): VolumeTargetLike | undefined {
    return typeof dosInstance === 'undefined' ? undefined : dosInstance;
  }

  get status(): AudioStatus {
    return this.statusSubject.value;
  }

  /** Whether the browser has `navigator.audioSession`, which is what "Som no modo silencioso" needs. */
  get playbackSupported(): boolean {
    return this.audioSession() !== undefined;
  }

  /** Begin watching the game's sound. Idempotent. */
  start(): void {
    if (this.watching) return;
    this.watching = true;
    this.zone.runOutsideAngular(() => {
      document.addEventListener('visibilitychange', this.onVisibility);
      // A page restored from the back/forward cache never fires visibilitychange.
      window.addEventListener('pageshow', this.onVisibility);
    });
    this.diagnostics.log('platform', 'audio: service started');
    this.evaluate('start');
  }

  /** Stop watching and let go of every listener and timer. Safe to call twice. */
  stop(): void {
    if (!this.watching) return;
    this.watching = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pageshow', this.onVisibility);
    this.stopListeningForGesture();
    clearTimeout(this.graceTimer);
    this.graceTimer = undefined;
    this.bind(null);
    this.asleepSince = null;
    this.lastState = null;
    this.again = null;
    this.publish(NO_AUDIO);
    this.diagnostics.log('platform', 'audio: service stopped');
  }

  /**
   * The chip was tapped: resume inside the gesture. Called synchronously from the tap's handler,
   * because WebKit counts only a resume made while the tap is the current user activation.
   */
  activate(): void {
    this.diagnostics.log('platform', 'audio: chip tapped', () => ({ state: this.status.state }));
    this.evaluate('chip');
  }

  /** "Som no modo silencioso". Returns whether the browser took it. */
  setPlayback(on: boolean): boolean {
    const session = this.audioSession();
    if (!session) return false;
    try {
      session.type = on ? 'playback' : 'auto';
      this.diagnostics.log('platform', 'audio: session type', () => ({ type: session.type }));
      return true;
    } catch (error) {
      this.diagnostics.log('platform', 'audio: session type refused', () => ({ error }));
      return false;
    }
  }

  /**
   * Put the player's volume into js-dos. Safe to call before js-dos has a sound node (it keeps the
   * value for when it does) and after it has gone; a failure is logged and never thrown.
   */
  applyVolume(volume: number, muted: boolean): void {
    const gain = GameVolumeHelper.gain(volume, muted);
    const target = this.jsdos();
    if (!target || typeof target.setVolume !== 'function') {
      this.diagnostics.log('platform', 'audio: no volume control', () => ({ gain }));
      return;
    }
    try {
      Promise.resolve(target.setVolume(gain)).catch(error => this.diagnostics.log('platform', 'audio: volume failed', () => ({ error })));
    } catch (error) {
      this.diagnostics.log('platform', 'audio: volume failed', () => ({ error }));
    }
  }

  private readonly onVisibility = (): void => {
    if (this.visible()) this.evaluate('visible');
    else this.evaluate('statechange'); // a hidden page: the clocks stop, the chip goes
  };

  private readonly onGesture = (): void => {
    this.evaluate('gesture');
  };

  private readonly onStateChange = (): void => {
    this.evaluate('statechange');
  };

  /**
   * Look at the context and act on what is found. Re-entrant calls are queued: `resume()` can change
   * the state before it returns, and the `statechange` that follows would otherwise publish the new
   * state and then be overwritten by the older reading of the look that asked.
   */
  private evaluate(trigger: AudioTrigger): void {
    if (!this.watching) return;
    if (this.evaluating) {
      this.again = trigger;
      return;
    }
    this.evaluating = true;
    try {
      this.look(trigger);
    } finally {
      this.evaluating = false;
    }
    if (this.again) {
      const next = this.again;
      this.again = null;
      this.evaluate(next);
    }
  }

  private look(trigger: AudioTrigger): void {
    const node = this.node();
    this.bind(node ? node.context as AudioContextLike : null);

    const state = AudioHealthHelper.normalise(this.context?.state);
    const visible = this.visible();
    const now = this.clock();

    if (state !== this.lastState) {
      this.diagnostics.log('platform', 'audio: state', () => ({ from: this.lastState, to: state, trigger, visible }));
      this.lastState = state;
    }

    // How long it has been asleep with the page in front of the person: the clock stops while hidden.
    if (AudioHealthHelper.wantsGesture(state, visible)) this.asleepSince ??= now;
    else this.asleepSince = null;

    if (AudioHealthHelper.shouldResume(state, trigger, visible)) this.resume(trigger);

    const asleepForMs = this.asleepSince === null ? 0 : now - this.asleepSince;
    const blocked = AudioHealthHelper.blocked(state, visible, asleepForMs);
    this.publish({ state, blocked });

    if (AudioHealthHelper.wantsGesture(state, visible)) this.listenForGesture();
    else this.stopListeningForGesture();

    // Not blocked yet, but asleep: look again when the grace ends, so the chip needs no other event.
    clearTimeout(this.graceTimer);
    this.graceTimer = undefined;
    if (this.asleepSince !== null && !blocked) {
      const remaining = Math.max(1, AUDIO_HEALTH.BLOCKED_GRACE_MS - asleepForMs);
      this.zone.runOutsideAngular(() => {
        this.graceTimer = setTimeout(() => this.evaluate('grace'), remaining);
      });
    }
  }

  /**
   * `resume()` is not awaited: on WebKit without a gesture it can stay pending for ever, and the
   * `statechange` event is what answers. A tap is three events (`pointerup`, `touchend`, `click`), and
   * each is asked, because which of them carries the activation WebKit counts is not something this can
   * know; but only the first of a burst is written to the log, with its answer.
   */
  private resume(trigger: AudioTrigger): void {
    const context = this.context;
    if (!context) return;
    const now = this.clock();
    const loud = now - this.lastResumeLogAt >= AUDIO_HEALTH.RESUME_LOG_GAP_MS;
    if (loud) {
      this.lastResumeLogAt = now;
      this.diagnostics.log('platform', 'audio: resume asked', () => ({ trigger, state: context.state }));
    }
    try {
      context.resume().then(
        () => { if (loud) this.diagnostics.log('platform', 'audio: resume answered', () => ({ trigger, state: context.state })); },
        error => { if (loud) this.diagnostics.log('platform', 'audio: resume refused', () => ({ trigger, error })); },
      );
    } catch (error) {
      this.diagnostics.log('platform', 'audio: resume threw', () => ({ trigger, error }));
    }
  }

  /** Follow one context's `statechange` at a time. */
  private bind(next: AudioContextLike | null): void {
    if (next === this.context) return;
    this.context?.removeEventListener('statechange', this.onStateChange);
    this.context = next;
    this.context?.addEventListener('statechange', this.onStateChange);
  }

  private publish(next: AudioStatus): void {
    const current = this.statusSubject.value;
    if (current.state === next.state && current.blocked === next.blocked) return;
    this.zone.run(() => this.statusSubject.next(next));
  }

  private listenForGesture(): void {
    if (this.gestureListening) return;
    this.gestureListening = true;
    this.zone.runOutsideAngular(() => {
      for (const type of AUDIO_HEALTH.GESTURE_EVENTS) document.addEventListener(type, this.onGesture, { capture: true, passive: true });
    });
  }

  private stopListeningForGesture(): void {
    if (!this.gestureListening) return;
    this.gestureListening = false;
    for (const type of AUDIO_HEALTH.GESTURE_EVENTS) document.removeEventListener(type, this.onGesture, { capture: true });
  }
}
