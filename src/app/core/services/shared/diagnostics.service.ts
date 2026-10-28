import { Injectable, NgZone } from '@angular/core';
import { DIAGNOSTICS, STORAGE_KEY } from '../../models/constants';
import { DiagnosticsCategory, DiagnosticsEntry, DiagnosticsPreviousSession } from '../../models/diagnostics.models';
import { DiagnosticsCapture, DiagnosticsCaptureScope } from '../../helpers/diagnostics-capture.helper';
import { DiagnosticsLog, DiagnosticsTail } from '../../helpers/diagnostics-log.helper';
import { DiagnosticsSerializer } from '../../helpers/diagnostics-serializer.helper';
import { LocalStorageService } from './local-storage.service';

/**
 * Why the log is on; shown in the panel and written as the log's first line. `url` covers the
 * address and the tab's session, which only remembers what the address asked.
 */
export type DiagnosticsReason = 'url' | 'stored' | 'user';

/**
 * The opt-in diagnostics log: a bounded record of what the app did on THIS device, for the person
 * who has to find out why something misbehaves on a phone nobody else can hold.
 *
 * **Off, it costs one boolean check per call.** Every `log()` begins with `if (!this.on) return`,
 * so a data thunk is never run, no entry is built, and no listener or timer exists: the capture
 * and the persistence timer are installed by `enable()` and removed by `disable()`, nowhere else.
 * That is what makes it safe to leave calls in code on a hot path. **Log through this service;
 * never `console.log` in a hot path.** A console line costs a string build and a write whether
 * anyone is looking, and cannot be exported from a phone.
 *
 * **How it is switched on**, and why there is no second mechanism next to `GamePage.debugMode`:
 * that flag was a hard-coded `false` nobody could reach, gating the "Baixar Disco Virtual" item.
 * It now reads `enabled`, so one switch is the only switch. The menu's "Diagnóstico" panel turns
 * it on and persists the choice (`STORAGE_KEY.DIAGNOSTICS`, wiped with the rest by "Apagar todos
 * os dados"), and `?diag=1` on the address turns it on for the rest of that tab's session
 * (`?diag=0` forces it off for the session). The address wins over the stored choice and never
 * overwrites it, so a link a tester was sent does not leave the log switched on for the next visit.
 * It does leave the log's tail behind (see below): that is kept until "Limpar", switching off or
 * "Apagar todos os dados", because it is what explains an eviction of that same tab.
 *
 * "The rest of the session" is `sessionStorage`, not the address, because the address does not
 * last: the document has `<base href="/">`, so the router's first `history.replaceState('#/game')`
 * resolves against the base and drops everything before the `#`. A reload, or a tab the OS evicted
 * and restored, would otherwise come back with the log off, which is the very case it is for. A
 * `?diag=` inside the hash (`#/game?diag=1`) survives the router and is read the same way.
 *
 * **Data is a thunk or a value, and is evaluated only when the log is on.** `log('key', 'x', () =>
 * ({ a: heavy() }))` never calls the arrow while off. When on, the result is turned into text
 * once, at once (DiagnosticsSerializer), bounded and incapable of throwing, so what is stored can
 * neither change afterwards nor outgrow its limit.
 *
 * **The tail survives the page.** A tab the OS evicted leaves no log behind in memory, and the
 * events that explain it (hidden, frozen, pagehide) are in the page that dies. While on, the last
 * `PERSIST_ENTRIES` entries are written to Ionic Storage every few seconds when there is something
 * new, and to `localStorage` as well when the page goes hidden, frozen or away (see `persistTail`
 * for why two); the next page that has the log on reads them back as "the previous page". A page
 * killed in the foreground gets no event at all, which is why waiting for one would not do.
 * "Limpar", turning the log off and "Apagar todos os dados" remove them; a `?diag=1` visit stores
 * no choice but writes a tail like any other, so its tail stays until one of those too.
 *
 * Privacy: nothing leaves the device unless the person copies, shares or downloads the report, and
 * the panel says so. Call sites log counts, kinds and timings, not the text a player typed, but
 * later phases log input events, so the panel also warns that typed text may appear.
 *
 * Root service with no per-room state: it has no `clear()` for `leaveRoom()` to call, and
 * `clearEntries()` empties the log, not a room.
 */
