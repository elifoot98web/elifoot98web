import { Pipe, PipeTransform } from '@angular/core';

/**
 * The MSN Messenger shortcodes worth having, in the order they must be tried.
 *
 * Longest-first matters: `:-)` has to be tested before `:)`, or the leading `:-` would
 * never match. Kept deliberately small — these are the ones people actually typed.
 */
const EMOTICONS: readonly (readonly [string, string])[] = [
  [':-)', '🙂'], [':)', '🙂'],
  [':-(', '🙁'], [':(', '🙁'],
  [';-)', '😉'], [';)', '😉'],
  [':-D', '😄'], [':D', '😄'],
  [':-P', '😛'], [':P', '😛'],
  [':-O', '😮'], [':O', '😮'],
  [":'(", '😢'],
  [':-|', '😐'], [':|', '😐'],
  ['(Y)', '👍'], ['(N)', '👎'],
  ['(L)', '❤️'], ['(U)', '💔'],
  ['(K)', '💋'], ['(F)', '🌹'],
  ['(6)', '😈'], ['(A)', '😇'],
  ['(H)', '😎'],
];

/**
 * Replace MSN-era shortcodes with their emoji, the cheapest available nod to the era.
 *
 * Pure (Angular's default), so it re-runs only when the string reference changes — chat
 * messages are immutable, so that is once per message.
 *
 * Plain string scanning rather than a regex: the shortcodes are full of regex
 * metacharacters — `(`, `|`, `)`, `?` — and escaping a generated alternation of them is
 * more error-prone than a linear scan that is O(text length) anyway.
 */
@Pipe({ name: 'msnEmoticon', standalone: false })
export class MsnEmoticonPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '';

    let out = '';
    let i = 0;
    outer: while (i < value.length) {
      for (const [code, emoji] of EMOTICONS) {
        // Case-sensitive on purpose: lowercasing would turn "(a)" in ordinary prose into
        // a halo, and MSN itself treated these as case-sensitive.
        if (value.startsWith(code, i)) {
          out += emoji;
          i += code.length;
          continue outer;
        }
      }
      out += value[i];
      i += 1;
    }
    return out;
  }
}
