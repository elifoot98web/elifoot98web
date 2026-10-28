import { DiagnosticsSerializer } from './diagnostics-serializer.helper';

const text = (value: unknown, max?: number) => DiagnosticsSerializer.toText(value, max);

describe('DiagnosticsSerializer', () => {

  describe('what it keeps', () => {

    it('writes a plain object as compact JSON', () => {
      expect(text({ job: 1, kind: 'chord', held: [3, 4] })).toBe('{"job":1,"kind":"chord","held":[3,4]}');
    });

    it('writes a top-level string as it is, unquoted', () => {
      expect(text('enqueue')).toBe('enqueue');
    });

    it('says "undefined" for a missing value instead of an empty string', () => {
      expect(text(undefined)).toBe('undefined');
    });

    it('drops an undefined property but keeps null', () => {
      expect(text({ a: undefined, b: null })).toBe('{"b":null}');
    });

    it('names NaN and Infinity, which JSON would turn into null', () => {
      // P4 found a NaN mouse delta that left the guest's pointer dead; a log that showed `null`
      // there would hide the cause.
      expect(text({ dx: NaN, dy: Infinity, dz: -Infinity })).toBe('{"dx":"NaN","dy":"Infinity","dz":"-Infinity"}');
    });

    it('writes a BigInt, a symbol and a function, which JSON.stringify rejects or drops', () => {
      expect(text({ big: 10n })).toBe('{"big":"10n"}');
      expect(text({ s: Symbol('x') })).toBe('{"s":"Symbol(x)"}');
      expect(text({ f: function named() { return 1; } })).toBe('{"f":"[function named]"}');
    });

    it('writes a date as ISO text, and an invalid one as such', () => {
      expect(text(new Date(Date.UTC(2026, 9, 28, 14, 3, 22)))).toBe('2026-10-28T14:03:22.000Z');
      expect(text(new Date(NaN))).toBe('Invalid Date');
    });

    it('keeps an Error\'s name, message and the first stack lines', () => {
      const error = new TypeError('boom');
      const out = JSON.parse(text({ error })).error;

      expect(out.name).toBe('TypeError');
      expect(out.message).toBe('boom');
      expect(out.stack.split(' | ').length).toBeLessThanOrEqual(4);
    });

    it('summarises typed arrays and buffers by size instead of listing them', () => {
      expect(text({ bytes: new Uint8Array(100000), buffer: new ArrayBuffer(8) }))
        .toBe('{"bytes":"Uint8Array(100000)","buffer":"ArrayBuffer(8)"}');
    });

    it('writes a Set as a list and a Map as pairs', () => {
      expect(text(new Set([1, 2]))).toBe('[1,2]');
      expect(text(new Map([['a', 1]]))).toBe('{"$map":[["a",1]]}');
    });
  });

  describe('what it refuses to follow', () => {

    it('marks a cycle and keeps the rest', () => {
      const node: Record<string, unknown> = { name: 'a' };
      node['self'] = node;

      expect(text(node)).toBe('{"name":"a","self":"[circular]"}');
    });

    it('prints a value reached twice by different paths in full: that is not a cycle', () => {
      const shared = { x: 1 };

      expect(text({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
    });

    it('stops at four levels', () => {
      expect(text({ a: { b: { c: { d: { e: 1 } } } } })).toBe('{"a":{"b":{"c":{"d":"[Object]"}}}}');
    });

    it('keeps the first 24 items of a list and counts the rest', () => {
      const out = JSON.parse(text(Array.from({ length: 30 }, (_, i) => i), 1000));

      expect(out.length).toBe(25);
      expect(out[24]).toBe('…+6');
    });

    it('keeps the first 24 keys of an object and counts the rest', () => {
      const wide: Record<string, number> = {};
      for (let i = 0; i < 30; i++) wide[`k${i}`] = i;
      const out = JSON.parse(text(wide, 2000));

      expect(Object.keys(out).length).toBe(25);
      expect(out['…']).toBe('+6 keys');
    });

    it('shortens a long string inside an object', () => {
      const out = JSON.parse(text({ s: 'x'.repeat(5000) }, 2000));

      expect(out.s.length).toBeLessThanOrEqual(200);
      expect(out.s.endsWith('[5000]')).toBeTrue();
    });
  });

  describe('it cannot be made to throw', () => {

    it('survives a getter that throws, and keeps the other properties', () => {
      const value = { ok: 1, get bad(): number { throw new Error('nope'); } };

      expect(text(value)).toBe('{"ok":1,"bad":"[threw Error: nope]"}');
    });

    it('survives an object that throws from every operation', () => {
      const hostile = new Proxy({}, {
        ownKeys() { throw new Error('no keys'); },
        get() { throw new Error('no reads'); },
        getPrototypeOf() { throw new Error('no prototype'); },
      });

      expect(() => text(hostile)).not.toThrow();
      expect(text(hostile)).toContain('unserializable');
    });
  });

  describe('truncate', () => {

    it('leaves text that fits alone', () => {
      expect(DiagnosticsSerializer.truncate('abc', 3)).toBe('abc');
    });

    it('ends in a marker that says how long the original was, and never exceeds the limit', () => {
      const out = DiagnosticsSerializer.truncate('x'.repeat(1000), 50);

      expect(out.length).toBeLessThanOrEqual(50);
      expect(out.endsWith('…[1000]')).toBeTrue();
    });

    it('does not split a surrogate pair', () => {
      // Each emoji is two UTF-16 units; whichever way the cut falls, no lone half may remain.
      for (let max = 8; max < 14; max++) {
        const out = DiagnosticsSerializer.truncate('😀'.repeat(20), max);
        const body = out.slice(0, out.indexOf('…'));

        expect(body.length % 2).toBe(0, `limit ${max}`);
      }
    });

    it('copes with a limit smaller than its own marker', () => {
      expect(DiagnosticsSerializer.truncate('x'.repeat(100), 3).length).toBeLessThanOrEqual(3);
      expect(DiagnosticsSerializer.truncate('x'.repeat(100), 0)).toBe('');
    });
  });
});
