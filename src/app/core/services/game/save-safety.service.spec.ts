import { NgZone } from '@angular/core';
import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { AUTO_SAVER, SAVE_SAFETY } from '../../models/constants';
import { DosCI } from '../../typings/jsdos';
import { memoryStorage, silentDiagnostics } from '../shared/diagnostics.testing';
import { LocalStorageService } from '../shared/local-storage.service';
import { SaveStatusService } from '../shared/save-status.service';
import { SaveSafetyService } from './save-safety.service';

type Look = boolean | 'unknown' | 'throw' | 'hang';

/** The page-unload prompt is dispatched on a stand-in, never on the window Karma watches. */
class TestSaveSafetyService extends SaveSafetyService {
  readonly unload = new EventTarget();
  protected override unloadTarget(): EventTarget {
    return this.unload;
  }
}

const GAP = SAVE_SAFETY.HIDDEN_PERSIST_MIN_GAP_MS;

interface Rig {
  service: TestSaveSafetyService;
  status: SaveStatusService;
  saveGame: jasmine.Spy;
  isGameSaving: jasmine.Spy;
  keyActivity: Subject<void>;
  autoSaver: { running: boolean };
  /** What each look answers; the last entry repeats. */
  looks: Look[];
  hosting: { value: boolean };
  game: HTMLElement;
}

function rig(): Rig {
  const zone = new NgZone({ enableLongStackTrace: false });
  const status = new SaveStatusService(memoryStorage() as unknown as LocalStorageService, zone, silentDiagnostics());
  const looks: Look[] = [false];
  let lookIndex = 0;
  const isGameSaving = jasmine.createSpy('isGameSaving').and.callFake(() => {
    const answer = looks[Math.min(lookIndex++, looks.length - 1)];
    if (answer === 'throw') return Promise.reject(new Error('screenshot failed'));
    if (answer === 'hang') return new Promise<boolean>(() => undefined);
    return Promise.resolve(answer === 'unknown' ? null : answer);
  });
  const saveGame = jasmine.createSpy('saveGame').and.callFake(() => {
    status.persistSucceeded(status.persistStarted());
    return Promise.resolve();
  });
  const keyActivity = new Subject<void>();
  const autoSaver = { running: true };

  const service = new TestSaveSafetyService(
    zone,
    status,
    { saveGame } as never,
    { isGameSaving, keyActivity$: keyActivity.asObservable() } as never,
    autoSaver as never,
    silentDiagnostics());

  // The game's surface, which is where input counts.
  const game = document.createElement('div');
  game.id = 'game-container';
  document.body.appendChild(game);

  return { service, status, saveGame, isGameSaving, keyActivity, autoSaver, looks, hosting: { value: false }, game };
}

function attach(r: Rig) {
  r.service.attach({} as DosCI, { isHosting: () => r.hosting.value });
}

/** `document.visibilityState`, as the current spec has set it. */
let visibility: jasmine.Spy;

