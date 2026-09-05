import { Injectable, OnDestroy } from '@angular/core';

/** Anything shorter than this is collapsing browser chrome or rounding noise. */
const MIN_KEYBOARD_INSET_PX = 60;

/**
 * Publishes the height of the on-screen keyboard as two CSS custom properties on <html>:
 *
 *   --kb-inset : the occluded strip at the bottom of the layout viewport, in px. `0px`
 *                with no keyboard, and permanently `0px` where visualViewport is absent.
 *   --kb-open  : `1` while that inset is non-zero, else `0`. Lets CSS drop
 *                `env(safe-area-inset-bottom)` padding the keyboard already covers,
 *                which cannot be derived from --kb-inset in plain CSS.
 *
 * Why measure instead of letting the layout resize: iOS Safari never shrinks the layout
 * viewport for the keyboard, and we must not make it. `interactive-widget=resizes-content`
 * or an Ionic scroll would resize `#game-container`, and js-dos re-lays-out its canvas
 * whenever that box changes — the exact jump the overlay chat exists to remove.
 * visualViewport reports the occlusion with zero layout effect.
 *
 * `offsetTop` is added to `height` because Safari may also shift the visual viewport down
 * while scrolling a field into view; innerHeight minus that bottom edge is the strip the
 * user cannot see. Android Chrome behaves the same under the default
 * `interactive-widget=resizes-visual`.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardInsetService implements OnDestroy {
  private consumers = 0;
  private frame: number | null = null;
  private published = -1;

  private readonly viewport: VisualViewport | null =
    typeof window === 'undefined' ? null : window.visualViewport;

  private readonly onViewportChange = () => this.schedule();

  /** Ref-counted: host and guest each mount their own chat panel. */
  start(): void {
    this.consumers += 1;
    if (this.consumers > 1) return;

    this.publish(0);
    if (!this.viewport) return; // No visualViewport: the properties stay at 0 forever.
    this.viewport.addEventListener('resize', this.onViewportChange);
    this.viewport.addEventListener('scroll', this.onViewportChange);
    this.measure();
  }

  stop(): void {
    if (this.consumers === 0) return;
    this.consumers -= 1;
    if (this.consumers > 0) return;
    this.teardown();
  }

  ngOnDestroy(): void {
    this.consumers = 0;
    this.teardown();
  }

  private teardown(): void {
    this.viewport?.removeEventListener('resize', this.onViewportChange);
    this.viewport?.removeEventListener('scroll', this.onViewportChange);
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.publish(0);
  }

  /** iOS fires resize+scroll several times per frame while the keyboard animates. */
  private schedule(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.measure();
    });
  }

  private measure(): void {
    if (!this.viewport) return;
    const occluded = window.innerHeight - (this.viewport.height + this.viewport.offsetTop);
    this.publish(occluded >= MIN_KEYBOARD_INSET_PX ? Math.round(occluded) : 0);
  }

  private publish(inset: number): void {
    if (inset === this.published) return;
    this.published = inset;
    const style = document.documentElement.style;
    style.setProperty('--kb-inset', `${inset}px`);
    style.setProperty('--kb-open', inset > 0 ? '1' : '0');
  }
}
