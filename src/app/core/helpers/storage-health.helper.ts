/** What `navigator.storage` said about this origin; each part is null when the browser does not say. */
export interface StorageHealth {
  /** Whether the browser agreed to keep this origin's data out of eviction (`navigator.storage.persisted()`). */
  persisted: boolean | null;
  /** Bytes in use by this origin (`estimate().usage`). */
  usage: number | null;
  /** Bytes this origin may use (`estimate().quota`). */
  quota: number | null;
}

export const UNKNOWN_STORAGE: StorageHealth = { persisted: null, usage: null, quota: null };

/**
 * The words of the "Armazenamento" line in the menu. The saves live in the browser's storage for
 * this site, which the browser may clear when space runs short unless it has agreed to protect it;
 * the line says which, and how much is in use. **It never promises protection**: "protegido" is the
 * browser's answer to `persist()`, which Chrome gives to an installed app, Firefox asks the person
 * about and Safari decides for itself, and the line says what the browser said and nothing more.
 */
export class StorageHealthHelper {

  /** A byte count in pt-BR: one decimal for MB and GB, none for KB; the decimal separator is a comma. */
  static bytes(value: number | null): string {
    if (value === null || !Number.isFinite(value) || value < 0) return '?';
    const units = [
      { limit: 1024 ** 3, unit: 'GB', digits: 1 },
      { limit: 1024 ** 2, unit: 'MB', digits: 1 },
      { limit: 1024, unit: 'KB', digits: 0 },
    ];
    for (const { limit, unit, digits } of units) {
      if (value >= limit) return `${(value / limit).toFixed(digits).replace('.', ',')} ${unit}`;
    }
    return `${Math.round(value)} B`;
  }

  /** What the browser said about the data's safety, in a few words. */
  static protection(persisted: boolean | null): string {
    if (persisted === true) return 'Protegido';
    if (persisted === false) return 'Não protegido';
    return 'Proteção desconhecida';
  }

  /** "Protegido · 14,2 MB de 1,9 GB em uso", or what is known of it. */
  static summary(health: StorageHealth): string {
    const parts: string[] = [];
    if (health.persisted !== null) parts.push(StorageHealthHelper.protection(health.persisted));
    if (health.usage !== null) {
      parts.push(health.quota !== null
        ? `${StorageHealthHelper.bytes(health.usage)} de ${StorageHealthHelper.bytes(health.quota)} em uso`
        : `${StorageHealthHelper.bytes(health.usage)} em uso`);
    }
    return parts.length > 0 ? parts.join(' · ') : 'O navegador não informa o armazenamento.';
  }

  /** The sentence under the summary when the browser did not agree to protect the data. */
  static warning(persisted: boolean | null): string | null {
    return persisted === false
      ? 'O navegador pode apagar os dados deste site se faltar espaço no aparelho. O backup é a cópia que sobrevive.'
      : null;
  }
}
