import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { CameraDirection, CameraGeometry, CameraOrientation, CameraPoint, CameraState, GuestFrame, PinchStep, StoredCameraViews, ViewportTransform as V } from '../../helpers/viewport-transform.helper';
import { CAMERA, STORAGE_KEY } from '../../models/constants';
import { DiagnosticsService } from '../shared/diagnostics.service';
import { LocalStorageService } from '../shared/local-storage.service';
import type { TouchCamera } from './touch-input.service';

/** The elements the camera works with. The page builds it from the DOM js-dos made, like the touch layer's surface. */
export interface CameraSurface {
  /** The clip: `.game-stream-container`. Its content box is the camera's view, and it is what cuts the picture off. */
  stage: HTMLElement;
  /** The picture's root, `#game-container` (`.emulator-root`). The transform goes here and nowhere else. */
  root: HTMLElement;
  /** The canvas inside the root: where a guest pixel is in it. */
  canvas: HTMLElement;
  /** The guest's frame size now (`dosCI.width()` and `height()`). */
  frame: () => GuestFrame;
}

export interface CameraOptions {
  /** Called for every gesture and every button: the page passes the one that wakes a sleeping guest. */
  activity?: () => void;
  /** Milliseconds on a monotonic clock. A spec under `fakeAsync` hands in `Date.now`, which it fakes (and `performance.now` it does not). */
  now?: () => number;
}

/** What the controls and the page need to know, without hearing about every frame of a pinch. */
export interface CameraView {
  attached: boolean;
  /** The setting is on and the surface exists: the camera does something. */
  enabled: boolean;
  scale: number;
  /** Magnified (past the fit). The page grows the view into the band under the picture while this holds in portrait. */
  zoomed: boolean;
  /** "Ajustar" at the fit, otherwise "1,5x". */
  label: string;
  canZoomIn: boolean;
  canZoomOut: boolean;
}

const OFF: CameraView = { attached: false, enabled: false, scale: 1, zoomed: false, label: 'Ajustar', canZoomIn: false, canZoomOut: false };

/** What one two-finger gesture has done, for the log. */
interface GestureRecord {
  origin: CameraPoint;
  startedScale: number;
  steps: number;
  clamps: number;
  lastLogAt: number;
}

/**
 * The in-app camera: zoom and pan of the HOST's picture, by one transform on `#game-container` that the stage clips. Phase P11,
 * and behind a setting (`STORAGE_KEY.CAMERA_ENABLED`, off as shipped): the maths is {@link ViewportTransform}, the fingers are
 * {@link CameraGesture} (fed by `TouchInputService`, which owns two-finger input), and this is the part that owns the element, the
 * observers and what is remembered.
 *
 * **The contract (CLAUDE.md, *The camera*).**
 *
 * - **The transform is on the picture's root and nowhere else, and it is `translate` and `scale` with the origin at the corner.**
 *   Never the canvas alone, never a rotation. The root's own box is untouched, so js-dos does not re-letterbox (its resize
 *   detector watches that box), `OverlaySyncHelper` (which reads untransformed `offset*` of two nodes that scale together) and
 *   every remote cursor stay aligned, and `captureStream` (the canvas's backing store) is the whole frame whatever the zoom is.
 * - **At the fit there is NO transform**: the property is removed, not set to `scale(1)`, which would still make a compositing layer.
 *   With the setting off, or at the fit, the page is the page it was before this existed.
 * - **The clip is the stage** (`overflow: hidden` on `.game-stream-container`, which already had it). In portrait it may grow into
 *   the free band under the picture while the picture is magnified (`.camera-tall`, global.scss); the PICTURE's box does not
 *   change, so that is invisible to js-dos.
 * - **Re-clamped from a ResizeObserver** on the clip and the root: a rotation, the address bar, fullscreen and the clip growing or
 *   shrinking all arrive as a resize. A rotation also swaps in the camera that was left in the other orientation.
 * - **Host only.** Spectators receive the canvas stream, which a transform does not touch, and their cursors are normalised to the
 *   full picture; the page of a spectator does not know this exists.
 * - **No timers while idle, nothing left behind**: the only timer is the debounced save; `detach()` flushes it and takes the
 *   transform, the custom property and the observers off the page.
 *
 * Runs outside Angular's zone: a pinch is pointer events at the display rate. The state the page binds ({@link view$}) is emitted
 * inside it, and only when it changes in a way a view can show (the label, whether the picture is magnified, the enabled flag).
 */
@Injectable({ providedIn: 'root' })
export class CameraService implements TouchCamera, OnDestroy {

