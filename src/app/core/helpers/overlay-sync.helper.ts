/**
 * Keeps the multiplayer cursor overlay aligned with whatever element it sits on top of —
 * the emulator canvas on the host, the video element on a guest.
 *
 * Both of those elements resize for reasons outside Angular's change detection: js-dos
 * re-lays-out its canvas whenever `#game-container` changes size (it watches the container
 * with its own resize detector), the chat sidebar animates its width over 300ms, and a
 * guest's video changes dimensions when the host's captured track changes resolution.
 * A ResizeObserver covers all of those cases uniformly, including every intermediate
 * frame of a CSS transition.
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
   * Pass only elements the callback does not itself resize. The guest observes its
   * container rather than the video, because its callback sets the video's dimensions
   * and observing it would feed the observer its own output.
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
