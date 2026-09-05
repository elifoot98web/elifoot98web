import { selfId } from "trystero";
import { CursorClickMessage, CursorPositionMessage } from "../models/multiplayer";
import { ColorHelper } from "./color.helper";
import { MULTIPLAYER } from "../models/constants";

/**
 * The overlay container owns the cursor elements it has already rendered, keyed by
 * peerId, so a later render can move them instead of rebuilding them.
 */
interface CursorHost extends HTMLElement {
  _cursorElements?: { [peerId: string]: HTMLElement };
}

export class CursorRendererHelper {
  static renderCursors(targetContainer: HTMLElement, cursors: { [peerId: string]: CursorPositionMessage }): void {
    const cursorElements = CursorRendererHelper.getCursorElements(targetContainer);

    // Remove elements for peers that no longer exist
    Object.keys(cursorElements).forEach(peerId => {
      if (!(peerId in cursors)) {
        targetContainer.removeChild(cursorElements[peerId]);
        delete cursorElements[peerId];
      }
    });

    const containerWidth = targetContainer.offsetWidth;
    const containerHeight = targetContainer.offsetHeight;

    Object.entries(cursors).forEach(([peerId, cursor]) => {
      const isSelf = peerId === selfId;
      let el = cursorElements[peerId];
      if (!el) {
        el = document.createElement('div');
        const img = document.createElement('img');
        const txt = document.createElement('p');
        el.className = `cursor${isSelf ? ' self' : ''}`;
        el.style.position = 'absolute';
        el.style.zIndex = `${MULTIPLAYER.CURSOR_Z_INDEX}`;
        el.style.pointerEvents = 'none'; // Prevent interaction with the native element
        // Remote positions arrive throttled, so interpolate between them to avoid
        // teleporting. The local cursor is deliberately left un-interpolated: it updates
        // on every pointer event, so a transition would restart before it ever finished
        // and the cursor would visibly trail the real pointer.
        if (!isSelf) {
          el.style.transition = `left ${MULTIPLAYER.CURSOR_SEND_THROTTLE_MS}ms linear, top ${MULTIPLAYER.CURSOR_SEND_THROTTLE_MS}ms linear`;
        }
        img.src = 'assets/cursor2.png';
        const filter = ColorHelper.getCSSFilterFromColor(cursor.color)
        img.style = filter;
        txt.innerText = isSelf ? 'Você' : cursor.name || peerId.slice(0, 6);
        txt.className = 'pointer-overlay-cursor-label';
        el.appendChild(img);
        el.appendChild(txt);
        targetContainer.appendChild(el);
        cursorElements[peerId] = el;
      }
      // Position. The normalized coordinates are cached on the element because a resize
      // has to re-derive the pixel position without a new message: a stationary cursor
      // would otherwise keep the pixels it was given before the surface changed size.
      // Bracket access is required — tsconfig sets noPropertyAccessFromIndexSignature.
      el.dataset['nx'] = String(cursor.x);
      el.dataset['ny'] = String(cursor.y);
      CursorRendererHelper.positionElement(el, containerWidth, containerHeight);
    });
  }

  /**
   * Re-derive every rendered cursor's pixel position from the normalized coordinates
   * cached on it.
   *
   * `renderCursors` only moves a cursor when a new position arrives, so after the
   * overlay changes size every already-rendered cursor points at the wrong place until
   * its peer moves. Now that the game surface no longer resizes on a chat toggle there
   * are far fewer incidental re-renders to paper over that, so the ResizeObserver-driven
   * sync on each page must call this explicitly, immediately after
   * `OverlaySyncHelper.align()`.
   *
   * Deliberately does not touch `el.style.transition`: remote cursors keep their
   * throttle-length interpolation (a 50ms linear catch-up during a resize, imperceptible
   * and self-correcting) and the local cursor keeps having none. Suppressing and
   * restoring the transition here would mean re-deriving `isSelf` and risks writing one
   * onto the self element.
   */
  static repositionAll(targetContainer: HTMLElement): void {
    const cursorElements = (targetContainer as CursorHost)._cursorElements;
    if (!cursorElements) return;

    const containerWidth = targetContainer.offsetWidth;
    const containerHeight = targetContainer.offsetHeight;
    // A zero-sized overlay means the surface is hidden or not laid out yet — the guest's
    // stream container carries `ion-hide` until IN_ROOM, and going display:none does
    // deliver a ResizeObserver entry. Writing 0px would pile every cursor into the
    // top-left corner; skipping is safe precisely because the cached values survive, so
    // the next non-zero pass restores every position exactly.
    if (!containerWidth || !containerHeight) return;

    Object.values(cursorElements).forEach(el => {
      CursorRendererHelper.positionElement(el, containerWidth, containerHeight);
    });
  }

  static renderClick(targetContainer: HTMLElement, click: CursorClickMessage): void {
    // Create mouse ping element
    const pingElement = document.createElement('div');
    pingElement.className = 'cursor-click-ping';
    pingElement.style.left = (click.x * targetContainer.offsetWidth) + 'px';
    pingElement.style.top = (click.y * targetContainer.offsetHeight) + 'px';
    pingElement.style.backgroundColor = click.color;
    pingElement.style.zIndex = `${MULTIPLAYER.CURSOR_CLICK_Z_INDEX}`; // Ensure it appears below cursors
    targetContainer.appendChild(pingElement);
    // Not registered in `_cursorElements` and deliberately not repositioned: a ping lives
    // for exactly one 1s animation and is removed on animationend, so a resize inside its
    // lifetime leaves a 4px decoration briefly off-position and then gone.
    pingElement.addEventListener('animationend', () => {
      pingElement.remove();
    });
  }

  private static getCursorElements(targetContainer: HTMLElement): { [peerId: string]: HTMLElement } {
    const host = targetContainer as CursorHost;
    if (!host._cursorElements) {
      host._cursorElements = {};
    }
    return host._cursorElements;
  }

  private static positionElement(el: HTMLElement, containerWidth: number, containerHeight: number): void {
    const nx = Number.parseFloat(el.dataset['nx'] ?? '');
    const ny = Number.parseFloat(el.dataset['ny'] ?? '');
    if (Number.isNaN(nx) || Number.isNaN(ny)) return;
    el.style.left = (nx * containerWidth) + 'px';
    el.style.top = (ny * containerHeight) + 'px';
  }
}
