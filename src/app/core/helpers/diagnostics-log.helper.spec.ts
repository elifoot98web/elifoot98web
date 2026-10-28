import { DIAGNOSTICS } from '../models/constants';
import { DiagnosticsCategory, DiagnosticsEntry } from '../models/diagnostics.models';
import { DiagnosticsLog, DiagnosticsTail } from './diagnostics-log.helper';

const entry = (n: number, cat: DiagnosticsCategory = 'key', data?: string): DiagnosticsEntry =>
  ({ t: n * 10, w: 1_800_000_000_000 + n, cat, msg: `m${n}`, ...(data === undefined ? {} : { data }) });

describe('DiagnosticsLog', () => {

  it('holds what it is given, oldest first, until it is full', () => {
    const log = new DiagnosticsLog(3);
    log.push(entry(1));
    log.push(entry(2));

    expect(log.toArray().map(e => e.msg)).toEqual(['m1', 'm2']);
    expect(log.size).toBe(2);
    expect(log.dropped).toBe(0);
  });

  it('overwrites the OLDEST entry once full, never the newest', () => {
    const log = new DiagnosticsLog(3);
    for (let n = 1; n <= 5; n++) log.push(entry(n));

    expect(log.toArray().map(e => e.msg)).toEqual(['m3', 'm4', 'm5']);
    expect(log.size).toBe(3);
    expect(log.dropped).toBe(2);
  });

  it('keeps its order across several laps of the ring', () => {
    const log = new DiagnosticsLog(4);
    for (let n = 1; n <= 23; n++) log.push(entry(n));

    expect(log.toArray().map(e => e.msg)).toEqual(['m20', 'm21', 'm22', 'm23']);
    expect(log.dropped).toBe(19);
  });

  it('is bounded at the real capacity however much is logged', () => {
    const log = new DiagnosticsLog();
    for (let n = 0; n < DIAGNOSTICS.CAPACITY + 1234; n++) log.push(entry(n));

    expect(log.capacity).toBe(5000);
    expect(log.size).toBe(DIAGNOSTICS.CAPACITY);
    expect(log.toArray()[0].msg).toBe('m1234');
    expect(log.dropped).toBe(1234);
  });

  it('hands out a copy: changing it does not change the log', () => {
    const log = new DiagnosticsLog(3);
    log.push(entry(1));
    log.toArray().length = 0;

    expect(log.size).toBe(1);
    expect(log.toArray().length).toBe(1);
  });

  it('counts every change in `revision`, so a writer can tell whether there is anything new', () => {
    const log = new DiagnosticsLog(2);
    const start = log.revision;
    log.push(entry(1));
    log.push(entry(2));
    log.push(entry(3));

    expect(log.revision).toBe(start + 3);
    log.clear();
    expect(log.revision).toBe(start + 4);
  });

  it('clear forgets the entries and the count of what was dropped', () => {
    const log = new DiagnosticsLog(2);
    for (let n = 1; n <= 5; n++) log.push(entry(n));
    log.clear();

    expect(log.size).toBe(0);
    expect(log.dropped).toBe(0);
    expect(log.toArray()).toEqual([]);
    log.push(entry(9));
    expect(log.toArray().map(e => e.msg)).toEqual(['m9']);
  });

  it('refuses a capacity that could not hold anything', () => {
    expect(() => new DiagnosticsLog(0)).toThrowError(RangeError);
    expect(() => new DiagnosticsLog(-1)).toThrowError(RangeError);
    expect(() => new DiagnosticsLog(1.5)).toThrowError(RangeError);
  });
});

