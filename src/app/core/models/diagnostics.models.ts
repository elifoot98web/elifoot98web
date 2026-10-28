/**
 * What an entry of the diagnostics log is about. A closed set, because the panel filters by it and
 * a typo in a call site would otherwise create a category nobody can pick.
 *
 * `page` is the one addition to the list the plan named (pointer, touch, key, ime, frame, boot,
 * ocr, save, update, error): the lifecycle of the page itself (hidden, frozen, evicted, resized,
 * rotated) is neither a boot stage nor a frame, and it is the evidence the iOS tab evictions
 * leave, so it gets its own filter instead of hiding under a name that means something else.
 */
export const DIAGNOSTICS_CATEGORIES = [
  'pointer', 'touch', 'key', 'ime', 'frame', 'boot', 'ocr', 'save', 'update', 'error', 'page',
] as const;

export type DiagnosticsCategory = typeof DIAGNOSTICS_CATEGORIES[number];

/** What the panel's filter calls each category. */
export const DIAGNOSTICS_CATEGORY_LABELS: Readonly<Record<DiagnosticsCategory, string>> = {
  pointer: 'Ponteiro',
  touch: 'Toque',
  key: 'Teclas',
  ime: 'Teclado do aparelho',
  frame: 'Quadros e tela do jogo',
  boot: 'Inicialização',
  ocr: 'Leitura da tela (OCR)',
  save: 'Salvamento',
  update: 'Atualização do app',
  error: 'Erros',
  page: 'Ciclo de vida da página',
};

/** The filter's "everything" choice. */
export type DiagnosticsFilter = DiagnosticsCategory | 'all';

/**
 * One note in the log. `data` is already text: it was serialised and truncated when the entry was
 * made, so what is stored cannot change afterwards and cannot be larger than the limit.
 */
export interface DiagnosticsEntry {
  /** `performance.now()` when it was logged: ms since this page began, the log's own timeline. */
  t: number;
  /**
   * `Date.now()` when it was logged. `t` does not advance while the page is suspended on every
   * browser, so only this tells how long a gap really was (and which page a persisted entry
   * belongs to).
   */
  w: number;
  cat: DiagnosticsCategory;
  msg: string;
  data?: string;
}

/** The log of an earlier page, as it was last written to storage. */
export interface DiagnosticsPreviousSession {
  /** `Date.now()` of the write that produced it. */
  savedAt: number;
  entries: readonly DiagnosticsEntry[];
}
