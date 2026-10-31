import { QuickHostHelper } from './quick-host.helper';

describe('QuickHostHelper', () => {

  describe('summary', () => {
    it('says the code, whether there is a password and how many may watch', () => {
      expect(QuickHostHelper.summary({ roomCode: 'ELI-XK3P', hasPassword: false, maxSpectators: 6 })).toBe('ELI-XK3P · sem senha · até 6 espectadores');
      expect(QuickHostHelper.summary({ roomCode: 'ELI-XK3P', hasPassword: true, maxSpectators: 3 })).toBe('ELI-XK3P · com senha · até 3 espectadores');
    });

    it('uses the singular for one spectator', () => {
      expect(QuickHostHelper.summary({ roomCode: 'ELI-AAAA', hasPassword: false, maxSpectators: 1 })).toContain('até 1 espectador');
      expect(QuickHostHelper.summary({ roomCode: 'ELI-AAAA', hasPassword: false, maxSpectators: 1 })).not.toContain('espectadores');
    });

    it('shows the code as the room will have it, in capitals and trimmed', () => {
      expect(QuickHostHelper.summary({ roomCode: ' eli-xk3p ', hasPassword: false, maxSpectators: 2 })).toMatch(/^ELI-XK3P · /);
    });

    it('says only whether there is a password: the summary takes a flag and not the word, so there is nothing of it to leak', () => {
      const summary = QuickHostHelper.summary({ roomCode: 'ELI-XK3P', hasPassword: true, maxSpectators: 6 });
      expect(summary).toBe('ELI-XK3P · com senha · até 6 espectadores');
    });
  });

  describe('the name', () => {
    it('is asked for on the first screen only when there is none', () => {
      expect(QuickHostHelper.needsName('')).toBeTrue();
      expect(QuickHostHelper.needsName('   ')).toBeTrue();
      expect(QuickHostHelper.needsName('Leu')).toBeFalse();
    });

    it('names the person who will appear in the room', () => {
      expect(QuickHostHelper.identity('  Leu ')).toBe('Você aparece como Leu');
      expect(QuickHostHelper.identity('')).toBe('');
    });
  });
});
