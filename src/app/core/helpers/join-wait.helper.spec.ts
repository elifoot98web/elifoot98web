import { MULTIPLAYER } from '../models/constants';
import { JoinWaitHelper } from './join-wait.helper';

describe('JoinWaitHelper', () => {

  describe('hint', () => {
    it('is silent while the wait is the normal one', () => {
      expect(JoinWaitHelper.hint(0)).toBeNull();
      expect(JoinWaitHelper.hint(MULTIPLAYER.JOIN_HINT_AFTER_MS - 1)).toBeNull();
    });

    it('admits at 8 s that mobile networks may be slow', () => {
      expect(JoinWaitHelper.hint(MULTIPLAYER.JOIN_HINT_AFTER_MS)).toBe('Redes móveis podem demorar um pouco mais.');
      expect(JoinWaitHelper.hint(MULTIPLAYER.JOIN_LONG_HINT_AFTER_MS - 1)).toBe('Redes móveis podem demorar um pouco mais.');
    });

    it('points at "Cancelar" once the wait is long, before the 20 s timeout', () => {
      expect(JoinWaitHelper.hint(MULTIPLAYER.JOIN_LONG_HINT_AFTER_MS)).toContain('cancelar');
      expect(MULTIPLAYER.JOIN_LONG_HINT_AFTER_MS).toBeLessThan(MULTIPLAYER.STREAM_WAIT_TIMEOUT);
    });

    it('speaks before the timeout does, and in order', () => {
      expect(MULTIPLAYER.JOIN_HINT_AFTER_MS).toBeLessThan(MULTIPLAYER.JOIN_LONG_HINT_AFTER_MS);
    });
  });

  describe('title', () => {
    it('names the room being entered', () => {
      expect(JoinWaitHelper.title({ roomCode: 'ELI-ABCD', draining: false })).toBe('Entrando na sala ELI-ABCD…');
    });

    it('does not name an empty code', () => {
      expect(JoinWaitHelper.title({ roomCode: '', draining: false })).toBe('Entrando na sala…');
    });

    it('says when it is waiting for the previous room to finish leaving', () => {
      expect(JoinWaitHelper.title({ roomCode: 'ELI-ABCD', draining: true })).toBe('Encerrando a sala anterior…');
    });
  });
});
