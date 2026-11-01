import { FULLSCREEN } from '../models/constants';

/** The part of `document` the fullscreen code reads: the standard names and WebKit's prefixed ones (iPad Safari). */
export interface FullscreenDocumentLike {
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  documentElement: {
    requestFullscreen?: (options?: { navigationUI?: 'hide' | 'show' | 'auto' }) => Promise<void>;
    webkitRequestFullscreen?: () => void;
  };
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => void;
}

/** What a viewport measures, in css px. */
export interface FullscreenViewport {
  width: number;
  height: number;
}

/**
 * What the "Tela cheia" entry and the "Gire o aparelho" hint decide from, as functions of plain
 * facts. Pure and free of the DOM, so a document that has no Fullscreen API (iPhone Safari) is a
 * literal in a spec.
 */
export class FullscreenHelper {

  /**
   * Whether the page can go fullscreen at all. iPhone Safari has no Fullscreen API for elements and
   * says `fullscreenEnabled` is false (older ones leave it undefined), which is why the entry is
   * hidden there; iPad Safari has the prefixed one, and Chromium, Firefox and desktop Safari the standard.
   */
  static supported(doc: FullscreenDocumentLike): boolean {
    const enabled = doc.fullscreenEnabled === true || doc.webkitFullscreenEnabled === true;
    const element = doc.documentElement;
    return enabled && (typeof element.requestFullscreen === 'function' || typeof element.webkitRequestFullscreen === 'function');
  }

  /** Whether some element is fullscreen right now. */
  static active(doc: FullscreenDocumentLike): boolean {
    return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
  }

  /**
   * A phone held upright: a finger is how it is used, the short side is a phone's, and it is taller
   * than wide. The picture is 4:3 and takes the width, so turning such a phone sideways is worth a
   * third more picture; a tablet gets a bigger picture either way and is not told to turn.
   */
  static phoneInPortrait(viewport: FullscreenViewport, coarsePointer: boolean): boolean {
    if (!coarsePointer) return false;
    const shortSide = Math.min(viewport.width, viewport.height);
    return viewport.width < viewport.height && shortSide < FULLSCREEN.PHONE_MAX_SHORT_SIDE_PX;
  }

  /**
   * Whether entering fullscreen should also ask for landscape. Only where a finger is the primary pointer
   * (a desktop browser rejects the lock anyway), and only when the browser has the call. The lock is the
   * player's own action, the "Tela cheia" they just pressed: a manifest `orientation`, or a lock taken
   * without being asked, would take portrait play away from people who never chose that (decision D4).
   */
  static shouldLockOrientation(state: { coarsePointer: boolean; canLock: boolean }): boolean {
    return state.coarsePointer && state.canLock;
  }

  /** The menu's words under the entry. */
  static describe(active: boolean, locksOrientation: boolean): string {
    if (active) return 'Ligada · toque para sair';
    return locksOrientation ? 'Esconde a barra do navegador e deita a tela' : 'Esconde a barra do navegador';
  }
}
