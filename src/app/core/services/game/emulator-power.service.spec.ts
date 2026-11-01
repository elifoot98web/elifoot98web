import { NgZone } from '@angular/core';
import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { EMULATOR_POWER } from '../../models/constants';
import { GuestAccessHelper } from '../../helpers/guest-access.helper';
import { DosCI } from '../../typings/jsdos';
import { silentDiagnostics } from '../shared/diagnostics.testing';
import { EmulatorPowerOptions, EmulatorPowerService } from './emulator-power.service';

const TICK = EMULATOR_POWER.TICK_MS;
const IDLE = EMULATOR_POWER.IDLE_MS;
const SLEEP = EMULATOR_POWER.SLEEP_MS;
const PROBE = EMULATOR_POWER.PROBE_MS;
const RETRY = EMULATOR_POWER.LOOK_RETRY_MS;

/** fakeAsync without its default of draining the clock at the end: a timer left behind fails the spec. */
const strict = (body: () => void) => fakeAsync(body, { flush: false });

/** Let the clock run in service ticks, with the microtasks of a look settling after each. */
function run(ms: number): void {
  for (let spent = 0; spent < ms; spent += TICK) {
    tick(TICK);
    flushMicrotasks();
  }
}

/**
 * The service is driven against a fake emulator that records what it is told, the real `document`
 * (the listeners are the point) and the fake clock. `world` is the page it serves: change it and
 * the next tick sees it.
 */
function rig() {
  const told: string[] = [];
  const frameListeners: (() => void)[] = [];
  const dosCI = {
    pause: () => told.push('pause'),
    resume: () => told.push('resume'),
    events: () => ({ onFrame: (listener: () => void) => frameListeners.push(listener) }),
  } as unknown as DosCI;
  const world = {
    hosting: false,
    detected: true,
    busy: false,
    saving: false as boolean | null,
    looks: 0,
    /** When set, a look answers with this promise instead of `saving`. */
    pendingLook: null as Promise<boolean | null> | null,
    throwing: false,
  };
  const options: EmulatorPowerOptions = {
    isHosting: () => { if (world.throwing) throw new Error('page callback'); return world.hosting; },
    gameDetected: () => world.detected,
    isBusy: () => world.busy,
    isGameSaving: () => { world.looks++; return world.pendingLook ?? Promise.resolve(world.saving); },
  };
  const diagnostics = silentDiagnostics();
  const service = new EmulatorPowerService(new NgZone({ enableLongStackTrace: false }), diagnostics);
  service.clock = () => Date.now();

  let began = 0;
  return {
    service,
    diagnostics,
    dosCI,
    told,
    world,
    options,
    frameListeners,
    start: () => { began = Date.now(); service.start(dosCI, options); },
    /** Advance to `ms` after the service was started: the interval ticks on those instants. */
    runTo: (ms: number) => run(began + ms - Date.now()),
    /** What the emulator was told since the last call. */
    drain: () => told.splice(0),
    frame: () => frameListeners.forEach(listener => listener()),
  };
}

