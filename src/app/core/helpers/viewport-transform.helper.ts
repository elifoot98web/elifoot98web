import { CAMERA } from '../models/constants';

/** A size in css px. */
export interface CameraSize {
  width: number;
  height: number;
}

/** A point in css px. Which space it is in (the view's, the picture's, the page's) is said where it is used. */
export interface CameraPoint {
  x: number;
  y: number;
}

/**
 * The camera: the picture scaled by `scale` about ITS OWN top-left corner, then moved by (`x`, `y`) css px inside the view.
 * That is `transform: translate(x, y) scale(scale)` with `transform-origin: 0 0` on `#game-container`, and nothing else:
 * no rotation, no skew, and never the canvas alone. `x` and `y` are zero or negative (the picture's corner is at or beyond
 * the view's, never inside it), and both are zero at the scale 1.
 */
export interface CameraState {
  scale: number;
  x: number;
  y: number;
}

/**
 * What the camera works inside, both in css px and both UNTRANSFORMED: the `view` is the clip (the box that cuts the picture
 * off, `.game-stream-container`'s content box) and the `content` is the picture's own box (`#game-container`'s `offsetWidth` and
 * `offsetHeight`, which a transform does not change). In landscape and in portrait without a zoom they are the same box.
 */
export interface CameraGeometry {
  view: CameraSize;
  content: CameraSize;
}

export type CameraDirection = 'left' | 'right' | 'up' | 'down';

/** The window's two orientations, which is all the camera remembers things per (a phone on its side wants another zoom). */
export type CameraOrientation = 'portrait' | 'landscape';

/** Where the camera was left: the scale and the CENTRE of the view as a fraction of the picture, so a different window restores the same part of it. */
export interface StoredCamera {
  scale: number;
  cx: number;
  cy: number;
}

export type StoredCameraViews = Partial<Record<CameraOrientation, StoredCamera>>;

/**
 * One step of a pinch, in the view's space: the content that was under the fingers' midpoint at `from` goes under the midpoint
 * at `to`, and the scale is multiplied by `factor` about it. A two-finger pan is a step whose factor is 1.
 */
export interface PinchStep {
  from: CameraPoint;
  to: CameraPoint;
  factor: number;
}

/** The guest's frame, in guest pixels. */
export interface GuestFrame {
  width: number;
  height: number;
}

/** A page point mapped into the guest's frame (whole guest pixels), and whether it is on the picture. */
export interface GuestHit {
  x: number;
  y: number;
  inside: boolean;
}

/**
 * What decides whether the camera's view grows into the free band under the picture (see {@link ViewportTransform.tallView}).
 * `deck` is DeckPresentation's `kind`, and `panel` what the deck's band holds now.
 */
export interface TallViewInput {
  zoomed: boolean;
  /** LayoutShape: only `portrait` has a band under the picture. */
  shape: 'portrait' | 'landscape-compact' | 'landscape-regular';
  chatOpen: boolean;
  deck: 'none' | 'band' | 'launcher' | 'rails';
  panel: 'tactics' | 'arrows' | 'more' | 'camera' | 'chat' | null;
}

const IDENTITY: Readonly<CameraState> = Object.freeze({ scale: 1, x: 0, y: 0 });

/**
 * The maths of the camera, with nothing else in it: no DOM, no clock, no storage, no setting. Every function takes the numbers
 * it needs and returns new ones, so the tables of a spec are the whole of its behaviour. {@link CameraService} owns the
 * element, the observers and the persistence; {@link CameraGesture} turns two fingers into {@link PinchStep}s.
 *
 * **The contract it serves (CLAUDE.md, *The camera*).** The picture's box is never resized by the camera: the transform is on the
 * picture's root, so js-dos does not re-letterbox, and `OverlaySyncHelper` (which reads untransformed `offset*` of two nodes that
 * scale together) and the remote cursors keep working. What follows from it is that a point of the PAGE is mapped to the guest
 * through the canvas's own rectangle (`getBoundingClientRect`, which includes the transform), as `TouchInputService` always did, so
 * the letterbox, the zoom and the pan are one formula ({@link clientToGuest}).
 *
 * **Where a picture smaller than the view sits.** At the start of the axis, not the middle: at the scale 1 view and picture are the
 * same box and nothing moves, and in portrait the view can be taller than the picture (the camera may grow into the free band under
 * it), where the picture growing from the top-left corner is what keeps it from jumping when the first pinch begins.
 */
