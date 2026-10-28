import { DiagnosticsEntry, DiagnosticsPreviousSession } from '../models/diagnostics.models';
import { DiagnosticsReportHelper } from './diagnostics-report.helper';

/** 14:03:22.101 on 2026-10-28 in whatever zone the spec runs in, so the clock text is zone-proof. */
const NOON = new Date(2026, 9, 28, 14, 3, 22, 101).getTime();

const entry = (cat: DiagnosticsEntry['cat'], msg: string, t = 12345, data?: string): DiagnosticsEntry =>
  ({ t, w: NOON, cat, msg, ...(data === undefined ? {} : { data }) });

describe('DiagnosticsReportHelper', () => {

  describe('events', () => {
    it('counts in the singular for one', () => {
      expect(DiagnosticsReportHelper.events(0)).toBe('0 eventos');
      expect(DiagnosticsReportHelper.events(1)).toBe('1 evento');
      expect(DiagnosticsReportHelper.events(2)).toBe('2 eventos');
    });
  });

  describe('filter', () => {
    const all = [entry('key', 'a'), entry('save', 'b'), entry('key', 'c'), entry('error', 'd')];

    it('keeps one category, in order', () => {
      expect(DiagnosticsReportHelper.filter(all, 'key').map(e => e.msg)).toEqual(['a', 'c']);
      expect(DiagnosticsReportHelper.filter(all, 'error').map(e => e.msg)).toEqual(['d']);
    });

    it('keeps everything for "all", as a copy', () => {
      const kept = DiagnosticsReportHelper.filter(all, 'all');

      expect(kept).toEqual(all);
      expect(kept).not.toBe(all);
    });

    it('is empty for a category with nothing in it', () => {
      expect(DiagnosticsReportHelper.filter(all, 'ime')).toEqual([]);
    });
  });

  describe('line', () => {

    it('shows seconds, category and message, with the data after', () => {
      expect(DiagnosticsReportHelper.line(entry('key', 'enqueue', 12345, '{"job":1}'), false))
        .toBe('  12.345 key     enqueue {"job":1}');
    });

    it('adds the wall clock for the export', () => {
      expect(DiagnosticsReportHelper.line(entry('page', 'freeze', 3600000), true))
        .toBe('3600.000 14:03:22.101 page    freeze');
    });

    it('lines the categories up, the longest being 7 characters', () => {
      const a = DiagnosticsReportHelper.line(entry('ime', 'x'), false);
      const b = DiagnosticsReportHelper.line(entry('pointer', 'x'), false);

      expect(a.indexOf('x')).toBe(b.indexOf('x'));
    });
  });

  describe('clock, day and timezone', () => {

    it('writes local time with milliseconds', () => {
      expect(DiagnosticsReportHelper.clock(NOON)).toBe('14:03:22.101');
      expect(DiagnosticsReportHelper.clock(new Date(2026, 0, 2, 3, 4, 5, 6).getTime())).toBe('03:04:05.006');
    });

    it('writes the local day', () => {
      expect(DiagnosticsReportHelper.day(NOON)).toBe('2026-10-28');
    });

    it('writes the offset east-positive, as ISO 8601 does', () => {
      const at = (offsetMinutes: number) => ({ getTimezoneOffset: () => offsetMinutes }) as Date;

      expect(DiagnosticsReportHelper.timezone(at(180))).toBe('UTC-03:00');
      expect(DiagnosticsReportHelper.timezone(at(-330))).toBe('UTC+05:30');
      expect(DiagnosticsReportHelper.timezone(at(0))).toBe('UTC+00:00');
    });
  });

  describe('viewLines', () => {
    const current = [entry('key', 'one', 1000), entry('save', 'two', 2000), entry('key', 'three', 3000)];

    it('shows the matching lines of this page', () => {
      const view = DiagnosticsReportHelper.viewLines(null, current, 'key', 300);

      expect(view.matched).toBe(2);
      expect(view.lines.map(l => l.trim().split(/\s+/).slice(2).join(' '))).toEqual(['one', 'three']);
    });

    it('keeps the LAST lines when there are more than the limit, and still counts them all', () => {
      const many = Array.from({ length: 10 }, (_, n) => entry('key', `m${n}`, n * 1000));

      const view = DiagnosticsReportHelper.viewLines(null, many, 'all', 3);

      expect(view.matched).toBe(10);
      expect(view.lines.length).toBe(3);
      expect(view.lines[2]).toContain('m9');
      expect(view.lines[0]).toContain('m7');
    });

    it('puts the previous page first, behind a divider', () => {
      const previous: DiagnosticsPreviousSession = { savedAt: NOON, entries: [entry('page', 'pagehide', 500)] };

      const view = DiagnosticsReportHelper.viewLines(previous, current, 'all', 300);

      expect(view.lines.length).toBe(5);
      expect(view.lines[0]).toContain('pagehide');
      expect(view.lines[1]).toContain('esta página');
      expect(view.matched).toBe(4);
      expect(view.matchedPrevious).toBe(1);
    });

    it('filters the previous page too, and leaves out the divider when none of it matches', () => {
      const previous: DiagnosticsPreviousSession = { savedAt: NOON, entries: [entry('page', 'pagehide', 500)] };

      const view = DiagnosticsReportHelper.viewLines(previous, current, 'save', 300);

      expect(view.lines.length).toBe(1);
      expect(view.lines[0]).toContain('two');
    });

    it('is empty for a limit of zero', () => {
      expect(DiagnosticsReportHelper.viewLines(null, current, 'all', 0).lines).toEqual([]);
    });
  });

  describe('compose', () => {
    const generatedAt = new Date(NOON);

    it('puts the header first and every entry after it, unfiltered', () => {
      const text = DiagnosticsReportHelper.compose({
        header: ['=== Relatório ===', 'User agent: teste'],
        previous: null,
        current: [entry('key', 'a'), entry('save', 'b')],
        dropped: 0,
        generatedAt,
      });
      const lines = text.split('\n');

      expect(lines[0]).toBe('=== Relatório ===');
      expect(lines[1]).toBe('User agent: teste');
      expect(text).toContain('=== Esta página: 2 eventos ===');
      expect(text).toMatch(/key {5}a\n.*save {4}b/);
      expect(text).not.toContain('Página anterior');
    });

    it('says when the start of the log was overwritten', () => {
      const text = DiagnosticsReportHelper.compose({ header: [], previous: null, current: [entry('key', 'a')], dropped: 17, generatedAt });

      expect(text).toContain('os 17 mais antigos foram descartados');
    });

    it('carries the previous page under its own heading, with when it was last saved', () => {
      const text = DiagnosticsReportHelper.compose({
        header: [],
        previous: { savedAt: NOON, entries: [entry('page', 'freeze', 800), entry('page', 'pagehide', 900)] },
        current: [entry('page', 'pageshow', 100)],
        dropped: 0,
        generatedAt,
      });

      expect(text).toContain('=== Página anterior: 2 eventos, último registro salvo em 2026-10-28 às 14:03:22.101 ===');
      expect(text.indexOf('freeze')).toBeLessThan(text.indexOf('=== Esta página'));
      expect(text.indexOf('=== Esta página')).toBeLessThan(text.indexOf('pageshow'));
    });
  });

  it('builds the report and its file name from one moment', () => {
    const report = DiagnosticsReportHelper.report({
      header: ['=== cabeçalho ==='], previous: null, current: [entry('key', 'a')], dropped: 0,
      generatedAt: new Date(2026, 9, 28, 14, 3, 22),
    });

    expect(report.fileName).toBe('elifoot98-diagnostico-20261028-140322.txt');
    expect(report.text.startsWith('=== cabeçalho ===\n')).toBeTrue();
    expect(report.text).toContain('=== Esta página: 1 evento ===');
  });

  it('names the file after the local date and time', () => {
    expect(DiagnosticsReportHelper.fileName(new Date(2026, 9, 28, 14, 3, 22))).toBe('elifoot98-diagnostico-20261028-140322.txt');
    expect(DiagnosticsReportHelper.fileName(new Date(2026, 0, 2, 3, 4, 5))).toBe('elifoot98-diagnostico-20260102-030405.txt');
  });
});
