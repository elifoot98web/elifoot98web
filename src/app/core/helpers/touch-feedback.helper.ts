import { TOUCH_INPUT } from '../models/constants';

/** What a pulse is for: the look is the same family, the weight says which. */
export type TouchFeedbackKind = 'tap' | 'double';

/**
 * The visible half of a tap. The guest cursor is a ~6x10 css px sprite and sits under the
 * fingertip, so without this a tap that landed looks exactly like one that was lost.
 *
 * It is DOM in the app, appended to the game surface, and never part of the guest's frame: the
 * canvas the spectators receive (`captureStream`) is untouched, and so is every screen-scraper,
 * which reads `dosCI.screenshot()`. The rings are absolutely positioned and `pointer-events:
 * none`, so they cannot change the surface's size (js-dos re-letterboxes its canvas whenever
 * `#game-container` resizes) or take a touch away from it. Their look is in `global.scss`
 * (`.touch-feedback`), because the nodes are created here and a component stylesheet would not
 * reach them.
 *
 * Coordinates are page (client) px. They are turned into the surface's own by the rectangle's
 * scale as well as its origin, so the same call stays right when a camera transform is put on the
 * surface (P11).
 */
export class TouchFeedbackHelper {
  private readonly rings: HTMLElement[] = [];
  private follower: HTMLElement | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly root: HTMLElement) { }

  /** A ring that appears at the point and fades out, once. */
  pulse(kind: TouchFeedbackKind, clientX: number, clientY: number): void {
    while (this.rings.length >= TOUCH_INPUT.FEEDBACK_MAX_RINGS) this.remove(this.rings[0]);

    const ring = this.create(`touch-feedback--${kind}`);
    this.place(ring, clientX, clientY);
    this.root.appendChild(ring);
    this.rings.push(ring);

    // `animationend` is the normal end. The timer is for a browser that runs no animation at all
    // (reduced motion set to none, a hidden page): the node would otherwise stay for good.
    ring.addEventListener('animationend', () => this.remove(ring), { once: true });
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.remove(ring);
    }, TOUCH_INPUT.FEEDBACK_RING_MS + 250);
    this.timers.add(timer);
  }

  /**
   * The ring that stays under a finger that is dragging or aiming. Created on first use. It moves by
   * `transform`, not `left`/`top`: it is called at the pointer rate, and a style write that dirties
   * layout would make the next rectangle read of the next event (this one's, and the layer's own in
   * `toGuest`) force a reflow every time.
   */
  follow(clientX: number, clientY: number): void {
    if (!this.follower) {
      this.follower = this.create('touch-feedback--hold');
      this.follower.style.left = '0';
      this.follower.style.top = '0';
      this.root.appendChild(this.follower);
    }
    const { x, y } = this.toSurface(clientX, clientY);
    this.follower.style.transform = `translate(${x}px, ${y}px)`;
  }

  stopFollowing(): void {
    this.follower?.remove();
    this.follower = null;
  }

  /** Remove everything this put on the surface. */
  dispose(): void {
    this.stopFollowing();
    for (const ring of [...this.rings]) this.remove(ring);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private create(modifier: string): HTMLElement {
    const element = document.createElement('div');
    element.className = `touch-feedback ${modifier}`;
    element.setAttribute('aria-hidden', 'true');
    return element;
  }

  private place(element: HTMLElement, clientX: number, clientY: number): void {
    const { x, y } = this.toSurface(clientX, clientY);
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  }

  /** Page px to the surface's own px, undoing any transform on it. */
  private toSurface(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.root.getBoundingClientRect();
    // offsetWidth is the untransformed width, the rectangle's is the transformed one.
    const scale = this.root.offsetWidth > 0 && rect.width > 0 ? rect.width / this.root.offsetWidth : 1;
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
  }

  private remove(ring: HTMLElement): void {
    ring.remove();
    const index = this.rings.indexOf(ring);
    if (index >= 0) this.rings.splice(index, 1);
  }
}