/** Make the page hidden or visible and tell the listeners. */
function setVisibility(state: 'hidden' | 'visible') {
  visibility.and.returnValue(state);
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('SaveSafetyService', () => {
  let r: Rig;

  beforeEach(() => {
    spyOn(console, 'error');
    visibility = spyOnProperty(document, 'visibilityState', 'get').and.returnValue('visible');
    r = rig();
  });

  afterEach(() => {
    r.service.detach();
    r.game.remove();
  });

  describe('input marks the game dirty', () => {
    it('for a tap or a click on the game, wherever inside it', () => {
      attach(r);
      const inner = document.createElement('canvas');
      r.game.appendChild(inner);

      inner.dispatchEvent(new Event('pointerdown', { bubbles: true }));

      expect(r.status.dirty).toBeTrue();
    });

    it('for a physical key aimed at the game', () => {
      attach(r);

      r.game.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));

      expect(r.status.dirty).toBeTrue();
    });

    it('not for a tap or a key anywhere else: the chat and the toolbar change nothing in the guest', () => {
      attach(r);
      const chat = document.createElement('input');
      document.body.appendChild(chat);

      chat.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      chat.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      chat.remove();

      expect(r.status.dirty).toBeFalse();
    });

    it('for a virtual key sent through the queue, which never becomes a DOM event', () => {
      attach(r);

      r.keyActivity.next();

      expect(r.status.dirty).toBeTrue();
    });

    it('not after detach', () => {
      attach(r);
      r.service.detach();

      r.game.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      r.keyActivity.next();

      expect(r.status.dirty).toBeFalse();
    });
  });

  describe('the page going hidden', () => {
    it('persists when there is unsaved input and the game is provably not saving', fakeAsync(() => {
      attach(r);
      r.status.markDirty();

      setVisibility('hidden');
      flushMicrotasks();

      expect(r.isGameSaving).toHaveBeenCalledTimes(1);
      expect(r.saveGame).toHaveBeenCalledTimes(1);
      expect(r.status.dirty).toBeFalse();
    }));

    it('does nothing for a page with no input since the last persist, and does not even look', fakeAsync(() => {
      attach(r);

      setVisibility('hidden');
      flushMicrotasks();

      expect(r.isGameSaving).not.toHaveBeenCalled();
      expect(r.saveGame).not.toHaveBeenCalled();
    }));

    it('does nothing when the page becomes visible', fakeAsync(() => {
      attach(r);
      r.status.markDirty();

      setVisibility('visible');
      flushMicrotasks();

      expect(r.saveGame).not.toHaveBeenCalled();
    }));

    it('does not persist while the game\'s save dialog is up', fakeAsync(() => {
      attach(r);
      r.status.markDirty();
      r.looks.splice(0, r.looks.length, true);

      setVisibility('hidden');
      flushMicrotasks();

      expect(r.saveGame).not.toHaveBeenCalled();
      expect(r.status.dirty).toBeTrue();
    }));

    it('does not persist on a look OCR could not read: null is not the all-clear', fakeAsync(() => {
      attach(r);
      r.status.markDirty();
      r.looks.splice(0, r.looks.length, 'unknown');

      setVisibility('hidden');
      flushMicrotasks();

      expect(r.saveGame).not.toHaveBeenCalled();
    }));

    it('does not persist on a look that threw, or one that never came back', fakeAsync(() => {
      attach(r);
      r.status.markDirty();
      r.looks.splice(0, r.looks.length, 'throw', 'hang');

      setVisibility('hidden');
      flushMicrotasks();
      expect(r.saveGame).not.toHaveBeenCalled();

      // The throttle only counts a persist that was attempted, so the hung look can be tried too.
      setVisibility('hidden');
      tick(AUTO_SAVER.HEARTBEAT_MS);
      flushMicrotasks();
      expect(r.saveGame).not.toHaveBeenCalled();
    }));

    it('is a no-op when auto-save is off, and then the OCR worker is not asked for', fakeAsync(() => {
      attach(r);
      r.autoSaver.running = false;
      r.status.markDirty();

      setVisibility('hidden');
      flushMicrotasks();

      expect(r.isGameSaving).not.toHaveBeenCalled();
      expect(r.saveGame).not.toHaveBeenCalled();
    }));

    it('persists at most once per gap, however often the page is hidden', fakeAsync(() => {
      attach(r);
      r.status.markDirty();
      setVisibility('hidden');
      flushMicrotasks();
      expect(r.saveGame).toHaveBeenCalledTimes(1);

      // More input, hidden again a minute later.
      r.status.markDirty();
      tick(60_000);
      setVisibility('hidden');
      flushMicrotasks();
      expect(r.saveGame).toHaveBeenCalledTimes(1);

      // And after the gap it may.
      tick(GAP);
      setVisibility('hidden');
      flushMicrotasks();
      expect(r.saveGame).toHaveBeenCalledTimes(2);
    }));

    it('does not persist if the player came back while it was looking', fakeAsync(() => {
      attach(r);
      r.status.markDirty();
      visibility.and.returnValue('hidden');
      // The look answers after the page is shown again.
      r.isGameSaving.and.callFake(() => new Promise<boolean>(resolve => setTimeout(() => resolve(false), 100)));

      document.dispatchEvent(new Event('visibilitychange'));
      visibility.and.returnValue('visible');
      tick(100);
      flushMicrotasks();

      expect(r.saveGame).not.toHaveBeenCalled();
    }));

    it('does not start a second persist while the first look is still going', fakeAsync(() => {
      attach(r);
      r.status.markDirty();
      r.isGameSaving.and.callFake(() => new Promise<boolean>(resolve => setTimeout(() => resolve(false), 100)));
      visibility.and.returnValue('hidden');

      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
      tick(100);
      flushMicrotasks();

      expect(r.isGameSaving).toHaveBeenCalledTimes(1);
      expect(r.saveGame).toHaveBeenCalledTimes(1);
    }));

    it('counts a persist that failed as an attempt, so a broken disk is not retried on every flip', fakeAsync(() => {
      attach(r);
      r.status.markDirty();
      r.saveGame.and.callFake(() => Promise.reject(new Error('IndexedDB closed')));

      setVisibility('hidden');
      flushMicrotasks();
      setVisibility('hidden');
      flushMicrotasks();

      expect(r.saveGame).toHaveBeenCalledTimes(1);
    }));

    it('listens to nothing after detach', fakeAsync(() => {
      attach(r);
      r.status.markDirty();
      r.service.detach();

      setVisibility('hidden');
      flushMicrotasks();

      expect(r.saveGame).not.toHaveBeenCalled();
    }));
  });

  describe('closing the page', () => {
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      r.service.unload.dispatchEvent(event);
      return event;
    };

    it('asks the browser to confirm when there is unsaved input', () => {
      attach(r);
      r.status.markDirty();

      expect(unload().defaultPrevented).toBeTrue();
    });

    it('asks when hosting a room, even with nothing unsaved', () => {
      attach(r);
      r.hosting.value = true;

      expect(unload().defaultPrevented).toBeTrue();
    });

    it('does not ask when there is nothing to lose', () => {
      attach(r);

      expect(unload().defaultPrevented).toBeFalse();
    });

    it('does not ask for a reload the app chose to make', () => {
      attach(r);
      r.status.markDirty();
      r.hosting.value = true;
      r.status.allowExit();

      expect(unload().defaultPrevented).toBeFalse();
    });

    it('does not ask after detach', () => {
      attach(r);
      r.status.markDirty();
      r.service.detach();

      expect(unload().defaultPrevented).toBeFalse();
    });
  });

  describe('saveNow', () => {
    it('has nothing to save without an emulator', async () => {
      expect(await r.service.saveNow('manual')).toEqual({ outcome: 'no-emulator' });
    });

    it('saves when the game is not saving', async () => {
      attach(r);

      const result = await r.service.saveNow('manual');

      expect(result.outcome).toBe('saved');
      expect(r.saveGame).toHaveBeenCalledTimes(1);
    });

    it('says a save was verified only when the look proved the dialog was not up', async () => {
      attach(r);

      expect(await r.service.saveNow('manual')).toEqual(jasmine.objectContaining({ outcome: 'saved', verified: true }));
    });

    it('saves on a look it could not read: the player asked, and OCR down is when the button is all there is', async () => {
      attach(r);
      r.looks.splice(0, r.looks.length, 'unknown');

      // ... but it does not claim to have checked, so the page can say so.
      expect(await r.service.saveNow('manual')).toEqual(jasmine.objectContaining({ outcome: 'saved', verified: false }));
    });

    it('saves when auto-save is off, without asking the OCR, and says it could not check', async () => {
      attach(r);
      r.autoSaver.running = false;

      expect(await r.service.saveNow('manual')).toEqual(jasmine.objectContaining({ outcome: 'saved', verified: false }));
      expect(r.isGameSaving).not.toHaveBeenCalled();
    });

    it('says the game is busy rather than copy the disk under its write', async () => {
      attach(r);
      r.looks.splice(0, r.looks.length, true);

      expect(await r.service.saveNow('manual')).toEqual({ outcome: 'busy' });
      expect(r.saveGame).not.toHaveBeenCalled();
    });

    it('reports a persist that failed', async () => {
      attach(r);
      const error = new Error('IndexedDB closed');
      r.saveGame.and.callFake(() => Promise.reject(error));

      expect(await r.service.saveNow('manual')).toEqual({ outcome: 'failed', error });
    });

    it('when leaving, waits for the game\'s own save to finish and then saves', fakeAsync(() => {
      attach(r);
      r.looks.splice(0, r.looks.length, true, true, false);
      let result: unknown;

      r.service.saveNow('leave').then(value => result = value);
      flushMicrotasks();
      expect(r.saveGame).not.toHaveBeenCalled();

      tick(SAVE_SAFETY.GAME_IDLE_POLL_MS);
      flushMicrotasks();
      expect(r.saveGame).not.toHaveBeenCalled();

      tick(SAVE_SAFETY.GAME_IDLE_POLL_MS);
      flushMicrotasks();
      expect(r.saveGame).toHaveBeenCalledTimes(1);
      expect((result as { outcome: string }).outcome).toBe('saved');
    }));

    it('when leaving, gives up waiting after the ceiling and saves anyway, unverified', fakeAsync(() => {
      attach(r);
      r.looks.splice(0, r.looks.length, true);
      let result: unknown;

      r.service.saveNow('leave').then(value => result = value);
      tick(SAVE_SAFETY.GAME_IDLE_WAIT_MS + SAVE_SAFETY.GAME_IDLE_POLL_MS);
      flushMicrotasks();

      expect(r.saveGame).toHaveBeenCalledTimes(1);
      expect(result).toEqual(jasmine.objectContaining({ outcome: 'saved', verified: false }));
    }));

    it('when leaving with the auto-saver already stopped, there is nothing to wait with: it saves at once', async () => {
      // Pins the order the page must keep: the leave flushes BEFORE it stops the auto-saver, because
      // the look needs the auto-saver's OCR worker. With it stopped the dialog is never waited for.
      attach(r);
      r.autoSaver.running = false;
      r.looks.splice(0, r.looks.length, true);

      const result = await r.service.saveNow('leave');

      expect(result).toEqual(jasmine.objectContaining({ outcome: 'saved', verified: false }));
      expect(r.isGameSaving).not.toHaveBeenCalled();
    });

    it('stops waiting for a persist that never answers and reports a failed save', fakeAsync(() => {
      attach(r);
      r.saveGame.and.callFake(() => new Promise<void>(() => undefined));
      let result: unknown;

      r.service.saveNow('manual').then(value => result = value);
      flushMicrotasks();
      expect(result).toBeUndefined();

      tick(AUTO_SAVER.PERSIST_TIMEOUT_MS);
      flushMicrotasks();

      expect(result).toEqual(jasmine.objectContaining({ outcome: 'failed' }));
    }));

    it('leaves with a failed save rather than hang on a persist that never answers', fakeAsync(() => {
      attach(r);
      r.saveGame.and.callFake(() => new Promise<void>(() => undefined));
      let result: unknown;

      r.service.saveNow('leave').then(value => result = value);
      tick(AUTO_SAVER.PERSIST_TIMEOUT_MS);
      flushMicrotasks();

      expect(result).toEqual(jasmine.objectContaining({ outcome: 'failed' }));
    }));
  });

  describe('saveBeforeReload', () => {
    it('saves, and says so, on a proven all-clear', async () => {
      attach(r);

      expect(await r.service.saveBeforeReload()).toBe('saved');
      expect(r.saveGame).toHaveBeenCalledTimes(1);
    });

    it('does not save while the dialog is up', async () => {
      attach(r);
      r.looks.splice(0, r.looks.length, true);

      expect(await r.service.saveBeforeReload()).toBe('busy');
      expect(r.saveGame).not.toHaveBeenCalled();
    });

    it('does not save on a look it could not read; it asks the person', async () => {
      attach(r);
      r.looks.splice(0, r.looks.length, 'unknown');

      expect(await r.service.saveBeforeReload()).toBe('ask');
      expect(r.saveGame).not.toHaveBeenCalled();
    });

    it('does not save on a look that threw', async () => {
      attach(r);
      r.looks.splice(0, r.looks.length, 'throw');

      expect(await r.service.saveBeforeReload()).toBe('ask');
      expect(r.saveGame).not.toHaveBeenCalled();
    });

    it('does not save, or look, when auto-save is off: it asks', async () => {
      attach(r);
      r.autoSaver.running = false;

      expect(await r.service.saveBeforeReload()).toBe('ask');
      expect(r.isGameSaving).not.toHaveBeenCalled();
      expect(r.saveGame).not.toHaveBeenCalled();
    });

    it('says it failed when the persist did', async () => {
      attach(r);
      r.saveGame.and.callFake(() => Promise.reject(new Error('quota')));

      expect(await r.service.saveBeforeReload()).toBe('failed');
    });

    it('says it failed, instead of holding the loader for ever, when the persist never answers', fakeAsync(() => {
      attach(r);
      r.saveGame.and.callFake(() => new Promise<void>(() => undefined));
      let result: unknown;

      r.service.saveBeforeReload().then(value => result = value);
      tick(AUTO_SAVER.PERSIST_TIMEOUT_MS);
      flushMicrotasks();

      expect(result).toBe('failed');
    }));

    it('asks without an emulator', async () => {
      expect(await r.service.saveBeforeReload()).toBe('ask');
    });
  });

  describe('isGameWriting', () => {
    it('is true only for a proven dialog', async () => {
      attach(r);

      r.looks.splice(0, r.looks.length, true);
      expect(await r.service.isGameWriting()).toBeTrue();
      r.looks.splice(0, r.looks.length, false);
      expect(await r.service.isGameWriting()).toBeFalse();
      r.looks.splice(0, r.looks.length, 'unknown');
      expect(await r.service.isGameWriting()).toBeFalse();
    });
  });
});
