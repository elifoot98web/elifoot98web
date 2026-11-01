import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, distinctUntilChanged, Observable, Subscription } from 'rxjs';
import { CaretState, CaretWatcher, FrameLike } from '../../helpers/caret-watch.helper';
import { FieldHint, FieldHintHelper, FieldHintSignals } from '../../helpers/field-hint.helper';
import { IBeamHelper } from '../../helpers/ibeam.helper';
import { FIELD_HINT } from '../../models/constants';
import { DosCI } from '../../typings/jsdos';
import { DiagnosticsService } from '../shared/diagnostics.service';
import { TouchInputService } from './touch-input.service';

/** What js-dos's frame listener reaches: the watcher of the moment, or nothing. */
interface FrameHook {
  watcher: CaretWatcher | null;
}

/**
 * "Does the guest have a text field in front of it?", as a hint (`hint$`) for the live type bar and
 * the deck's Texto button, from two signals that each see part of it (see FieldHintHelper): a caret
 * blinking in the guest (CaretWatcher, from the frame events) and the guest's cursor being an
 * I-beam where the last tap landed (IBeamHelper, from one screenshot per tap).
 *
 * **It is a hint and nothing gates on it.** The shortcut hazard it exists for: on a screen without
 * a text field the letters are game commands (A is Automático, M is Melhores), so live typing there
 * would fire them, and a badge says "nenhum campo detectado". But a field whose text is selected
 * blinks no caret, and a selected field is most of the fields a form walks into, so "nenhum campo"
 * is a statement about what was SEEN. It never blocks a key and never opens the OS keyboard (iOS
 * opens one only from a tap, and both signals arrive after it).
 *
 * **It runs only while the live keyboard setting is on** (`start()` / `stop()` from the page). Off, it
 * owns nothing: no subscription, no timer and no work per frame. One thing it cannot take back: js-dos
 * has no way to remove a frame listener, so the one it registers on the emulator stays until the
 * emulator goes, as a closure that does nothing while `stop()` has been called (the page registers it once per
 * emulator, however many times the setting is flipped). A frame event is one array push when it
 * does something, and one null check when it does not.
 *
 * Everything runs outside Angular's zone; `hint$` is the only thing that comes back in, and only
 * when the answer changes.
 */
@Injectable({
  providedIn: 'root'
})
export class FieldHintService {
  /** One frame listener per emulator, kept for the length of its life (js-dos cannot remove it). */
  private static readonly hooks = new WeakMap<object, FrameHook>();

  private readonly hintSubject = new BehaviorSubject<FieldHint>('none');
  readonly hint$: Observable<FieldHint> = this.hintSubject.pipe(distinctUntilChanged());

  private ci: DosCI | null = null;
  private watcher: CaretWatcher | null = null;
  private clicks: Subscription | null = null;
  private lookHandle: ReturnType<typeof setTimeout> | null = null;
  private staleHandle: ReturnType<typeof setTimeout> | null = null;
  private signals: FieldHintSignals = { caret: false, ibeam: null };

  /**
   * Milliseconds on a monotonic clock. A spec under `fakeAsync` replaces it with `Date.now`, which
   * zone.js fakes and `performance.now` it does not.
   */
  clock: () => number = () => performance.now();

  constructor(private zone: NgZone, private touch: TouchInputService, private diagnostics: DiagnosticsService) { }

  get hint(): FieldHint {
    return this.hintSubject.value;
  }

  get running(): boolean {
    return this.ci !== null;
  }

  /** Start watching an emulator. Idempotent for the same one; a different one replaces it. */
  start(dosCI: DosCI): void {
    if (this.ci === dosCI) return;
    this.stop();
    this.ci = dosCI;
    this.signals = { caret: false, ibeam: null };

    this.zone.runOutsideAngular(() => {
      this.watcher = new CaretWatcher({
        now: () => this.clock(),
        screenshot: () => dosCI.screenshot() as Promise<FrameLike>,
        timers: {
          setTimeout: (handler, ms) => setTimeout(handler, ms),
          clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
        onChange: (state: CaretState) => this.onCaret(state),
        log: (message, data) => this.diagnostics.log('frame', message, data),
      });
      this.hookFrames(dosCI);
      this.clicks = this.touch.clicks$.subscribe(point => this.scheduleLook(point.x, point.y));
    });
    this.diagnostics.log('frame', 'field hint on');
  }

  stop(): void {
    if (!this.ci) return;
    const hook = FieldHintService.hooks.get(this.ci);
    if (hook) hook.watcher = null;
    this.watcher?.dispose();
    this.watcher = null;
    this.clicks?.unsubscribe();
    this.clicks = null;
    this.clearTimer('lookHandle');
    this.clearTimer('staleHandle');
    this.ci = null;
    this.signals = { caret: false, ibeam: null };
    this.publish();
    this.diagnostics.log('frame', 'field hint off');
  }

  // ----------------------------------------------------------------------------------- signals

  /** Registers js-dos's frame listener the first time this emulator is seen, and points it at the watcher of the moment. */
  private hookFrames(dosCI: DosCI): void {
    let hook = FieldHintService.hooks.get(dosCI);
    if (!hook) {
      const created: FrameHook = { watcher: null };
      FieldHintService.hooks.set(dosCI, created);
      dosCI.events().onFrame(() => created.watcher?.onFrame());
      hook = created;
    }
    hook.watcher = this.watcher;
  }

  private onCaret(state: CaretState): void {
    this.signals = { ...this.signals, caret: state.active };
    this.publish();
  }

  /** Look at the cursor a moment after a tap: Windows has had time to set its shape. */
  private scheduleLook(x: number, y: number): void {
    this.clearTimer('lookHandle');
    this.lookHandle = setTimeout(() => {
      this.lookHandle = null;
      void this.look(x, y);
    }, FIELD_HINT.IBEAM_LOOK_DELAY_MS);
  }

  private async look(x: number, y: number): Promise<void> {
    const dosCI = this.ci;
    if (!dosCI) return;
    try {
      const frame = await dosCI.screenshot();
      if (this.ci !== dosCI) return;
      const began = this.clock();
      const look = IBeamHelper.look(frame, x, y);
      this.diagnostics.log('frame', 'i-beam look', () => ({ tap: { x, y }, ...look, ms: Math.round((this.clock() - began) * 10) / 10 }));
      this.signals = { ...this.signals, ibeam: { at: this.clock(), seen: look.found } };
      this.publish();
    } catch (error) {
      this.diagnostics.log('frame', 'i-beam look failed', () => ({ error: String(error) }));
    }
  }

  /** Recompute the answer, tell the app if it changed, and schedule the moment it could change by itself. */
  private publish(): void {
    const now = this.clock();
    const hint = FieldHintHelper.combine(this.signals, now);
    this.clearTimer('staleHandle');
    const stale = FieldHintHelper.staleIn(this.signals, now);
    if (stale !== null && this.ci) {
      this.zone.runOutsideAngular(() => {
        this.staleHandle = setTimeout(() => { this.staleHandle = null; this.publish(); }, stale + 1);
      });
    }

    if (hint !== this.hintSubject.value) {
      this.diagnostics.log('frame', 'field hint', () => ({ hint, caret: this.signals.caret, ibeam: this.signals.ibeam?.seen ?? null }));
      this.zone.run(() => this.hintSubject.next(hint));
    }
  }

  private clearTimer(name: 'lookHandle' | 'staleHandle'): void {
    const handle = this[name];
    if (handle !== null) clearTimeout(handle);
    this[name] = null;
  }
}
