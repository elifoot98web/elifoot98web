/**
 * Keeps the multiplayer cursor overlay aligned with whatever element it sits on top of —
 * the emulator canvas on the host, the video element on a guest.
 *
 * Both of those elements resize for reasons outside Angular's change detection. On the
 * host, js-dos re-lays-out its canvas whenever `#game-container` changes size (it watches
 * that element — also `.emulator-root` — with its own resize detector): a window resize,
 * a rotation (which also drops the header in mobile landscape), the mobile URL bar
 * collapsing, a fullscreen change, or `isHidden` flipping `.full` on at boot. NOT a chat
 * toggle any more — the chat is an overlay that changes no box — and NOT the js-dos
 * virtual keyboard, which is `position:absolute; bottom:0` inside the same root.
 *
 * On a guest, the video's box follows its intrinsic size (CSS letterboxing, see
 * join-game.page.scss), which changes on a DOS video-mode change or on WebRTC encoder
 * downscaling. The *captured* track resolution follows the host's DOS frame size and is
 * independent of the host's layout.
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
