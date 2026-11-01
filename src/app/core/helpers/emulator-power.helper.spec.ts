import { EmulatorPowerHelper, IdlePowerMachine, PowerBlocker, PowerConfig, PowerStep } from './emulator-power.helper';

const CONFIG: PowerConfig = { idleMs: 2000, inputQuietMs: 2000, sleepMs: 2000, probeMs: 250, policy: 'probe', lookRetryMs: 1000, lookRetryMaxMs: 8000, slackMs: 0, maxIdleMs: 20000 };
const TICK = 250;

/**
 * The machine owns no clock, so every spec is a script of (time, event) calls. `drive` runs the
 * caller's side of the handshake the way the service does: a tick every 250 ms, and a `look` is
 * answered after `lookMs` with whatever `verdict` says at that moment.
 */
function rig(config: Partial<PowerConfig> = {}, startAt = 0) {
  const machine = new IdlePowerMachine({ ...CONFIG, ...config }, startAt);
  const commands: { at: number; command: string; why: string }[] = [];
  const record = (at: number, step: PowerStep) => {
    if (step.command !== 'none') commands.push({ at, command: step.command, why: step.why });
    return step;
  };

  return {
    machine,
    commands,
    /** Only the commands, in order. */
    names: () => commands.map(c => c.command),
    tick: (at: number, blocker: PowerBlocker = null) => record(at, machine.tick(at, blocker)),
    frame: (at: number) => record(at, machine.frame(at)),
    input: (at: number) => record(at, machine.input(at)),
    visible: (at: number) => record(at, machine.visible(at)),
    answer: (at: number, verdict: boolean | null, blocker: PowerBlocker = null) => record(at, machine.answer(at, verdict, blocker)),
    settle: (at: number) => record(at, machine.settle(at)),
    /**
     * Tick from `from` to `to` inclusive, answering a look after `lookMs` with `verdict()`.
     * Returns the time of the last tick.
     */
    drive(from: number, to: number, options: { verdict?: () => boolean | null; lookMs?: number; blocker?: () => PowerBlocker } = {}) {
      const verdict = options.verdict ?? (() => false);
      const lookMs = options.lookMs ?? 0;
      let pending: { askedAt: number; answerAt: number } | null = null;
      for (let at = from; at <= to; at += TICK) {
        if (pending && at >= pending.answerAt) {
          record(at, machine.answer(at, verdict(), options.blocker?.() ?? null));
          pending = null;
        }
        const step = record(at, machine.tick(at, options.blocker?.() ?? null));
        if (step.command === 'look') pending = { askedAt: at, answerAt: at + lookMs };
      }
    },
  };
}

