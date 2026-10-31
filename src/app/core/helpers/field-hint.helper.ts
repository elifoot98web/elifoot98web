import { FIELD_HINT } from '../models/constants';

/** What the two hints add up to. Never more than a suggestion. */
export type FieldHint = 'field' | 'none';

export interface FieldHintSignals {
  /** A caret is blinking in the guest (CaretWatcher). */
  caret: boolean;
  /** The last look under a tap: when (ms, any clock) and whether the cursor was an I-beam. */
  ibeam: { at: number; seen: boolean } | null;
}

/**
 * Two imperfect signals for "a text field has the focus in the guest", combined by the rule that
 * each can say yes and neither can say no with authority:
 *
 * - **A caret blinking** says yes for as long as it blinks. Its absence says nothing: a field
 *   whose text is selected (Tab and Enter select, so most fields a form walks into) shows none.
 * - **An I-beam under the last tap** says yes for `IBEAM_TTL_MS` after the tap. After that the
 *   cursor has probably left, and the tap is no longer where the player is.
 *
 * The answer is "field" or "none", and "none" is rendered as "nenhum campo detectado" (the word
 * is detected, because it is a detector). Nothing is ever blocked by it and the OS keyboard is
 * never opened by it: iOS opens a keyboard only from a tap, and both signals arrive later than one.
 */
export class FieldHintHelper {

  static combine(signals: FieldHintSignals, now: number): FieldHint {
    if (signals.caret) return 'field';
    if (signals.ibeam?.seen && now - signals.ibeam.at <= FIELD_HINT.IBEAM_TTL_MS) return 'field';
    return 'none';
  }

  /** How long until the answer can change by itself (an I-beam going stale), or `null` if it cannot. */
  static staleIn(signals: FieldHintSignals, now: number): number | null {
    if (signals.caret || !signals.ibeam?.seen) return null;
    const left = FIELD_HINT.IBEAM_TTL_MS - (now - signals.ibeam.at);
    return left > 0 ? left : null;
  }

  /** The badge's words. */
  static label(hint: FieldHint): string {
    return hint === 'field' ? 'campo detectado' : 'nenhum campo detectado';
  }
}