describe('DiagnosticsTail', () => {
  const limits = { maxEntries: 1000, maxChars: 200_000 };

  it('reads back what it wrote', () => {
    const written = [entry(1, 'key', '{"job":1}'), entry(2, 'page'), entry(3, 'save', 'ok')];

    const back = DiagnosticsTail.parse(DiagnosticsTail.serialize(written, 1234, limits));

    expect(back?.savedAt).toBe(1234);
    expect(back?.entries).toEqual(written);
  });

  it('keeps the NEWEST entries when there are more than the limit', () => {
    const written = Array.from({ length: 50 }, (_, n) => entry(n));

    const back = DiagnosticsTail.parse(DiagnosticsTail.serialize(written, 1, { maxEntries: 10, maxChars: 1e6 }));

    expect(back?.entries.map(e => e.msg)).toEqual(written.slice(-10).map(e => e.msg));
  });

  it('keeps the newest entries that fit the character budget', () => {
    const written = Array.from({ length: 200 }, (_, n) => entry(n, 'key', 'x'.repeat(100)));

    const text = DiagnosticsTail.serialize(written, 1, { maxEntries: 1000, maxChars: 5000 });
    const back = DiagnosticsTail.parse(text);

    expect(text.length).toBeLessThan(5200);
    expect(back?.entries.length).toBeGreaterThan(10);
    expect(back?.entries.length).toBeLessThan(200);
    expect(back?.entries[back.entries.length - 1].msg).toBe('m199');
  });

  it('rounds the timestamps it stores to the millisecond', () => {
    const back = DiagnosticsTail.parse(DiagnosticsTail.serialize([{ ...entry(1), t: 12.34567891 }], 1, limits));

    expect(back?.entries[0].t).toBe(12.346);
  });

  describe('reading storage, which is an input like any other', () => {

    it('returns null for nothing, for text that is not JSON and for JSON that is not a tail', () => {
      expect(DiagnosticsTail.parse(null)).toBeNull();
      expect(DiagnosticsTail.parse(undefined)).toBeNull();
      expect(DiagnosticsTail.parse('')).toBeNull();
      expect(DiagnosticsTail.parse('{not json')).toBeNull();
      expect(DiagnosticsTail.parse('42')).toBeNull();
      expect(DiagnosticsTail.parse('null')).toBeNull();
      expect(DiagnosticsTail.parse('{"v":1}')).toBeNull();
    });

    it('returns null for another version of the format', () => {
      expect(DiagnosticsTail.parse('{"v":2,"savedAt":1,"entries":[[1,2,"key","x"]]}')).toBeNull();
    });

    it('returns null when no row survives', () => {
      expect(DiagnosticsTail.parse('{"v":1,"savedAt":1,"entries":[]}')).toBeNull();
      expect(DiagnosticsTail.parse('{"v":1,"savedAt":1,"entries":[["a"],"b",7]}')).toBeNull();
    });

    it('skips a bad row and keeps the good ones', () => {
      const text = '{"v":1,"savedAt":5,"entries":[[1,2,"key","ok"],[1,2,"nonsense","x"],[1,"2","key","x"],[3,4,"page","fine","d"],[5,6,"key",7],[5,6,"key","x",9]]}';

      const back = DiagnosticsTail.parse(text);

      expect(back?.entries.map(e => e.msg)).toEqual(['ok', 'fine']);
    });

    it('shortens strings that are longer than an entry may hold', () => {
      const long = 'y'.repeat(5000);
      const text = JSON.stringify({ v: 1, savedAt: 1, entries: [[1, 2, 'key', long, long]] });

      const back = DiagnosticsTail.parse(text);

      expect(back?.entries[0].msg.length).toBeLessThanOrEqual(DIAGNOSTICS.MESSAGE_MAX_CHARS);
      expect(back?.entries[0].data?.length).toBeLessThanOrEqual(DIAGNOSTICS.DATA_MAX_CHARS);
    });

    it('does not take more rows than a tail is allowed to hold', () => {
      const rows = Array.from({ length: DIAGNOSTICS.PERSIST_ENTRIES + 300 }, (_, n) => [n, n, 'key', `m${n}`]);

      const back = DiagnosticsTail.parse(JSON.stringify({ v: 1, savedAt: 1, entries: rows }));

      expect(back?.entries.length).toBe(DIAGNOSTICS.PERSIST_ENTRIES);
      expect(back?.entries[back.entries.length - 1].msg).toBe(`m${DIAGNOSTICS.PERSIST_ENTRIES + 299}`);
    });
  });
});
