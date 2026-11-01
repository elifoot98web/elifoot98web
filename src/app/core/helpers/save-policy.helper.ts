/** What `EmulatorControlService.isGameSaving` answers: yes, no, or "OCR could not read the strip". */
export type GameSavingVerdict = boolean | null;

/** Why a save is being asked for; each has its own answer to "what if the game may be writing". */
export type SavePurpose =
  /** The page went to the background. Nobody asked; it is a net under a fall. */
  | 'hidden'
  /** The player asked (the chip, the menu). */
  | 'manual'
  /** The player is leaving the game, which saves before it exits the emulator. */
  | 'leave'
  /** The player asked to reload the page, which throws away everything not already saved. */
  | 'reload';

/**
 * - `persist`: write the changes layer now.
 * - `wait`: the game is writing its own save this instant; do not touch the disk, and look again.
 * - `ask`: nothing can be proved, so the person decides (the caller says what is at stake).
 * - `skip`: do nothing, and say why in the log.
 */
export type SaveAction = 'persist' | 'wait' | 'ask' | 'skip';

export type HiddenGate = 'proceed' | 'clean' | 'throttled' | 'no-emulator' | 'auto-save-off';

export interface HiddenGateInput {
  /** Input has reached the game since the last persist. */
  dirty: boolean;
  hasEmulator: boolean;
  /** The auto-saver is running, which is what keeps the OCR worker alive. */
  autoSaveRunning: boolean;
  /** `Date.now()` of the last persist the page itself started because it went hidden, or null. */
  lastHiddenPersistAt: number | null;
  now: number;
  minGapMs: number;
}

export interface BackupNudgeInput {
  now: number;
  lastBackupAt: number | null;
  firstPersistedAt: number | null;
  /** The reminder has been shown and answered once, ever. */
  dismissed: boolean;
  afterMs: number;
}

/**
 * The rules for when the app may write the emulator's disk on its own, and what to do when it
 * cannot tell whether the game is in the middle of writing its own save.
 *
 * **The reason for all of it.** The game writes its `.e98` while its "A gravar o jogo..." dialog is
 * up (about a second), and a persist that lands in the middle stores a truncated file over the
 * last good snapshot. `isGameSaving` reads that dialog with OCR and has three answers, not two:
 * `true`, `false`, and `null` for "the strip could not be read" (no worker, a failed pass, a frame
 * that would not encode). **`null` is never `false`.** The auto-saver learned this the hard way
 * (a worker dying under the memory spike of a save looked like the all-clear) and every decision
 * below keeps it apart.
 *
 * What differs between purposes is the price of being wrong:
 *
 * - `hidden` is unrequested, so it persists only on a proven `false`. A `null` costs a net that was
 *   never promised, and the periodic save still runs.
 * - `reload` throws the page away, so it persists only on a proven `false` and, on `null`, asks
 *   the person instead of pretending: "Recarregar sem salvar" is a statement of fact.
 * - `manual` and `leave` are the player explicitly asking for a save (the leave dialog says "O
 *   jogo será salvo antes de sair"). With the OCR down that is the only way left to save at all,
 *   and the forced periodic save runs just as unguarded every five minutes, so `null` persists;
 *   only a seen dialog waits. A `null` save is not presented as a clean one: `SaveSafetyService`
 *   marks it unverified and the toast says it could not confirm the game was not writing.
 *
 * Kept free of Angular and of the DOM so the table can be tested as a table.
 */
export class SavePolicyHelper {

  static decide(purpose: SavePurpose, verdict: GameSavingVerdict): SaveAction {
    switch (purpose) {
      case 'hidden':
        return verdict === false ? 'persist' : 'skip';
      case 'reload':
        return verdict === false ? 'persist' : verdict === true ? 'wait' : 'ask';
      case 'manual':
      case 'leave':
        return verdict === true ? 'wait' : 'persist';
    }
  }

  /**
   * Everything about a hidden page that can be decided without looking at the screen, in the order
   * that spares the most work: a page with nothing to save never costs an OCR pass, and a page
   * that is not running the OCR is not asked (asking would start its 5 MB download for a page that
   * is going to sleep).
   */
  static gateHidden(input: HiddenGateInput): HiddenGate {
    if (!input.hasEmulator) return 'no-emulator';
    if (!input.dirty) return 'clean';
    if (input.lastHiddenPersistAt !== null && input.now - input.lastHiddenPersistAt < input.minGapMs) return 'throttled';
    if (!input.autoSaveRunning) return 'auto-save-off';
    return 'proceed';
  }

  /**
   * Whether the one-time "faça um backup" reminder is due. Counted from the last backup, or from
   * the first save when there never was one, and never again once it has been answered: it is a
   * nudge, and a nudge that repeats is a nag.
   */
  static backupNudgeDue(input: BackupNudgeInput): boolean {
    if (input.dismissed) return false;
    const since = input.lastBackupAt ?? input.firstPersistedAt;
    if (since === null) return false;
    return input.now - since >= input.afterMs;
  }
}