  private readonly viewSubject = new BehaviorSubject<CameraView>(OFF);
  /** Whether the picture is magnified, what to write on the Zoom tab, which buttons work. Emits only when one of those changes. */
  readonly view$: Observable<CameraView> = this.viewSubject.asObservable();

  private surface: CameraSurface | null = null;
  private options: CameraOptions = {};
  private observer: ResizeObserver | null = null;
  private setting = false;
  private state: CameraState = { ...V.IDENTITY };
  /** The geometry `state` was last made valid for: a rotation stores the old camera against the old window, not the new one. */
  private geometryOfState: CameraGeometry | null = null;
  private views: StoredCameraViews = {};
  private orientation: CameraOrientation = 'portrait';
  private gesture: GestureRecord | null = null;
  private lastClick: { content: CameraPoint; at: number } | null = null;
  /**
   * A camera was stored for this orientation but the picture had no size to put it on yet (the page attaches while the game is still
   * hidden and not laid out): the first resize that gives it one restores it, as long as nobody has touched the camera meanwhile.
   */
  private pendingRestore = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** What was last written to the element, so an unchanged state costs no style write. */
  private written: string | null = null;
  private unscaleWritten: string | null = null;
  /** Bumped by every attach and detach, so a timer of an earlier page cannot touch the next one. */
  private epoch = 0;

  constructor(
    private zone: NgZone,
    private diagnostics: DiagnosticsService,
    private storage: LocalStorageService,
  ) { }

  // ------------------------------------------------------------------ what the page asks

  /** The camera does something now: the setting is on and the picture is there. This is {@link TouchCamera.enabled}. */
  get enabled(): boolean {
    return this.setting && this.surface !== null;
  }

  get current(): Readonly<CameraState> {
    return this.state;
  }

  get zoomed(): boolean {
    return V.isZoomed(this.state);
  }

  /** What storage said, for the page to hand over before it attaches (storage is read by the page like every other setting). */
  configure(enabled: boolean, storedViews: unknown): void {
    this.views = V.normaliseViews(storedViews);
    this.setting = enabled;
    this.log('camera setting', () => ({ enabled, stored: Object.keys(this.views) }));
    this.restore('configure');
  }

  /** Put the camera on the picture. Attaching again lets go of the previous one first. */
  attach(surface: CameraSurface, options: CameraOptions = {}): void {
    this.detach('replaced');
    this.surface = surface;
    this.options = options;
    this.orientation = this.orientationNow();
    this.epoch++;
    this.zone.runOutsideAngular(() => {
      // The clip and the root: the clip changes size with the window and the deck; the root's box is the picture's, which the
      // stage plan changes. Neither is changed by the transform, so the observer is never fed its own output.
      this.observer = new ResizeObserver(() => this.refresh());
      this.observer.observe(surface.stage);
      this.observer.observe(surface.root);
    });
    this.restore('attach');
    this.publish();
    this.log('camera attached', () => ({ enabled: this.setting, orientation: this.orientation, ...this.geometryOfNow() }));
  }

  /** Take the camera off the page: the transform, the property and the observers go, and what was left is written. */
  detach(reason = 'detach'): void {
    const surface = this.surface;
    if (!surface) return;
    this.flush();
    this.epoch++;
    this.observer?.disconnect();
    this.observer = null;
    this.endGesture(reason, false);
    this.write({ ...V.IDENTITY });
    this.surface = null;
    this.geometryOfState = null;
    this.state = { ...V.IDENTITY };
    this.lastClick = null;
    this.publish();
    this.log('camera detached', () => ({ reason }));
  }

  ngOnDestroy(): void {
    this.detach('destroyed');
  }

  /** The "Zoom e movimento" switch. Off puts the picture back exactly as it was; the camera that was left is kept for when it is on again. */
  setEnabled(on: boolean): void {
    if (on === this.setting) return;
    this.flush();
    this.setting = on;
    this.log('camera setting', () => ({ enabled: on }));
    this.endGesture('setting changed', false);
    if (on) this.restore('enabled');
    else this.apply({ ...V.IDENTITY }, { persist: false });
    this.publish();
  }

  // ------------------------------------------------------------------ the buttons

  /** A preset ("1,5x", "2x"), or `1` for "Ajustar". Zooms about the last click when it was recent, otherwise the middle of the view. */
  zoomTo(scale: number): void {
    if (!this.ready()) return;
    this.pendingRestore = false;
    this.options.activity?.();
    const geometry = this.geometryOfNow();
    const next = V.zoomTo(this.state, geometry, scale, this.focal(geometry));
    this.log('camera preset', () => ({ from: this.state.scale, to: next.scale }));
    this.apply(next);
  }

