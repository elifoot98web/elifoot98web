import { DiagnosticsEntry, DiagnosticsFilter, DiagnosticsPreviousSession } from '../models/diagnostics.models';

/** What `viewLines` hands the panel. */
export interface DiagnosticsView {
  /** The last lines that matched, oldest first; at most the limit asked for. */
  lines: string[];
  /** How many entries matched the filter before the limit cut them, both pages together. */
  matched: number;
  /** How many of those belong to the previous page. */
  matchedPrevious: number;
}

/** A finished report: the text to hand over and the name to give it as a file. */
export interface DiagnosticsReport {
  text: string;
  fileName: string;
}

export interface DiagnosticsReportParts {
  /** The device facts, one line each (see DiagnosticsHeaderHelper). */
  header: readonly string[];
  /** The log of the page before this one, if the OS or the user replaced the page. */
  previous: DiagnosticsPreviousSession | null;
  current: readonly DiagnosticsEntry[];
  /** Entries the ring buffer overwrote: the start of `current` is missing. */
  dropped: number;
  generatedAt: Date;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Lays the log out as text, for the panel and for the file that leaves the device. Pure: it only
 * formats what it is given, so the shape of a report is tested without a browser.
 *
 * A line reads `  12.345 14:03:22.101 key     enqueue {"job":1}`: seconds since this page began,
 * the clock time, the category and the note. Both clocks are there because they answer different
 * questions. The first orders entries within a page and survives a wrong system clock; the second
 * is the only one that shows how long the device was asleep, and lines up two reports taken on
 * different devices.
 */
export class DiagnosticsReportHelper {

  /** "1 evento", "0 eventos", "12 eventos". */
  static events(count: number): string {
    return `${count} ${count === 1 ? 'evento' : 'eventos'}`;
  }

  /** The entries of one category, or all of them. */
  static filter(entries: readonly DiagnosticsEntry[], filter: DiagnosticsFilter): DiagnosticsEntry[] {
    return filter === 'all' ? entries.slice() : entries.filter(entry => entry.cat === filter);
  }

  /** Local `YYYY-MM-DD` of an epoch time. */
  static day(epochMs: number): string {
    const date = new Date(epochMs);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  /** Local `HH:MM:SS.mmm` of an epoch time. */
  static clock(epochMs: number): string {
    const date = new Date(epochMs);
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}`;
  }

  /** `+03:00` style offset of the machine's time zone, east positive, as ISO 8601 writes it. */
  static timezone(date: Date): string {
    const minutes = -date.getTimezoneOffset();
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    return `UTC${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
  }

  /** One line. `withClock` adds the wall-clock time; the panel leaves it out to keep the line short. */
  static line(entry: DiagnosticsEntry, withClock: boolean): string {
    const seconds = (entry.t / 1000).toFixed(3).padStart(8);
    const clock = withClock ? ` ${DiagnosticsReportHelper.clock(entry.w)}` : '';
    const data = entry.data === undefined ? '' : ` ${entry.data}`;
    return `${seconds}${clock} ${entry.cat.padEnd(7)} ${entry.msg}${data}`;
  }

  /**
   * The panel's text: the last `limit` lines of the chosen category, the previous page's first,
   * then a divider, then this page's.
   */
  static viewLines(
    previous: DiagnosticsPreviousSession | null,
    current: readonly DiagnosticsEntry[],
    filter: DiagnosticsFilter,
    limit: number
  ): DiagnosticsView {
    const before = previous ? DiagnosticsReportHelper.filter(previous.entries, filter) : [];
    const now = DiagnosticsReportHelper.filter(current, filter);

    const lines = before.map(entry => DiagnosticsReportHelper.line(entry, false));
    if (before.length > 0) lines.push('---------- esta página ----------');
    for (const entry of now) lines.push(DiagnosticsReportHelper.line(entry, false));

    return { lines: limit > 0 ? lines.slice(-limit) : [], matched: before.length + now.length, matchedPrevious: before.length };
  }

  /** The whole file: header, then the previous page's log, then this page's. Nothing is filtered. */
  static compose(parts: DiagnosticsReportParts): string {
    const out: string[] = [...parts.header, ''];

    if (parts.previous) {
      const saved = parts.previous.savedAt;
      out.push(
        `=== Página anterior: ${DiagnosticsReportHelper.events(parts.previous.entries.length)}, último registro salvo em ${DiagnosticsReportHelper.day(saved)} às ${DiagnosticsReportHelper.clock(saved)} ===`,
        'Se esta página substituiu uma que o sistema encerrou, as últimas linhas abaixo mostram o que aconteceu antes.',
        ...parts.previous.entries.map(entry => DiagnosticsReportHelper.line(entry, true)),
        ''
      );
    }

    const missing = parts.dropped > 0 ? `; os ${parts.dropped} mais antigos foram descartados` : '';
    out.push(
      `=== Esta página: ${DiagnosticsReportHelper.events(parts.current.length)}${missing} ===`,
      ...parts.current.map(entry => DiagnosticsReportHelper.line(entry, true)),
      ''
    );
    return out.join('\n');
  }

  /** The whole report and its file name, both stamped with `parts.generatedAt`. */
  static report(parts: DiagnosticsReportParts): DiagnosticsReport {
    return { text: DiagnosticsReportHelper.compose(parts), fileName: DiagnosticsReportHelper.fileName(parts.generatedAt) };
  }

  /** `elifoot98-diagnostico-20261028-140322.txt`, in local time. */
  static fileName(now: Date): string {
    const day = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
    const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    return `elifoot98-diagnostico-${day}-${time}.txt`;
  }
}
