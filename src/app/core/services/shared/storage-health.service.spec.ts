import { NgZone } from '@angular/core';
import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { silentDiagnostics } from './diagnostics.testing';
import { SaveStatusService } from './save-status.service';
import { StorageEstimateSource, StorageHealthService } from './storage-health.service';

class TestStorageHealthService extends StorageHealthService {
  source: StorageEstimateSource | undefined = {};
  protected override manager(): StorageEstimateSource | undefined { return this.source; }
}

function build(durable: boolean | null = null) {
  const saveStatus = { durable } as unknown as SaveStatusService;
  return new TestStorageHealthService(saveStatus, silentDiagnostics());
}

function read(service: StorageHealthService) {
  let value: Awaited<ReturnType<StorageHealthService['read']>> | undefined;
  service.read().then(v => { value = v; });
  flushMicrotasks();
  return value;
}

describe('StorageHealthService', () => {
  it('reads what the browser says: persisted, usage and quota', fakeAsync(() => {
    const service = build();
    service.source = {
      persisted: () => Promise.resolve(true),
      estimate: () => Promise.resolve({ usage: 5_000_000, quota: 2_000_000_000 }),
    };

    expect(read(service)).toEqual({ persisted: true, usage: 5_000_000, quota: 2_000_000_000 });
  }));

  it('never asks the browser to protect anything: that is the save status\'s one request, made after the first save', fakeAsync(() => {
    const service = build();
    const persist = jasmine.createSpy('persist').and.returnValue(Promise.resolve(true));
    service.source = { persisted: () => Promise.resolve(false), estimate: () => Promise.resolve({}), persist } as StorageEstimateSource;

    read(service);

    expect(persist).not.toHaveBeenCalled();
  }));

  it('falls back to what the save status was told when the browser cannot be asked "persisted"', fakeAsync(() => {
    const service = build(true);
    service.source = { estimate: () => Promise.resolve({ usage: 1, quota: 2 }) };

    expect(read(service)?.persisted).toBeTrue();
  }));

  it('is all unknown, not an error, in a browser without navigator.storage', fakeAsync(() => {
    const service = build();
    service.source = undefined;

    expect(read(service)).toEqual({ persisted: null, usage: null, quota: null });
  }));

  it('gives up on a question the browser never answers, and still reports the other', fakeAsync(() => {
    const service = build();
    service.source = {
      persisted: () => Promise.resolve(false),
      estimate: () => new Promise(() => undefined),
    };

    let value: unknown;
    service.read().then(v => { value = v; });
    flushMicrotasks();
    expect(value).toBeUndefined(); // still waiting for the estimate
    tick(2000);
    flushMicrotasks();

    expect(value).toEqual({ persisted: false, usage: null, quota: null });
  }));

  it('treats a question that fails as unknown', fakeAsync(() => {
    const service = build();
    service.source = {
      persisted: () => Promise.reject(new Error('SecurityError')),
      estimate: () => Promise.reject(new Error('SecurityError')),
    };

    expect(read(service)).toEqual({ persisted: null, usage: null, quota: null });
  }));

  it('does not take junk for a number', fakeAsync(() => {
    const service = build();
    service.source = {
      persisted: () => Promise.resolve('yes' as unknown as boolean),
      estimate: () => Promise.resolve({ usage: '5' as unknown as number, quota: NaN }),
    };

    const health = read(service);
    expect(health?.persisted).toBeNull();
    expect(health?.usage).toBeNull();
    expect(health?.quota).toBeNull();
  }));
});