@Injectable({
  providedIn: 'root'
})
export class DiagnosticsService {
  private on = false;
  private reason: DiagnosticsReason | null = null;
  private readonly buffer = new DiagnosticsLog(DIAGNOSTICS.CAPACITY);
  private previousPage: DiagnosticsPreviousSession | null = null;

  private stopCapture: (() => void) | null = null;
  private persistTimer: ReturnType<typeof setInterval> | undefined;
  /** The log's revision as of the last write to each copy of the tail (see {@link persistTail}). */
  private persistedRevision = -1;
  private fastRevision = -1;
  /** The previous page's tail has been read; until then writing would overwrite it unread. */
  private tailRestored = false;
  /** The address or the person has already chosen, so a late read of the stored choice must not override it. */
  private decided = false;
  /** Moves on at every clear, so a read of the stored tail that was in flight cannot bring a cleared log back. */
  private clearEpoch = 0;

  constructor(private zone: NgZone, private storage: LocalStorageService) {
    void this.initialise();
  }

  /** Whether the log is recording. Cheap: a field. */
  get enabled(): boolean {
    return this.on;
  }

  /** On for this tab's session only, because of `?diag=1`: no stored choice was made. */
  get sessionOnly(): boolean {
    return this.on && this.reason === 'url';
  }

  /** Entries of this page, oldest first. A copy. */
  get entries(): DiagnosticsEntry[] {
    return this.buffer.toArray();
  }

  get entryCount(): number {
    return this.buffer.size;
  }

  /** Entries the ring buffer overwrote: the start of `entries` is missing. */
  get dropped(): number {
    return this.buffer.dropped;
  }

  /** The log of the page before this one, if it was saved before that page went away. */
  get previous(): DiagnosticsPreviousSession | null {
    return this.previousPage;
  }

  /**
   * Note something. `data` is a value, or a function returning one that is called only if the log
   * is on. Never throws, whatever `data` is.
   */
  log(cat: DiagnosticsCategory, msg: string, data?: unknown): void {
    if (!this.on) return;
    this.record(cat, msg, data);
  }

  /**
   * Switch recording on, as a person's own choice. `persist` (the default) remembers it for the next
   * visit; `false` turns it on for this page alone (what the specs use to stay clear of storage).
   */
  async enable(options: { persist?: boolean } = {}): Promise<void> {
    this.decided = true;
    // A person's own choice outranks whatever the address asked for earlier in this tab.
    this.clearSessionRequest();
    this.activate(options.persist === false ? 'url' : 'user');
    if (options.persist !== false) await this.rememberChoice(true);
  }

  /**
   * Switch recording off and forget the stored choice and the stored tail. What is already in
   * memory stays until the page closes or `clearEntries()`, so a report can still be taken after
   * the switch is turned off.
   */
  async disable(options: { persist?: boolean } = {}): Promise<void> {
    this.decided = true;
    this.clearSessionRequest();
    if (this.on) this.record('page', 'diagnostics off', undefined);
    this.deactivate();
    await Promise.all([
      options.persist === false ? Promise.resolve() : this.rememberChoice(false),
      this.forgetStoredTail(),
    ]);
  }

  /** Empty the log, this page's and the previous page's, in memory and in storage. */
  clearEntries(): void {
    this.clearEpoch++;
    this.buffer.clear();
    this.previousPage = null;
    this.persistedRevision = -1;
    this.fastRevision = -1;
    void this.forgetStoredTail();
    if (this.on) this.record('page', 'log cleared', undefined);
  }

