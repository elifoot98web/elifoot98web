import { Injectable, NgZone } from '@angular/core';
import { WAKE_LOCK } from '../../models/constants';
import { WakeLockDenial, WakeLockHelper, WakeLockTrigger } from '../../helpers/wake-lock.helper';
import { DiagnosticsService } from './diagnostics.service';

/** The part of a `WakeLockSentinel` this service uses; a spec stands in for it. */
export interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

/** The part of `navigator.wakeLock` this service uses; a spec stands in for it. */
export interface WakeLockApiLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/** What the service needs to know about the page it serves; it owns none of it. */
export interface WakeLockOptions {
  /** The player's switch ("Manter a tela ligada"). Ignored while {@link inRoom} is true. */
  setting: boolean;
  /** A room is open (hosting or watching). It holds the screen whatever the switch says. */
  inRoom: () => boolean;
}

/**
 * Keeps the screen on while the game runs, so that a phone does not dim and lock in the middle of a
 * match: a locked page is a hidden page, where js-dos pauses the emulator, and a host's stream
 * freezes for everyone in the room. The rules are {@link WakeLockHelper}; this owns the sentinel,
 * the listeners and the log.
 *
 * **Everything is feature-detected and degrades to nothing.** Screen Wake Lock is Chrome 84+,
 * Safari 16.4+ and Firefox 126+; below that `supported` is false, the menu says so, and the app
 * works exactly as before. The floor of the build (Safari 14.1, iOS 14.5) is untouched.
 *
 * **The browser releases the lock when the page hides**, so the page's `visibilitychange` back to
 * visible asks again, and so does the sentinel's own `release` event while the page is visible
 * (the battery saver came on, say; at most `QUICK_RELEASE_LIMIT` quick ones in a row, so a browser
 * that grants and takes back at once is not asked in a loop). A request the browser refuses
 * (`NotAllowedError`: battery saver, a browser that wants a gesture first) is logged and waits for
 * something that could change the answer: the page coming back, a new wish, or a tap, at most
 * every `GESTURE_RETRY_MIN_MS`. The tap listener exists only while such a refusal is waiting.
 *
 * **A room overrides the switch**: a hosting phone that locks freezes everyone's picture, and a
 * watching one leaves the room. The page calls `refresh()` when the room opens or closes.
 *
 * It is a root service with no per-room state, so it has no `clear()` for `leaveRoom()`: the page
 * starts it and stops it, and `stop()` releases the lock. It logs into the diagnostics log under
 * `platform` and runs its listeners outside Angular's zone.
 */
@Injectable({
  providedIn: 'root'
})
export class WakeLockService {
  private options: WakeLockOptions | null = null;
  private sentinel: WakeLockSentinelLike | null = null;
  private onSentinelRelease: (() => void) | null = null;
  private requesting = false;
  private denial: WakeLockDenial | null = null;
  private lastAttemptAt = -Infinity;
  private grantedAt = 0;
  private quickReleases = 0;
  /** Moved on by every start() and stop(): a request that lands after its run ended finds out and lets go. */
  private run = 0;
  private gestureListening = false;

  constructor(private zone: NgZone, private diagnostics: DiagnosticsService) { }

  /** Where `navigator.wakeLock` comes from; a spec overrides it. */
  protected api(): WakeLockApiLike | undefined {
    return typeof navigator === 'undefined' ? undefined : (navigator as { wakeLock?: WakeLockApiLike }).wakeLock;
  }

  protected visible(): boolean {
    return document.visibilityState === 'visible';
  }

  /** Milliseconds; a spec under `fakeAsync` leaves it on `Date.now`, which zone.js fakes. */
  protected clock(): number {
    return Date.now();
  }

  /** Whether this browser has the API at all. */
  get supported(): boolean {
    return this.api() !== undefined;
  }

  get running(): boolean {
    return this.options !== null;
  }

  /** Whether a lock is held right now. */
  get holding(): boolean {
    return this.sentinel !== null;
  }

  /** The wish: the service is running and either a room is open or the switch is on. */
  get wanted(): boolean {
    return WakeLockHelper.wanted({
      running: this.options !== null,
      setting: this.options?.setting ?? false,
      inRoom: this.options?.inRoom() ?? false,
    });
  }

  /** The menu's words under the switch. */
  get summary(): string {
    return WakeLockHelper.describe({
      supported: this.supported,
      wanted: this.wanted,
      holding: this.holding,
      denial: this.denial,
      inRoom: this.options?.inRoom() ?? false,
    });
  }

  /**
   * Begin serving a page: ask for the lock if it is wanted, and keep asking as the page hides and
   * shows. Idempotent; a second call replaces the options and looks again.
   */
  start(options: WakeLockOptions): void {
    const first = this.options === null;
    this.options = options;
    if (first) {
      this.run++;
      this.denial = this.supported ? null : 'unsupported';
      this.quickReleases = 0;
      this.zone.runOutsideAngular(() => document.addEventListener('visibilitychange', this.onVisibility));
      this.diagnostics.log('platform', 'wake lock: service started', () => ({ supported: this.supported, setting: options.setting, inRoom: options.inRoom() }));
    }
    this.evaluate('wish');
  }

  /** The player flipped the switch. */
  setSetting(on: boolean): void {
    if (!this.options) return;
    this.options = { ...this.options, setting: on };
    this.diagnostics.log('platform', 'wake lock: setting chosen', () => ({ on }));
    this.quickReleases = 0;
    this.evaluate('wish');
  }

