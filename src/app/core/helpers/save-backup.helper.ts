import JSZip from 'jszip';
import { BASE_SAVEGAME_DIR } from '../models/constants';

/** A file the player picked, already read. */
export interface BackupInput {
  name: string;
  data: ArrayBuffer | Uint8Array;
}

/** One save game, as it will sit in the guest's `jogos` directory. */
export interface BackupSave {
  /** The DOS name, upper case: `MEUJOGO.E98`. */
  name: string;
  data: Uint8Array;
  /** The picked file it came from, for the dialog. */
  source: string;
}

export interface BackupReading {
  /** One entry per DOS name; if the selection holds the same name twice the later one wins. */
  saves: BackupSave[];
  /** Picked files that are neither `.e98` nor `.zip`, and `.e98` entries with nothing in them. */
  ignored: string[];
  /** `.zip` files that could not be opened. */
  unreadable: string[];
  /** Names the selection held more than once. */
  repeated: string[];
}

/** The part of `navigator` that sharing a file needs; a spec hands in a stand-in. */
export interface ShareNavigatorLike {
  share?: (data: { files?: File[]; title?: string }) => Promise<void>;
  canShare?: (data: { files?: File[] }) => boolean;
}

/**
 * The backup file: what "Exportar jogos salvos" writes and what "Importar jogos salvos" reads.
 *
 * **A backup the app writes must be one the app reads.** The export used to be a zip that the
 * import, which took a single `.e98`, refused, so a player who followed the FAQ's advice could not
 * restore without unzipping on a phone. Both ends are here, next to each other, and
 * save-backup.helper.spec.ts feeds one to the other.
 *
 * The export is a flat zip of `NAME.E98` entries, nothing else. The import reads `.e98` files and
 * `.zip` files (several at once) and takes every `.e98` it finds in a zip, wherever it sits, so
 * the full-disk copy that the boot-failure dialog offers (`d/eli98/jogos/NAME.E98` inside a bigger
 * zip) restores its saves the same way, and a zip made by hand or by macOS (a `__MACOSX` folder of
 * `._NAME.E98` resource forks) does too.
 *
 * Kept free of Angular and of the DOM so it can be tested on plain bytes.
 */
export class SaveBackupHelper {

