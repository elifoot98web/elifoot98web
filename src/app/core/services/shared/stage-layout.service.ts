import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, filter, Observable, Subscription } from 'rxjs';
import { LayoutShapeHelper, LayoutViewport } from '../../helpers/layout-shape.helper';
import { StageHelper, StageInsets, StagePlan, StageView } from '../../helpers/stage.helper';
import { STAGE } from '../../models/constants';
import { DiagnosticsService } from './diagnostics.service';
import { LayoutHelperService } from './layout-helper.service';

/** The properties written on <html>, and the only place their names are spelled. */
const PROPERTIES = ['--stage-w', '--stage-h', '--stage-mx', '--stage-my', '--stage-left', '--stage-right', '--chat-panel-width', '--chat-dock-w'] as const;

/**
 * Writes the page's layout where the stylesheets can read it, and tells the components that draw the rails.
 *
 * **What it owns is the stage**: the box of the 4:3 picture, `--stage-w` and `--stage-h` in px, exactly the size
 * `.game-stream-container` has in landscape (explicit, no longer `flex: 1`), so that `#game-container` IS the picture and
 * the gutters on either side are rails instead of an overlay on the container. The answer is
 * {@link StageHelper.plan}, a pure function; this is the part that reads the page for it and writes the result back:
 *
 * - the box: the element the page lays out in (`.game-stream-flex-container`), measured with one ResizeObserver, which also
 *   covers the address bar collapsing, a fullscreen change and a rotation;
 * - the shape of the window, from `LayoutHelperService.viewport$`, which is already immune to the OS keyboard;
 * - the safe areas, read from a hidden probe element whose padding is `env(safe-area-inset-*)` (CSS is the only way to
 *   ask a browser for them);
 * - what the page tells it: whether the deck is shown (`setKeys`), whether the chat is docked open (`setChat`) and the
 *   player's view mode (`setView`).
 *
 * **What it does not read is the point of the contract**: not the OS keyboard (`--kb-inset`, `visualViewport`, and the
 * height a browser that resizes its layout viewport for the keyboard takes from the element: see `recompute`), not what is
 * inside a rail or a panel, not the chat's own state, not a transform. A second `start()` on the other page (the
 * spectator's) reuses all of it, which is how the guest's picture ends up the host's size at the same window.
 *
 * Closing the chat is delayed by the time its slide-out takes (`CHAT_CLOSE_DELAY_MS`): the width it holds is given back
 * to the stage only when the panel has left, as the old CSS did with a transition delay. Opening is immediate.
 *
 * Everything is logged through the diagnostics service (category `layout`), once per CHANGE of the plan.
 */
@Injectable({ providedIn: 'root' })
export class StageLayoutService implements OnDestroy {

  private readonly planSubject = new BehaviorSubject<StagePlan | null>(null);
  /** The plan, once there is one: after `start()` and a box that is not zero. */
  readonly plan$: Observable<StagePlan> = this.planSubject.pipe(filter((plan): plan is StagePlan => plan !== null));

  private host: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private subscription: Subscription | null = null;
  private probe: HTMLElement | null = null;
  private viewport: LayoutViewport | null = null;

  private keys = false;
  private view: StageView = 'fit';
  /** What the page asked for, and what the plan is built from (it lags the first by the slide-out when closing). */
  private chatOpen = false;
  private chatDocked = false;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by every start and stop, so a timer of an earlier mount cannot touch the next one. */
  private epoch = 0;

  constructor(
    private layout: LayoutHelperService,
    private diagnostics: DiagnosticsService,
    private zone: NgZone,
  ) { }

  /** The current plan, or null before the first one. */
  get plan(): StagePlan | null {
    return this.planSubject.value;
  }

  /**
   * Begin laying out `host`, the page's flex row. Called once the element is in the DOM; calling it again for another
   * element (the next page) lets go of the first.
   */
  start(host: HTMLElement): void {
    this.stop();
    this.epoch++;
    this.host = host;
    this.probe = this.createProbe();
    this.subscription = this.layout.viewport$.subscribe(viewport => {
      this.viewport = viewport;
      this.recompute('viewport');
    });
    // Outside the zone: it fires on every resize of the page, and nearly always with nothing to say.
    this.zone.runOutsideAngular(() => {
      this.observer = new ResizeObserver(() => this.recompute('box'));
      this.observer.observe(host);
      // The safe areas can change without the window changing size (fullscreen, an installed app's status bar, a device
      // override): the probe's border box is the sum of its paddings, so it moves with them. A browser that cannot observe
      // a border box (Safari before 15.4) ignores the option and relies on the resize and the rotation, which carry them.
      this.observer.observe(this.probe!, { box: 'border-box' });
    });
    this.recompute('start');
  }

  /** Let go of the page: the properties go (a page without a stage must not inherit one) and nothing is left scheduled. */
  stop(): void {
    this.epoch++;
    this.observer?.disconnect();
    this.observer = null;
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.clearCloseTimer();
    this.probe?.remove();
    this.probe = null;
    this.host = null;
    this.viewport = null;
    if (this.planSubject.value) {
      const style = document.documentElement.style;
      PROPERTIES.forEach(name => style.removeProperty(name));
      this.planSubject.next(null);
    }
    this.keys = false;
    this.view = 'fit';
    this.chatOpen = false;
    this.chatDocked = false;
  }

  ngOnDestroy(): void {
    this.stop();
  }

