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
      let el = cursorElements[peerId];
      if (!el) {
        el = document.createElement('div');
        const img = document.createElement('img');
        const txt = document.createElement('p');
        el.className = `cursor${peerId === 'self' ? ' self' : ''}`;
        el.style.position = 'absolute';
        el.style.zIndex = `${MULTIPLAYER.CURSOR_Z_INDEX}`;
        el.style.pointerEvents = 'none'; // Prevent interaction with the native element
        img.src = 'assets/cursor2.png';
        const filter = ColorHelper.getCSSFilterFromColor(cursor.color)
        img.style = filter;
        txt.innerText = peerId === selfId ? 'Você' : cursor.name || peerId.slice(0, 6);
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
    pingElement.className = 'cursor-click';
    pingElement.style.position = 'absolute';
    pingElement.style.left = (click.x * targetContainer.offsetWidth) + 'px';
    pingElement.style.top = (click.y * targetContainer.offsetHeight) + 'px';
    pingElement.style.backgroundColor = click.color;
    pingElement.style.width = '4px';
    pingElement.style.height = '4px';
    pingElement.style.borderRadius = '50%';
    pingElement.style.pointerEvents = 'none'; // Prevent interaction with the ping
    pingElement.style.zIndex = `${MULTIPLAYER.CURSOR_CLICK_Z_INDEX}`; // Ensure it appears below cursors
    targetContainer.appendChild(pingElement);
    pingElement.addEventListener('animationend', () => {
      pingElement.remove();
    })
    pingElement.style.animation = 'ping 1s cubic-bezier(0, 0, 0.2, 1)';
    
  }
}