  /** `2026-10-28_14-32-07`, local time, zero padded. (The first export stamped the month from 0.) */
  static fileStamp(date: Date): string {
    const two = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}_`
      + `${two(date.getHours())}-${two(date.getMinutes())}-${two(date.getSeconds())}`;
  }

  static backupFileName(date: Date): string {
    return `elifoot98_saves_${SaveBackupHelper.fileStamp(date)}.zip`;
  }

  /**
   * The backup zip made of the `.e98` files in a persisted changes layer (what `dosCI.persist()`
   * returns), or null if it holds none.
   */
  static async build(layer: Uint8Array | ArrayBuffer): Promise<{ bytes: Uint8Array; names: string[] } | null> {
    const source = await JSZip.loadAsync(layer);
    const directory = BASE_SAVEGAME_DIR.toLowerCase();

    const saves = new Map<string, Uint8Array>();
    for (const entry of Object.values(source.files)) {
      const path = entry.name.toLowerCase();
      if (entry.dir || !path.startsWith(directory) || !path.endsWith('.e98')) continue;
      saves.set(SaveBackupHelper.baseName(entry.name).toUpperCase(), await entry.async('uint8array'));
    }
    if (saves.size === 0) return null;

    const backup = new JSZip();
    for (const [name, data] of saves) backup.file(name, data);
    const bytes = await backup.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } });
    return { bytes, names: [...saves.keys()] };
  }

  /** The saves in a selection of `.e98` and `.zip` files, and what could not be used. */
  static async read(inputs: readonly BackupInput[]): Promise<BackupReading> {
    const saves = new Map<string, BackupSave>();
    const reading: BackupReading = { saves: [], ignored: [], unreadable: [], repeated: [] };

    const keep = (save: BackupSave) => {
      if (saves.has(save.name) && !reading.repeated.includes(save.name)) reading.repeated.push(save.name);
      saves.set(save.name, save);
    };

    for (const input of inputs) {
      const lower = input.name.toLowerCase();
      if (lower.endsWith('.e98')) {
        const data = SaveBackupHelper.bytes(input.data);
        const name = SaveBackupHelper.baseName(input.name).toUpperCase();
        if (data.byteLength === 0) reading.ignored.push(input.name);
        else keep({ name, data, source: input.name });
      } else if (lower.endsWith('.zip')) {
        let zip: JSZip;
        try {
          zip = await JSZip.loadAsync(input.data);
        } catch {
          // JSZip's own message is English and says nothing a person can act on.
          reading.unreadable.push(input.name);
          continue;
        }
        for (const entry of Object.values(zip.files)) {
          if (entry.dir || !entry.name.toLowerCase().endsWith('.e98') || SaveBackupHelper.isResourceFork(entry.name)) continue;
          const data = await entry.async('uint8array');
          if (data.byteLength === 0) reading.ignored.push(entry.name);
          else keep({ name: SaveBackupHelper.baseName(entry.name).toUpperCase(), data, source: input.name });
        }
      } else {
        reading.ignored.push(input.name);
      }
    }

    reading.saves = [...saves.values()];
    return reading;
  }

  /** Which of `saves` replace a save the guest already has. DOS names do not care about case. */
  static overwrites(saves: readonly BackupSave[], existingNames: Iterable<string>): string[] {
    const existing = new Set([...existingNames].map(name => SaveBackupHelper.baseName(name).toUpperCase()));
    return saves.map(save => save.name).filter(name => existing.has(name));
  }

  /**
   * The `.e98` names in a persisted changes layer, which is what an import can overwrite. The
   * bundle ships no save of its own (`jogos/` holds one `DRLIST.ELI`), so the layer is the whole
   * story.
   */
  static async existingNames(layer: Uint8Array | ArrayBuffer): Promise<string[]> {
    const zip = await JSZip.loadAsync(layer);
    const directory = BASE_SAVEGAME_DIR.toLowerCase();
    return Object.values(zip.files)
      .filter(entry => !entry.dir && entry.name.toLowerCase().startsWith(directory) && entry.name.toLowerCase().endsWith('.e98'))
      .map(entry => SaveBackupHelper.baseName(entry.name).toUpperCase());
  }

  /**
   * What the import's confirm dialog says. The overwrites come first and are flagged, because they
   * are the only part that cannot be undone, and a long list is cut so the buttons stay on a phone.
   */
  static importMessage(saves: readonly BackupSave[], overwrites: readonly string[], maxListed = 8): string {
    const replaced = new Set(overwrites);
    const lines = [...saves]
      .sort((a, b) => Number(replaced.has(b.name)) - Number(replaced.has(a.name)) || a.name.localeCompare(b.name))
      .map(save => replaced.has(save.name) ? `• ${save.name} (substitui o atual)` : `• ${save.name}`);
    const listed = lines.slice(0, maxListed);
    if (lines.length > listed.length) listed.push(`… e mais ${lines.length - listed.length}`);

    const total = saves.length;
    const count = total === 1 ? '1 jogo salvo' : `${total} jogos salvos`;
    let head: string;
    if (overwrites.length === 0) {
      head = total === 1 ? `${count} será adicionado:` : `${count} serão adicionados:`;
    } else if (total === 1) {
      head = `${count} substitui um que já existe:`;
    } else if (overwrites.length >= total) {
      head = `${count} substituem outros que já existem:`;
    } else if (overwrites.length === 1) {
      head = `${count}, 1 deles substitui um que já existe:`;
    } else {
      head = `${count}, ${overwrites.length} deles substituem outros que já existem:`;
    }
    return `${head}\n${listed.join('\n')}\n\nO jogo será reiniciado e o que você não gravou dentro dele será perdido.`;
  }

  /** What to tell the player about the files that were left out; empty when nothing was. */
  static skippedMessage(reading: Pick<BackupReading, 'ignored' | 'unreadable'>): string {
    const parts: string[] = [];
    if (reading.unreadable.length > 0) {
      parts.push(`Não foi possível abrir: ${reading.unreadable.join(', ')}.`);
    }
    if (reading.ignored.length > 0) {
      parts.push(`Ignorado (não é um jogo salvo): ${reading.ignored.join(', ')}.`);
    }
    return parts.join('\n');
  }

  /**
   * Whether this browser can hand a file to the system share sheet (Salvar em Arquivos, Drive,
   * WhatsApp). Feature-detected both ways: `canShare` exists in more browsers than file sharing.
   */
  static canShareFile(nav: ShareNavigatorLike, file: File): boolean {
    try {
      return typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] });
    } catch {
      return false;
    }
  }

  /** The last path segment, whichever way the slashes lean. */
  private static baseName(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }

  /** `__MACOSX/._NAME.E98` and friends: a Mac's zip carries a shadow copy of each file. */
  private static isResourceFork(path: string): boolean {
    return path.split(/[\\/]/).some(segment => segment === '__MACOSX' || segment.startsWith('._'));
  }

  private static bytes(data: ArrayBuffer | Uint8Array): Uint8Array {
    return data instanceof Uint8Array ? data : new Uint8Array(data);
  }
}
