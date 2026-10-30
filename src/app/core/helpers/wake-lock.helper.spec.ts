import { WAKE_LOCK } from '../models/constants';
import { WakeLockDenial, WakeLockHelper, WakeLockSituation, WakeLockStep, WakeLockTrigger } from './wake-lock.helper';

/** A situation in which a request is plainly in order, changed one fact at a time. */
const base: WakeLockSituation = {
  wanted: true,
  visible: true,
  holding: false,
  requesting: false,
  denial: null,
  trigger: 'wish',
  sinceAttemptMs: Infinity,
};
const decide = (change: Partial<WakeLockSituation>): WakeLockStep => WakeLockHelper.decide({ ...base, ...change });

describe('WakeLockHelper', () => {
  describe('wanted', () => {
    // running x setting x in a room
    const table: Array<[boolean, boolean, boolean, boolean]> = [
      [false, true, true, false],  // not started: never
      [false, false, false, false],
      [true, true, false, true],   // the switch
      [true, false, false, false], // switched off, alone
      [true, false, true, true],   // a room overrides the switch
      [true, true, true, true],
    ];
    for (const [running, setting, inRoom, expected] of table) {
      it(`running ${running}, switch ${setting}, room ${inRoom}: ${expected ? 'held' : 'not held'}`, () => {
        expect(WakeLockHelper.wanted({ running, setting, inRoom })).toBe(expected);
      });
    }
  });

  describe('setting', () => {
    it('is on for a player who never chose, and follows an explicit choice either way', () => {
      expect(WAKE_LOCK.DEFAULT_ENABLED).toBeTrue(); // decision D10: on in solo play
      expect(WakeLockHelper.setting(undefined)).toBe(WAKE_LOCK.DEFAULT_ENABLED);
      expect(WakeLockHelper.setting(null)).toBe(WAKE_LOCK.DEFAULT_ENABLED);
      expect(WakeLockHelper.setting(true)).toBeTrue();
      expect(WakeLockHelper.setting(false)).toBeFalse();
    });

    it('takes storage for what it is, one more input: junk is the default', () => {
      expect(WakeLockHelper.setting('no')).toBe(WAKE_LOCK.DEFAULT_ENABLED);
      expect(WakeLockHelper.setting(0)).toBe(WAKE_LOCK.DEFAULT_ENABLED);
    });
  });

  describe('decide', () => {
    it('asks when the screen is wanted, free and visible', () => {
      expect(decide({})).toBe('request');
    });

    it('lets go of a held lock that is no longer wanted, and does nothing when none is held', () => {
      expect(decide({ wanted: false, holding: true })).toBe('release');
      expect(decide({ wanted: false, holding: false })).toBe('none');
    });

    it('does nothing while a request is in flight: the answer decides', () => {
      expect(decide({ requesting: true })).toBe('none');
      expect(decide({ wanted: false, requesting: true })).toBe('none');
    });

    it('does nothing when it already holds the lock', () => {
      expect(decide({ holding: true })).toBe('none');
      expect(decide({ holding: true, trigger: 'visible' })).toBe('none');
    });

    it('does not ask a hidden page: the API refuses it, and the page coming back asks again', () => {
      for (const trigger of ['wish', 'visible', 'gesture', 'released'] as WakeLockTrigger[]) {
        expect(decide({ visible: false, trigger })).withContext(trigger).toBe('none');
      }
    });

    describe('after a refusal', () => {
      const asked = (denial: WakeLockDenial, trigger: WakeLockTrigger, sinceAttemptMs = Infinity) => decide({ denial, trigger, sinceAttemptMs });

      it('never asks again of a browser without the API', () => {
        for (const trigger of ['wish', 'visible', 'gesture', 'released'] as WakeLockTrigger[]) {
          expect(asked('unsupported', trigger)).withContext(trigger).toBe('none');
        }
      });

      it('asks again of a browser that said no, when the page comes back or the wish changes', () => {
        expect(asked('not-allowed', 'visible')).toBe('request');
        expect(asked('not-allowed', 'wish')).toBe('request');
      });

      it('asks again on a tap, but not on every tap: a battery saver says no to each of them', () => {
        expect(asked('not-allowed', 'gesture', WAKE_LOCK.GESTURE_RETRY_MIN_MS)).toBe('request');
        expect(asked('not-allowed', 'gesture', WAKE_LOCK.GESTURE_RETRY_MIN_MS - 1)).toBe('none');
        expect(asked('not-allowed', 'gesture', 0)).toBe('none');
      });

      it('does not ask again because the browser took a lock back after a refusal', () => {
        expect(asked('not-allowed', 'released')).toBe('none');
      });

      it('treats any other failure as worth another try only when the page comes back or the wish changes, never on a tap', () => {
        expect(asked('failed', 'visible')).toBe('request');
        expect(asked('failed', 'wish')).toBe('request');
        expect(asked('failed', 'gesture')).toBe('none');
        expect(asked('failed', 'released')).toBe('none');
      });
    });

    it('asks again when the browser took the lock back from a visible page', () => {
      expect(decide({ trigger: 'released' })).toBe('request');
    });
  });

  describe('denialOf', () => {
    it('reads NotAllowedError as the browser\'s no, and anything else as a failure', () => {
      expect(WakeLockHelper.denialOf({ name: 'NotAllowedError' })).toBe('not-allowed');
      expect(WakeLockHelper.denialOf(new DOMException('battery saver', 'NotAllowedError'))).toBe('not-allowed');
      expect(WakeLockHelper.denialOf({ name: 'AbortError' })).toBe('failed');
      expect(WakeLockHelper.denialOf(new Error('boom'))).toBe('failed');
      expect(WakeLockHelper.denialOf(null)).toBe('failed');
      expect(WakeLockHelper.denialOf('NotAllowedError')).toBe('failed');
    });
  });

  describe('quickRelease', () => {
    it('is a release soon after the grant', () => {
      expect(WakeLockHelper.quickRelease(0)).toBeTrue();
      expect(WakeLockHelper.quickRelease(WAKE_LOCK.QUICK_RELEASE_MS - 1)).toBeTrue();
      expect(WakeLockHelper.quickRelease(WAKE_LOCK.QUICK_RELEASE_MS)).toBeFalse();
    });
  });

  describe('describe', () => {
    const state = { supported: true, wanted: true, holding: false, denial: null as WakeLockDenial | null, inRoom: false };

    it('says what the browser did, in Portuguese', () => {
      expect(WakeLockHelper.describe({ ...state, holding: true })).toBe('Ligada: a tela não apaga durante o jogo.');
      expect(WakeLockHelper.describe({ ...state, holding: true, inRoom: true })).toContain('sala');
      expect(WakeLockHelper.describe({ ...state, wanted: false })).toContain('Desligada');
      expect(WakeLockHelper.describe({ ...state, denial: 'not-allowed' })).toContain('não deixou');
      expect(WakeLockHelper.describe({ ...state, denial: 'failed' })).toContain('Não foi possível');
      expect(WakeLockHelper.describe({ ...state })).toBe('Ligando…');
    });

    it('says the browser cannot, when it cannot, whatever else is true', () => {
      expect(WakeLockHelper.describe({ ...state, supported: false, holding: true })).toBe('Este navegador não permite manter a tela ligada.');
    });
  });
});