  /** "+" and "-": one rung of the ladder. */
  zoomStep(direction: 1 | -1): void {
    if (!this.ready()) return;
    this.zoomTo(V.stepScale(this.state.scale, direction));
  }

  /** "Ajustar". */
  fit(): void {
    this.zoomTo(1);
  }

  /** The pad: look one press in a direction. */
  nudge(direction: CameraDirection): void {
    if (!this.ready() || !this.zoomed) return;
    this.options.activity?.();
    const next = V.nudge(this.state, this.geometryOfNow(), direction);
    this.log('camera nudge', () => ({ direction, x: round(next.x), y: round(next.y) }));
    this.apply(next);
  }

  // ------------------------------------------------------------------ two fingers (TouchCamera)

  gestureStart(): void {
    const surface = this.surface;
    if (!surface || !this.setting) return;
    this.options.activity?.();
    this.pendingRestore = false;
    const box = surface.stage.getBoundingClientRect();
    this.gesture = { origin: { x: box.left, y: box.top }, startedScale: this.state.scale, steps: 0, clamps: 0, lastLogAt: Number.NEGATIVE_INFINITY };
    this.log('camera pinch start', () => ({ scale: round(this.state.scale), x: round(this.state.x), y: round(this.state.y) }));
  }

  /** One step of the fingers, in page px. */
  gestureStep(step: PinchStep): void {
    const gesture = this.gesture;
    if (!gesture || !this.surface) return;
    const geometry = this.geometryOfNow();
    const local: PinchStep = {
      from: { x: step.from.x - gesture.origin.x, y: step.from.y - gesture.origin.y },
      to: { x: step.to.x - gesture.origin.x, y: step.to.y - gesture.origin.y },
      factor: step.factor,
    };
    const before = this.state;
    const next = V.pinch(before, geometry, local);

    // Where the fingers asked to go, without the clamp: a difference is the camera standing at an edge or at a limit of the scale.
    const asked = before.scale * (Number.isFinite(step.factor) && step.factor > 0 ? step.factor : 1);
    const under = V.contentAt(before, local.from);
    const clamped = Math.abs(asked - next.scale) > 1e-9
      || Math.abs(local.to.x - under.x * next.scale - next.x) > 0.5 || Math.abs(local.to.y - under.y * next.scale - next.y) > 0.5;
    gesture.steps++;
    const now = this.clock();
    if (clamped) {
      gesture.clamps++;
      if (now - gesture.lastLogAt >= CAMERA.LOG_PINCH_EVERY_MS) {
        gesture.lastLogAt = now;
        this.log('camera clamp', () => ({ scale: round(next.scale), asked: round(asked), x: round(next.x), y: round(next.y) }));
      }
    } else if (now - gesture.lastLogAt >= CAMERA.LOG_PINCH_EVERY_MS) {
      gesture.lastLogAt = now;
      this.log('camera pinch', () => ({ factor: round(step.factor), scale: round(next.scale), dx: round(local.to.x - local.from.x), dy: round(local.to.y - local.from.y) }));
    }
    this.apply(next, { persist: false });
  }

  gestureEnd(reason: string): void {
    this.endGesture(reason, true);
  }

  /**
   * A click went out at a guest pixel: bring what it opens into view. It is always remembered (the buttons zoom about it), but the picture
   * only moves when nothing else has hold of it: the click promise settles after the cursor's paced walk, which on a slow phone is long enough
   * for a new finger to land or a pinch to start, and the picture sliding under a live finger would send its next move somewhere else.
   */
  clicked(point: { x: number; y: number }, options: { follow?: boolean } = {}): void {
    const surface = this.surface;
    if (!surface || !this.setting) return;
    const geometry = this.geometryOfNow();
    const frame = this.frameOf(surface);
    // No frame (the emulator is gone, or has not drawn): there is no pixel to bring into view.
    if (!frame) return;
    const content = V.guestToContent(this.canvasBox(surface), frame, point.x, point.y);
    this.lastClick = { content, at: this.clock() };
    if (!this.zoomed || options.follow === false || this.gesture) return;
    const next = V.reveal(this.state, geometry, content);
    if (next === this.state) return;
    this.log('camera follow', () => ({ guest: `${point.x},${point.y}`, x: round(next.x), y: round(next.y) }));
    this.apply(next);
  }

  // ------------------------------------------------------------------ the observer

