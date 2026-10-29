import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { FIELD_HINT } from '../models/constants';
import { CaretState, CaretWatcher, CaretWatchHelper, FrameLike } from './caret-watch.helper';
import { FrameName, loadFrame } from './field-hint.fixtures';

type Frame = Awaited<ReturnType<typeof loadFrame>>;

const strict = (body: () => void) => fakeAsync(body, { flush: false });

describe('CaretWatchHelper', () => {
  const frames = {} as Record<FrameName, Frame>;

  beforeAll(async () => {
    for (const name of ['caretOn640', 'caretOff640', 'ibeamYellow640', 'ibeamWhite640'] as FrameName[]) {
      frames[name] = await loadFrame(name);
    }
  });

  /** A copy of a frame with a rectangle painted on it. */
  const painted = (frame: Frame, x: number, y: number, width: number, height: number, [r, g, b]: [number, number, number] = [0, 0, 0]): Frame => {
    const copy: Frame = { width: frame.width, height: frame.height, data: new Uint8ClampedArray(frame.data) };
    for (let row = y; row < y + height; row++) {
      for (let column = x; column < x + width; column++) {
        const o = (row * frame.width + column) * 4;
        copy.data[o] = r; copy.data[o + 1] = g; copy.data[o + 2] = b;
      }
    }
    return copy;
  };

  describe('findBar', () => {

    it('finds the caret by which two consecutive real frames differ: 1 px wide and 14 tall', () => {
      expect(CaretWatchHelper.findBar(frames.caretOn640, frames.caretOff640)).toEqual({ x: 204, y: 153, h: 14 });
      expect(CaretWatchHelper.findBar(frames.caretOff640, frames.caretOn640)).toEqual({ x: 204, y: 153, h: 14 });
    });

    it('finds nothing in two identical frames', () => {
      expect(CaretWatchHelper.findBar(frames.caretOn640, frames.caretOn640)).toBeNull();
    });

    it('finds nothing in two frames of different screens', () => {
      expect(CaretWatchHelper.findBar(frames.ibeamYellow640, frames.ibeamWhite640)).toBeNull();
    });

    it('finds nothing when the sizes differ', () => {
      const small: FrameLike = { width: 10, height: 10, data: new Uint8ClampedArray(400) };
      expect(CaretWatchHelper.findBar(small, frames.caretOn640)).toBeNull();
    });

    it('accepts a bar from 8 to 25 rows and up to 3 columns, wherever it is', () => {
      const base = frames.caretOff640;
      expect(CaretWatchHelper.findBar(base, painted(base, 300, 300, 1, 8))).toEqual({ x: 300, y: 300, h: 8 });
      expect(CaretWatchHelper.findBar(base, painted(base, 300, 300, 1, 25))).toEqual({ x: 300, y: 300, h: 25 });
      expect(CaretWatchHelper.findBar(base, painted(base, 300, 300, 3, 17))).toEqual({ x: 300, y: 300, h: 17 });
    });

    it('turns down what is not a bar: too short, too tall, too wide, too sparse', () => {
      const base = frames.caretOff640;
      expect(CaretWatchHelper.findBar(base, painted(base, 300, 300, 1, 7))).withContext('short').toBeNull();
      expect(CaretWatchHelper.findBar(base, painted(base, 300, 300, 1, 26))).withContext('tall').toBeNull();
      expect(CaretWatchHelper.findBar(base, painted(base, 300, 300, 4, 14))).withContext('wide').toBeNull();
      // Three dots spread over twelve rows: a bar's bounding box, not a bar.
      const dots = painted(painted(painted(base, 300, 300, 1, 1), 300, 306, 1, 1), 300, 311, 1, 1);
      expect(CaretWatchHelper.findBar(base, dots)).withContext('sparse').toBeNull();
    });

    it('ignores a change too faint to be a caret', () => {
      const base = frames.caretOff640;
      const o = (300 * base.width + 300) * 4;
      const faint: Frame = { width: base.width, height: base.height, data: new Uint8ClampedArray(base.data) };
      for (let row = 0; row < 14; row++) {
        const at = o + row * base.width * 4;
        faint.data[at] = Math.min(255, faint.data[at] + 20);
      }
      expect(CaretWatchHelper.findBar(base, faint)).toBeNull();
    });
  });

  describe('looksLikeBlink', () => {

    it('wants at least two gaps of a blink in the window, with at most one that is not', () => {
      expect(CaretWatchHelper.looksLikeBlink([0, 543, 1086], 1100)).toBeTrue();
      expect(CaretWatchHelper.looksLikeBlink([0, 543, 1086, 1629], 1700)).toBeTrue();
      expect(CaretWatchHelper.looksLikeBlink([0, 543], 600)).toBeFalse();
      expect(CaretWatchHelper.looksLikeBlink([0, 100, 200, 300], 400)).toBeFalse();
      // One stray gap is allowed (a frame of something else slipped in), two are not.
      expect(CaretWatchHelper.looksLikeBlink([0, 543, 1086, 1186], 1200)).toBeTrue();
      expect(CaretWatchHelper.looksLikeBlink([0, 543, 643, 1186, 1286], 1300)).toBeFalse();
    });

    it('takes the blink gaps at their edges', () => {
      const edge = [0, FIELD_HINT.BLINK_MIN_MS, FIELD_HINT.BLINK_MIN_MS + FIELD_HINT.BLINK_MAX_MS];
      expect(CaretWatchHelper.looksLikeBlink(edge, edge[2])).toBeTrue();
      expect(CaretWatchHelper.looksLikeBlink([0, FIELD_HINT.BLINK_MIN_MS - 1, 2 * FIELD_HINT.BLINK_MIN_MS - 2], 900)).toBeFalse();
      expect(CaretWatchHelper.looksLikeBlink([0, FIELD_HINT.BLINK_MAX_MS + 1, 2 * FIELD_HINT.BLINK_MAX_MS + 2], 1500)).toBeFalse();
    });

    it('forgets frames older than the window', () => {
      expect(CaretWatchHelper.looksLikeBlink([0, 543, 1086], 1086 + FIELD_HINT.BLINK_WINDOW_MS)).toBeFalse();
    });
  });

  describe('CaretWatcher', () => {

    interface Rig {
      watcher: CaretWatcher;
      states: CaretState[];
      shots: () => number;
      frame: () => void;
      script: (...answers: Array<Frame | Promise<Frame>>) => void;
      clock: { now: number };
    }

    /**
     * A watcher on the fake clock. `frame()` is the guest's framebuffer changing now; each
     * `screenshot()` is answered, in order, by the frames handed to `script`.
     */
    const rig = (): Rig => {
      const states: CaretState[] = [];
      const clock = { now: 1000 };
      let answers: Array<Frame | Promise<Frame>> = [];
      let calls = 0;
      const watcher = new CaretWatcher({
        now: () => clock.now,
        screenshot: () => {
          calls++;
          const next = answers.shift();
          return next ? Promise.resolve(next) : Promise.reject(new Error('no frame'));
        },
        timers: {
          setTimeout: (handler, ms) => setTimeout(handler, ms),
          clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
        onChange: state => states.push(state),
      });
      return {
        watcher, states, clock,
        shots: () => calls,
        frame: () => watcher.onFrame(),
        script: (...next) => { answers = next; },
      };
    };

    /** Frames at the real blink period (543 ms, the median of the measurement), each after the clock has moved. */
    const blink = (r: Rig, times: number, gap = 543) => {
      for (let i = 0; i < times; i++) {
        // The clock first: a timer that fires during the tick reads it.
        r.clock.now += gap;
        tick(gap);
        r.frame();
        flushMicrotasks();
      }
    };

    it('finds the caret on the fourth blink frame and reports where it is', strict(() => {
      const r = rig();
      r.script(frames.caretOn640, frames.caretOff640);
      r.frame();
      blink(r, 2);
      expect(r.shots()).withContext('suspected on the third frame').toBe(1);
      expect(r.states).toEqual([]);
      blink(r, 1);
      expect(r.states).toEqual([{ active: true, x: 204, y: 153, h: 14 }]);
      r.watcher.dispose();
    }));

    it('says it is gone when the frames stop, and holds no timer afterwards', strict(() => {
      const r = rig();
      r.script(frames.caretOn640, frames.caretOff640);
      r.frame();
      blink(r, 3);
      expect(r.states.length).toBe(1);
      r.clock.now += FIELD_HINT.GONE_AFTER_MS;
      tick(FIELD_HINT.GONE_AFTER_MS);
      expect(r.states[r.states.length - 1]).toEqual({ active: false });
    }));

    it('stays while the blink goes on, with one timer at most', strict(() => {
      const r = rig();
      r.script(frames.caretOn640, frames.caretOff640);
      r.frame();
      blink(r, 3);
      blink(r, 10);
      expect(r.states.length).toBe(1);
      expect(r.watcher.state.active).toBeTrue();
      r.watcher.dispose();
    }));

    it('does nothing on frames that do not tick like a blink, and takes no screenshot', strict(() => {
      const r = rig();
      r.frame();
      blink(r, 40, 33);
      expect(r.shots()).toBe(0);
      expect(r.states).toEqual([]);
      r.watcher.dispose();
    }));

    it('does nothing on a screen that sends no frames at all, and holds no timer', strict(() => {
      const r = rig();
      tick(60 * 1000);
      expect(r.states).toEqual([]);
      r.watcher.dispose();
    }));

    it('is not fooled by a regular tick that changes more than a bar, and tries again only after the cooldown', strict(() => {
      const r = rig();
      // Something else ticks at 543 ms: the pair differs by a whole screen.
      r.script(frames.ibeamYellow640, frames.ibeamWhite640, frames.ibeamYellow640, frames.ibeamWhite640);
      r.frame();
      blink(r, 3);
      expect(r.states).toEqual([]);
      expect(r.shots()).toBe(2);
      // The next frames fall inside the cooldown: no further screenshots.
      blink(r, 1);
      expect(r.shots()).toBe(2);
      // And once it has passed, it looks again.
      blink(r, 2);
      expect(r.shots()).toBeGreaterThan(2);
      r.watcher.dispose();
    }));

    it('drops a pair whose second frame came too soon to be the other half of a blink', strict(() => {
      const r = rig();
      r.script(frames.caretOn640, frames.caretOff640);
      r.frame();
      blink(r, 2);
      expect(r.shots()).toBe(1);
      blink(r, 1, 120);
      expect(r.shots()).toBe(1);
      expect(r.states).toEqual([]);
      r.watcher.dispose();
    }));

    it('survives a screenshot that fails', strict(() => {
      const r = rig();
      r.script();
      r.frame();
      blink(r, 4);
      expect(r.states).toEqual([]);
      r.watcher.dispose();
    }));

    it('gives up a caret when the screen keeps changing and never blinks again', strict(() => {
      const r = rig();
      r.script(frames.caretOn640, frames.caretOff640);
      r.frame();
      blink(r, 3);
      expect(r.watcher.state.active).toBeTrue();
      // An animation takes over: frames every 100 ms, so the 1.2 s silence never comes.
      blink(r, Math.ceil(FIELD_HINT.STALE_AFTER_MS / 100) + 5, 100);
      expect(r.states[r.states.length - 1]).toEqual({ active: false });
      r.watcher.dispose();
    }));

    it('ignores frames and verifications that arrive after dispose', strict(() => {
      const r = rig();
      r.script(frames.caretOn640, frames.caretOff640);
      r.frame();
      blink(r, 2);
      r.watcher.dispose();
      blink(r, 1);
      expect(r.states).toEqual([]);
    }));
  });
});
