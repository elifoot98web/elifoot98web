import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { SAVE_SAFETY, STORAGE_KEY } from '../../models/constants';
import { EMPTY_SAVE_STATUS, SaveStatusSnapshot } from '../../helpers/save-status.helper';
import { SavePolicyHelper } from '../../helpers/save-policy.helper';
import { DiagnosticsService } from './diagnostics.service';
import { LocalStorageService } from './local-storage.service';

/** The part of `navigator.storage` this service uses; a spec stands in for it. */
export interface StorageManagerLike {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
}

/** Handed out when a persist begins and given back when it ends, so input that arrives during it is not forgotten. */
export interface PersistToken {
  /** `dirtySeq` as the persist began: input since then is not in what it wrote. */
  readonly seq: number;
}

/**
 * What the player's saves look like from the outside: when the emulator's disk last reached
 * IndexedDB, whether input has reached the game since, and when a backup last left the app. It
 * feeds the toolbar chip, the "faça um backup" reminder and the page-exit prompt.
 *
 * It holds no emulator and does no saving. SaveGameService reports every persist to it (that is
 * the one place they all pass through), and the game page reports input to it. It lives in the
 * main bundle (the update flow asks it whether leaving is deliberate), so it imports nothing from
 * the game's chunk.
 *
 * **Dirty means "input since the last persist", counted, not flagged.** A persist takes a second
 * or more, and a click that lands while it runs is not in what it wrote; clearing a plain flag at
 * the end would call that click saved. So every `markDirty()` moves a counter, a persist remembers
 * the counter as it began, and it only clears the flag if nothing moved since. Dirty is
 * conservative by nature: it cannot tell a click that changed the game from a click on a tab, and
 * the game's own save happens only at kickoffs, so it errs towards saying "not saved".
 *
 * **The stored timestamps describe the disk, so they follow it.** "Apagar todos os dados" empties
 * Ionic Storage with the rest, and `freeze()` keeps a persist that finishes during the wipe from
 * writing them straight back (the diagnostics tail had exactly that bug: the reload fired
 * `pagehide`, which wrote it again).
 */
@Injectable({
  providedIn: 'root'
})
export class SaveStatusService {
  private state: SaveStatusSnapshot = { ...EMPTY_SAVE_STATUS };
  private readonly subject = new BehaviorSubject<SaveStatusSnapshot>(this.state);
  private dirtySeq = 0;
  private inFlight = 0;
  private loading: Promise<void> | null = null;
  private frozen = false;
  private nudgeDismissed = false;
  private durabilityAsked = false;
  private exitIsDeliberate = false;
  private writing = false;

  /** Whether the browser agreed to keep this origin's storage (`navigator.storage.persist()`); null until asked or unsupported. */
  durable: boolean | null = null;

  /** Emits on every change that matters to the chip, never on an input that changes nothing. */
  readonly snapshot$: Observable<SaveStatusSnapshot> = this.subject.asObservable();

  constructor(
    private storage: LocalStorageService,
    private zone: NgZone,
    private diagnostics: DiagnosticsService) { }

  get snapshot(): SaveStatusSnapshot {
    return this.state;
  }

  /** Input has reached the game since the last persist. */
  get dirty(): boolean {
    return this.state.dirty;
  }

  /**
   * Read what earlier visits stored. Once; later calls share the first. Never throws: with site
   * data blocked the chip just starts from "Ainda não salvo".
   */
  load(): Promise<void> {
    if (!this.loading) {
      this.loading = this.read().catch(error => {
        console.warn('Could not read the save status', error);
      });
    }
    return this.loading;
  }

  /**
   * Input reached the game. Called at the pace of a finger or a keyboard, so everything after
   * the first call since a persist is one increment.
   */
  markDirty(): void {
    this.dirtySeq++;
    if (this.state.dirty) return;
    this.state = { ...this.state, dirty: true, dirtySince: Date.now() };
    this.diagnostics.log('save', 'status: unsaved input');
    this.publish();
  }

  persistStarted(): PersistToken {
    this.inFlight++;
    if (!this.state.persisting) {
      this.state = { ...this.state, persisting: true };
      this.publish();
    }
    return { seq: this.dirtySeq };
  }