  /**
   * The clip or the picture changed size (a rotation, the address bar, fullscreen, the band growing or folding): keep the camera
   * valid for the new geometry, and when the window turned, swap the camera that was left in the other orientation in.
   * Public because the observer calls it and a spec does without a layout engine's timing.
   */
  refresh(): void {
    const surface = this.surface;
    if (!surface) return;
    const orientation = this.orientationNow();
    if (orientation !== this.orientation) {
      // The camera is stored against the geometry it was valid for, which is the old window's, not this one's.
      const old = this.orientation;
      if (this.setting && this.geometryOfState) {
        this.views = V.withView(this.views, old, V.isZoomed(this.state) ? V.toStored(this.state, this.geometryOfState) : null);
        this.saveViews();
      }
      this.orientation = orientation;
      this.endGesture('rotation', false);
      this.log('camera rotation', () => ({ from: old, to: orientation }));
      this.restore('rotation');
      this.publish();
      return;
    }
    if (!this.setting) return;
    const geometry = this.geometryOfNow();
    if (!this.hasSize(geometry)) return;
    if (this.pendingRestore) {
      this.restore('first layout');
      return;
    }
    const next = V.clamp(this.state, geometry);
    if (next.scale !== this.state.scale || next.x !== this.state.x || next.y !== this.state.y) {
      this.log('camera reclamp', () => ({ view: `${geometry.view.width}x${geometry.view.height}`, from: round(this.state.x) + ',' + round(this.state.y), to: round(next.x) + ',' + round(next.y) }));
    }
    this.apply(next, { persist: false });
    this.geometryOfState = geometry;
  }

  // ------------------------------------------------------------------ internals

  private ready(): boolean {
    return this.enabled && this.hasSize(this.geometryOfNow());
  }

  private hasSize(geometry: CameraGeometry): boolean {
    return geometry.view.width > 0 && geometry.view.height > 0 && geometry.content.width > 0 && geometry.content.height > 0;
  }

  /** The view and the picture, untransformed: the clip's content box and the root's `offset*`. */
  private geometryOfNow(): CameraGeometry {
    const surface = this.surface;
    if (!surface) return { view: { width: 0, height: 0 }, content: { width: 0, height: 0 } };
    return {
      view: { width: surface.stage.clientWidth, height: surface.stage.clientHeight },
      content: { width: surface.root.offsetWidth, height: surface.root.offsetHeight },
    };
  }

  /** The guest's frame, or null when there is none to speak of (`dosCI` is the page's `any`, and an exited emulator answers anything). */
  private frameOf(surface: CameraSurface): GuestFrame | null {
    try {
      const frame = surface.frame();
      return frame.width > 0 && frame.height > 0 ? frame : null;
    } catch {
      return null;
    }
  }

  /** Where the canvas is inside the root (its `offset*`, which is the whole root unless js-dos letterboxes). */
  private canvasBox(surface: CameraSurface): { left: number; top: number; width: number; height: number } {
    const canvas = surface.canvas;
    return { left: canvas.offsetLeft, top: canvas.offsetTop, width: canvas.offsetWidth, height: canvas.offsetHeight };
  }

  /** A seam for the spec: the orientation of the window. */
  protected orientationNow(): CameraOrientation {
    return V.orientationOf(window.innerWidth, window.innerHeight);
  }

  protected devicePixelRatio(): number {
    return window.devicePixelRatio || 1;
  }

  private clock(): number {
    return (this.options.now ?? (() => performance.now()))();
  }

  /** The view point a button zooms about: the last click when it was recent and is on the view, otherwise the middle. */
  private focal(geometry: CameraGeometry): CameraPoint {
    const middle = { x: geometry.view.width / 2, y: geometry.view.height / 2 };
    const click = this.lastClick;
    if (!click || this.clock() - click.at > CAMERA.FOCUS_CLICK_MS) return middle;
    const at = V.viewAt(this.state, click.content);
    const onView = at.x >= 0 && at.x <= geometry.view.width && at.y >= 0 && at.y <= geometry.view.height;
    return onView ? at : middle;
  }

  /** The camera this orientation was left at (or the fit), made valid for the window as it is. */
  private restore(reason: string): void {
    const surface = this.surface;
    if (!surface) return;
    if (!this.setting) {
      this.apply({ ...V.IDENTITY }, { persist: false });
      return;
    }
    const geometry = this.geometryOfNow();
    const stored = this.views[this.orientation];
    this.pendingRestore = !!stored && !this.hasSize(geometry);
    const next = stored && this.hasSize(geometry) ? V.fromStored(stored, geometry) : { ...V.IDENTITY };
    this.apply(next, { persist: false });
    if (stored && !this.pendingRestore) this.log('camera restored', () => ({ reason, orientation: this.orientation, scale: round(next.scale) }));
  }

