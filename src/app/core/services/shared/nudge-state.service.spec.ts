import { fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { STORAGE_KEY } from '../../models/constants';
import { logRecorder, memoryStorage, silentDiagnostics } from './diagnostics.testing';
import { LocalStorageService } from './local-storage.service';
import { NudgeStateService } from './nudge-state.service';

function build(initial: Record<string, unknown> = {}, diagnostics: unknown = silentDiagnostics()) {
  const storage = memoryStorage(initial);
  const service = new NudgeStateService(storage as unknown as LocalStorageService, diagnostics as never);
  return { service, storage };
}

/** The value of a promise a fakeAsync body is waiting for. */
function settle<T>(promise: Promise<T>): T {
  let value: T | undefined;
  promise.then(v => { value = v; });
  flushMicrotasks();
  return value as T;
}

describe('NudgeStateService', () => {
  beforeEach(() => spyOn(console, 'warn'));

  it('starts with every nudge due', fakeAsync(() => {
    const { service } = build();

    expect(settle(service.answered('install'))).toBeFalse();
    expect(settle(service.answered('rotate'))).toBeFalse();
  }));

  it('remembers an answer, in this visit and in the next, and never shows the nudge again', fakeAsync(() => {
    const { service, storage } = build();

    settle(service.answer('install'));

    expect(settle(service.answered('install'))).toBeTrue();
    expect(storage.values.get(STORAGE_KEY.INSTALL_NUDGE_DISMISSED)).toBe(true);
    // A later visit: a new service over the same storage.
    const later = new NudgeStateService(storage as unknown as LocalStorageService, silentDiagnostics());
    expect(settle(later.answered('install'))).toBeTrue();
    expect(settle(later.answered('rotate'))).toBeFalse(); // the other one is its own
  }));

  it('keeps the two nudges apart, each under its own key', fakeAsync(() => {
    const { service, storage } = build();

    settle(service.answer('rotate'));

    expect(storage.values.get(STORAGE_KEY.ROTATE_HINT_SHOWN)).toBe(true);
    expect(storage.values.has(STORAGE_KEY.INSTALL_NUDGE_DISMISSED)).toBeFalse();
    expect(settle(service.answered('install'))).toBeFalse();
  }));

  it('does not bring a nudge back because the write failed: the answer is kept in memory first', fakeAsync(() => {
    const { service, storage } = build();
    spyOn(storage, 'set').and.returnValue(Promise.reject(new Error('QuotaExceededError')));

    settle(service.answer('install'));

    expect(settle(service.answered('install'))).toBeTrue();
  }));

  it('reads a store that cannot be read as "answered": a nudge that cannot remember it was shown would nag on every visit', fakeAsync(() => {
    const { diagnostics, messages } = logRecorder();
    const { service, storage } = build({}, diagnostics);
    spyOn(storage, 'get').and.returnValue(Promise.reject(new Error('SecurityError')));

    expect(settle(service.answered('install'))).toBeTrue();
    expect(messages()).toContain('nudge: storage unreadable, treated as answered');
  }));

  it('takes only a stored true for an answer: junk is not one', fakeAsync(() => {
    const { service } = build({ [STORAGE_KEY.ROTATE_HINT_SHOWN]: 'yes', [STORAGE_KEY.INSTALL_NUDGE_DISMISSED]: 1 });

    expect(settle(service.answered('rotate'))).toBeFalse();
    expect(settle(service.answered('install'))).toBeFalse();
  }));

  it('notes an answer, under "platform"', fakeAsync(() => {
    const { diagnostics, calls } = logRecorder();
    const { service } = build({}, diagnostics);

    settle(service.answer('rotate'));

    expect(calls).toEqual([['platform', 'nudge: answered', { nudge: 'rotate' }]]);
  }));
});