  /** The control deck is shown, so the rails carry keys. */
  setKeys(on: boolean): void {
    if (on === this.keys) return;
    this.keys = on;
    this.recompute('keys');
  }

  /** "Tamanho da imagem". */
  setView(view: StageView): void {
    if (view === this.view) return;
    this.view = view;
    this.recompute('view');
  }

  /** The chat is open beside the picture. Opening takes the room at once; closing gives it back after the slide-out. */
  setChat(open: boolean): void {
    if (open === this.chatOpen) return;
    this.chatOpen = open;
    this.clearCloseTimer();
    const delay = open ? 0 : this.closeDelay();
    if (delay === 0) {
      this.chatDocked = open;
      this.recompute('chat');
      return;
    }
    const epoch = this.epoch;
    this.closeTimer = this.zone.runOutsideAngular(() => setTimeout(() => {
      this.closeTimer = null;
      if (epoch !== this.epoch || this.chatOpen) return;
      this.chatDocked = false;
      this.recompute('chat closed');
    }, delay));
  }

  /** No slide-out under reduced motion (global.scss drops the transition), so nothing to wait for. */
  private closeDelay(): number {
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return reduced ? 0 : STAGE.CHAT_CLOSE_DELAY_MS;
  }

  private clearCloseTimer(): void {
    if (this.closeTimer !== null) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  private recompute(reason: string): void {
    const host = this.host;
    const viewport = this.viewport;
    if (!host || !viewport) return;
    // A page that is not on screen (the spectator's, until it has a room) measures 0x0, and a plan made of that would
    // write a zero-size stage. The observer fires again when the box is real.
    if (host.clientWidth <= 0 || host.clientHeight <= 0) return;
    // The shape is the SETTLED viewport (LayoutShapeHelper.settle holds it while a field has the focus and the window has
    // shrunk to the OS keyboard's size), but the element is measured live. A browser that resizes the layout viewport for
    // the keyboard (older Android WebViews, some OEM browsers: the case settle exists for) shrinks the element with it, and
    // a stage planned from that box would follow the keyboard, which the contract says it never does. What the window
    // lost against the settled viewport is therefore given back to the box: the box the page had before the keyboard.
    // Only at the same width (a rotation is believed, so the two agree again) and never negative.
    const live = this.liveViewport();
    const covered = live.width === viewport.width ? Math.max(0, viewport.height - live.height) : 0;
    const box = { width: host.clientWidth, height: host.clientHeight + covered };

    const shape = LayoutShapeHelper.of(viewport.width, viewport.height);
    const insets = this.readInsets();
    const next = StageHelper.plan({ box, shape, insets, keys: this.keys, chat: this.chatDocked, view: this.view });
    // A window too small to hold a stage keeps the last one that was written: a 0 px picture is not a layout.
    if (shape !== 'portrait' && next.stage.width < STAGE.MIN_STAGE_WIDTH) return;

    const before = this.planSubject.value;
    if (StageHelper.samePlan(before, next)) return;
    this.write(next);
    this.zone.run(() => this.planSubject.next(next));
    this.diagnostics.log('layout', 'stage plan', () => ({
      reason,
      viewport: `${viewport.width}x${viewport.height}`,
      box: `${box.width}x${box.height}`,
      covered,
      shape,
      view: this.view,
      keys: this.keys,
      chat: this.chatDocked,
      insets: `${insets.top}/${insets.right}/${insets.bottom}/${insets.left}`,
      columns: `${next.leftColumns}${next.leftFolded ? 'f' : ''}+${next.rightColumns}`,
      left: next.left,
      right: next.right,
      stage: `${next.stage.width}x${next.stage.height}`,
      at: `${next.offset.x},${next.offset.y}`,
      lossPercent: Math.round(StageHelper.loss(next, box) * 1000) / 10,
    }));
  }

  /** The window as it is this instant, which is not always the settled viewport (see `recompute`). A seam for the spec. */
  protected liveViewport(): LayoutViewport {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  private write(plan: StagePlan): void {
    const style = document.documentElement.style;
    style.setProperty('--stage-w', `${plan.stage.width}px`);
    style.setProperty('--stage-h', `${plan.stage.height}px`);
    // The picture's offset: from the end of the left rail (where its flex item starts) and from the top of the row.
    style.setProperty('--stage-mx', `${plan.offset.x - plan.left}px`);
    style.setProperty('--stage-my', `${plan.offset.y}px`);
    style.setProperty('--stage-left', `${plan.left}px`);
    style.setProperty('--stage-right', `${plan.right}px`);
    style.setProperty('--chat-panel-width', `${plan.chatPanel}px`);
    style.setProperty('--chat-dock-w', `${plan.chatDocked}px`);
  }

  /**
   * The safe areas, in whole px. CSS is the only way to ask for them: a hidden, fixed, zero-size element whose padding is
   * `env(safe-area-inset-*)` reports them back as its computed padding. Zero wherever the browser has none, and whenever
   * it cannot be read.
   */
  protected readInsets(): StageInsets {
    if (!this.probe) return { top: 0, right: 0, bottom: 0, left: 0 };
    const style = getComputedStyle(this.probe);
    const px = (value: string) => {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
    };
    return { top: px(style.paddingTop), right: px(style.paddingRight), bottom: px(style.paddingBottom), left: px(style.paddingLeft) };
  }

  private createProbe(): HTMLElement {
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;box-sizing:content-box;overflow:hidden;visibility:hidden;pointer-events:none;'
      + 'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
    document.body.appendChild(probe);
    return probe;
  }
}
