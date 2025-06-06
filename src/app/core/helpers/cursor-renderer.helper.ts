import { selfId } from "trystero";
import { PlayerCursorMessage } from "../models/multiplayer";
import { ColorHelper } from "./color.helper";

export class CursorRendererHelper {
    static renderCursors(targetContainer: HTMLElement, cursors: { [peerId: string]: PlayerCursorMessage }): void {
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
}