describe('IdlePowerMachine', () => {
  describe('going to sleep', () => {
    it('stays awake until nothing has happened for the idle time, then asks', () => {
      const r = rig();

      expect(r.tick(1750).command).toBe('none');
      expect(r.tick(2000)).toEqual(jasmine.objectContaining({ command: 'look', state: 'awake', why: 'idle' }));
    });

    it('counts the idle time from the last frame', () => {
      const r = rig();

      r.frame(1500);

      expect(r.tick(2000).command).toBe('none');
      expect(r.tick(3250).command).toBe('none');
      expect(r.tick(3500).command).toBe('look');
    });

    it('counts the idle time from the last input', () => {
      const r = rig();

      r.input(1900);

      expect(r.tick(3500).command).toBe('none');
      expect(r.tick(3900).command).toBe('look');
    });

    it('waits for the input quiet time as well: a still screen right after a tap may be a computation', () => {
      const r = rig({ inputQuietMs: 10000 });

      r.input(1000);

      expect(r.tick(2000).command).toBe('none');
      expect(r.tick(10750).command).toBe('none');
      expect(r.tick(11000).command).toBe('look');
    });

    it('does not shorten the frame rule: the input may be old and the picture still moving', () => {
      const r = rig({ inputQuietMs: 10000 });

      r.frame(11500);

      expect(r.tick(12000).command).toBe('none');
      expect(r.tick(13500).command).toBe('look');
    });

    it('keeps a guest with a blinking caret awake for good: a frame every 550 ms is never two seconds of quiet', () => {
      const r = rig();

      for (let at = 550; at < 120000; at += 550) {
        r.frame(at);
        r.tick(at + 1);
        r.tick(at + 251);
        r.tick(at + 501);
      }

      expect(r.names()).toEqual([]);
      expect(r.machine.state).toBe('awake');
    });

    it('sleeps on a definite no, and only then', () => {
      const r = rig();
      r.tick(2000);

      const step = r.answer(2010, false);

      expect(step).toEqual(jasmine.objectContaining({ command: 'pause', state: 'asleep', from: 'awake' }));
      expect(r.machine.paused).toBeTrue();
    });

    it('does not sleep while the save dialog is up, and asks again after the retry delay, not sooner', () => {
      const r = rig();
      r.tick(2000);

      expect(r.answer(2010, true)).toEqual(jasmine.objectContaining({ command: 'none', why: 'save dialog up' }));
      expect(r.tick(2250).command).toBe('none');
      expect(r.tick(3000).command).toBe('none');
      expect(r.tick(3010).command).toBe('look');
      expect(r.machine.state).toBe('awake');
    });

    it('does not sleep on a look that could not tell, either (null is not the all-clear)', () => {
      const r = rig();
      r.tick(2000);

      const step = r.answer(2010, null);

      expect(step).toEqual(jasmine.objectContaining({ command: 'none', state: 'awake', why: 'save dialog unreadable' }));
      expect(r.tick(2500).command).toBe('none');
      expect(r.tick(3010).command).toBe('look');
    });

    it('asks less and less often when the look keeps being unable to tell: that is the page (auto-save off, no OCR), not the screen', () => {
      const r = rig();
      let asked = 2000;
      r.tick(asked);

      for (const wait of [1000, 2000, 4000, 8000, 8000]) {
        r.answer(asked + 10, null);
        expect(r.tick(asked + 10 + wait - 1).command).toBe('none');
        expect(r.tick(asked + 10 + wait).command).toBe('look');
        asked = asked + 10 + wait;
      }
    });

    it('goes back to the short retry as soon as a look gives a definite answer', () => {
      const r = rig();
      r.tick(2000);
      r.answer(2010, null);
      r.tick(3010);
      r.answer(3020, null);               // the wait is 2 s now
      r.tick(5020);
      r.answer(5030, true);               // a dialog that is up: back to 1 s

      expect(r.tick(6029).command).toBe('none');
      expect(r.tick(6030).command).toBe('look');
      r.answer(6040, null);               // and the next unreadable one starts the doubling again
      expect(r.tick(7039).command).toBe('none');
      expect(r.tick(7040).command).toBe('look');
    });

    it('never asks twice at once: a tick while a look is out says nothing', () => {
      const r = rig();

      r.tick(2000);

      expect(r.tick(2250)).toEqual(jasmine.objectContaining({ command: 'none', why: 'look out' }));
    });

    it('drops the answer when a frame arrived while the look was out: it describes a screen that moved', () => {
      const r = rig();
      r.tick(2000);
      r.frame(2005);

      const step = r.answer(2010, false);

      expect(step).toEqual(jasmine.objectContaining({ command: 'none', why: 'activity during the look' }));
      expect(r.machine.state).toBe('awake');
      // ...and the idle time restarts from that frame.
      expect(r.tick(3750).command).toBe('none');
      expect(r.tick(4005).command).toBe('look');
    });

    it('drops the answer when input arrived while the look was out', () => {
      const r = rig();
      r.tick(2000);
      r.input(2005);

      expect(r.answer(2010, false).command).toBe('none');
    });

    it('drops the answer when something started to block while the look was out', () => {
      const r = rig();
      r.tick(2000);

      const step = r.answer(2010, false, 'hosting');

      expect(step).toEqual(jasmine.objectContaining({ command: 'none', why: 'hosting' }));
      expect(r.machine.state).toBe('awake');
    });

    it('ignores an answer nobody asked for', () => {
      const r = rig();

      expect(r.answer(2010, false)).toEqual(jasmine.objectContaining({ command: 'none', why: 'stale answer' }));
      expect(r.machine.state).toBe('awake');
    });

    it('lets slack stand in for a timer that fired a hair early', () => {
      const r = rig({ slackMs: 25 });

      expect(r.tick(1974).command).toBe('none');
      expect(r.tick(1975).command).toBe('look');
    });
  });

  describe('the longest gap', () => {
    it('is the longest stretch between two frames that the guest spent awake', () => {
      const r = rig();

      r.frame(300);
      r.frame(5000);
      r.frame(5600);

      expect(r.machine.longestFrameGapMs).toBe(4700);
    });

    it('does not count the time the guest slept when an input woke it before its first frame: that quiet was the saver\'s', () => {
      const r = rig();
      r.frame(300);
      r.tick(2300);
      r.answer(2300, false);                // asleep at 2300
      r.input(60000);                       // woken a minute later

      r.frame(60040);

      expect(r.machine.longestFrameGapMs).toBe(300);
    });

    it('does not count it either when a blocker woke the guest', () => {
      const r = rig();
      r.frame(300);
      r.tick(2300);
      r.answer(2300, false);
      r.tick(60000, 'a persist is running');

      r.tick(60250);
      r.frame(60300);

      expect(r.machine.longestFrameGapMs).toBe(300);
    });

    it('does not count a gap that ended with the guest asleep or probing: the duty cycle stretched it', () => {
      const r = rig();
      r.frame(300);
      r.tick(2300);
      r.answer(2300, false);
      r.tick(4300);                       // probe begins

      r.frame(90000);

      expect(r.machine.longestFrameGapMs).toBe(300);
    });
  });

  describe('a stall (a frame from a guest that was asleep)', () => {
    /** Asleep at 2000, probing from 4000 to 4250, 6250 to 6500, and so on. */
    function asleep() {
      const r = rig();
      r.tick(2000);
      r.answer(2000, false);
      return r;
    }

    it('grows the idle time to twice the quiet stretch that just ended', () => {
      const r = asleep();
      r.tick(4000);                       // probe

      const step = r.frame(5000);

      expect(step.grewTo).toBe(10000);
      expect(r.tick(14999).command).toBe('none');
      expect(r.tick(15000).command).toBe('look');
    });

    it('also grows it for a frame that comes while the guest is asleep, not probing', () => {
      const r = asleep();

      const step = r.frame(3000);

      expect(step.grewTo).toBe(6000);
      expect(step.command).toBe('resume');
    });

    it('has a ceiling', () => {
      const r = asleep();
      r.tick(4000);

      const step = r.frame(90000);

      expect(step.grewTo).toBe(20000);
    });

    it('does nothing for a frame from a guest that is awake', () => {
      const r = rig();
      r.frame(9000);

      expect(r.frame(18000).grewTo).toBeUndefined();
    });

    it('never shrinks, and does not grow again for a stretch it already covers', () => {
      const r = asleep();
      r.tick(4000);
      expect(r.frame(90000).grewTo).toBe(20000);
      r.tick(110000);                     // look: 20 s of quiet
      r.answer(110000, false);
      r.tick(112000);                     // probe

      const step = r.frame(112500);

      expect(step.grewTo).toBeUndefined();
      expect(r.tick(132000).command).toBe('none');   // 19.5 s since that frame: still the 20 s
      expect(r.tick(132500).command).toBe('look');
    });

    it('raises the input quiet time with it when it is the smaller of the two', () => {
      const r = asleep();
      r.tick(4000);
      r.frame(5000);                      // idle and input quiet are now 10000

      r.input(6000);

      expect(r.tick(15999).command).toBe('none');    // frame rule is met at 15000, input rule at 16000
      expect(r.tick(16000).command).toBe('look');
    });

    it('is switched off by a ceiling of 0', () => {
      const r = rig({ maxIdleMs: 0 });
      r.tick(2000);
      r.answer(2000, false);
      r.tick(4000);

      expect(r.frame(5000).grewTo).toBeUndefined();
    });
  });

  describe('blockers', () => {
    it('never sleeps while something blocks, and counts the block as activity', () => {
      const r = rig();

      r.drive(0, 5000, { blocker: () => 'hosting' });
      expect(r.names()).toEqual([]);

      // The idle time restarts when the blocker ends, not at the last frame 5 s ago.
      expect(r.tick(5250).command).toBe('none');
      expect(r.tick(6750).command).toBe('none');
      expect(r.tick(7000).command).toBe('look');
    });

    it('wakes a sleeping guest the moment something blocks', () => {
      const r = rig();
      r.tick(2000);
      r.answer(2000, false);

      const step = r.tick(2250, 'hosting');

      expect(step).toEqual(jasmine.objectContaining({ command: 'resume', state: 'awake', why: 'hosting' }));
    });

    it('wakes a guest in the middle of a probe without a command: it is already running', () => {
      const r = rig();
      r.tick(2000);
      r.answer(2000, false);
      r.tick(4000);                       // probe begins

      const step = r.tick(4100, 'a persist is running');

      expect(step).toEqual(jasmine.objectContaining({ command: 'none', state: 'awake' }));
      expect(r.names()).toEqual(['look', 'pause', 'resume']);
    });

    it('leaves a sleeping guest asleep until the sleep time is over', () => {
      const r = rig();
      r.tick(2000);
      r.answer(2000, false);

      expect(r.tick(2250).command).toBe('none');
    });
  });

  describe('the probe', () => {
    it('resumes every 2.25 s for 250 ms: asleep 2000, probing 250, asleep again', () => {
      const r = rig();
      r.tick(2000);
      r.answer(2000, false);              // asleep at 2000

      r.drive(2250, 2000 + 2250 * 3);

      expect(r.commands.slice(2)).toEqual([
        { at: 4000, command: 'resume', why: 'probe' },
        { at: 4250, command: 'pause', why: 'probe saw no frame' },
        { at: 6250, command: 'resume', why: 'probe' },
        { at: 6500, command: 'pause', why: 'probe saw no frame' },
        { at: 8500, command: 'resume', why: 'probe' },
        { at: 8750, command: 'pause', why: 'probe saw no frame' },
      ]);
    });

    it('runs the guest for about one ninth of the time while nothing happens', () => {
      const r = rig();
      r.tick(2000);
      r.answer(2000, false);

      r.drive(2250, 62000);

      const resumes = r.commands.filter(c => c.command === 'resume').length;
      const pauses = r.commands.filter(c => c.command === 'pause').length;
      expect(resumes).toBe(26);                       // 60 s / 2.25 s
      expect(pauses).toBe(27);                        // those 26 probes ended, plus the first sleep
      expect(resumes * 250 / 60000).toBeCloseTo(0.1083, 3);
    });

    it('stays awake the moment a frame arrives in a probe, and sleeps again only after another quiet 2 s', () => {
      // Without the learning (a frame from a sleeping guest grows the idle time), which has its own cases.
      const r = rig({ maxIdleMs: 0 });
      r.tick(2000);
      r.answer(2000, false);
      r.tick(4000);                       // probe begins

      const step = r.frame(4100);

      expect(step).toEqual(jasmine.objectContaining({ command: 'none', state: 'awake', from: 'probing' }));
      expect(r.tick(4250).command).toBe('none');
      expect(r.tick(6000).command).toBe('none');
      expect(r.tick(6100).command).toBe('look');
    });

    it('lets a frame arrive late in the probe and still count', () => {
      const r = rig();
      r.tick(2000);
      r.answer(2000, false);
      r.tick(4000);

      r.frame(4240);

      expect(r.machine.state).toBe('awake');
      expect(r.tick(4250).command).toBe('none');
    });

    it('the hard policy never resumes by itself', () => {
      const r = rig({ policy: 'hard' });
      r.tick(2000);
      r.answer(2000, false);

      r.drive(2250, 600000);

      expect(r.names()).toEqual(['look', 'pause']);
      expect(r.machine.state).toBe('asleep');
    });
  });

  describe('waking', () => {
    function asleep() {
      const r = rig();
      r.tick(2000);
      r.answer(2000, false);
      return r;
    }

    it('wakes on input with one resume', () => {
      const r = asleep();

      const step = r.input(2600);

      expect(step).toEqual(jasmine.objectContaining({ command: 'resume', state: 'awake', from: 'asleep', why: 'input' }));
    });

    it('is idempotent: a hundred inputs in a row send one resume', () => {
      const r = asleep();

      for (let i = 0; i < 100; i++) r.input(2600 + i * 10);

      expect(r.names()).toEqual(['look', 'pause', 'resume']);
    });

    it('wakes on input during a probe without a second resume: it is running', () => {
      const r = asleep();
      r.tick(4000);

      const step = r.input(4100);

      expect(step).toEqual(jasmine.objectContaining({ command: 'none', state: 'awake', from: 'probing' }));
      expect(r.names()).toEqual(['look', 'pause', 'resume']);
    });

    it('treats a frame from a guest it thought asleep as a wake (it was in flight, or something resumed it)', () => {
      const r = asleep();

      const step = r.frame(2100);

      expect(step).toEqual(jasmine.objectContaining({ command: 'resume', state: 'awake', why: 'frame while asleep' }));
    });

    it('starts the idle time over after a wake', () => {
      const r = asleep();
      r.input(2600);

      expect(r.tick(4500).command).toBe('none');
      expect(r.tick(4600).command).toBe('look');
    });

    it('treats the page coming back as a wake that js-dos already carried out: no command, fresh clocks', () => {
      const r = asleep();

      const step = r.visible(9000);

      expect(step).toEqual(jasmine.objectContaining({ command: 'none', state: 'awake', from: 'asleep' }));
      expect(r.tick(10000).command).toBe('none');
      expect(r.tick(11000).command).toBe('look');
    });

    it('forgets a look that was out when the page was hidden', () => {
      const r = rig();
      r.tick(2000);

      r.visible(2100);

      expect(r.answer(2200, false).why).toBe('stale answer');
    });
  });

  describe('settle (stop)', () => {
    it('resumes a sleeping guest and goes back to awake', () => {
      const r = rig();
      r.tick(2000);
      r.answer(2000, false);

      expect(r.settle(2500)).toEqual(jasmine.objectContaining({ command: 'resume', state: 'awake' }));
    });

    it('says nothing to a guest that is awake or on trial, which is already running', () => {
      const r = rig();
      expect(r.settle(100).command).toBe('none');

      const probing = rig();
      probing.tick(2000);
      probing.answer(2000, false);
      probing.tick(4000);
      expect(probing.settle(4100)).toEqual(jasmine.objectContaining({ command: 'none', state: 'awake' }));
    });
  });

  describe('configure', () => {
    it('applies a new idle time to a live machine', () => {
      const r = rig();

      r.machine.configure({ idleMs: 500, inputQuietMs: 500 });

      expect(r.tick(500).command).toBe('look');
    });
  });
});