export class ViewportTransform {

  static readonly IDENTITY: Readonly<CameraState> = IDENTITY;

  /** A scale from anywhere (a pinch ratio, storage) as one the camera can show: finite, and between {@link CAMERA.MIN_SCALE} and {@link CAMERA.MAX_SCALE}. */
  static clampScale(scale: number): number {
    if (!Number.isFinite(scale)) return CAMERA.MIN_SCALE;
    return Math.min(CAMERA.MAX_SCALE, Math.max(CAMERA.MIN_SCALE, scale));
  }

  /** Whether the state is the picture exactly as it is without a camera. */
  static isIdentity(state: CameraState): boolean {
    return state.scale === 1 && state.x === 0 && state.y === 0;
  }

  /** Whether the picture is magnified at all (the scale is past 1; a snapped fit is exactly 1). */
  static isZoomed(state: CameraState): boolean {
    return state.scale > 1;
  }

  /** How far the picture's corner may go: the lowest `x` and `y`. A picture no bigger than the view in an axis has no room to move in it. */
  static limits(scale: number, geometry: CameraGeometry): CameraPoint {
    const { view, content } = geometry;
    return {
      x: Math.min(0, view.width - content.width * scale),
      y: Math.min(0, view.height - content.height * scale),
    };
  }

  /** A state the camera can show: the scale in range and the picture covering the view wherever it is bigger than it. Never throws, never NaN. */
  static clamp(state: CameraState, geometry: CameraGeometry): CameraState {
    const scale = ViewportTransform.clampScale(state.scale);
    const limits = ViewportTransform.limits(scale, geometry);
    return {
      scale,
      x: ViewportTransform.within(state.x, limits.x),
      y: ViewportTransform.within(state.y, limits.y),
    };
  }

  private static within(value: number, lowest: number): number {
    if (!Number.isFinite(value)) return 0;
    // `0 - 0` and not `-0`: a negative zero would print as "-0px" and read as a change.
    return Math.min(0, Math.max(lowest, value)) + 0;
  }

  /** Where a point of the picture (its own px) is on the view. */
  static viewAt(state: CameraState, content: CameraPoint): CameraPoint {
    return { x: state.x + content.x * state.scale, y: state.y + content.y * state.scale };
  }

  /** The point of the picture (its own px) that is under a point of the view. */
  static contentAt(state: CameraState, view: CameraPoint): CameraPoint {
    return { x: (view.x - state.x) / state.scale, y: (view.y - state.y) / state.scale };
  }

  /**
   * Put the point `content` of the picture at the point `view` of the view, at `scale`. Every zoom is this: about a focal point
   * (the content under it stays under it), onto a click, or onto the middle of the view.
   */
  static place(geometry: CameraGeometry, scale: number, content: CameraPoint, view: CameraPoint): CameraState {
    const s = ViewportTransform.clampScale(scale);
    return ViewportTransform.clamp({ scale: s, x: view.x - content.x * s, y: view.y - content.y * s }, geometry);
  }

  /** Zoom to `scale` keeping the content under the view point `focal` where it is. */
  static zoomAbout(state: CameraState, geometry: CameraGeometry, focal: CameraPoint, scale: number): CameraState {
    return ViewportTransform.place(geometry, scale, ViewportTransform.contentAt(state, focal), focal);
  }

