import { InstallMode } from './install.helper';
import { NudgeHelper } from './nudge.helper';

describe('NudgeHelper', () => {
  describe('installDue', () => {
    const due = { mode: 'prompt' as InstallMode, dismissed: false, firstPersistedAt: 1_700_000_000_000 as number | null, inRoom: false };

    it('is due after a session that saved something, when there is something to offer', () => {
      expect(NudgeHelper.installDue(due)).toBeTrue();
      expect(NudgeHelper.installDue({ ...due, mode: 'ios' })).toBeTrue();
    });

    it('is never due on a first visit: nothing has been saved yet, and an app that asks before it is used gets dismissed', () => {
      expect(NudgeHelper.installDue({ ...due, firstPersistedAt: null })).toBeFalse();
    });

    it('is never due again once it was answered, whatever else is true', () => {
      expect(NudgeHelper.installDue({ ...due, dismissed: true })).toBeFalse();
      expect(NudgeHelper.installDue({ ...due, dismissed: true, mode: 'ios' })).toBeFalse();
    });

    it('is not due in an app that is already installed, or where there is nothing to offer', () => {
      expect(NudgeHelper.installDue({ ...due, mode: 'installed' })).toBeFalse();
      expect(NudgeHelper.installDue({ ...due, mode: 'none' })).toBeFalse();
    });

    it('is not due while a room is open: a banner is not what a host or a spectator needs', () => {
      expect(NudgeHelper.installDue({ ...due, inRoom: true })).toBeFalse();
    });
  });

  describe('rotateDue', () => {
    const due = { answered: false, phoneInPortrait: true, inRoom: false };

    it('is due on a phone held upright that has not been told', () => {
      expect(NudgeHelper.rotateDue(due)).toBeTrue();
    });

    it('is never due again once it was shown', () => {
      expect(NudgeHelper.rotateDue({ ...due, answered: true })).toBeFalse();
    });

    it('is not due on a phone on its side, a tablet or a desktop, or with a room open', () => {
      expect(NudgeHelper.rotateDue({ ...due, phoneInPortrait: false })).toBeFalse();
      expect(NudgeHelper.rotateDue({ ...due, inRoom: true })).toBeFalse();
    });
  });
});