describe('EmulatorPowerHelper', () => {
  const quiet = { hosting: false, gameDetected: true, holds: 0, busy: false };

  describe('blocker', () => {
    it('is null when nothing stands in the way', () => {
      expect(EmulatorPowerHelper.blocker(quiet)).toBeNull();
    });

    it('names each reason', () => {
      expect(EmulatorPowerHelper.blocker({ ...quiet, hosting: true })).toBe('hosting');
      expect(EmulatorPowerHelper.blocker({ ...quiet, gameDetected: false })).toBe('game not detected');
      expect(EmulatorPowerHelper.blocker({ ...quiet, holds: 1 })).toBe('held awake');
      expect(EmulatorPowerHelper.blocker({ ...quiet, busy: true })).toBe('keys or touch in progress');
    });

    it('counts any number of holds', () => {
      expect(EmulatorPowerHelper.blocker({ ...quiet, holds: 3 })).toBe('held awake');
    });
  });

  describe('enabled', () => {
    it('is the default for a player who never chose, whatever the default is', () => {
      for (const absent of [undefined, null, 'on', 1, {}]) {
        expect(EmulatorPowerHelper.enabled(absent, true)).toBeTrue();
        expect(EmulatorPowerHelper.enabled(absent, false)).toBeFalse();
      }
    });

    it('is the choice for one who did, whatever the default has become since', () => {
      expect(EmulatorPowerHelper.enabled(true, false)).toBeTrue();
      expect(EmulatorPowerHelper.enabled(false, true)).toBeFalse();
    });
  });
});