  /** Move the picture by (dx, dy) css px on the view. */
  static pan(state: CameraState, geometry: CameraGeometry, dx: number, dy: number): CameraState {
    return ViewportTransform.clamp({ scale: state.scale, x: state.x + dx, y: state.y + dy }, geometry);
  }

  /** One step of a pinch or a two-finger pan. */
  static pinch(state: CameraState, geometry: CameraGeometry, step: PinchStep): CameraState {
    const factor = Number.isFinite(step.factor) && step.factor > 0 ? step.factor : 1;
    return ViewportTransform.place(geometry, state.scale * factor, ViewportTransform.contentAt(state, step.from), step.to);
  }

  /**
   * The camera's answer to a preset or a "+" and "-": the scale `scale` about `focal`. The scale 1 is "Ajustar" and is the identity,
   * wherever the camera was.
   */
  static zoomTo(state: CameraState, geometry: CameraGeometry, scale: number, focal: CameraPoint): CameraState {
    if (!(scale > 1 + 1e-9)) return { ...IDENTITY };
    return ViewportTransform.zoomAbout(state, geometry, focal, scale);
  }

  /** A pinch that ended near the fit is the fit: the identity is the one state with no transform at all. */
  static settle(state: CameraState): CameraState {
    return state.scale < CAMERA.SNAP_TO_FIT ? { ...IDENTITY } : state;
  }

