import { NgZone } from '@angular/core';
import { DiagnosticsService } from './diagnostics.service';
import { LocalStorageService } from './local-storage.service';

/**
 * Stand-ins for specs. Nothing here is imported by the app, so none of it reaches the bundle.
 */

/** A storage that keeps its values in a map and never fails. */
export function memoryStorage(initial: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initial));
  const storage = {
    values,
    get: (key: string) => Promise.resolve(values.has(key) ? values.get(key) : null),
    set: (key: string, value: unknown) => { values.set(key, value); return Promise.resolve(); },
  };
  return storage;
}

/** A diagnostics service that is off and records nothing: for code that merely logs through it. */
export function silentDiagnostics(): DiagnosticsService {
  return new DiagnosticsService(new NgZone({ enableLongStackTrace: false }), memoryStorage() as unknown as LocalStorageService);
}

/**
 * A real diagnostics service that is ON, writing to a map and not to Ionic Storage. It installs
 * the real window listeners like any other, so a spec must `await diagnostics.disable()` when it
 * is done.
 */
export async function recordingDiagnostics(storage = memoryStorage()): Promise<DiagnosticsService> {
  const service = new DiagnosticsService(new NgZone({ enableLongStackTrace: false }), storage as unknown as LocalStorageService);
  await service.enable({ persist: false });
  return service;
}
