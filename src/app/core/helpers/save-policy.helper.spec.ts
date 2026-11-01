import { SAVE_SAFETY } from '../models/constants';
import { GameSavingVerdict, HiddenGateInput, SavePolicyHelper, SavePurpose } from './save-policy.helper';

/**
 * The tables. The one rule they all exist to keep: `null` (OCR could not read the strip) is not
 * `false`. Where a persist needs the all-clear, only `false` is one.
 */
describe('SavePolicyHelper', () => {
  describe('decide', () => {
    const table: { purpose: SavePurpose; verdict: GameSavingVerdict; action: string }[] = [
      // Nobody asked: only a proven all-clear writes.
      { purpose: 'hidden', verdict: false, action: 'persist' },
      { purpose: 'hidden', verdict: true, action: 'skip' },
      { purpose: 'hidden', verdict: null, action: 'skip' },
      // The page is about to be thrown away: only a proven all-clear saves; an unreadable look is a question.
      { purpose: 'reload', verdict: false, action: 'persist' },
      { purpose: 'reload', verdict: true, action: 'wait' },
      { purpose: 'reload', verdict: null, action: 'ask' },
      // The player asked for a save: it waits for a dialog it can see, and does not refuse when it cannot see.
      { purpose: 'manual', verdict: false, action: 'persist' },
      { purpose: 'manual', verdict: true, action: 'wait' },
      { purpose: 'manual', verdict: null, action: 'persist' },
      { purpose: 'leave', verdict: false, action: 'persist' },
      { purpose: 'leave', verdict: true, action: 'wait' },
      { purpose: 'leave', verdict: null, action: 'persist' },
    ];

    for (const { purpose, verdict, action } of table) {
      it(`${purpose} with ${String(verdict)} is ${action}`, () => {
        expect(SavePolicyHelper.decide(purpose, verdict)).toBe(action as never);
      });
    }

    it('never lets an unrequested or destructive save act on a reading it could not make', () => {
      for (const purpose of ['hidden', 'reload'] as SavePurpose[]) {
        expect(SavePolicyHelper.decide(purpose, null)).not.toBe('persist');
      }
    });

    it('never persists while the dialog is up, whoever asked', () => {
      for (const purpose of ['hidden', 'reload', 'manual', 'leave'] as SavePurpose[]) {
        expect(SavePolicyHelper.decide(purpose, true)).not.toBe('persist');
      }
    });
  });

  describe('gateHidden', () => {
    const NOW = 1_000_000_000;
    const ready: HiddenGateInput = {
      dirty: true,
      hasEmulator: true,
      autoSaveRunning: true,
      lastHiddenPersistAt: null,
      now: NOW,
      minGapMs: SAVE_SAFETY.HIDDEN_PERSIST_MIN_GAP_MS,
    };

    it('goes ahead when there is something to save and nothing in the way', () => {
      expect(SavePolicyHelper.gateHidden(ready)).toBe('proceed');
    });

    it('does nothing for a page with no input since the last persist, without spending an OCR pass on it', () => {
      expect(SavePolicyHelper.gateHidden({ ...ready, dirty: false })).toBe('clean');
    });

    it('does nothing without an emulator', () => {
      expect(SavePolicyHelper.gateHidden({ ...ready, hasEmulator: false })).toBe('no-emulator');
    });

    it('does nothing when auto-save is off: asking would start the OCR worker for a page going to sleep', () => {
      expect(SavePolicyHelper.gateHidden({ ...ready, autoSaveRunning: false })).toBe('auto-save-off');
    });

    it('persists at most once per gap, however often the page is hidden', () => {
      const gap = SAVE_SAFETY.HIDDEN_PERSIST_MIN_GAP_MS;

      expect(SavePolicyHelper.gateHidden({ ...ready, lastHiddenPersistAt: NOW - 1 })).toBe('throttled');
      expect(SavePolicyHelper.gateHidden({ ...ready, lastHiddenPersistAt: NOW - gap + 1 })).toBe('throttled');
      expect(SavePolicyHelper.gateHidden({ ...ready, lastHiddenPersistAt: NOW - gap })).toBe('proceed');
    });

    it('is a few minutes, as the spec has it', () => {
      expect(SAVE_SAFETY.HIDDEN_PERSIST_MIN_GAP_MS).toBeGreaterThanOrEqual(2 * 60 * 1000);
      expect(SAVE_SAFETY.HIDDEN_PERSIST_MIN_GAP_MS).toBeLessThanOrEqual(10 * 60 * 1000);
    });
  });

  describe('backupNudgeDue', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const NOW = 50 * DAY;
    const base = { now: NOW, lastBackupAt: null, firstPersistedAt: null, dismissed: false, afterMs: 7 * DAY };

    it('is not due for a player who has never saved: there is nothing to back up', () => {
      expect(SavePolicyHelper.backupNudgeDue(base)).toBeFalse();
    });

    it('counts from the first save when there never was a backup', () => {
      expect(SavePolicyHelper.backupNudgeDue({ ...base, firstPersistedAt: NOW - 7 * DAY + 1 })).toBeFalse();
      expect(SavePolicyHelper.backupNudgeDue({ ...base, firstPersistedAt: NOW - 7 * DAY })).toBeTrue();
    });

    it('counts from the last backup when there was one, however old the first save is', () => {
      const old = { ...base, firstPersistedAt: NOW - 40 * DAY };

      expect(SavePolicyHelper.backupNudgeDue({ ...old, lastBackupAt: NOW - 2 * DAY })).toBeFalse();
      expect(SavePolicyHelper.backupNudgeDue({ ...old, lastBackupAt: NOW - 8 * DAY })).toBeTrue();
    });

    it('never comes back once it has been answered', () => {
      expect(SavePolicyHelper.backupNudgeDue({ ...base, firstPersistedAt: NOW - 30 * DAY, dismissed: true })).toBeFalse();
    });

    it('is not fooled by a clock that was set back', () => {
      expect(SavePolicyHelper.backupNudgeDue({ ...base, lastBackupAt: NOW + 3 * DAY })).toBeFalse();
    });
  });
});
