import { GAME_INPUT_FN_BTNS } from '../models/constants';
import { EmulatorKeyCode } from '../models/game';
import { DeckKey, DeckKeyHelper } from './deck-keys.helper';

const K = EmulatorKeyCode;

/** The js-dos (GLFW) key codes written out as numbers, independently of the enum the table is built from. */
const NUMBERS = {
  f1: 290, f12: 301, a: 65, m: 77, kpMultiply: 332, kpMinus: 333,
  up: 265, down: 264, left: 263, right: 262, enter: 257, esc: 256, tab: 258,
  backspace: 259, space: 32, delete: 261, pageUp: 266, pageDown: 267, home: 268, end: 269,
  leftShift: 340, leftAlt: 342,
};

const byId = (keys: DeckKey[], id: string): DeckKey => keys.find(entry => entry.id === id) as DeckKey;

describe('DeckKeyHelper', () => {

  describe('the formation keys', () => {
    const formations = DeckKeyHelper.formations();

    it('are F1 to F12 in order, with the codes js-dos knows them by', () => {
      expect(formations.map(entry => entry.label)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12']);
      expect(formations.map(entry => entry.codes[0])).toEqual(Array.from({ length: 12 }, (_, index) => NUMBERS.f1 + index));
      expect(formations[11].codes[0]).toBe(NUMBERS.f12);
    });

    it('carry the captions of GAME_INPUT_FN_BTNS, the one table of formations', () => {
      expect(formations.map(entry => entry.caption)).toEqual(GAME_INPUT_FN_BTNS.map(button => button.label));
      expect(formations.map(entry => entry.label)).toEqual(GAME_INPUT_FN_BTNS.map(button => button.text));
    });

    it('are the twelve formations of the game, and every one fields ten outfield players', () => {
      expect(formations.map(entry => entry.caption)).toEqual([
        '3-3-4', '3-4-3', '4-2-4', '4-3-3', '4-4-2', '4-5-1', '5-2-3', '5-3-2', '5-4-1', '5-5-0', '6-3-1', '6-4-0',
      ]);
      for (const entry of formations) {
        const sum = (entry.caption as string).split('-').map(Number).reduce((a, b) => a + b, 0);
        expect(sum).withContext(entry.caption ?? entry.id).toBe(10);
      }
    });

    it('say the formation to a screen reader, and not only the key', () => {
      expect(byId(formations, 'f5').aria).toBe('F5, formação 4-4-2');
    });

    it('do not repeat when held: a formation is picked once', () => {
      expect(formations.every(entry => !entry.repeat)).toBeTrue();
    });
  });

  describe('the function keys of the "Mais teclas" grid', () => {

    it('are the same twelve codes without captions', () => {
      const plain = DeckKeyHelper.functionKeys();

      expect(plain.map(entry => entry.codes[0])).toEqual(DeckKeyHelper.formations().map(entry => entry.codes[0]));
      expect(plain.every(entry => entry.caption === undefined)).toBeTrue();
      expect(plain.map(entry => entry.aria)).toEqual(plain.map(entry => entry.label));
    });
  });

  describe('the tactics shortcuts', () => {
    const [automatic, best] = DeckKeyHelper.tacticShortcuts();

    it('are A for Automático and M for Melhores, the two the owner verified', () => {
      expect(automatic.codes).toEqual([NUMBERS.a]);
      expect(automatic.caption).toBe('Automático');
      expect(best.codes).toEqual([NUMBERS.m]);
      expect(best.caption).toBe('Melhores');
    });

    it('have a caption for a 48 px rail key where the full one would not fit: only Automático needs one', () => {
      expect(automatic.shortCaption).toBe('Auto');
      expect(best.shortCaption).toBeUndefined();
      // A short caption is shorter, or it is not one.
      expect((automatic.shortCaption ?? '').length).toBeLessThan((automatic.caption ?? '').length);
    });
  });

  describe('the keypad keys', () => {
    const keypad = DeckKeyHelper.keypad();

    it('are * for Craque and - for Registro, labelled by what the owner said they do (D8)', () => {
      expect(byId(keypad, 'kp-multiply').codes).toEqual([NUMBERS.kpMultiply]);
      expect(byId(keypad, 'kp-multiply').caption).toBe('Craque');
      expect(byId(keypad, 'kp-minus').codes).toEqual([NUMBERS.kpMinus]);
      expect(byId(keypad, 'kp-minus').caption).toBe('Registro');
    });

    it('explain themselves to a screen reader, since a bare asterisk explains nothing', () => {
      expect(byId(keypad, 'kp-multiply').aria).toContain('craque');
      expect(byId(keypad, 'kp-minus').aria).toContain('registro');
    });
  });

  describe('the arrows panel', () => {
    const arrows = DeckKeyHelper.arrows();

    it('maps the cross, Enter, Esc and Tab to their codes', () => {
      expect(arrows.up.codes).toEqual([NUMBERS.up]);
      expect(arrows.down.codes).toEqual([NUMBERS.down]);
      expect(arrows.left.codes).toEqual([NUMBERS.left]);
      expect(arrows.right.codes).toEqual([NUMBERS.right]);
      expect(arrows.enter.codes).toEqual([NUMBERS.enter]);
      expect(arrows.esc.codes).toEqual([NUMBERS.esc]);
      expect(arrows.tab.codes).toEqual([NUMBERS.tab]);
    });

    it('repeats the four arrows and nothing else: Enter and Esc held would answer a dialog twice', () => {
      expect([arrows.up, arrows.down, arrows.left, arrows.right].every(entry => entry.repeat)).toBeTrue();
      expect([arrows.enter, arrows.esc, arrows.tab].some(entry => entry.repeat)).toBeFalse();
    });

    it('names the arrows in Portuguese', () => {
      expect(arrows.left.aria).toBe('Seta para a esquerda');
      expect(arrows.up.aria).toBe('Seta para cima');
    });
  });

  describe('the editing keys', () => {
    const editing = DeckKeyHelper.editing();

    it('maps every one to its code', () => {
      expect(byId(editing, 'space').codes).toEqual([NUMBERS.space]);
      expect(byId(editing, 'backspace').codes).toEqual([NUMBERS.backspace]);
      expect(byId(editing, 'delete').codes).toEqual([NUMBERS.delete]);
      expect(byId(editing, 'tab').codes).toEqual([NUMBERS.tab]);
      expect(byId(editing, 'page-up').codes).toEqual([NUMBERS.pageUp]);
      expect(byId(editing, 'page-down').codes).toEqual([NUMBERS.pageDown]);
      expect(byId(editing, 'home').codes).toEqual([NUMBERS.home]);
      expect(byId(editing, 'end').codes).toEqual([NUMBERS.end]);
    });

    it('sends Shift+Tab as one chord with the modifier first', () => {
      expect(byId(editing, 'shift-tab').codes).toEqual([NUMBERS.leftShift, NUMBERS.tab]);
    });

    it('repeats deleting and paging, and not Space or Home', () => {
      const repeating = editing.filter(entry => entry.repeat).map(entry => entry.id).sort();

      expect(repeating).toEqual(['backspace', 'delete', 'page-down', 'page-up']);
    });
  });

  describe('Sair', () => {
    const quit = DeckKeyHelper.quit();

    it('is Alt+F4, modifier first', () => {
      expect(quit.codes).toEqual([NUMBERS.leftAlt, K.KBD_f4]);
      expect(quit.codes[1]).toBe(NUMBERS.f1 + 3);
    });

    it('is the only key that asks first', () => {
      expect(quit.guarded).toBeTrue();
      expect(DeckKeyHelper.all().filter(entry => entry.guarded).map(entry => entry.id)).toEqual(['quit']);
    });
  });

  describe('the table as a whole', () => {
    const all = DeckKeyHelper.all();

    it('has no two controls with one id', () => {
      expect(new Set(all.map(entry => entry.id)).size).toBe(all.length);
    });

    it('holds only codes the key queue accepts: whole positive numbers, a chord short enough', () => {
      for (const entry of all) {
        expect(entry.codes.length).withContext(entry.id).toBeGreaterThan(0);
        expect(entry.codes.length).withContext(entry.id).toBeLessThanOrEqual(4);
        for (const code of entry.codes) {
          expect(Number.isInteger(code) && code > 0).withContext(`${entry.id} ${code}`).toBeTrue();
        }
      }
    });

    it('gives every control a name a screen reader can say', () => {
      for (const entry of all) expect(entry.aria.trim().length).withContext(entry.id).toBeGreaterThan(0);
    });

    it('covers the 22 game keys the FABs carried, and the ones js-dos\'s keyboard was needed for', () => {
      const ids = all.map(entry => entry.id);
      for (const wanted of ['f1', 'f12', 'a', 'm', 'kp-multiply', 'kp-minus', 'up', 'down', 'left', 'right', 'enter', 'esc', 'tab', 'shift-tab', 'backspace', 'space']) {
        expect(ids).withContext(wanted).toContain(wanted);
      }
    });
  });
});
