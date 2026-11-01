import { WipeFlowHelper } from './wipe-flow.helper';

describe('WipeFlowHelper', () => {

  describe('confirmed (the last question is not answered by a stray tap)', () => {
    it('is true only when the box is ticked', () => {
      expect(WipeFlowHelper.confirmed([WipeFlowHelper.CONFIRM_VALUE])).toBeTrue();
    });

    it('is false for every other thing an alert can hand over: nothing, an empty group, another value, a bare string', () => {
      expect(WipeFlowHelper.confirmed(undefined)).toBeFalse();
      expect(WipeFlowHelper.confirmed(null)).toBeFalse();
      expect(WipeFlowHelper.confirmed([])).toBeFalse();
      expect(WipeFlowHelper.confirmed(['outra'])).toBeFalse();
      expect(WipeFlowHelper.confirmed(WipeFlowHelper.CONFIRM_VALUE)).toBeFalse();
      expect(WipeFlowHelper.confirmed({})).toBeFalse();
      expect(WipeFlowHelper.confirmed(true)).toBeFalse();
    });
  });

  describe('the first question', () => {
    it('offers the backup before it offers to go on, and says why', () => {
      const first = WipeFlowHelper.first();
      expect(first.backup).toBe('Baixar backup agora');
      expect(first.next).toBe('Continuar');
      expect(first.message).toContain('não dá para desfazer');
      expect(first.message).toContain('Baixe uma cópia');
    });

    it('does not use the words of the old one-step dialog', () => {
      const words = JSON.stringify([WipeFlowHelper.first(), WipeFlowHelper.second()]);
      expect(words).not.toContain('"Sim"');
      expect(words).not.toContain('"Aviso"');
    });
  });

  describe('the last question', () => {
    it('asks for a tick and names what is lost', () => {
      const second = WipeFlowHelper.second();
      expect(second.checkbox).toBe('Entendo que vou perder meus jogos salvos');
      expect(second.confirm).toBe('Apagar tudo');
    });

    it('reminds a person who pressed the button with the box empty', () => {
      expect(WipeFlowHelper.second().reminder).toContain('Marque a caixa');
    });
  });
});
