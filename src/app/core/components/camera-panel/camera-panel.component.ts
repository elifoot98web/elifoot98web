import { ChangeDetectionStrategy, Component, Input, NgZone, OnDestroy } from '@angular/core';
import { CameraDirection } from '../../helpers/viewport-transform.helper';
import { KeyRepeatScheduler, KeyRepeatTimers } from '../../helpers/key-repeat.helper';
import { CAMERA } from '../../models/constants';
import { CameraService } from '../../services/game';
import { DiagnosticsService } from '../../services/shared';

/**
 * The camera's panel in the control deck ("Zoom"): the same things two fingers do, for a hand that cannot pinch or would rather not
 * (WCAG 2.5.1: a gesture that needs two fingers also needs a single-pointer way), and for the devices where a pinch is unreliable.
 * Ajustar, 1,5x and 2x; "+" and "-" one rung at a time; and a pad that moves the VIEW, a quarter of it per press, repeating
 * while it is held. It is the deck's own look (`.deck-key` keycaps, `.deck-face`), laid out in _deck.scss.
 *
 * Every key is an `appDeckKey` and presses as the finger lands or lifts like the deck's own, so it never takes the focus from the
 * game and releases exactly once. The preset keys press on the lift (`deckKeyOn="up"`): inside the sheet this panel can scroll, and a
 * scroll gesture starts as a touch on a key. The pad presses on the landing, because a held key repeats.
 *
 * In portrait the panel is the one panel that does NOT take the band: the camera grows into what the band leaves, so the picture
 * can be seen while the panel is used (the page, `camera-tall`).
 *
 * It keeps no state of its own: the camera is the service's, and the keys that are lit (the preset in force) and the ones that cannot
 * do anything (the ladder's ends) are read from its view.
 */
@Component({
  selector: 'app-camera-panel',
  templateUrl: './camera-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class CameraPanelComponent implements OnDestroy {

  /** A room is live: the panel says that spectators see the whole picture, whatever the host's camera does. */
  @Input() hosting = false;

  readonly view$ = this.camera.view$;
  readonly presets = CAMERA.PRESETS;
  readonly pad: ReadonlyArray<{ direction: CameraDirection; glyph: string; label: string }> = [
    { direction: 'left', glyph: '←', label: 'Ver mais à esquerda' },
    { direction: 'up', glyph: '↑', label: 'Ver mais acima' },
    { direction: 'down', glyph: '↓', label: 'Ver mais abaixo' },
    { direction: 'right', glyph: '→', label: 'Ver mais à direita' },
  ];

  private readonly repeats = new Map<CameraDirection, KeyRepeatScheduler>();
  /** Outside Angular's zone: a held key ticks eleven times a second and none of it is a change the view shows. */
  private readonly timers: KeyRepeatTimers = {
    setTimeout: (handler, ms) => this.zone.runOutsideAngular(() => setTimeout(handler, ms)),
    clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };

  constructor(private camera: CameraService, private diagnostics: DiagnosticsService, private zone: NgZone) { }

  ngOnDestroy(): void {
    this.repeats.forEach(scheduler => scheduler.stop('cancel'));
  }

  presetLabel(scale: number): string {
    return `${String(scale).replace('.', ',')}x`;
  }

  /** The key of the preset in force is lit; at the fit it is "Ajustar". */
  isPreset(view: { scale: number }, scale: number): boolean {
    return Math.abs(view.scale - scale) < 0.005;
  }

  fit(): void {
    this.camera.fit();
  }

  zoomTo(scale: number): void {
    this.camera.zoomTo(scale);
  }

  zoomStep(direction: 1 | -1): void {
    this.camera.zoomStep(direction);
  }

  padDown(direction: CameraDirection): void {
    this.repeatOf(direction).start();
  }

  padUp(direction: CameraDirection): void {
    this.repeats.get(direction)?.stop('release');
  }

  private repeatOf(direction: CameraDirection): KeyRepeatScheduler {
    let scheduler = this.repeats.get(direction);
    if (!scheduler) {
      scheduler = new KeyRepeatScheduler(
        { delayMs: CAMERA.NUDGE_REPEAT_DELAY_MS, intervalMs: CAMERA.NUDGE_REPEAT_INTERVAL_MS, maxPending: 1, maxHoldMs: 10 * 1000 },
        { fire: () => this.camera.nudge(direction), pending: () => 0 },
        this.timers,
        (reason, fired) => {
          if (reason !== 'cancel' && fired > 0) this.diagnostics.log('touch', 'camera pad held', () => ({ direction, reason, repeats: fired }));
        },
      );
      this.repeats.set(direction, scheduler);
    }
    return scheduler;
  }
}
