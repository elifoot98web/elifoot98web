import { AUDIO_HEALTH } from '../models/constants';
import { AudioContextStateName, AudioHealthHelper, AudioTrigger, GameVolumeHelper } from './audio-health.helper';

const STATES: Array<AudioContextStateName | null> = [null, 'running', 'suspended', 'interrupted', 'closed'];
const TRIGGERS: AudioTrigger[] = ['start', 'visible', 'gesture', 'statechange', 'chip', 'grace'];

describe('AudioHealthHelper', () => {
  describe('normalise', () => {
    it('knows the four states, WebKit\'s `interrupted` among them, and nothing else', () => {
      for (const state of ['running', 'suspended', 'interrupted', 'closed']) expect(AudioHealthHelper.normalise(state)).toBe(state as AudioContextStateName);
      expect(AudioHealthHelper.normalise('paused')).toBeNull();
      expect(AudioHealthHelper.normalise(undefined)).toBeNull();
      expect(AudioHealthHelper.normalise(3)).toBeNull();
    });
  });

  describe('shouldResume: the decision table', () => {
    // [state, trigger, visible] -> resume? Written out row by row; the rule it exists for is asserted again below.
    const rows: Array<[AudioContextStateName | null, AudioTrigger, boolean, boolean]> = [
      // asleep, visible: any moment that could carry a gesture or a change of circumstances
      ['suspended', 'start', true, true],
      ['suspended', 'visible', true, true],
      ['suspended', 'gesture', true, true],
      ['suspended', 'chip', true, true],
      ['interrupted', 'visible', true, true],
      ['interrupted', 'gesture', true, true],
      ['interrupted', 'chip', true, true],
      // never on the context's own say-so (a loop with the browser) or on the timer that only decides the chip
      ['suspended', 'statechange', true, false],
      ['interrupted', 'statechange', true, false],
      ['suspended', 'grace', true, false],
      ['interrupted', 'grace', true, false],
      // never for a hidden page: the browser refuses, and the page coming back asks again
      ['suspended', 'visible', false, false],
      ['suspended', 'gesture', false, false],
      ['interrupted', 'chip', false, false],
      // nothing to resume
      ['running', 'visible', true, false],
      ['running', 'gesture', true, false],
      ['closed', 'visible', true, false],
      ['closed', 'chip', true, false],
      [null, 'start', true, false],
      [null, 'gesture', true, false],
    ];
    for (const [state, trigger, visible, expected] of rows) {
      it(`${state} on ${trigger}, ${visible ? 'visible' : 'hidden'}: ${expected ? 'resume' : 'leave it'}`, () => {
        expect(AudioHealthHelper.shouldResume(state, trigger, visible)).toBe(expected);
      });
    }

    it('never resumes a context that is running, closed or missing, whatever the trigger', () => {
      for (const state of [null, 'running', 'closed'] as const) {
        for (const trigger of TRIGGERS) {
          for (const visible of [true, false]) {
            expect(AudioHealthHelper.shouldResume(state, trigger, visible)).withContext(`${state} ${trigger} ${visible}`).toBeFalse();
          }
        }
      }
    });
  });

  describe('blocked: when the chip appears', () => {
    const grace = AUDIO_HEALTH.BLOCKED_GRACE_MS;

    it('is not blocked while the page still has time to fix it by itself', () => {
      expect(AudioHealthHelper.blocked('suspended', true, 0)).toBeFalse();
      expect(AudioHealthHelper.blocked('interrupted', true, grace - 1)).toBeFalse();
    });

    it('is blocked once a context has been asleep on a visible page for the grace period', () => {
      expect(AudioHealthHelper.blocked('suspended', true, grace)).toBeTrue();
      expect(AudioHealthHelper.blocked('interrupted', true, grace * 10)).toBeTrue();
    });

    it('is never blocked on a hidden page, or when the context runs, is closed or does not exist', () => {
      expect(AudioHealthHelper.blocked('suspended', false, grace * 10)).toBeFalse();
      for (const state of [null, 'running', 'closed'] as const) {
        expect(AudioHealthHelper.blocked(state, true, grace * 10)).withContext(String(state)).toBeFalse();
      }
    });

    it('never calls a muted game blocked: a mute is a gain on a context that keeps running', () => {
      expect(AudioHealthHelper.blocked('running', true, grace * 10)).toBeFalse();
    });
  });

  describe('wantsGesture', () => {
    it('is true only for an asleep context on a visible page', () => {
      for (const state of STATES) {
        for (const visible of [true, false]) {
          const expected = visible && (state === 'suspended' || state === 'interrupted');
          expect(AudioHealthHelper.wantsGesture(state, visible)).withContext(`${state} ${visible}`).toBe(expected);
        }
      }
    });
  });

  describe('chipLabel', () => {
    it('tells a host that the room is silent too, and says nothing of rooms to anyone else', () => {
      expect(AudioHealthHelper.chipLabel(false)).toBe('Ativar som');
      expect(AudioHealthHelper.chipLabel(true)).toContain('quem assiste');
    });
  });
});

