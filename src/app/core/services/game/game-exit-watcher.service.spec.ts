import { NgZone } from '@angular/core';
import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { GAME_EXIT_WATCH } from '../../models/constants';
import { BootStageHelper } from '../../helpers/boot-stage.helper';
import { FrameName, loadFrame } from '../../helpers/game-exit.fixtures';
import { DosCI } from '../../typings/jsdos';
import { silentDiagnostics } from '../shared/diagnostics.testing';
import { GameExitWatcherService } from './game-exit-watcher.service';

const POLL = GAME_EXIT_WATCH.POLL_MS;
const NEEDED = GAME_EXIT_WATCH.LOOKS_NEEDED;

/** fakeAsync without its default of draining the clock at the end: a timer left behind fails the spec. */
const strict = (body: () => void) => fakeAsync(body, { flush: false });

type Frame = Awaited<ReturnType<typeof loadFrame>>;

/**
 * The watcher is driven with real frames of the guest (the fixtures GameExitHelper is specced on)
 * and a fake clock; the screenshot is a script of what each look finds.
 */
describe('GameExitWatcherService', () => {
  const frames = {} as Record<FrameName, Frame>;

  beforeAll(async () => {
    for (const name of ['programManager640', 'programManager640Cursor', 'squad640', 'teamEditor640', 'acerca640'] as FrameName[]) {
      frames[name] = await loadFrame(name);
    }
  });

  type Look = FrameName | 'throw' | 'hang';

  function fixture() {
    const script: Look[] = ['squad640'];
    let index = 0;
    const screenshot = jasmine.createSpy('screenshot').and.callFake(() => {
      const next = script[Math.min(index++, script.length - 1)];
      if (next === 'throw') return Promise.reject(new Error('emulator gone'));
      if (next === 'hang') return new Promise<ImageData>(() => undefined);
      return Promise.resolve(frames[next] as unknown as ImageData);
    });
    const service = new GameExitWatcherService(new NgZone({ enableLongStackTrace: false }), silentDiagnostics());
    const exits: number[] = [];
    service.exited$.subscribe(() => exits.push(Date.now()));
    return { service, screenshot, script, exits, dosCI: { screenshot } as unknown as DosCI };
  }

  let hidden: jasmine.Spy;

  beforeEach(() => {
    hidden = spyOnProperty(document, 'hidden', 'get').and.returnValue(false);
  });

  it('stays quiet while the game is on screen', strict(() => {
    const f = fixture();

    f.service.start(f.dosCI);
    tick(POLL * 10);

    expect(f.screenshot).toHaveBeenCalledTimes(10);
    expect(f.exits).toEqual([]);
    f.service.stop();
  }));

  it('says so once the bare desktop has stayed for the number of looks in a row it needs', strict(() => {
    const f = fixture();
    f.script.splice(0, f.script.length, 'squad640', 'programManager640');

    f.service.start(f.dosCI);
    tick(POLL);                       // the game
    tick(POLL * (NEEDED - 1));        // the desktop, one look short
    expect(f.exits).toEqual([]);

    tick(POLL);                       // the look that completes it
    expect(f.exits.length).toBe(1);
    f.service.stop();
  }));

  it('does not say it before the three seconds the spec asks for have passed', strict(() => {
    const f = fixture();
    f.script.splice(0, f.script.length, 'programManager640');

    f.service.start(f.dosCI);
    tick(POLL * NEEDED - 1);

    expect(f.exits).toEqual([]);
    tick(1);
    expect(f.exits.length).toBe(1);
    expect(POLL * NEEDED).toBeGreaterThanOrEqual(3000);
    f.service.stop();
  }));

  it('starts counting again when anything else is on screen in between', strict(() => {
    const f = fixture();
    // The last look repeats for ever, so the script ends on the game.
    f.script.splice(0, f.script.length, 'programManager640', 'programManager640', 'squad640', 'programManager640', 'programManager640', 'squad640');

    f.service.start(f.dosCI);
    tick(POLL * 10);

    expect(f.exits).toEqual([]);
    f.service.stop();
  }));

  it('says it once per episode, not once per look', strict(() => {
    const f = fixture();
    f.script.splice(0, f.script.length, 'programManager640');

    f.service.start(f.dosCI);
    tick(POLL * 20);

    expect(f.exits.length).toBe(1);
    f.service.stop();
  }));

  it('says it again for a new episode: gone from the desktop, then back to it', strict(() => {
    const f = fixture();
    f.script.splice(0, f.script.length,
      'programManager640', 'programManager640', 'programManager640',
      'teamEditor640',
      'programManager640Cursor', 'programManager640Cursor', 'programManager640Cursor');

    f.service.start(f.dosCI);
    tick(POLL * 7);

    expect(f.exits.length).toBe(2);
    f.service.stop();
  }));

  it('does not take the team editor on the same desktop for the game having quit', strict(() => {
    const f = fixture();
    f.script.splice(0, f.script.length, 'teamEditor640');

    f.service.start(f.dosCI);
    tick(POLL * 10);

    expect(f.exits).toEqual([]);
    f.service.stop();
  }));

  it('does not count a look that failed, or one that never came back, towards an exit', strict(() => {
    const f = fixture();
    f.script.splice(0, f.script.length, 'programManager640', 'programManager640', 'throw', 'programManager640', 'hang', 'programManager640');

    f.service.start(f.dosCI);
    tick(POLL * 4);
    // The hung look gives up after its deadline, and the loop goes on.
    tick(GAME_EXIT_WATCH.SCREENSHOT_TIMEOUT_MS + POLL * 3);

    expect(f.exits).toEqual([]);
    f.service.stop();
  }));

  it('skips the looks of a page that is hidden, and goes on from where it was when it is shown again', strict(() => {
    const f = fixture();
    f.script.splice(0, f.script.length, 'programManager640');

    f.service.start(f.dosCI);
    tick(POLL * 2);
    expect(f.exits).toEqual([]);

    hidden.and.returnValue(true);
    tick(POLL * 10);
    expect(f.screenshot).toHaveBeenCalledTimes(2);
    expect(f.exits).toEqual([]);

    hidden.and.returnValue(false);
    tick(POLL);
    expect(f.exits.length).toBe(1);
    f.service.stop();
  }));

  it('leaves nothing on the clock after stop, and a look that was in flight says nothing', strict(() => {
    const f = fixture();
    f.script.splice(0, f.script.length, 'programManager640');

    f.service.start(f.dosCI);
    tick(POLL * 2);
    f.service.stop();
    tick(POLL * 10);

    expect(f.exits).toEqual([]);
    expect(f.screenshot).toHaveBeenCalledTimes(2);
  }));

  it('does not say it for a look that lands after stop', strict(() => {
    const f = fixture();
    let finish!: () => void;
    f.screenshot.and.callFake(() => new Promise<ImageData>(resolve => { finish = () => resolve(frames.programManager640 as unknown as ImageData); }));

    f.service.start(f.dosCI);
    tick(POLL);                       // a look is now waiting for its frame
    f.service.stop();
    finish();
    flushMicrotasks();
    tick(POLL * 10);

    expect(f.exits).toEqual([]);
  }));

  describe('started before the boot saw the game (armWhen)', () => {
    const armWhen = (frame: Parameters<typeof BootStageHelper.isGameScreen>[0]) => BootStageHelper.isGameScreen(frame);

    it('is given a splash that the boot probe accepts, which the squad list is not', () => {
      expect(BootStageHelper.isGameScreen(frames.acerca640)).toBeTrue();
      expect(BootStageHelper.isGameScreen(frames.squad640)).toBeFalse();
    });

    it('does not count the desktop Windows draws while the game loads', strict(() => {
      const f = fixture();
      f.script.splice(0, f.script.length, 'programManager640');

      f.service.start(f.dosCI, { armWhen });
      tick(POLL * 20);

      expect(f.screenshot).toHaveBeenCalledTimes(20);
      expect(f.exits).toEqual([]);
      f.service.stop();
    }));

    it('counts from the first frame of the game, so a late boot still gets the dialog', strict(() => {
      const f = fixture();
      // The desktop of the boot, the splash that arms it, the game, then the exit.
      f.script.splice(0, f.script.length, 'programManager640', 'programManager640', 'acerca640', 'squad640',
        'programManager640', 'programManager640', 'programManager640');

      f.service.start(f.dosCI, { armWhen });
      tick(POLL * 6);
      expect(f.exits).toEqual([]);

      tick(POLL);
      expect(f.exits.length).toBe(1);
      f.service.stop();
    }));

    it('needs the three looks even when the frame that arms it is the desktop of a quick exit', strict(() => {
      const f = fixture();
      f.script.splice(0, f.script.length, 'acerca640', 'programManager640', 'programManager640');

      f.service.start(f.dosCI, { armWhen });
      tick(POLL * 3);

      expect(f.exits).toEqual([]);
      tick(POLL);
      expect(f.exits.length).toBe(1);
      f.service.stop();
    }));

    it('is armed again from scratch by the next start', strict(() => {
      const f = fixture();
      f.script.splice(0, f.script.length, 'acerca640');
      f.service.start(f.dosCI, { armWhen });
      tick(POLL);
      f.service.stop();

      f.script.splice(0, f.script.length, 'programManager640');
      f.service.start(f.dosCI, { armWhen });
      tick(POLL * 10);

      expect(f.exits).toEqual([]);
      f.service.stop();
    }));
  });

  it('can be started again without doubling up', strict(() => {
    const f = fixture();

    f.service.start(f.dosCI);
    f.service.start(f.dosCI);
    tick(POLL * 3);

    expect(f.screenshot).toHaveBeenCalledTimes(3);
    f.service.stop();
  }));
});
