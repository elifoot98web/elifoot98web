import { DIAGNOSTICS } from '../models/constants';

/** Past these a value is summarised, not followed: a note about an event is not a dump of it. */
const MAX_DEPTH = 4;
const MAX_KEYS = 24;
const MAX_ITEMS = 24;
const MAX_STRING = 200;

/**
 * Turns whatever a call site hands the diagnostics log into a short piece of text that cannot
 * throw, loop or grow.
 *
 * Why it is its own step: the log is switched on to watch code that is already misbehaving, so it
 * is the last thing allowed to add a failure of its own. A circular object, a getter that throws,
 * a 2 MB string or a BigInt (which `JSON.stringify` rejects) must each end up as text, never as an
 * exception in the caller. And it happens once, when the entry is made, so what is stored cannot
 * change afterwards and cannot outgrow its limit.
 *
 * Deliberate departures from plain JSON, because they are what a debugging session needs to see:
 * `NaN` and `Infinity` are named (JSON turns both into `null`, and P4 found a NaN mouse delta that
 * wedged the guest's pointer for good), an `Error` keeps its name, message and first stack
 * lines, and typed arrays are summarised by length instead of listed.
 *
 * Free of Angular and of the DOM, so it is tested on plain values.
 */
export class DiagnosticsSerializer {

  /** `value` as text of at most `maxChars` characters. Never throws. */
  static toText(value: unknown, maxChars: number = DIAGNOSTICS.DATA_MAX_CHARS): string {
    let text: string;
    try {
      const plain = DiagnosticsSerializer.plain(value, 0, new Set<object>());
      text = typeof plain === 'string' ? plain : (JSON.stringify(plain) ?? String(plain));
    } catch (error) {
      text = `[unserializable: ${DiagnosticsSerializer.describe(error)}]`;
    }
    return DiagnosticsSerializer.truncate(text, maxChars);
  }

  /**
   * Cut `text` to `maxChars`, ending in a marker that says how long it was. The marker counts
   * against the limit, so the result is never longer than asked. A cut that would split a
   * surrogate pair drops the half, so the text stays well formed.
   */
  static truncate(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const marker = `…[${text.length}]`;
    let keep = Math.max(0, maxChars - marker.length);
    const last = text.charCodeAt(keep - 1);
    if (keep > 0 && last >= 0xd800 && last <= 0xdbff) keep--;
    return (text.slice(0, keep) + marker).slice(0, Math.max(0, maxChars));
  }

  /** A value that threw, in one line. */
  static describe(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    try {
      return String(error);
    } catch {
      return 'unknown';
    }
  }

  /** A JSON-safe, size-bounded copy of `value`. `ancestors` is the path from the root, for cycles. */
  private static plain(value: unknown, depth: number, ancestors: Set<object>): unknown {
    if (value === null || typeof value === 'boolean') return value;
    switch (typeof value) {
      case 'undefined': return depth === 0 ? 'undefined' : undefined;
      case 'number': return Number.isFinite(value) ? value : String(value);
      case 'bigint': return `${value}n`;
      case 'symbol': return value.toString();
      case 'function': return `[function ${value.name || 'anonymous'}]`;
      case 'string': return DiagnosticsSerializer.truncate(value, MAX_STRING);
    }

    const object = value as object;
    if (ancestors.has(object)) return '[circular]';
    if (object instanceof Date) return Number.isNaN(object.getTime()) ? 'Invalid Date' : object.toISOString();
    if (object instanceof Error) return DiagnosticsSerializer.error(object);
    if (ArrayBuffer.isView(object)) {
      const view = object as ArrayBufferView & { length?: number };
      return `${object.constructor.name}(${view.length ?? view.byteLength})`;
    }
    if (object instanceof ArrayBuffer) return `ArrayBuffer(${object.byteLength})`;

    if (depth >= MAX_DEPTH) {
      return Array.isArray(object) ? `[Array(${object.length})]` : '[Object]';
    }

    ancestors.add(object);
    try {
      if (Array.isArray(object)) return DiagnosticsSerializer.items(object, depth, ancestors);
      if (object instanceof Set) return DiagnosticsSerializer.items(Array.from(object), depth, ancestors);
      if (object instanceof Map) return { $map: DiagnosticsSerializer.items(Array.from(object), depth, ancestors) };
      return DiagnosticsSerializer.fields(object as Record<string, unknown>, depth, ancestors);
    } finally {
      ancestors.delete(object);
    }
  }

  private static items(list: unknown[], depth: number, ancestors: Set<object>): unknown[] {
    const shown = list.slice(0, MAX_ITEMS).map(item => DiagnosticsSerializer.plain(item, depth + 1, ancestors));
    if (list.length > MAX_ITEMS) shown.push(`…+${list.length - MAX_ITEMS}`);
    return shown;
  }

  private static fields(object: Record<string, unknown>, depth: number, ancestors: Set<object>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(object);
    for (const key of keys.slice(0, MAX_KEYS)) {
      try {
        const copy = DiagnosticsSerializer.plain(object[key], depth + 1, ancestors);
        if (copy !== undefined) out[key] = copy;
      } catch (error) {
        // A getter that throws is a fact about the object, not a reason to lose the rest of it.
        out[key] = `[threw ${DiagnosticsSerializer.describe(error)}]`;
      }
    }
    if (keys.length > MAX_KEYS) out['…'] = `+${keys.length - MAX_KEYS} keys`;
    return out;
  }

  private static error(error: Error): Record<string, unknown> {
    const out: Record<string, unknown> = { name: error.name, message: DiagnosticsSerializer.truncate(error.message, MAX_STRING) };
    if (error.stack) {
      // The first lines say where; the rest is the same frames a thousand times over.
      out['stack'] = DiagnosticsSerializer.truncate(error.stack.split('\n').slice(0, 4).join(' | '), MAX_STRING);
    }
    return out;
  }
}