  /**
   * What `?diag=` on the address asks for: `'on'`, `'off'`, or `null` for nothing / something else.
   * The route lives after the `#` (hash routing), so the parameter is accepted there as well.
   */
  static urlRequest(search: string, hash: string): 'on' | 'off' | null {
    const pattern = new RegExp(`[?&]${DIAGNOSTICS.URL_PARAM}=([^&#]*)`, 'i');
    return DiagnosticsService.parseSwitch(pattern.exec(search)?.[1] ?? pattern.exec(hash)?.[1]);
  }

  /** `'on'` for 1/true/on and `'off'` for 0/false/off, in any case; anything else asks for nothing. */
  static parseSwitch(raw: string | null | undefined): 'on' | 'off' | null {
    const value = raw?.toLowerCase();
    if (value === '1' || value === 'true' || value === 'on') return 'on';
    if (value === '0' || value === 'false' || value === 'off') return 'off';
    return null;
  }

  // -- internals ---------------------------------------------------------------------------

  private async initialise(): Promise<void> {
    // The address, else what an earlier load of this tab was asked (the address is gone by now).
    const fromAddress = DiagnosticsService.urlRequest(location.search, location.hash);
    if (fromAddress) this.writeSessionRequest(fromAddress);
    const request = fromAddress ?? DiagnosticsService.parseSwitch(this.readSessionRequest());
    if (request === 'on') {
      this.decided = true;
      this.activate('url');
      return;
    }
    if (request === 'off') {
      this.decided = true;
      return;
    }

    try {
      const stored = await this.storage.get<boolean>(STORAGE_KEY.DIAGNOSTICS);
      if (stored === true && !this.decided) this.activate('stored');
    } catch (error) {
      // Site data blocked: there is no stored choice to honour, and the app does not need one.
      console.warn('Could not read the diagnostics setting', error);
    }
  }

  private activate(reason: DiagnosticsReason): void {
    if (this.on) {
      // Already recording; the person asking has only changed why.
      if (reason === 'user') this.reason = 'user';
      return;
    }
    this.on = true;
    this.reason = reason;
    this.tailRestored = false;

    this.zone.runOutsideAngular(() => {
      this.stopCapture = DiagnosticsCapture.install(
        { window: window as unknown as DiagnosticsCaptureScope['window'], document },
        { log: (cat, msg, data) => this.log(cat, msg, data), flush: () => this.persistTail(true) }
      );
      this.persistTimer = setInterval(() => this.persistTail(false), DIAGNOSTICS.PERSIST_INTERVAL_MS);
    });

    this.record('page', 'diagnostics on', () => ({ reason }));
    void this.restoreTail();
  }

  private deactivate(): void {
    this.on = false;
    this.reason = null;
    this.stopCapture?.();
    this.stopCapture = null;
    clearInterval(this.persistTimer);
    this.persistTimer = undefined;
  }

  private record(cat: DiagnosticsCategory, msg: string, data: unknown): void {
    // Stamped before the thunk runs, so the time is when the event happened and not when it was described.
    const t = performance.now();
    const w = Date.now();

    let text: string | undefined;
    if (data !== undefined) {
      try {
        text = DiagnosticsSerializer.toText(typeof data === 'function' ? (data as () => unknown)() : data);
      } catch (error) {
        text = `[data threw ${DiagnosticsSerializer.describe(error)}]`;
      }
    }

    const entry: DiagnosticsEntry = { t, w, cat, msg: DiagnosticsSerializer.truncate(msg, DIAGNOSTICS.MESSAGE_MAX_CHARS) };
    if (text !== undefined) entry.data = text;
    this.buffer.push(entry);
  }

