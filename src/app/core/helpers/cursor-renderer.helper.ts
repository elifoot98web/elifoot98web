import { selfId } from "trystero";
import { CursorClickMessage, CursorPositionMessage } from "../models/multiplayer";
import { ColorHelper } from "./color.helper";
import { MULTIPLAYER } from "../models/constants";

export class CursorRendererHelper {
  static renderCursors(targetContainer: HTMLElement, cursors: { [peerId: string]: CursorPositionMessage }): void {
    // Keep a map of cursor elements by peerId
    if (!(targetContainer as any)._cursorElements) {
      (targetContainer as any)._cursorElements = {};
    }
    const cursorElements: { [peerId: string]: HTMLElement } = (targetContainer as any)._cursorElements;

    // Remove elements for peers that no longer exist
    Object.keys(cursorElements).forEach(peerId => {
      if (!(peerId in cursors)) {
        targetContainer.removeChild(cursorElements[peerId]);
        delete cursorElements[peerId];
      }
    });

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
      // Position
      const containerWidth = targetContainer.offsetWidth;
      const containerHeight = targetContainer.offsetHeight;
      el.style.left = (cursor.x * containerWidth) + 'px';
      el.style.top = (cursor.y * containerHeight) + 'px';
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
    pingElement.addEventListener('animationend', () => {
      pingElement.remove();
    });    
  }
}