describe('GameVolumeHelper', () => {
  it('reads storage as one more input: anything but a number from 0 to 1 is the default or the nearest edge', () => {
    expect(GameVolumeHelper.normalise(0.4)).toBe(0.4);
    expect(GameVolumeHelper.normalise(0)).toBe(0);
    expect(GameVolumeHelper.normalise(7)).toBe(1);
    expect(GameVolumeHelper.normalise(-1)).toBe(0);
    expect(GameVolumeHelper.normalise('0.4')).toBe(AUDIO_HEALTH.DEFAULT_VOLUME);
    expect(GameVolumeHelper.normalise(NaN)).toBe(AUDIO_HEALTH.DEFAULT_VOLUME);
    expect(GameVolumeHelper.normalise(undefined)).toBe(AUDIO_HEALTH.DEFAULT_VOLUME);
    expect(GameVolumeHelper.normalise(null)).toBe(AUDIO_HEALTH.DEFAULT_VOLUME);
  });

  it('converts to and from the slider\'s percent', () => {
    expect(GameVolumeHelper.toPercent(0.35)).toBe(35);
    expect(GameVolumeHelper.fromPercent(35)).toBeCloseTo(0.35, 10);
    expect(GameVolumeHelper.fromPercent(250)).toBe(1);
    expect(GameVolumeHelper.toPercent(1)).toBe(100);
  });

  it('turns a mute into a gain of zero and leaves the volume alone', () => {
    expect(GameVolumeHelper.gain(0.6, false)).toBe(0.6);
    expect(GameVolumeHelper.gain(0.6, true)).toBe(0);
    expect(GameVolumeHelper.gain(5, false)).toBe(1);
  });

  describe('afterSlider', () => {
    it('unmutes when the slider moves above zero: a slider that changes nothing you can hear is a bug report', () => {
      expect(GameVolumeHelper.afterSlider({ volume: 0.5, muted: true }, 30)).toEqual({ volume: jasmine.any(Number), muted: false });
      expect(GameVolumeHelper.afterSlider({ volume: 0.5, muted: true }, 30).volume).toBeCloseTo(0.3, 10);
    });

    it('leaves the mute switch as it was when the slider goes to zero: a volume of zero and a mute are different things to come back from', () => {
      expect(GameVolumeHelper.afterSlider({ volume: 0.5, muted: false }, 0)).toEqual({ volume: 0, muted: false });
      expect(GameVolumeHelper.afterSlider({ volume: 0.5, muted: true }, 0)).toEqual({ volume: 0, muted: true });
    });
  });

  it('says what the menu shows, in Portuguese', () => {
    expect(GameVolumeHelper.label(0.7, false)).toBe('70%');
    expect(GameVolumeHelper.label(0.7, true)).toBe('Silenciado');
    expect(GameVolumeHelper.label(0, false)).toBe('Mudo');
  });
});
