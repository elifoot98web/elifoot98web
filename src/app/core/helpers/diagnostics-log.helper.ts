import { DIAGNOSTICS } from '../models/constants';
import { DIAGNOSTICS_CATEGORIES, DiagnosticsCategory, DiagnosticsEntry, DiagnosticsPreviousSession } from '../models/diagnostics.models';
import { DiagnosticsSerializer } from './diagnostics-serializer.helper';

/**
 * The diagnostics log's memory: a ring buffer of fixed size.
 *
 * When it is full the OLDEST entry is overwritten, never the newest. A report is read after
 * something went wrong, and what matters is what happened just before it, so a buffer that stopped
 * accepting entries at capacity would keep the least useful part of a long session. `dropped`
 * says how many were overwritten, so a report can say its start is missing.
 *
 * It grows by `push` up to the capacity instead of allocating 5000 slots up front: a log that is
 * on for a minute should cost a minute's worth of memory. It does not look at the entries it
 * holds; making them is the service's job (see DiagnosticsService.log).
 *
 * Free of Angular, so it is tested on plain objects.
 */
export class DiagnosticsLog {
  private slots: DiagnosticsEntry[] = [];
  /** Where the next entry goes once the buffer is full: the position of the oldest one. */
  private oldest = 0;
  private overwritten = 0;
  private changes = 0;

  constructor(readonly capacity: number = DIAGNOSTICS.CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`A diagnostics log needs a capacity of at least 1, got ${capacity}`);
    }
  }

  /** Entries held now. */
  get size(): number {
    return this.slots.length;
  }

  /** Entries overwritten since the last `clear()`: how many are missing from the start. */
  get dropped(): number {
    return this.overwritten;
  }

  /** Counts every change. A writer compares it with the value it last saw to know whether there is anything new. */
  get revision(): number {
    return this.changes;
  }

  push(entry: DiagnosticsEntry): void {
    if (this.slots.length < this.capacity) {
      this.slots.push(entry);
    } else {
      this.slots[this.oldest] = entry;
      this.oldest = (this.oldest + 1) % this.capacity;
      this.overwritten++;
    }
    this.changes++;
  }

  /** A copy, oldest first. */
  toArray(): DiagnosticsEntry[] {
    if (this.slots.length < this.capacity) return this.slots.slice();
    return this.slots.slice(this.oldest).concat(this.slots.slice(0, this.oldest));
  }

  clear(): void {
    this.slots = [];
    this.oldest = 0;
    this.overwritten = 0;
    this.changes++;
  }
}

export interface DiagnosticsTailLimits {
  maxEntries: number;
  maxChars: number;
}

/**
 * The tail of the log as it is written to storage, and read back by the next page.
 *
 * Why anything is written at all: the events that explain an iOS tab eviction (hidden, frozen,
 * pagehide) happen in a page that is then destroyed, and an in-memory log dies with it. The page
 * that replaces it reads this back and shows it as "the previous page". It is bounded twice
 * (entries and characters, whichever bites first) because it is written every few seconds on a
 * device that is already struggling, and it keeps the NEWEST entries for the reason the ring
 * buffer does.
 *
 * Storage is an input like any other: it can be absent, truncated, from another version or edited
 * by hand, so reading it validates every row and a bad one is skipped, not fatal.
 */
export class DiagnosticsTail {
  private static readonly VERSION = 1;

  static serialize(entries: readonly DiagnosticsEntry[], savedAt: number, limits: DiagnosticsTailLimits): string {
    const rows: string[] = [];
    let chars = 0;
    // From the newest back, so the budget is spent on what is closest to the end.
    for (let i = entries.length - 1; i >= 0 && rows.length < limits.maxEntries; i--) {
      const entry = entries[i];
      const t = Number(entry.t.toFixed(3));
      const row = JSON.stringify(entry.data === undefined
        ? [t, entry.w, entry.cat, entry.msg]
        : [t, entry.w, entry.cat, entry.msg, entry.data]);
      if (chars + row.length + 1 > limits.maxChars) break;
      chars += row.length + 1;
      rows.push(row);
    }
    rows.reverse();
    return `{"v":${DiagnosticsTail.VERSION},"savedAt":${savedAt},"entries":[${rows.join(',')}]}`;
  }

  /** The session `text` holds, or `null` when it holds nothing usable. Never throws. */
  static parse(text: unknown): DiagnosticsPreviousSession | null {
    if (typeof text !== 'string' || text === '') return null;

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    if (typeof raw !== 'object' || raw === null) return null;
    const { v, savedAt, entries } = raw as { v?: unknown; savedAt?: unknown; entries?: unknown };
    if (v !== DiagnosticsTail.VERSION || typeof savedAt !== 'number' || !Number.isFinite(savedAt) || !Array.isArray(entries)) {
      return null;
    }

    const kept: DiagnosticsEntry[] = [];
    for (const row of entries.slice(-DIAGNOSTICS.PERSIST_ENTRIES)) {
      const entry = DiagnosticsTail.entryFrom(row);
      if (entry) kept.push(entry);
    }
    return kept.length > 0 ? { savedAt, entries: kept } : null;
  }

  private static entryFrom(row: unknown): DiagnosticsEntry | null {
    if (!Array.isArray(row)) return null;
    const [t, w, cat, msg, data] = row as unknown[];
    if (typeof t !== 'number' || !Number.isFinite(t) || typeof w !== 'number' || !Number.isFinite(w)) return null;
    if (!DIAGNOSTICS_CATEGORIES.includes(cat as DiagnosticsCategory) || typeof msg !== 'string') return null;
    if (data !== undefined && typeof data !== 'string') return null;

    const entry: DiagnosticsEntry = {
      t, w, cat: cat as DiagnosticsCategory,
      msg: DiagnosticsSerializer.truncate(msg, DIAGNOSTICS.MESSAGE_MAX_CHARS),
    };
    if (data !== undefined) entry.data = DiagnosticsSerializer.truncate(data, DIAGNOSTICS.DATA_MAX_CHARS);
    return entry;
  }
}