  /** The wish may have changed without the service being told: a room opened or closed. */
  refresh(): void {
    if (!this.options) return;
    this.evaluate('wish');
  }

  /** Let go and forget the page. Safe to call twice. */
  stop(): void {
    if (!this.options) return;
    this.options = null;
    this.run++;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.stopListeningForGesture();
    this.release('service stopped');
    this.requesting = false;
    this.diagnostics.log('platform', 'wake lock: service stopped');
  }

  private readonly onVisibility = (): void => {
    if (this.visible()) {
      // A page that comes back starts the quick-release count over: the browser let go because the page hid.
      this.quickReleases = 0;
      this.diagnostics.log('platform', 'wake lock: page visible again', () => ({ holding: this.holding }));
      this.evaluate('visible');
    } else {
      this.diagnostics.log('platform', 'wake lock: page hidden', () => ({ holding: this.holding }));
    }
  };

  private readonly onGesture = (): void => {
    this.evaluate('gesture');
  };

  private evaluate(trigger: WakeLockTrigger): void {
    if (!this.options) return;
    // A refusal that was waiting for a tap has nothing to wait for once the wish is gone.
    if (!this.wanted) this.stopListeningForGesture();
    const step = WakeLockHelper.decide({
      wanted: this.wanted,
      visible: this.visible(),
      holding: this.holding,
      requesting: this.requesting,
      denial: this.denial,
      trigger,
      sinceAttemptMs: this.clock() - this.lastAttemptAt,
    });
    if (step === 'release') this.release('no longer wanted');
    else if (step === 'request') void this.acquire(trigger);
  }

  private async acquire(trigger: WakeLockTrigger): Promise<void> {
    const api = this.api();
    if (!api) {
      this.denial = 'unsupported';
      return;
    }
    const run = this.run;
    this.requesting = true;
    this.lastAttemptAt = this.clock();
    let sentinel: WakeLockSentinelLike;
    try {
      sentinel = await api.request('screen');
    } catch (error) {
      if (run !== this.run) return;
      this.requesting = false;
      this.denial = WakeLockHelper.denialOf(error);
      this.diagnostics.log('platform', 'wake lock: refused', () => ({ trigger, kind: this.denial, error }));
      this.listenForGestureIfWaiting();
      return;
    }

    if (run !== this.run) {
      // The page was left (and perhaps another started) while the browser was thinking: not ours any more,
      // and the flags are the new run's to set.
      this.diagnostics.log('platform', 'wake lock: granted after the page was left, released');
      await sentinel.release().catch(() => undefined);
      return;
    }
    this.requesting = false;
    if (!this.wanted) {
      // The wish went away while the browser was thinking: hand it back.
      this.diagnostics.log('platform', 'wake lock: granted too late, released');
      await sentinel.release().catch(() => undefined);
      return;
    }

    this.sentinel = sentinel;
    this.denial = null;
    this.grantedAt = this.clock();
    this.stopListeningForGesture();
    const onRelease = () => this.onSentinelReleased(sentinel);
    this.onSentinelRelease = onRelease;
    sentinel.addEventListener('release', onRelease);
    this.diagnostics.log('platform', 'wake lock: granted', () => ({ trigger }));
  }

  /** The browser took the lock back: the page hid, the battery saver came on, or the system decided. */
  private onSentinelReleased(sentinel: WakeLockSentinelLike): void {
    if (sentinel !== this.sentinel) return;
    const heldMs = this.clock() - this.grantedAt;
    this.sentinel = null;
    this.onSentinelRelease = null;
    const visible = this.visible();
    const quick = visible && WakeLockHelper.quickRelease(heldMs);
    this.quickReleases = quick ? this.quickReleases + 1 : 0;
    this.diagnostics.log('platform', 'wake lock: released by the browser', () => ({ heldMs, visible, quickReleases: this.quickReleases }));

    if (!visible) return; // the page coming back asks again
    if (this.quickReleases >= WAKE_LOCK.QUICK_RELEASE_LIMIT) {
      this.denial = 'failed';
      this.diagnostics.log('platform', 'wake lock: unstable, not asking again until the page returns');
      return;
    }
    this.evaluate('released');
  }

  /** Our own letting go: the wish went away, or the page did. */
  private release(why: string): void {
    const sentinel = this.sentinel;
    if (!sentinel) return;
    this.sentinel = null;
    if (this.onSentinelRelease) sentinel.removeEventListener('release', this.onSentinelRelease);
    this.onSentinelRelease = null;
    this.diagnostics.log('platform', 'wake lock: released', () => ({ why }));
    sentinel.release().catch(() => undefined);
  }

  /** A `not-allowed` refusal may only need a tap; nothing is listened for while nothing is waiting. */
  private listenForGestureIfWaiting(): void {
    if (this.denial !== 'not-allowed' || !this.wanted || this.gestureListening) return;
    this.gestureListening = true;
    this.zone.runOutsideAngular(() => {
      for (const type of WAKE_LOCK.GESTURE_EVENTS) document.addEventListener(type, this.onGesture, { capture: true, passive: true });
    });
  }

  private stopListeningForGesture(): void {
    if (!this.gestureListening) return;
    this.gestureListening = false;
    for (const type of WAKE_LOCK.GESTURE_EVENTS) document.removeEventListener(type, this.onGesture, { capture: true });
  }
}
