import { FirstRunHelper } from './first-run.helper';
import { HelpTopicHelper } from './help-topic.helper';

describe('FirstRunHelper', () => {

  describe('due (whether the coach is shown)', () => {
    const fresh = { stored: undefined as unknown, readable: true, gameSeen: true, hostedThisVisit: false };

    it('is shown to a person who has never answered it, once the game\'s screen is up', () => {
      expect(FirstRunHelper.due(fresh)).toBeTrue();
      expect(FirstRunHelper.due({ ...fresh, stored: null })).toBeTrue();
      expect(FirstRunHelper.due({ ...fresh, stored: false })).toBeTrue();
    });

    it('reuses the flag the old welcome alert wrote: a player who pressed "Entendi" on it is not shown the coach on upgrade', () => {
      expect(FirstRunHelper.due({ ...fresh, stored: true })).toBeFalse();
    });

    it('is not shown over a screen that never rendered', () => {
      expect(FirstRunHelper.due({ ...fresh, gameSeen: false })).toBeFalse();
    });

    it('is not shown when the store cannot be read: a coach that cannot remember it was answered would greet the person on every visit', () => {
      expect(FirstRunHelper.due({ ...fresh, readable: false })).toBeFalse();
      expect(FirstRunHelper.due({ ...fresh, readable: false, stored: true })).toBeFalse();
    });

    it('waits a visit that has just put a room on the air: it already did what it was for', () => {
      expect(FirstRunHelper.due({ ...fresh, hostedThisVisit: true })).toBeFalse();
    });

    it('treats only a stored true as an answer: a corrupt value does not retire it', () => {
      for (const stored of ['true', 1, {}, 'yes']) expect(FirstRunHelper.due({ ...fresh, stored })).toBeTrue();
    });
  });

  describe('the cards', () => {
    it('are three, in the order tap, type, save, for a finger and for a mouse', () => {
      for (const touch of [true, false]) {
        expect(FirstRunHelper.cards({ touch }).map(card => card.id)).toEqual(['tap', 'type', 'save']);
      }
    });

    it('speak to the device: "Toque" to a finger, "Clique" and Esc to a mouse', () => {
      const [touchTap] = FirstRunHelper.cards({ touch: true });
      const [mouseTap] = FirstRunHelper.cards({ touch: false });
      expect(touchTap.title).toBe('Toque para clicar');
      expect(mouseTap.title).toBe('Clique para jogar');
      expect(mouseTap.lines.join(' ')).toContain('Esc');
      expect(touchTap.lines.join(' ')).not.toContain('Esc');
    });

    it('send a finger to the Texto tab and a mouse to the menu for typing', () => {
      const touch = FirstRunHelper.cards({ touch: true })[1];
      const mouse = FirstRunHelper.cards({ touch: false })[1];
      expect(touch.lines.join(' ')).toContain('Texto');
      expect(mouse.lines.join(' ')).toContain('Digitar texto');
    });

    it('tell everyone the same thing about saving: the game saves in the browser, and a backup is how it survives', () => {
      const text = (touch: boolean) => FirstRunHelper.cards({ touch })[2].lines.join(' ');
      expect(text(true)).toBe(text(false));
      expect(text(true)).toContain('backup');
      expect(text(true)).toContain('Exportar jogos salvos');
    });

    it('promise nothing the app does not do: no "aprender a jogar", no touchpad', () => {
      const all = JSON.stringify([...FirstRunHelper.cards({ touch: true }), ...FirstRunHelper.cards({ touch: false })]).toLowerCase();
      expect(all).not.toContain('aprender a jogar');
      expect(all).not.toContain('deslize');
      expect(all).not.toContain('touchpad');
    });

    it('keep each card short enough to read on a bus: two or three lines, none of them a paragraph', () => {
      for (const touch of [true, false]) {
        for (const card of FirstRunHelper.cards({ touch })) {
          expect(card.lines.length).toBeGreaterThanOrEqual(1);
          expect(card.lines.length).toBeLessThanOrEqual(3);
          for (const line of card.lines) expect(line.length).toBeLessThan(200);
        }
      }
    });

    it('each open the guide at a topic that exists', () => {
      const topics = HelpTopicHelper.topics();
      for (const card of FirstRunHelper.cards({ touch: true })) expect(topics).toContain(card.help);
    });

    it('pulse a ring only on the card about touching', () => {
      expect(FirstRunHelper.cards({ touch: true }).map(card => !!card.pulse)).toEqual([true, false, false]);
      expect(FirstRunHelper.cards({ touch: false }).map(card => !!card.pulse)).toEqual([false, false, false]);
    });

    it('end with the project\'s promise, which the old alert opened with', () => {
      expect(FirstRunHelper.FOOTER).toContain('gratuito');
      expect(FirstRunHelper.FOOTER).toContain('código aberto');
    });
  });

  describe('move', () => {
    it('steps through the deck and stops at its ends', () => {
      expect(FirstRunHelper.move(0, 1, 3)).toBe(1);
      expect(FirstRunHelper.move(1, 1, 3)).toBe(2);
      expect(FirstRunHelper.move(2, 1, 3)).toBe(2);
      expect(FirstRunHelper.move(2, -1, 3)).toBe(1);
      expect(FirstRunHelper.move(0, -1, 3)).toBe(0);
    });

    it('survives an empty deck', () => {
      expect(FirstRunHelper.move(0, 1, 0)).toBe(0);
    });
  });
});
