import { EmulatorKeyCode } from '../models/game';
import { TypeKeyHelper } from './type-key.helper';

const K = EmulatorKeyCode;

describe('TypeKeyHelper', () => {

  describe('named keys', () => {

    it('maps Enter, Esc and the navigation keys to the game\'s keys, and says they move the guest', () => {
      const cases: Array<[string, EmulatorKeyCode]> = [
        ['Enter', K.KBD_enter], ['Escape', K.KBD_esc],
        ['ArrowLeft', K.KBD_left], ['ArrowRight', K.KBD_right], ['ArrowUp', K.KBD_up], ['ArrowDown', K.KBD_down],
        ['Home', K.KBD_home], ['End', K.KBD_end], ['Delete', K.KBD_delete],
        ['PageUp', K.KBD_pageup], ['PageDown', K.KBD_pagedown],
      ];
      for (const [name, code] of cases) {
        const key = TypeKeyHelper.fromKeyboardEvent({ key: name }, false);
        expect(key?.codes).withContext(name).toEqual([code]);
        expect(key?.resets).withContext(name).toBeTrue();
      }
    });

    it('maps F1 to F12 to the function keys', () => {
      for (let n = 1; n <= 12; n++) {
        const key = TypeKeyHelper.fromKeyboardEvent({ key: `F${n}` }, false);
        expect(key?.codes).withContext(`F${n}`).toEqual([K.KBD_f1 + n - 1]);
      }
      expect(TypeKeyHelper.fromKeyboardEvent({ key: 'F13' }, false)).toBeNull();
      expect(TypeKeyHelper.fromKeyboardEvent({ key: 'F0' }, false)).toBeNull();
    });

    it('makes Shift+Tab a chord with Shift first', () => {
      expect(TypeKeyHelper.fromKeyboardEvent({ key: 'Tab' }, false)?.codes).toEqual([K.KBD_tab]);
      expect(TypeKeyHelper.fromKeyboardEvent({ key: 'Tab', shiftKey: true }, false)?.codes).toEqual([K.KBD_leftshift, K.KBD_tab]);
    });

    it('lets only the arrows, the page keys and Delete repeat', () => {
      expect(TypeKeyHelper.fromKeyboardEvent({ key: 'ArrowDown' }, false)?.repeatable).toBeTrue();
      expect(TypeKeyHelper.fromKeyboardEvent({ key: 'PageDown' }, false)?.repeatable).toBeTrue();
      expect(TypeKeyHelper.fromKeyboardEvent({ key: 'Delete' }, false)?.repeatable).toBeTrue();
      for (const name of ['Enter', 'Escape', 'Tab', 'F5', 'Home', 'End']) {
        expect(TypeKeyHelper.fromKeyboardEvent({ key: name }, false)?.repeatable).withContext(name).toBeFalse();
      }
    });
  });

  describe('Backspace', () => {

    it('is the guest\'s own key only in an empty field, where no input event will carry it', () => {
      const key = TypeKeyHelper.fromKeyboardEvent({ key: 'Backspace' }, true);
      expect(key?.codes).toEqual([K.KBD_backspace]);
      expect(key?.resets).toBeFalse();
      expect(key?.repeatable).toBeTrue();
    });

    it('is left to the input event in a field with text, or it would delete twice', () => {
      expect(TypeKeyHelper.fromKeyboardEvent({ key: 'Backspace' }, false)).toBeNull();
    });
  });

  describe('what is not the game\'s', () => {

    it('ignores letters, digits and punctuation: text comes from the field\'s value', () => {
      for (const name of ['a', 'A', '5', ' ', '.', 'ã', 'Dead', 'Shift', 'CapsLock']) {
        expect(TypeKeyHelper.fromKeyboardEvent({ key: name }, false)).withContext(name).toBeNull();
      }
    });

    it('ignores what an IME is in the middle of, by either of its two tells', () => {
      expect(TypeKeyHelper.fromKeyboardEvent({ key: 'Enter', isComposing: true }, false)).toBeNull();
      expect(TypeKeyHelper.fromKeyboardEvent({ key: 'Enter', keyCode: 229 }, false)).toBeNull();
      expect(TypeKeyHelper.fromKeyboardEvent({ key: 'Unidentified', keyCode: 229 }, true)).toBeNull();
      expect(TypeKeyHelper.fromKeyboardEvent({ key: 'Backspace', keyCode: 229 }, true)).toBeNull();
    });

    it('leaves a chord with Ctrl, Alt or Meta to the browser (paste, select all)', () => {
      expect(TypeKeyHelper.fromKeyboardEvent({ key: 'Enter', ctrlKey: true }, false)).toBeNull();
      expect(TypeKeyHelper.fromKeyboardEvent({ key: 'Tab', altKey: true }, false)).toBeNull();
      expect(TypeKeyHelper.fromKeyboardEvent({ key: 'Escape', metaKey: true }, false)).toBeNull();
    });
  });

  describe('resetsField', () => {

    it('is every chord but Backspace', () => {
      expect(TypeKeyHelper.resetsField([K.KBD_backspace])).toBeFalse();
      expect(TypeKeyHelper.resetsField([K.KBD_tab])).toBeTrue();
      expect(TypeKeyHelper.resetsField([K.KBD_leftshift, K.KBD_tab])).toBeTrue();
      expect(TypeKeyHelper.resetsField([K.KBD_left])).toBeTrue();
    });
  });
});
