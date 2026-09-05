import { MULTIPLAYER } from '../models/constants';

/**
 * Sanitisers for values that arrive over the trystero data channel.
 *
 * Every field on a `*Message` interface is a *claim*, not a fact. trystero payloads are
 * plain `JSON.parse` output (`toJson`/`fromJson` in `@trystero-p2p/core`), so the declared
 * TypeScript types describe what a well-behaved peer sends and constrain nothing at
 * runtime: a peer with devtools can put any JSON value — an object, `null`, a 4 MB string —
 * in any field. The compiler will not warn, because by the time the value exists the cast
 * has already happened.
 *
 * The services already understood this for identity: `senderId` is taken from the transport
 * rather than the payload, `kind` is forced to `'user'`, and `PlayerIdentMessage.host` is
 * deprecated precisely because it was forgeable. These helpers extend the same treatment to
 * the fields that were still being trusted — the ones that reach a date pipe, a sort
 * comparator, a colour parser and the DOM.
 *
 * Every function is total: it takes `unknown` and always returns a usable value of the
 * right type, because the alternative at a call site is a `try`/`catch` around a message
 * handler, and a handler that throws takes the whole subscription with it.
 */
export class WireGuardHelper {

    /**
     * Clamp a peer-supplied timestamp to a finite, representable epoch value.
     *
     * Unguarded, this field breaks the transcript permanently rather than transiently, for
     * two compounding reasons. `DatePipe` rethrows as `invalidPipeArgumentError` (NG02100)
     * for `{}`, `[]`, `'pwned'` or `undefined`, and it does so during change detection, so
     * the throw escapes into Angular rather than into a handler. And `Number('1e400')` is
     * `Infinity`, which in the transcript's `(a, b) => a.timestamp - b.timestamp` comparator
     * sorts the line permanently last — past the `slice(-100)` window that would otherwise
     * scroll it away. The panel does not recover without a reload.
     *
     * The upper bound is the ECMAScript maximum time value (±8.64e15 ms, ~±273,790 years),
     * beyond which `new Date(v)` is an Invalid Date and the pipe throws again.
     *
     * Falls back to now: a message that reached us did arrive at some point, and the clock
     * is only used for ordering and display.
     */
    static timestamp(value: unknown, fallback: number = Date.now()): number {
        const n = Number(value);
        return Number.isFinite(n) && Math.abs(n) <= 8.64e15 ? n : fallback;
    }

    /**
     * Coerce a peer-supplied value to a length-capped string.
     *
     * Non-strings become the fallback rather than `String(value)`: rendering `[object
     * Object]` in the transcript would be a peer choosing what our UI says.
     */
    static text(value: unknown, maxLength: number, fallback = ''): string {
        if (typeof value !== 'string') return fallback;
        return value.length > maxLength ? value.slice(0, maxLength) : value;
    }

    /**
     * Validate a peer-supplied colour, falling back to the default cursor colour.
     *
     * Three sinks consume this field and each fails differently, which is why it is
     * validated at ingest rather than at any one of them:
     *
     * - `ColorHelper.getCSSFilterFromColor` (cursor rendering) **throws** on an unparseable
     *   hex, and it is called per cursor per render inside a subscription with no
     *   `try`/`catch` above it.
     * - `ColorHelper.darkenForText` (chat author colour) catches and returns `#000000`, so
     *   it degrades quietly — the inconsistency between these two is itself a reason to fix
     *   the value once, at the boundary.
     * - `[style.background-color]` on the roster swatch and `pingElement.style
     *   .backgroundColor` on the click ping write to the DOM. Not an XSS vector — Angular
     *   writes via `el.style.setProperty`, which rejects a declaration breakout, and
     *   `background-color` cannot take `url()` — but that is a property of how Angular 19
     *   happens to write styles, not a guarantee worth depending on.
     *
     * Accepts only `#rgb` and `#rrggbb`, the two forms `ColorHelper` can parse. Note this
     * is deliberately stricter than CSS: named colours and `rgb()` are rejected, because
     * the palette in the join dialog only ever produces hex.
     */
    static color(value: unknown, fallback: string = MULTIPLAYER.DEFAULT_CURSOR_COLOR): string {
        return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)
            ? value
            : fallback;
    }

    /**
     * Clamp a peer-supplied normalised coordinate to the unit interval.
     *
     * Cursor positions are multiplied by the container's `offset*` to get pixels, so a
     * non-finite value yields `NaN` (silently dropping the cursor) and a large one parks it
     * far outside the surface. Neither is dangerous; both make the overlay behave oddly for
     * everyone, since cursors are shared.
     */
    static unitInterval(value: unknown): number {
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        return Math.min(1, Math.max(0, n));
    }

    /**
     * Bound a self-reported "how long I have been hosting" claim.
     *
     * This one decides who keeps the room when two hosts collide, and the longer-running
     * host wins — so an unbounded claim is an eviction primitive: send `hostingForMs:
     * 1e308` and the real host, which may have spectators mid-match, tears itself down and
     * reports ROOM_CODE_TAKEN. It is the same class of defect as the deprecated
     * `PlayerIdentMessage.host`, but with no transport-level fact available to replace it,
     * because elapsed time only exists on the sender's own clock.
     *
     * So it is bounded rather than derived. Anything non-finite, negative, or beyond the
     * ceiling is treated as `0` — deliberately *not* clamped to the ceiling, since a claim
     * that large is not a plausible session and clamping would still hand the liar the win
     * against any genuinely shorter host.
     *
     * The ceiling is generous on purpose: a real host may legitimately run for many hours,
     * and losing a tie-break because a marathon session was disbelieved would be a worse
     * failure than the one being prevented.
     */
    static hostingDuration(value: unknown, maxMs = MULTIPLAYER.WIRE_MAX_HOSTING_MS): number {
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 && n <= maxMs ? n : 0;
    }
}
