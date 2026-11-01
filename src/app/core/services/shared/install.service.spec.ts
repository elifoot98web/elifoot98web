import { NgZone } from '@angular/core';
import { fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { InstallMode } from '../../helpers/install.helper';
import { logRecorder, silentDiagnostics } from './diagnostics.testing';
import { BeforeInstallPromptEventLike, InstallService } from './install.service';

/** The facts about the device, set BEFORE the service is built: it works out its mode in its constructor. */
const device = { standalone: false, ios: false };

class TestInstallService extends InstallService {
  protected override isStandalone(): boolean { return device.standalone || super.isStandalone(); }
  protected override isIos(): boolean { return device.ios; }
}

/** What Chromium fires: an event with a prompt() and the person's answer to it. */
function promptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEventLike;
  const shown = { count: 0 };
  event.prompt = () => { shown.count++; return Promise.resolve(); };
  event.userChoice = Promise.resolve({ outcome });
  return { event, shown };
}

function rig(facts: Partial<typeof device> = {}, diagnostics: unknown = silentDiagnostics()) {
  Object.assign(device, { standalone: false, ios: false }, facts);
  const service = new TestInstallService(new NgZone({ enableLongStackTrace: false }), diagnostics as never);
  const modes: InstallMode[] = [];
  service.mode$.subscribe(mode => modes.push(mode));
  return { service, modes };
}

describe('InstallService', () => {
  let live: InstallService[] = [];
  afterEach(() => {
    for (const service of live) service.ngOnDestroy();
    live = [];
  });
  const make = (...args: Parameters<typeof rig>) => {
    const r = rig(...args);
    live.push(r.service);
    return r;
  };

  it('offers nothing in a browser that has no prompt and is not iOS', () => {
    const { service } = make();
    expect(service.mode).toBe('none');
  });

  it('offers the prompt once Chromium makes it available, and holds it back from the browser\'s own mini-bar', () => {
    const { service, modes } = make();
    const { event } = promptEvent();

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBeTrue();
    expect(service.mode).toBe('prompt');
    expect(modes).toEqual(['none', 'prompt']);
  });

  it('shows the prompt on request, once, and says what the person answered', fakeAsync(() => {
    const { service } = make();
    const { event, shown } = promptEvent('accepted');
    window.dispatchEvent(event);

    let outcome = '';
    service.prompt().then(value => { outcome = value; });
    flushMicrotasks();

    expect(shown.count).toBe(1);
    expect(outcome).toBe('accepted');
    // The event is spent: a second ask has nothing to show, and the entry goes with the prompt.
    expect(service.mode).toBe('none');
    service.prompt().then(value => { outcome = value; });
    flushMicrotasks();
    expect(outcome).toBe('unavailable');
    expect(shown.count).toBe(1);
  }));

  it('reports a dismissed prompt, and picks up the next event Chromium fires after its own cool-down', fakeAsync(() => {
    const { service } = make();
    window.dispatchEvent(promptEvent('dismissed').event);

    let outcome = '';
    service.prompt().then(value => { outcome = value; });
    flushMicrotasks();
    expect(outcome).toBe('dismissed');
    expect(service.mode).toBe('none');

    window.dispatchEvent(promptEvent().event);
    expect(service.mode).toBe('prompt');
  }));

  it('reports a prompt that throws as unavailable instead of failing', fakeAsync(() => {
    const { service } = make();
    const { event } = promptEvent();
    event.prompt = () => Promise.reject(new DOMException('not allowed', 'NotAllowedError'));
    window.dispatchEvent(event);

    let outcome = '';
    service.prompt().then(value => { outcome = value; });
    flushMicrotasks();

    expect(outcome).toBe('unavailable');
  }));

  it('has nothing to show when asked without a prompt', fakeAsync(() => {
    const { service } = make();
    let outcome = '';
    service.prompt().then(value => { outcome = value; });
    flushMicrotasks();
    expect(outcome).toBe('unavailable');
  }));

  it('shows the how-to on iOS, which has no prompt', () => {
    const { service } = make({ ios: true });
    expect(service.mode).toBe('ios');
  });

  it('hides everything in an app that is already installed, prompt or not', () => {
    const { service } = make({ ios: true, standalone: true });
    expect(service.mode).toBe('installed');

    window.dispatchEvent(promptEvent().event);

    expect(service.mode).toBe('installed');
  });

  it('hides everything the moment the app is installed from the browser\'s own menu', () => {
    const { service, modes } = make();
    window.dispatchEvent(promptEvent().event);
    expect(service.mode).toBe('prompt');

    window.dispatchEvent(new Event('appinstalled'));

    expect(service.mode).toBe('installed');
    expect(modes).toEqual(['none', 'prompt', 'installed']);
  });

  it('notes the prompt, the answer and the installation, under "platform"', fakeAsync(() => {
    const { diagnostics, calls, messages } = logRecorder();
    const { service } = make({}, diagnostics);
    window.dispatchEvent(promptEvent('accepted').event);

    service.prompt();
    flushMicrotasks();
    window.dispatchEvent(new Event('appinstalled'));

    expect(messages()).toEqual(jasmine.arrayContaining(['install: prompt available', 'install: prompt answered', 'install: app installed']));
    expect(calls.every(([cat]) => cat === 'platform')).toBeTrue();
  }));

  it('stops listening when it is destroyed', () => {
    const { service } = make();
    service.ngOnDestroy();

    window.dispatchEvent(promptEvent().event);

    expect(service.mode).toBe('none');
  });
});
