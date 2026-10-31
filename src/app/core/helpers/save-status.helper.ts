import { SAVE_SAFETY } from '../models/constants';

/** Everything the chip and the nudge need to know about the state of the player's saves. */
export interface SaveStatusSnapshot {
  /** When the emulator's disk last reached IndexedDB, or null if it never has (or storage is blocked). */
  lastPersistedAt: number | null;
  /** The first time that ever happened here: the nudge counts from it when there is no backup. */
  firstPersistedAt: number | null;
  /** When a backup last left the app. */
  lastBackupAt: number | null;
  /** Input has reached the game since the last persist. */
  dirty: boolean;
  /** `Date.now()` of the first such input, null while clean. */
  dirtySince: number | null;
  /** A persist is in flight. */
  persisting: boolean;
  /** The last persist failed and none has worked since. */
  persistFailed: boolean;
}

export const EMPTY_SAVE_STATUS: SaveStatusSnapshot = {
  lastPersistedAt: null,
  firstPersistedAt: null,
  lastBackupAt: null,
  dirty: false,
  dirtySince: null,
  persisting: false,
  persistFailed: false,
};

export type SaveChipTone = 'idle' | 'ok' | 'busy' | 'warn';

export interface SaveChipView {
  /** What the chip shows. */
  text: string;
  tone: SaveChipTone;
  /** What a screen reader says: the text, and what tapping does. */
  label: string;
}

/**
 * Says, in a few words, whether the player's progress has reached the browser's storage.
 *
 * "Saved" here means one thing: the emulator's changes layer was written to IndexedDB at that
 * time, which includes whatever the game had saved to its own files by then. It does not mean the
 * game's state in memory is on disk (Elifoot writes its own save at kickoffs), which is why input
 * since the last persist is tracked, and why a long stretch of it turns the chip into a warning.
 *
 * Times are the device's local time, built from the `Date` accessors and not from `Intl`, so the
 * wording does not depend on the browser's locale data. Kept free of Angular so it can be tested.
 */
export class SaveStatusHelper {

  static describe(status: SaveStatusSnapshot, now: number): SaveChipView {
    const tap = 'Toque para salvar agora.';

    if (status.persisting) {
      return { text: 'Salvando…', tone: 'busy', label: 'Salvando o jogo no navegador.' };
    }
    if (status.persistFailed) {
      return { text: 'Falha ao salvar', tone: 'warn', label: `Não foi possível salvar o jogo. ${tap}` };
    }
    if (status.dirty && status.dirtySince !== null && now - status.dirtySince >= SAVE_SAFETY.UNSAVED_WARNING_AFTER_MS) {
      const text = `Sem salvar há ${SaveStatusHelper.age(now - status.dirtySince)}`;
      return { text, tone: 'warn', label: `${text}. ${tap}` };
    }
    if (status.lastPersistedAt === null) {
      return { text: 'Ainda não salvo', tone: 'idle', label: `O jogo ainda não foi salvo neste navegador. ${tap}` };
    }

    const text = SaveStatusHelper.savedText(status.lastPersistedAt, now);
    return { text, tone: 'ok', label: `${text}. ${tap}` };
  }

  /** "Salvo às 14:32", "Salvo ontem 21:14", "Salvo em 27/10 21:14". */
  static savedText(at: number, now: number): string {
    const when = new Date(at);
    const today = new Date(now);
    const clock = SaveStatusHelper.clock(when);

    if (SaveStatusHelper.sameDay(when, today)) return `Salvo às ${clock}`;

    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (SaveStatusHelper.sameDay(when, yesterday)) return `Salvo ontem ${clock}`;

    return `Salvo em ${SaveStatusHelper.two(when.getDate())}/${SaveStatusHelper.two(when.getMonth() + 1)} ${clock}`;
  }

  /** "12 min", "3 h". Under a minute the warning is not shown, so there is no seconds form. */
  static age(ms: number): string {
    const minutes = Math.max(1, Math.floor(ms / 60000));
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h`;
  }

  /** `14:32`, local time. */
  static clock(at: number | Date): string {
    const date = typeof at === 'number' ? new Date(at) : at;
    return `${SaveStatusHelper.two(date.getHours())}:${SaveStatusHelper.two(date.getMinutes())}`;
  }

  private static sameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  private static two(value: number): string {
    return String(value).padStart(2, '0');
  }
}