  persistSucceeded(token: PersistToken): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const now = Date.now();
    const dirty = this.dirtySeq !== token.seq;
    const firstPersistedAt = this.state.firstPersistedAt ?? now;
    this.state = {
      ...this.state,
      lastPersistedAt: now,
      firstPersistedAt,
      dirty,
      dirtySince: dirty ? now : null,
      persisting: this.inFlight > 0,
      persistFailed: false,
    };
    this.publish();
    this.remember(STORAGE_KEY.LAST_PERSISTED_AT, now);
    this.remember(STORAGE_KEY.FIRST_PERSISTED_AT, firstPersistedAt);
    this.diagnostics.log('save', 'status: persisted', () => ({ dirtyAfter: dirty }));
    void this.requestDurableStorage();
  }

  persistFailed(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.state = { ...this.state, persisting: this.inFlight > 0, persistFailed: true };
    this.publish();
    this.diagnostics.log('save', 'status: persist failed');
  }

  /** A backup left the app (a download started, or a share sheet was not cancelled). */
  recordBackup(): void {
    const now = Date.now();
    this.state = { ...this.state, lastBackupAt: now };
    this.publish();
    this.remember(STORAGE_KEY.LAST_BACKUP_AT, now);
    this.diagnostics.log('save', 'status: backup recorded');
  }

  /** The "faça um backup" reminder is due and has not been answered. */
  async backupNudgeDue(): Promise<boolean> {
    await this.load();
    return SavePolicyHelper.backupNudgeDue({
      now: Date.now(),
      lastBackupAt: this.state.lastBackupAt,
      firstPersistedAt: this.state.firstPersistedAt,
      dismissed: this.nudgeDismissed,
      afterMs: SAVE_SAFETY.BACKUP_NUDGE_AFTER_MS,
    });
  }

  /** The reminder was answered, either way. It is never shown again. */
  dismissBackupNudge(): void {
    this.nudgeDismissed = true;
    this.remember(STORAGE_KEY.BACKUP_NUDGE_DISMISSED, true);
    this.diagnostics.log('save', 'status: backup nudge answered');
  }

  /**
   * Stop writing to storage. Called before "Apagar todos os dados" empties it: a persist that
   * finishes after the wipe would otherwise write its timestamp back into a store that is
   * supposed to be empty, and the page would come back claiming a save the disk no longer has.
   */
  freeze(): void {
    this.frozen = true;
  }

  /**
   * The auto-saver sees the game's own "A gravar o jogo..." dialog right now. Only a dialog that
   * was SEEN sets it: a reading OCR could not make leaves it false, so this is a reason to wait,
   * never a proof that it is safe to write.
   */
  setGameWriting(writing: boolean): void {
    this.writing = writing;
  }

  get gameWriting(): boolean {
    return this.writing;
  }

  /**
   * Resolve once the game is not writing its own save, or when `maxMs` has passed, whichever is
   * first; true if it is idle. For a caller that is going to write the disk or reload whatever
   * happens (the update), and so waits out a save in progress but cannot wait for ever.
   */
  whenGameIdle(maxMs: number, pollMs = 250): Promise<boolean> {
    if (!this.writing) return Promise.resolve(true);
    const deadline = Date.now() + maxMs;
    return new Promise(resolve => {
      const look = () => {
        if (!this.writing) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(look, pollMs);
      };
      setTimeout(look, pollMs);
    });
  }

  /** The page is about to be replaced on purpose (a save-then-reload, an update): no "leave site?" prompt. */
  allowExit(): void {
    this.exitIsDeliberate = true;
  }

  get exitAllowed(): boolean {
    return this.exitIsDeliberate;
  }

  /** Where `navigator.storage` comes from; a spec overrides it. */
  protected storageManager(): StorageManagerLike | undefined {
    return typeof navigator === 'undefined' ? undefined : (navigator as { storage?: StorageManagerLike }).storage;
  }

  /**
   * Ask the browser to keep this origin's storage out of eviction, once, after the first save that
   * worked: the saves are only worth protecting once there is one. Chrome decides on its own
   * (an installed PWA gets it), Firefox asks the person, and Safari answers from its own rules
   * (whether it ever says yes is on the device checklist). The answer changes nothing the app
   * does; it is kept for the log, and the copy never promises protection the browser may refuse.
   */
  private async requestDurableStorage(): Promise<void> {
    if (this.durabilityAsked) return;
    this.durabilityAsked = true;

    const manager = this.storageManager();
    if (!manager || typeof manager.persist !== 'function') {
      this.diagnostics.log('save', 'storage.persist unsupported');
      return;
    }
    try {
      const already = typeof manager.persisted === 'function' ? await manager.persisted() : false;
      const granted = already || await manager.persist();
      this.durable = granted;
      this.diagnostics.log('save', 'storage.persist', () => ({ already, granted }));
    } catch (error) {
      this.diagnostics.log('save', 'storage.persist failed', () => ({ error }));
    }
  }

  private async read(): Promise<void> {
    const [lastPersistedAt, firstPersistedAt, lastBackupAt, dismissed] = await Promise.all([
      this.storage.get<unknown>(STORAGE_KEY.LAST_PERSISTED_AT),
      this.storage.get<unknown>(STORAGE_KEY.FIRST_PERSISTED_AT),
      this.storage.get<unknown>(STORAGE_KEY.LAST_BACKUP_AT),
      this.storage.get<unknown>(STORAGE_KEY.BACKUP_NUDGE_DISMISSED),
    ]);
    this.nudgeDismissed = dismissed === true;
    // A persist that finished before this read did is newer than anything stored, and wins.
    this.state = {
      ...this.state,
      lastPersistedAt: this.state.lastPersistedAt ?? SaveStatusService.time(lastPersistedAt),
      firstPersistedAt: this.state.firstPersistedAt ?? SaveStatusService.time(firstPersistedAt),
      lastBackupAt: this.state.lastBackupAt ?? SaveStatusService.time(lastBackupAt),
    };
    this.publish();
  }

  /** Storage is just another input: anything that is not a plausible time is no time. */
  private static time(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  }

  private remember(key: string, value: number | boolean): void {
    if (this.frozen) return;
    this.storage.set(key, value).catch(error => {
      console.warn(`Could not store ${key}`, error);
    });
  }

  /** Always inside the zone: the callers (the auto-saver, a pointer listener) are outside it. */
  private publish(): void {
    const snapshot = this.state;
    this.zone.run(() => this.subject.next(snapshot));
  }
}
