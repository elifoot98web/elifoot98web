import { Injectable } from '@angular/core';
import { TimeoutHelper } from '../../helpers/timeout.helper';
import { StorageHealth, StorageHealthHelper, UNKNOWN_STORAGE } from '../../helpers/storage-health.helper';
import { DiagnosticsService } from './diagnostics.service';
import { SaveStatusService } from './save-status.service';

/** The part of `navigator.storage` this service reads; a spec stands in for it. */
export interface StorageEstimateSource {
  persisted?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}

/** How long each question to the browser may take; `estimate()` has no deadline of its own. */
const ASK_TIMEOUT_MS = 2000;

/**
 * What the browser says about this site's storage, for the one line in the options menu.
 *
 * **It only reads.** The request to protect the storage (`navigator.storage.persist()`) is made once
 * by {@link SaveStatusService} after the first save that worked, and this service does not repeat it:
 * a second request would only ask Firefox's person the same question twice. The answer `persist()`
 * gave is `saveStatus.durable`, which stands in when the browser cannot be asked `persisted()`.
 * Every question is raced against a deadline and a failed one is "unknown", never an error: the
 * line is information, and a menu must not wait for the browser to be able to give it.
 */
@Injectable({
  providedIn: 'root'
})
export class StorageHealthService {
  constructor(private saveStatus: SaveStatusService, private diagnostics: DiagnosticsService) { }

  /** Where `navigator.storage` comes from; a spec overrides it. */
  protected manager(): StorageEstimateSource | undefined {
    return typeof navigator === 'undefined' ? undefined : (navigator as { storage?: StorageEstimateSource }).storage;
  }

  async read(): Promise<StorageHealth> {
    const manager = this.manager();
    if (!manager) return { ...UNKNOWN_STORAGE, persisted: this.saveStatus.durable };

    const [persisted, estimate] = await Promise.all([
      this.ask(() => manager.persisted?.()),
      this.ask(() => manager.estimate?.()),
    ]);
    const health: StorageHealth = {
      persisted: typeof persisted === 'boolean' ? persisted : this.saveStatus.durable,
      usage: StorageHealthService.size(estimate?.usage),
      quota: StorageHealthService.size(estimate?.quota),
    };
    this.diagnostics.log('platform', 'storage: read', () => ({ ...health, line: StorageHealthHelper.summary(health) }));
    return health;
  }

  /** A byte count the browser reported, or null for anything that is not one: storage figures are just another input. */
  private static size(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  }

  private async ask<T>(question: () => Promise<T> | undefined): Promise<T | undefined> {
    try {
      return await TimeoutHelper.withTimeout(async () => question(), ASK_TIMEOUT_MS);
    } catch (error) {
      this.diagnostics.log('platform', 'storage: question failed', () => ({ error }));
      return undefined;
    }
  }
}