  private endGesture(reason: string, settle: boolean): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    const before = this.state;
    if (settle && this.setting && this.surface) this.apply(V.settle(this.state));
    this.log('camera pinch end', () => ({ reason, steps: gesture.steps, clamps: gesture.clamps, from: round(gesture.startedScale), to: round(this.state.scale), snappedToFit: settle && before.scale !== this.state.scale && this.state.scale === 1 }));
  }

  /** Make a state the camera's: clamp it, write it, tell the page what changed, and remember it. */
  private apply(requested: CameraState, options: { persist?: boolean } = {}): void {
    const surface = this.surface;
    if (!surface) return;
    const geometry = this.geometryOfNow();
    const next = this.hasSize(geometry) ? V.clamp(requested, geometry) : { ...V.IDENTITY };
    this.state = next;
    this.geometryOfState = geometry;
    this.write(this.hasSize(geometry) ? V.snap(next, geometry, this.devicePixelRatio()) : next);
    this.publish();
    if (options.persist !== false && this.setting) this.scheduleSave();
  }

  /** The one place the element is touched. */
  private write(state: CameraState): void {
    const surface = this.surface;
    if (!surface) return;
    const css = V.css(state);
    if (css !== this.written) {
      this.written = css;
      const style = surface.root.style;
      if (css === null) {
        style.removeProperty('transform');
        style.removeProperty('transform-origin');
        // An element that never had an inline style gets its attribute back as it was, not as `style=""`.
        if (surface.root.getAttribute('style') === '') surface.root.removeAttribute('style');
      } else {
        style.transformOrigin = '0 0';
        style.transform = css;
      }
    }
    // What the tap rings undo, so a 44 px ring stays 44 px on the screen however far the picture is magnified.
    const unscale = css === null ? null : String(Math.round(1 / state.scale * 10000) / 10000);
    if (unscale !== this.unscaleWritten) {
      this.unscaleWritten = unscale;
      if (unscale === null) {
        surface.root.style.removeProperty('--camera-unscale');
        if (surface.root.getAttribute('style') === '') surface.root.removeAttribute('style');
      } else {
        surface.root.style.setProperty('--camera-unscale', unscale);
      }
    }
  }

  private publish(): void {
    const enabled = this.enabled;
    const view: CameraView = this.surface
      ? {
        attached: true,
        enabled,
        scale: this.state.scale,
        zoomed: enabled && V.isZoomed(this.state),
        label: V.isZoomed(this.state) ? V.label(this.state.scale) : 'Ajustar',
        canZoomIn: enabled && this.state.scale < CAMERA.MAX_SCALE,
        canZoomOut: enabled && this.state.scale > 1,
      }
      : OFF;
    const before = this.viewSubject.value;
    const same = before.attached === view.attached && before.enabled === view.enabled
      && before.zoomed === view.zoomed && before.canZoomIn === view.canZoomIn && before.canZoomOut === view.canZoomOut
      // The scale changes at every step of a pinch, and so does its label: that is told when the fingers lift, not a hundred times.
      && (this.gesture !== null || before.label === view.label);
    // Inside the zone, and only for a change a view can show: a pinch is a hundred steps and one or two of those.
    if (!same) this.zone.run(() => this.viewSubject.next(view));
  }

  // ------------------------------------------------------------------ what is kept

  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    const epoch = this.epoch;
    this.saveTimer = this.zone.runOutsideAngular(() => setTimeout(() => {
      this.saveTimer = null;
      if (epoch === this.epoch) this.remember();
    }, CAMERA.SAVE_DEBOUNCE_MS));
  }

  /** Write now what a pending save would write, and cancel it. */
  private flush(): void {
    if (this.saveTimer === null) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.remember();
  }

  private remember(): void {
    if (!this.surface || !this.setting || !this.geometryOfState) return;
    this.views = V.withView(this.views, this.orientation, V.isZoomed(this.state) ? V.toStored(this.state, this.geometryOfState) : null);
    this.saveViews();
  }

  private saveViews(): void {
    const views = this.views;
    this.storage.set<StoredCameraViews>(STORAGE_KEY.CAMERA_VIEWS, views).catch(error => {
      // It applies for this visit either way.
      console.warn('Could not store the camera', error);
    });
  }

  private log(message: string, data?: () => Record<string, unknown>): void {
    this.diagnostics.log('touch', message, data);
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