  /**
   * Read the previous page's tail, once per activation, before anything may overwrite it. There
   * are two copies (see {@link persistTail}) and the newer one wins.
   */
  private async restoreTail(): Promise<void> {
    const epoch = this.clearEpoch;
    try {
      const slow = await this.storage.get<string>(STORAGE_KEY.DIAGNOSTICS_LOG).catch(() => null);
      const kept = [DiagnosticsTail.parse(slow), DiagnosticsTail.parse(this.readFastTail())]
        .filter((session): session is DiagnosticsPreviousSession => session !== null)
        .sort((a, b) => b.savedAt - a.savedAt)[0];
      // A clear that landed while the read was in flight wins.
      if (kept && epoch === this.clearEpoch) this.previousPage = kept;
    } catch (error) {
      console.warn('Could not read the previous diagnostics log', error);
    } finally {
      this.tailRestored = true;
    }
  }

  /**
   * Write the tail if there is something new. Best effort and never throws: it runs as a page dies.
   *
   * Two places, for two situations. Every few seconds it goes to Ionic Storage (IndexedDB), which
   * is asynchronous and so costs the emulator's frames nothing, and which is the copy that
   * survives a page killed in the foreground without a word. When the page is going hidden,
   * frozen or away (`sync`) it ALSO goes to `localStorage`, because that write is complete when
   * the call returns, whereas an IndexedDB transaction started inside `pagehide` is not
   * guaranteed to commit (measured: a reload lost every entry after the last interval write).
   * Whichever copy is newer is what the next page reads.
   */
  private persistTail(sync: boolean): void {
    if (!this.on || !this.tailRestored) return;
    const revision = this.buffer.revision;
    const slowDue = revision !== this.persistedRevision;
    const fastDue = sync && revision !== this.fastRevision;
    if (!slowDue && !fastDue) return;
    try {
      const text = DiagnosticsTail.serialize(this.buffer.toArray(), Date.now(), {
        maxEntries: DIAGNOSTICS.PERSIST_ENTRIES,
        maxChars: DIAGNOSTICS.PERSIST_MAX_CHARS,
      });
      if (fastDue) {
        this.fastRevision = revision;
        this.writeFastTail(text);
      }
      if (slowDue) {
        this.persistedRevision = revision;
        this.storage.set(STORAGE_KEY.DIAGNOSTICS_LOG, text).catch(() => undefined);
      }
    } catch {
      // Nothing useful to do, and a failing diagnostic must not become the app's failure.
    }
  }

  private async forgetStoredTail(): Promise<void> {
    this.writeFastTail(null);
    try {
      await this.storage.set<string>(STORAGE_KEY.DIAGNOSTICS_LOG, '');
    } catch (error) {
      console.warn('Could not clear the stored diagnostics log', error);
    }
  }

  private async rememberChoice(enabled: boolean): Promise<void> {
    try {
      await this.storage.set<boolean>(STORAGE_KEY.DIAGNOSTICS, enabled);
    } catch (error) {
      console.warn('Could not store the diagnostics setting', error);
    }
  }

  // `localStorage` and `sessionStorage` throw when site data is blocked, and none of this may
  // become the page's problem, so every access is guarded and a failure is simply "nothing there".

  private readFastTail(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY.DIAGNOSTICS_LOG);
    } catch {
      return null;
    }
  }

  private writeFastTail(text: string | null): void {
    try {
      if (text === null) {
        localStorage.removeItem(STORAGE_KEY.DIAGNOSTICS_LOG);
      } else {
        localStorage.setItem(STORAGE_KEY.DIAGNOSTICS_LOG, text);
      }
    } catch {
      // Quota or blocked storage: the IndexedDB copy is still written.
    }
  }

  private readSessionRequest(): string | null {
    try {
      return sessionStorage.getItem(DIAGNOSTICS.SESSION_KEY);
    } catch {
      return null;
    }
  }

  private writeSessionRequest(request: 'on' | 'off'): void {
    try {
      sessionStorage.setItem(DIAGNOSTICS.SESSION_KEY, request);
    } catch {
      // Without it the switch lasts until the next load, which is what the address alone gives.
    }
  }

  private clearSessionRequest(): void {
    try {
      sessionStorage.removeItem(DIAGNOSTICS.SESSION_KEY);
    } catch {
      // See above.
    }
  }
}
