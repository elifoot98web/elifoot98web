import { EmulatorKeyCode, EmulatorKeyCodeHelper, KeyTask } from '../models/game';

/** Every control character, and the two Unicode separators that the planner folds to a line break. */
const CONTROL_CHARACTERS = /[\p{Cc}\u2028\u2029]/gu;

/**
 * What the guest has to be sent for its field to follow the type bar's: some Backspaces, then
 * some text. `backspaces` counts GUEST characters (an ellipsis is three of them there), `text` is
 * what the bar holds from the first difference on, as typed (the planner turns it into keys).
 */
export interface MirrorStep {
  backspaces: number;
  text: string;
}

/** A step as the keys that carry it out, and how many of them there are for each part. */
export interface PlannedStep {
  tasks: KeyTask[];
  /** The Backspaces among `tasks` (they come first). */
  backspaces: number;
  /** Code points the guest cannot show, typed as "?". */
  substituted: number;
}

/**
 * The model behind the live type bar: what the guest's field holds, as a list of code points, and
 * the one operation that matters, `sync(value)`: given what the bar's field says NOW, the Backspaces
 * and the text that bring the guest from what it holds to that. Pure on purpose (no DOM, no clock,
 * no emulator), because it is where a real keyboard's quirks either get absorbed or become a wrong
 * name in somebody's save.
 *
 * **Why a diff of the whole value and not a stream of the keys.** Every keyboard that matters
 * reports typing differently: a hardware key is a `keydown` with a name, Gboard in a composition is
 * `keyCode 229` and `key: "Unidentified"`, iOS replaces a word on an autocorrect, a swipe commits a
 * whole word, and a suggestion tap rewrites the word just typed. The one thing they all agree on is
 * the field's `value` afterwards, so the bar compares that against what the guest holds, in CODE
 * POINTS (`Array.from`: an emoji is one, not two UTF-16 units), and sends "delete from the first
 * difference, type the rest". Replacements, corrections, a paste and a plain letter are the same
 * operation, and an event that arrives twice (Chrome and Safari order `compositionend` and the last
 * `input` differently) finds nothing left to send the second time.
 *
 * It assumes the guest's caret is at the END of what it holds, which is why the bar clears itself
 * (`reset()`) after any key that moves the guest's focus or caret (Enter, Tab, the arrows...): from
 * there the bar and the guest's field no longer describe the same text, and the honest model is
 * "a new, empty bar".
 *
 * **Every code point is one visible character in the guest, except the ellipsis.** The planner
 * (EmulatorKeyCodeHelper) folds a typographic quote to an ASCII one, an accent is an Alt code and
 * anything the guest cannot show is a "?", so the count of what the guest holds is not the count
 * of what the bar holds: "…" is three dots there, and deleting it takes three Backspaces. `sync`
 * asks the planner how wide each code point is, so the Backspaces are always right.
 *
 * **A trailing space is held back until something follows it.** Gboard puts a space after a word
 * it completes from a suggestion, iOS puts one after a QuickType word, and a name field wants
 * "Felipão", not "Felipão ". A space that does not end the text is part of it (the "Silva" typed
 * next sends " Silva"), so holding back only the trailing run costs nothing the player can see in
 * the guest except the space itself, and it makes the keyboard's auto-space vanish without ever
 * guessing which spaces were the keyboard's. It also means a lone Space on a screen where Space
 * is a command is not sent.
 */
export class TypeMirror {

  /** What the guest holds, one entry per code point of the bar, in NFC. */
  private held: string[] = [];

  /** What the guest holds, as the bar would show it. */
  get guestText(): string {
    return this.held.join('');
  }

  get isEmpty(): boolean {
    return this.held.length === 0;
  }

  /**
   * Follow the field to `value`. Returns what to send, or `null` when the guest already agrees
   * (which includes a value that only gained or lost a trailing space). The model moves to the new
   * state at once: the keys are queued behind whatever is already going out, and the guest gets
   * there in order.
   */
  sync(value: string): MirrorStep | null {
    const wanted = TypeMirror.settled(value);

    let common = 0;
    const limit = Math.min(this.held.length, wanted.length);
    while (common < limit && this.held[common] === wanted[common]) common++;

    let backspaces = 0;
    for (let index = common; index < this.held.length; index++) {
      backspaces += TypeMirror.guestWidth(this.held[index]);
    }
    const text = wanted.slice(common).join('');
    this.held = wanted;

    return backspaces > 0 || text.length > 0 ? { backspaces, text } : null;
  }

  /** The guest's field is no longer the one this describes (a key moved its caret, a send failed). */
  reset(): void {
    this.held = [];
  }

  /**
   * The text as code points, folded to NFC (a "ã" typed as "a" plus a combining tilde is one
   * character in the guest), minus the spaces at its end.
   *
   * **A control character is a space.** `<input type=text>` strips only the line feed and carriage
   * return from what is pasted, so a Tab (a spreadsheet cell, a tab-separated note), a backspace
   * character or U+2028/2029 survive into the value, and the planner would turn each into the key it
   * names: Tab and Enter move the guest to another field and a backspace deletes. The bar's
   * single line must not do that behind the mirror's back (the keys of the strip are the way to
   * press them), so they type as the space they look like, and a trailing one is held back like any.
   */
  static settled(value: string): string[] {
    const points = Array.from(value.normalize('NFC').replace(CONTROL_CHARACTERS, ' '));
    while (points.length > 0 && TypeMirror.isSpace(points[points.length - 1])) points.pop();
    return points;
  }

  /** Whether the guest types this code point as a plain space (the no-break and exotic spaces fold to one). */
  static isSpace(point: string): boolean {
    const tasks = EmulatorKeyCodeHelper.planCodePoint(point).tasks;
    return tasks.length === 1 && tasks[0].kind === 'chord'
      && tasks[0].keys.length === 1 && tasks[0].keys[0] === EmulatorKeyCode.KBD_space;
  }

  /** How many characters the guest shows for one code point: one, except for what folds to several. */
  static guestWidth(point: string): number {
    return Math.max(1, EmulatorKeyCodeHelper.planCodePoint(point).tasks.length);
  }

  /** A step as keys: the Backspaces, then the planned text. The same planner the compose dialog uses. */
  static plan(step: MirrorStep): PlannedStep {
    const erase = (): KeyTask => ({ kind: 'chord', keys: [EmulatorKeyCode.KBD_backspace] });
    const text = EmulatorKeyCodeHelper.planText(step.text);
    return {
      tasks: [...Array.from({ length: step.backspaces }, erase), ...text.tasks],
      backspaces: step.backspaces,
      substituted: text.substituted,
    };
  }
}
