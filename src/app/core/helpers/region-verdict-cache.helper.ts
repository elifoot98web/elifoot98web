/**
 * What OCR said about the last strip of the screen it read, so a strip that has not changed is
 * not read again.
 *
 * This is a cache keyed by the strip's fingerprint, not a filter in front of OCR: identical
 * pixels give an identical answer (the recogniser is deterministic), so recalling the answer
 * loses nothing, and anything that changes the pixels at all, a moving cursor included, simply
 * misses and costs one more OCR pass. It can make OCR run more often than strictly needed; it
 * cannot stop it from running on a frame it has not seen.
 *
 * It matters that the answer is remembered and not just "nothing changed": while the game's
 * dialog is up the strip is static, and the caller is asking whether it is *still* up. A gate
 * that merely skipped unchanged frames would answer "no" for the whole dialog.
 *
 * The guest's cursor sprite can sit inside the strip. Today that is harmless, for the reason
 * above. A future matcher that compares the strip against a reference bitmap instead of reading
 * it with OCR would have to mask the cursor out first (the sprite is white and black and is drawn
 * into the framebuffer itself), or a pointer parked over the title would defeat it.
 */
export class RegionVerdictCache {
  private hash: number | null = null;
  private verdict: boolean | null = null;

  /** The remembered answer if `hash` is the strip it was given for, else `null`. */
  recall(hash: number): boolean | null {
    return this.hash === hash ? this.verdict : null;
  }

  /** Keep `verdict` for `hash`, replacing whatever was kept. Only ever one strip is remembered. */
  remember(hash: number, verdict: boolean): void {
    this.hash = hash;
    this.verdict = verdict;
  }

  /** Forget everything, so the next strip is read whatever it looks like. */
  forget(): void {
    this.hash = null;
    this.verdict = null;
  }
}