  /** The next rung of {@link CAMERA.STEPS} above (`1`) or below (`-1`) the scale, or the scale itself at the end of the ladder. */
  static stepScale(scale: number, direction: 1 | -1): number {
    const steps = CAMERA.STEPS;
    const epsilon = 1e-6;
    if (direction === 1) {
      return steps.find(step => step > scale + epsilon) ?? steps[steps.length - 1];
    }
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i] < scale - epsilon) return steps[i];
    }
    return steps[0];
  }

  /**
   * Move the VIEW one press of the pad in a direction: "right" looks further right, so the picture goes left. A fraction of the
   * view's own size, so a press is the same share of the screen at any zoom.
   */
  static nudge(state: CameraState, geometry: CameraGeometry, direction: CameraDirection, fraction = CAMERA.NUDGE_FRACTION): CameraState {
    const dx = geometry.view.width * fraction;
    const dy = geometry.view.height * fraction;
    switch (direction) {
      case 'left': return ViewportTransform.pan(state, geometry, dx, 0);
      case 'right': return ViewportTransform.pan(state, geometry, -dx, 0);
      case 'up': return ViewportTransform.pan(state, geometry, 0, dy);
      default: return ViewportTransform.pan(state, geometry, 0, -dy);
    }
  }

  /**
   * Bring a point of the picture into view with room around it: the least movement that leaves it `margin` (a fraction of the view)
   * from every edge, and none when it is already there. Menus and lists open below and beside what was tapped, so a click near an
   * edge of the view moves the view before the thing it opens is cut off.
   */
  static reveal(state: CameraState, geometry: CameraGeometry, content: CameraPoint, margin = CAMERA.FOLLOW_MARGIN): CameraState {
    if (!ViewportTransform.isZoomed(state)) return state;
    const at = ViewportTransform.viewAt(state, content);
    const mx = geometry.view.width * margin;
    const my = geometry.view.height * margin;
    const dx = ViewportTransform.shortfall(at.x, mx, geometry.view.width - mx);
    const dy = ViewportTransform.shortfall(at.y, my, geometry.view.height - my);
    // The very same state when there is nothing to do, so a caller can tell by identity and skip the write.
    return dx === 0 && dy === 0 ? state : ViewportTransform.pan(state, geometry, dx, dy);
  }

  /** How far to move a coordinate to bring it inside [low, high]; zero when it is, and the middle when the band is empty. */
  private static shortfall(value: number, low: number, high: number): number {
    if (low >= high) return (low + high) / 2 - value;
    if (value < low) return low - value;
    if (value > high) return high - value;
    return 0;
  }

  /**
   * The state to write: the translation on the device's pixel grid, so the canvas is never sampled on a fractional pixel it
   * did not need to be on, and the scale as it is. Rounded to the nearest device pixel, and then pulled back inside the limits
   * on the side that keeps the picture covering the view: a hairline of the clip's green past the picture's edge is worse
   * than half a pixel of the picture cut off.
   */
  static snap(state: CameraState, geometry: CameraGeometry, dpr: number): CameraState {
    if (ViewportTransform.isIdentity(state)) return state;
    const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const limits = ViewportTransform.limits(state.scale, geometry);
    const onGrid = (value: number, lowest: number) => {
      const rounded = Math.round(value * ratio) / ratio;
      const lowestOnGrid = Math.ceil(lowest * ratio - 1e-9) / ratio;
      return ViewportTransform.within(rounded, lowestOnGrid);
    };
    return { scale: state.scale, x: onGrid(state.x, limits.x), y: onGrid(state.y, limits.y) };
  }

  /** The CSS value for a state, or `null` for the identity: the element then gets NO transform (not `scale(1)`, which would still make it a compositing layer). */
  static css(state: CameraState): string | null {
    if (ViewportTransform.isIdentity(state)) return null;
    const px = (value: number) => `${Math.round(value * 1000) / 1000}px`;
    return `translate(${px(state.x)}, ${px(state.y)}) scale(${Math.round(state.scale * 10000) / 10000})`;
  }

  // ---------------------------------------------------------------- the page and the guest

  /**
   * Whether the camera's VIEW (the clip) grows down into the band under the picture: a portrait page whose picture is magnified and
   * whose band holds nothing but its taskbar, the camera's own panel (as tall as its keys, so the picture is still watched while it is
   * used) or nothing at all (no deck). A panel of keys or the chat takes the band, and the clip is the stage again. The PICTURE's box does
   * not depend on this, so it is invisible to js-dos and to the stage plan; see global.scss `.camera-tall`.
   */
  static tallView(input: TallViewInput): boolean {
    if (!input.zoomed || input.shape !== 'portrait' || input.chatOpen) return false;
    if (input.deck === 'none') return true;
    return input.deck === 'band' && (input.panel === null || input.panel === 'camera');
  }

  /**
   * A page point on the guest's frame, through the canvas's own rectangle in the page (`getBoundingClientRect`): the letterbox, the
   * zoom and the pan are all in that rectangle, so this is the one formula at every scale. Whole guest pixels (floor), and `inside`
   * says whether the point is on the canvas at all (a touch in the strip beside a letterboxed picture is not).
   */
  static clientToGuest(rect: Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height' | 'right' | 'bottom'>, frame: GuestFrame, x: number, y: number): GuestHit | null {
    if (!(rect.width > 0) || !(rect.height > 0) || !(frame.width > 0) || !(frame.height > 0)) return null;
    const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    const gx = Math.floor((x - rect.left) / rect.width * frame.width);
    const gy = Math.floor((y - rect.top) / rect.height * frame.height);
    // A point ON the right or the bottom edge is inside and floors to one past the last pixel; a point outside keeps its
    // number, which says how far outside it is.
    return {
      x: inside ? Math.min(frame.width - 1, Math.max(0, gx)) : gx,
      y: inside ? Math.min(frame.height - 1, Math.max(0, gy)) : gy,
      inside,
    };
  }

  /** The inverse: the page point at the CENTRE of a guest pixel (the point a finger aimed at that pixel would be on). */
  static guestToClient(rect: Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>, frame: GuestFrame, gx: number, gy: number): CameraPoint {
    return {
      x: rect.left + (gx + 0.5) / frame.width * rect.width,
      y: rect.top + (gy + 0.5) / frame.height * rect.height,
    };
  }

  /**
   * A point of the picture's box (its own, untransformed px) for a guest pixel: where the canvas sits inside the box (`canvas`, the
   * canvas's `offset*` in it, which is the whole box in landscape and a letterbox in a mode js-dos fits) and the centre of the pixel.
   */
  static guestToContent(canvas: { left: number; top: number; width: number; height: number }, frame: GuestFrame, gx: number, gy: number): CameraPoint {
    return {
      x: canvas.left + (gx + 0.5) / frame.width * canvas.width,
      y: canvas.top + (gy + 0.5) / frame.height * canvas.height,
    };
  }

  // ---------------------------------------------------------------- what is kept

  static orientationOf(width: number, height: number): CameraOrientation {
    return width > height ? 'landscape' : 'portrait';
  }

  /** The camera as it is kept: the scale and the centre of the view as a fraction of the picture. */
  static toStored(state: CameraState, geometry: CameraGeometry): StoredCamera {
    const { view, content } = geometry;
    const fraction = (centre: number, offset: number, size: number) =>
      size > 0 ? Math.min(1, Math.max(0, (centre - offset) / (size * state.scale))) : 0.5;
    return {
      scale: Math.round(state.scale * 1000) / 1000,
      cx: Math.round(fraction(view.width / 2, state.x, content.width) * 10000) / 10000,
      cy: Math.round(fraction(view.height / 2, state.y, content.height) * 10000) / 10000,
    };
  }

  /** The state a stored camera comes to in THIS window (which may be another size than the one it was left in). */
  static fromStored(stored: StoredCamera, geometry: CameraGeometry): CameraState {
    const scale = ViewportTransform.clampScale(stored.scale);
    if (!(scale > 1)) return { ...IDENTITY };
    const { view, content } = geometry;
    return ViewportTransform.place(
      geometry,
      scale,
      { x: stored.cx * content.width, y: stored.cy * content.height },
      { x: view.width / 2, y: view.height / 2 },
    );
  }

  /**
   * What storage gave back, as views: anything that is not an object of finite numbers is dropped, because storage is just another
   * input (a file from an older build, an edited value). A scale at the fit is not kept; it is the absence of a zoom.
   */
  static normaliseViews(raw: unknown): StoredCameraViews {
    if (!raw || typeof raw !== 'object') return {};
    const views: StoredCameraViews = {};
    for (const orientation of ['portrait', 'landscape'] as const) {
      const entry = (raw as Record<string, unknown>)[orientation];
      if (!entry || typeof entry !== 'object') continue;
      const { scale, cx, cy } = entry as Record<string, unknown>;
      if (typeof scale !== 'number' || typeof cx !== 'number' || typeof cy !== 'number') continue;
      if (![scale, cx, cy].every(Number.isFinite)) continue;
      const clamped = ViewportTransform.clampScale(scale);
      if (!(clamped > 1)) continue;
      views[orientation] = { scale: clamped, cx: Math.min(1, Math.max(0, cx)), cy: Math.min(1, Math.max(0, cy)) };
    }
    return views;
  }

  /** The views with one orientation replaced; the fit removes it, so a camera at Ajustar is not stored as a zoom. */
  static withView(views: StoredCameraViews, orientation: CameraOrientation, stored: StoredCamera | null): StoredCameraViews {
    const next: StoredCameraViews = { ...views };
    if (stored && stored.scale > 1) next[orientation] = stored;
    else delete next[orientation];
    return next;
  }

  /** The player's word on the camera, or the default for one who never gave it (and only on a device with a finger). */
  static enabled(stored: unknown, coarse: boolean, byDefault = CAMERA.DEFAULT_ENABLED): boolean {
    if (typeof stored === 'boolean') return stored;
    return byDefault && coarse;
  }

  /** "1,5x": the scale as the Zoom tab and the log write it (pt-BR decimal comma, no trailing zeros). */
  static label(scale: number): string {
    const rounded = Math.round(scale * 100) / 100;
    return `${String(rounded).replace('.', ',')}x`;
  }
}