describe('EmulatorPowerService', () => {
  let hidden: jasmine.Spy;

  beforeEach(() => {
    hidden = spyOnProperty(document, 'hidden', 'get').and.returnValue(false);
  });

  describe('going to sleep', () => {
    it('pauses the emulator after the idle time when the save dialog is provably not up', strict(() => {
      const r = rig();
      r.start();

      run(IDLE - TICK);
      expect(r.told).toEqual([]);

      run(TICK * 2);
      expect(r.told).toEqual(['pause']);
      expect(r.service.state).toBe('asleep');
      r.service.stop();
    }));

    it('asks the page about the save dialog before it sleeps, and does not sleep on a dialog that is up', strict(() => {
      const r = rig();
      r.world.saving = true;
      r.start();

      run(IDLE + TICK * 2);

      expect(r.world.looks).toBe(1);
      expect(r.told).toEqual([]);
      r.service.stop();
    }));

    it('does not sleep on a look that could not tell, and asks again only after the retry delay', strict(() => {
      const r = rig();
      r.world.saving = null;
      r.start();

      run(IDLE + TICK);
      expect(r.world.looks).toBe(1);

      run(RETRY - TICK * 2);
      expect(r.world.looks).toBe(1);

      run(TICK * 3);
      expect(r.world.looks).toBe(2);
      expect(r.told).toEqual([]);
      expect(r.service.stats.looksRefused).toBe(2);
      r.service.stop();
    }));

    it('sleeps once the dialog is gone', strict(() => {
      const r = rig();
      r.world.saving = true;
      r.start();
      run(IDLE + TICK * 2);
      expect(r.told).toEqual([]);

      r.world.saving = false;
      run(RETRY + TICK * 2);

      expect(r.told).toEqual(['pause']);
      r.service.stop();
    }));

    it('treats a look that never answers as one that could not tell', strict(() => {
      const r = rig();
      r.world.pendingLook = new Promise<boolean | null>(() => undefined);
      r.start();

      run(IDLE + EMULATOR_POWER.LOOK_TIMEOUT_MS + TICK * 2);

      expect(r.told).toEqual([]);
      expect(r.service.stats.looksRefused).toBe(1);
      r.service.stop();
    }));

    it('drops a "no" that was overtaken by a frame while the look was out', strict(() => {
      const r = rig();
      let answer!: (verdict: boolean) => void;
      r.world.pendingLook = new Promise<boolean>(resolve => { answer = resolve; });
      r.start();
      run(IDLE);
      expect(r.world.looks).toBe(1);

      r.frame();
      answer(false);
      run(TICK);

      expect(r.told).toEqual([]);
      expect(r.service.state).toBe('awake');
      r.service.stop();
    }));

    it('stays awake for as long as frames keep coming (a blinking caret is one every ~0.55 s)', strict(() => {
      const r = rig();
      r.start();

      for (let i = 0; i < 40; i++) {
        tick(550);
        r.frame();
        flushMicrotasks();
      }

      expect(r.told).toEqual([]);
      expect(r.world.looks).toBe(0);
      r.service.stop();
    }));

    it('never sleeps a game it has not seen (the boot is quiet for long stretches)', strict(() => {
      const r = rig();
      r.world.detected = false;
      r.start();

      run(IDLE * 3);
      expect(r.told).toEqual([]);

      r.world.detected = true;
      run(IDLE + TICK * 2);
      expect(r.told).toEqual(['pause']);
      r.service.stop();
    }));

    it('never sleeps while keys or touch are in progress', strict(() => {
      const r = rig();
      r.world.busy = true;
      r.start();

      run(IDLE * 3);

      expect(r.told).toEqual([]);
      r.service.stop();
    }));

    it('never sleeps a host', strict(() => {
      const r = rig();
      r.world.hosting = true;
      r.start();

      run(IDLE * 3);

      expect(r.told).toEqual([]);
      r.service.stop();
    }));

    it('wakes a guest that was asleep when a room is created', strict(() => {
      const r = rig();
      r.start();
      run(IDLE + TICK * 2);
      expect(r.told).toEqual(['pause']);

      r.world.hosting = true;
      run(TICK * 2);

      expect(r.told).toEqual(['pause', 'resume']);
      expect(r.service.state).toBe('awake');
      r.service.stop();
    }));

    it('reads a page callback that throws as "do not sleep": unknown is not idle', strict(() => {
      const r = rig();
      r.world.throwing = true;
      r.start();

      run(IDLE * 3);

      expect(r.told).toEqual([]);
      r.service.stop();
    }));
  });

  describe('the probe', () => {
    // From the start: the look is asked at 2000 and the guest sleeps at once (a screenshot and a
    // cached verdict), so it is asleep from 2000, probes from 4000 to 4250, 6250 to 6500, and so on.
    it('resumes for a quarter second every two and a quarter, while nothing happens', strict(() => {
      const r = rig();
      r.start();
      r.runTo(IDLE);
      expect(r.drain()).toEqual(['pause']);

      r.runTo(IDLE + SLEEP - TICK);
      expect(r.drain()).toEqual([]);
      r.runTo(IDLE + SLEEP);
      expect(r.drain()).toEqual(['resume']);
      expect(r.service.state).toBe('probing');

      r.runTo(IDLE + SLEEP + PROBE);
      expect(r.drain()).toEqual(['pause']);
      expect(r.service.state).toBe('asleep');

      r.runTo(IDLE + SLEEP + PROBE + SLEEP - TICK);
      expect(r.drain()).toEqual([]);
      r.runTo(IDLE + SLEEP + PROBE + SLEEP);
      expect(r.drain()).toEqual(['resume']);
      r.service.stop();
    }));

    it('stays awake when a frame arrives in a probe, with no word to the emulator', strict(() => {
      const r = rig();
      r.start();
      r.runTo(IDLE + SLEEP);
      r.drain();
      expect(r.service.state).toBe('probing');

      r.frame();

      expect(r.service.state).toBe('awake');
      run(PROBE * 3);
      expect(r.drain()).toEqual([]);
      r.service.stop();
    }));

    it('writes only the first probe of a sleep to the diagnostics log, and the count goes on in the books and the wake', strict(() => {
      const r = rig();
      const log = spyOn(r.diagnostics, 'log');
      r.start();
      const fifthProbe = IDLE + SLEEP * 5 + PROBE * 4;
      r.runTo(fifthProbe);
      expect(r.service.stats.probes).toBe(5);

      const lines = () => log.calls.allArgs().filter(args => args[0] === 'power').map(args => args[1]);
      expect(lines().filter(line => line === 'probe').length).toBe(1);
      expect(lines().filter(line => line === 'asleep again').length).toBe(1);

      r.service.wake('test');
      expect(lines().filter(line => line === 'awake').length).toBe(1);
      const woke = (log.calls.allArgs().find(args => args[1] === 'awake')![2] as () => { probes: number })();
      expect(woke.probes).toBe(5);

      // The next sleep is a new one: its first probe is written down again.
      r.runTo(fifthProbe + IDLE + SLEEP);
      expect(lines().filter(line => line === 'probe').length).toBe(2);
      r.service.stop();
    }));

    it('keeps the books: how long the guest slept, probed and was awake, and how many times', strict(() => {
      const r = rig();
      r.start();
      r.runTo(IDLE + SLEEP + PROBE + SLEEP);

      const stats = r.service.stats;

      expect(stats.sleeps).toBe(1);
      expect(stats.probes).toBe(2);
      expect(stats.awakeMs).toBe(IDLE);
      expect(stats.probingMs).toBe(PROBE);
      expect(stats.asleepMs).toBe(SLEEP * 2);
      r.service.stop();
    }));
  });

  describe('a stall: the guest was working while it slept', () => {
    // Asleep at IDLE, probing from IDLE + SLEEP. A frame there is a guest that drew something nobody asked for.
    it('raises the idle time to twice the quiet stretch, counts it, and keeps what it learned across a toggle', strict(() => {
      const r = rig();
      r.start();
      r.runTo(IDLE + SLEEP);
      expect(r.service.state).toBe('probing');

      r.frame();
      const learned = (IDLE + SLEEP) * 2;
      expect(r.service.stats.stalls).toBe(1);
      expect(r.service.state).toBe('awake');
      r.drain();

      // Quiet for less than the new idle time: still awake.
      run(learned - TICK * 2);
      expect(r.told).toEqual([]);
      run(TICK * 4);
      expect(r.told).toEqual(['pause']);

      // A toggle starts a new machine, which starts from what was learned and not from the constant.
      r.service.stop();
      r.drain();
      r.start();
      r.runTo(learned - TICK);
      expect(r.told).toEqual([]);
      r.runTo(learned);
      expect(r.told).toEqual(['pause']);
      r.service.stop();
    }));

    it('does not count a frame from a guest that is awake', strict(() => {
      const r = rig();
      r.start();

      for (let i = 0; i < 10; i++) { tick(1000); r.frame(); flushMicrotasks(); }

      expect(r.service.stats.stalls).toBe(0);
      r.service.stop();
    }));
  });

  describe('waking', () => {
    /** Asleep since 2000 after the start, and 500 ms later, the next probe still 1500 ms away. */
    function asleepRig() {
      const r = rig();
      r.start();
      r.runTo(IDLE + TICK * 2);
      r.drain();
      return r;
    }

    const inputs: [string, () => Event][] = [
      ['pointerdown', () => new Event('pointerdown')],
      ['pointerup', () => new Event('pointerup')],
      ['keydown', () => new KeyboardEvent('keydown', { key: 'a' })],
      ['keyup', () => new KeyboardEvent('keyup', { key: 'a' })],
      ['touchstart', () => new Event('touchstart')],
      ['wheel', () => new Event('wheel')],
      ['a pointer moving with a button down', () => new PointerEvent('pointermove', { buttons: 1 })],
    ];

    for (const [name, make] of inputs) {
      it(`wakes on ${name}, at the document, before the page's own listeners see it`, strict(() => {
        const r = asleepRig();
        // A listener on the target runs after the document's capture listener, so by then the guest
        // must already have been told to resume.
        let toldWhenPageSawIt: string[] = [];
        const page = () => { toldWhenPageSawIt = [...r.told]; };
        const event = make();
        document.body.addEventListener(event.type, page);

        document.body.dispatchEvent(event);
        document.body.removeEventListener(event.type, page);

        expect(r.told).toEqual(['resume']);
        expect(toldWhenPageSawIt).toEqual(['resume']);
        r.service.stop();
      }));
    }

    it('does not wake on a mouse that is only moving over the page', strict(() => {
      const r = asleepRig();

      document.body.dispatchEvent(new PointerEvent('pointermove', { buttons: 0 }));

      expect(r.told).toEqual([]);
      r.service.stop();
    }));

    it('wakes on a mouse that is moving with the pointer locked: that is the guest\'s mouse', strict(() => {
      const r = asleepRig();
      spyOnProperty(document, 'pointerLockElement', 'get').and.returnValue(document.body);

      document.body.dispatchEvent(new PointerEvent('pointermove', { buttons: 0 }));

      expect(r.told).toEqual(['resume']);
      r.service.stop();
    }));

    it('sends one resume however many inputs follow', strict(() => {
      const r = asleepRig();

      for (let i = 0; i < 50; i++) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      r.service.wake();
      r.service.wake('keys');

      expect(r.told).toEqual(['resume']);
      r.service.stop();
    }));

    it('wake() resumes a sleeping guest and starts the idle time over', strict(() => {
      const r = asleepRig();

      r.service.wake('keys');
      expect(r.told).toEqual(['resume']);

      run(IDLE - TICK * 2);
      expect(r.told).toEqual(['resume']);
      run(TICK * 4);
      expect(r.told).toEqual(['resume', 'pause']);
      r.service.stop();
    }));

    it('wakes a probing guest without a second resume', strict(() => {
      const r = asleepRig();
      r.runTo(IDLE + SLEEP);
      expect(r.drain()).toEqual(['resume']);

      r.service.wake('touch');

      expect(r.told).toEqual([]);
      expect(r.service.state).toBe('awake');
      r.service.stop();
    }));
  });

  describe('holds', () => {
    it('wakes a sleeping guest and keeps it from sleeping until released', strict(() => {
      const r = rig();
      r.start();
      run(IDLE + TICK * 2);
      r.drain();

      const release = r.service.hold('persist');
      expect(r.told).toEqual(['resume']);

      run(IDLE * 3);
      expect(r.told).toEqual(['resume']);

      release();
      run(IDLE - TICK * 2);
      expect(r.told).toEqual(['resume']);
      run(TICK * 4);
      expect(r.told).toEqual(['resume', 'pause']);
      r.service.stop();
    }));

    it('stacks: the guest sleeps again only when every hold is released, and a release is idempotent', strict(() => {
      const r = rig();
      r.start();
      const first = r.service.hold('persist');
      const second = r.service.hold('omatic');

      first();
      first();
      run(IDLE * 3);
      expect(r.told).toEqual([]);

      second();
      run(IDLE + TICK * 2);
      expect(r.told).toEqual(['pause']);
      r.service.stop();
    }));

    it('does nothing, and costs nothing, when the service is not running', strict(() => {
      const r = rig();

      const release = r.service.hold('persist');
      r.service.wake();
      release();

      expect(r.told).toEqual([]);
      expect(r.service.running).toBeFalse();
    }));

    it('lets a hold from an earlier run go: it must not lift the holds of the run that replaced it', strict(() => {
      const r = rig();
      r.start();
      const stale = r.service.hold('persist');
      r.service.stop();
      r.start();
      r.service.hold('omatic');

      stale();
      run(IDLE * 3);

      expect(r.told).toEqual([]);
      r.service.stop();
    }));

    it('is the door GuestAccessHelper opens for code outside the service, and for game.js', strict(() => {
      const r = rig();
      r.start();
      run(IDLE + TICK * 2);
      r.drain();

      const release = GuestAccessHelper.hold('backup');
      expect(r.told).toEqual(['resume']);
      run(IDLE * 3);
      expect(r.told).toEqual(['resume']);

      release();
      r.service.stop();
      expect(globalThis.holdGuestAwake).toBeUndefined();
    }));
  });

  describe('a hidden page', () => {
    it('is js-dos\'s: no pause, no probe, and no resume even for a wake', strict(() => {
      const r = rig();
      r.start();
      run(IDLE + TICK * 2);
      run(SLEEP);
      r.drain();
      hidden.and.returnValue(true);

      run(SLEEP * 3);
      r.service.wake('keys');

      expect(r.told).toEqual([]);
      r.service.stop();
    }));

    it('does not look at the screen while hidden', strict(() => {
      const r = rig();
      hidden.and.returnValue(true);
      r.start();

      run(IDLE * 3);

      expect(r.world.looks).toBe(0);
      r.service.stop();
    }));

    it('is awake again, with a fresh idle time, when the page comes back (js-dos resumed it)', strict(() => {
      const r = rig();
      r.start();
      run(IDLE + TICK * 2);
      expect(r.service.state).toBe('asleep');
      hidden.and.returnValue(true);
      run(SLEEP * 2);
      r.drain();

      hidden.and.returnValue(false);
      document.dispatchEvent(new Event('visibilitychange'));

      expect(r.service.state).toBe('awake');
      expect(r.told).toEqual([]);
      run(IDLE - TICK * 2);
      expect(r.told).toEqual([]);
      run(TICK * 4);
      expect(r.told).toEqual(['pause']);
      r.service.stop();
    }));

    it('does not resume a guest it stops while the page is hidden (js-dos will, on return)', strict(() => {
      const r = rig();
      r.start();
      run(IDLE + TICK * 2);
      r.drain();
      hidden.and.returnValue(true);

      r.service.stop();

      expect(r.told).toEqual([]);
    }));
  });

  describe('stop', () => {
    it('resumes a guest that is asleep and leaves nothing behind', strict(() => {
      const r = rig();
      r.start();
      run(IDLE + TICK * 2);
      r.drain();

      r.service.stop();

      expect(r.told).toEqual(['resume']);
      expect(r.service.running).toBeFalse();
      expect(r.service.state).toBeNull();
      // The strict clock fails the spec if the interval is still scheduled; the listeners must be gone too.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      expect(r.told).toEqual(['resume']);
    }));

    it('says nothing to a guest that is awake', strict(() => {
      const r = rig();
      r.start();

      r.service.stop();

      expect(r.told).toEqual([]);
    }));

    it('is safe twice, and before start', strict(() => {
      const r = rig();

      r.service.stop();
      r.start();
      r.service.stop();
      r.service.stop();

      expect(r.told).toEqual([]);
    }));

    it('registers one frame listener with js-dos however often it is started again (js-dos cannot remove one)', strict(() => {
      const r = rig();

      r.start();
      r.service.stop();
      r.start();
      r.service.stop();
      r.start();

      expect(r.frameListeners.length).toBe(1);
      r.service.stop();
    }));

    it('ignores the frames of an emulator it let go of', strict(() => {
      const r = rig();
      r.start();
      run(IDLE + TICK * 2);
      r.service.stop();
      r.drain();

      r.frame();

      expect(r.told).toEqual([]);
    }));

    it('leaves the door alone when another service has registered its own', strict(() => {
      const a = rig();
      const b = rig();
      a.start();
      b.start();
      const bDoor = globalThis.holdGuestAwake;

      a.service.stop();

      expect(globalThis.holdGuestAwake).toBe(bDoor);
      b.service.stop();
    }));
  });

  describe('start', () => {
    it('is idempotent for the same emulator, and refreshes what it asks the page', strict(() => {
      const r = rig();
      r.start();
      r.world.hosting = true;
      r.service.start(r.dosCI, { ...r.options, isHosting: () => false });

      run(IDLE + TICK * 2);

      expect(r.told).toEqual(['pause']);
      r.service.stop();
    }));

    it('replaces the emulator it had, giving the old one back', strict(() => {
      const first = rig();
      first.start();
      run(IDLE + TICK * 2);
      first.drain();
      const other = rig();

      first.service.start(other.dosCI, other.options);

      expect(first.told).toEqual(['resume']);
      first.service.stop();
    }));
  });

  describe('retune', () => {
    it('applies a new idle time to a live service, and to the next start', strict(() => {
      const r = rig();
      r.start();
      r.service.retune({ idleMs: 500, inputQuietMs: 500 });

      run(TICK * 4);

      expect(r.told).toEqual(['pause']);
      r.service.stop();
    }));
  });
});
