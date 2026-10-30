/**
 * Keeps the multiplayer cursor overlay aligned with whatever element it sits on top of —
 * the emulator canvas on the host, the video element on a guest.
 *
 * Both of those elements resize for reasons outside Angular's change detection. On the
 * host, js-dos re-lays-out its canvas whenever `#game-container` changes size (it watches
 * that element — also `.emulator-root` — with its own resize detector): a window resize,
 * a rotation (which also drops the header in landscape-compact), the mobile URL bar
 * collapsing, a fullscreen change, `isHidden` flipping `.full` on at boot, and the stage
 * plan changing (StageLayoutService): a landscape chat docking beside the picture or folding
 * the rails, the player's view mode, the safe areas. In landscape that container IS the
 * picture (its size is `--stage-w` x `--stage-h`, written by the plan), so the canvas fills it
 * and the canvas's offset inside it is zero; in portrait the picture's box is pinned to its 4:3
 * height and neither the chat under it nor the control deck's band can change it. NOT the
 * deck's launcher sheet, which is `position:absolute` over the page, nor the rails' keys or
 * the OS keyboard, which the plan does not read. (js-dos's own virtual keyboard used to be in
 * this list; it is no longer built.)
 *
 * On a guest, the video's box is fitted from its frame RATIO (see `fitVideoToContainer`) into
 * a container that is the same stage the host's is, so the two pictures are the same size at
 * the same window. The *captured* track resolution follows the host's DOS frame size and is
 * independent of the host's layout, and the fit is by ratio on purpose: WebRTC ramps the
 * encoder up from a low resolution on every join, and a fit from intrinsic pixels made the
 * picture visibly grow.
 *
 * A ResizeObserver covers all of those cases uniformly, including every intermediate
 * frame of a CSS transition.
 *
 * Alignment moves the overlay box. Cursors already inside it keep the pixel coordinates
 * `CursorRendererHelper` gave them, so every caller of `align()` must follow it with
 * `CursorRendererHelper.repositionAll(overlay)`.
 */
export class OverlaySyncHelper {
  /**
   * Position `overlay` exactly over `target`.
   */
  static align(overlay: HTMLElement, target: HTMLElement): void {
    overlay.style.position = 'absolute';
    overlay.style.pointerEvents = 'none';
    overlay.style.left = `${target.offsetLeft}px`;
    overlay.style.top = `${target.offsetTop}px`;
    overlay.style.width = `${target.offsetWidth}px`;
    overlay.style.height = `${target.offsetHeight}px`;
  }

  /**
   * Re-run `onResize` whenever any of `targets` changes size.
   *
   * Pass only elements the callback does not itself resize, or the observer is fed its
   * own output. The callback on both pages writes to the absolutely-positioned overlay
   * only, which cannot affect the layout of the canvas, the video or their container —
   * so the host observes `[canvas, container]` and the guest `[video, container]`.
   *
   * @returns a disposer that stops observing.
   */
  static observe(targets: (HTMLElement | null | undefined)[], onResize: () => void): () => void {
    const observer = new ResizeObserver(() => onResize());
    targets.forEach(target => {
      if (target) observer.observe(target);
    });
    return () => observer.disconnect();
  }
}
