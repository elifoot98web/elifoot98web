import { GAME_INPUT_FN_BTNS } from '../models/constants';
import { EmulatorKeyCode } from '../models/game';

/**
 * One control of the deck that sends keys: what is printed on it, what a screen reader says, and
 * the chord it sends. This table is the single place that says which button is which key (the
 * FABs, the header buttons and js-dos's own keyboard each had a copy of some of it).
 */
export interface DeckKey {
  /** Stable, for the diagnostics log and for tests. Never shown. */
  id: string;
  /** Printed on the keycap. */
  label: string;
  /** Under the label: the formation a function key picks, or what the game does with the key. */
  caption?: string;
  /** The accessible name. pt-BR, and says what the key does where the label alone would not. */
  aria: string;
  /** Pressed together in this order and released in reverse; modifiers first. */
  codes: readonly EmulatorKeyCode[];
  /** Holding the key repeats it (KeyRepeatScheduler). Only navigation and deletion do. */
  repeat: boolean;
  /** An ionicons name, drawn on the keycap. */
  icon?: string;
  /** Draw the icon alone: the accessible name says the rest. */
  iconOnly?: boolean;
  /** Sending it needs the player's say-so first (it ends the game). */
  guarded?: boolean;
}

const K = EmulatorKeyCode;

const key = (id: string, label: string, aria: string, codes: readonly EmulatorKeyCode[], extra: Partial<DeckKey> = {}): DeckKey =>
  ({ id, label, aria, codes, repeat: false, ...extra });

/**
 * The deck's key table. Pure data and lookups, no Angular and no DOM.
 *
 * **What the two unlabelled keys do** (decision D8, confirmed by the owner): the keypad `*` opens
 * the player search for the "craque" (star player) attribute, and the keypad `-` is where the
 * serial registration key is typed. `A` is Seleccionar > Automático and `M` Seleccionar > Melhores,
 * both verified by pressing them on the main screen. The captions say so; whether the guest does
 * exactly that on every screen is on the device checklist.
 */
export class DeckKeyHelper {

  /** F1 to F12 with their formation captions, from {@link GAME_INPUT_FN_BTNS}. */
  static formations(): DeckKey[] {
    return GAME_INPUT_FN_BTNS.map(button => key(
      DeckKeyHelper.functionKeyId(button.keyCode),
      button.text,
      `${button.text}, formação ${button.label}`,
      [button.keyCode],
      { caption: button.label },
    ));
  }

  /** The same twelve keys without a caption, for the "Mais teclas" grid. */
  static functionKeys(): DeckKey[] {
    return GAME_INPUT_FN_BTNS.map(button => key(
      DeckKeyHelper.functionKeyId(button.keyCode), button.text, button.text, [button.keyCode],
    ));
  }

  private static functionKeyId(code: EmulatorKeyCode): string {
    return `f${code - K.KBD_f1 + 1}`;
  }

  /** Seleccionar > Automático and Seleccionar > Melhores: the other two tactics keys. */
  static tacticShortcuts(): DeckKey[] {
    return [
      key('a', 'A', 'A, Automático', [K.KBD_a], { caption: 'Automático' }),
      key('m', 'M', 'M, Melhores', [K.KBD_m], { caption: 'Melhores' }),
    ];
  }

  /** The "Setas" panel: the cross, Enter, Esc and Tab. */
  static arrows(): { up: DeckKey; down: DeckKey; left: DeckKey; right: DeckKey; enter: DeckKey; esc: DeckKey; tab: DeckKey } {
    return {
      up: key('up', 'Cima', 'Seta para cima', [K.KBD_up], { icon: 'caret-up-outline', iconOnly: true, repeat: true }),
      down: key('down', 'Baixo', 'Seta para baixo', [K.KBD_down], { icon: 'caret-down-outline', iconOnly: true, repeat: true }),
      left: key('left', 'Esquerda', 'Seta para a esquerda', [K.KBD_left], { icon: 'caret-back-outline', iconOnly: true, repeat: true }),
      right: key('right', 'Direita', 'Seta para a direita', [K.KBD_right], { icon: 'caret-forward-outline', iconOnly: true, repeat: true }),
      enter: key('enter', 'Enter', 'Enter', [K.KBD_enter], { icon: 'return-down-back-outline' }),
      esc: key('esc', 'Esc', 'Esc', [K.KBD_esc]),
      tab: key('tab', 'Tab', 'Tab', [K.KBD_tab]),
    };
  }

  /** Editing and navigation keys of the "Mais teclas" panel. */
  static editing(): DeckKey[] {
    return [
      key('space', 'Espaço', 'Espaço', [K.KBD_space]),
      // A text face, not an icon: ionicons are fetched from /svg/ the first time one is drawn, so a
      // glyph that only a panel nobody has opened draws could be missing from the offline cache of a
      // player whose update arrived online and who next launches offline, leaving a blank keycap.
      key('backspace', 'Apagar', 'Backspace, apagar', [K.KBD_backspace], { repeat: true }),
      key('delete', 'Del', 'Delete', [K.KBD_delete], { repeat: true }),
      key('tab', 'Tab', 'Tab', [K.KBD_tab]),
      key('shift-tab', '⇧Tab', 'Shift mais Tab, voltar ao campo anterior', [K.KBD_leftshift, K.KBD_tab]),
      key('page-up', 'PgUp', 'Page Up, página anterior', [K.KBD_pageup], { repeat: true }),
      key('page-down', 'PgDn', 'Page Down, próxima página', [K.KBD_pagedown], { repeat: true }),
      key('home', 'Home', 'Home, início', [K.KBD_home]),
      key('end', 'End', 'End, fim', [K.KBD_end]),
    ];
  }

  /** The keypad `*` and `-` of the game, labelled by what the owner confirmed they do (D8). */
  static keypad(): DeckKey[] {
    return [
      key('kp-multiply', 'Num *', 'Craque, asterisco do teclado numérico: procura jogadores craque', [K.KBD_kpmultiply], { caption: 'Craque' }),
      key('kp-minus', 'Num -', 'Registro, menos do teclado numérico: digita o código de registro', [K.KBD_kpminus], { caption: 'Registro' }),
    ];
  }

  /**
   * Alt+F4, closing Elifoot. It leaves the game for the Program Manager, and the page offers to
   * restart it after a few seconds (GameExitWatcherService), but it is never one tap away.
   */
  static quit(): DeckKey {
    return key('quit', 'Sair', 'Sair do jogo, Alt mais F4', [K.KBD_leftalt, K.KBD_f4], { caption: 'Alt+F4', guarded: true });
  }

  /** One key of the table by id; a typo here is a bug in the deck, so it throws. */
  static byId(id: string): DeckKey {
    const found = DeckKeyHelper.all().find(entry => entry.id === id);
    if (!found) throw new Error(`Unknown deck key: ${id}`);
    return found;
  }

  /** Every key the deck can send, each once, for the tests and the diagnostics lookups. */
  static all(): DeckKey[] {
    const arrows = DeckKeyHelper.arrows();
    const seen = new Map<string, DeckKey>();
    for (const entry of [
      ...DeckKeyHelper.formations(),
      ...DeckKeyHelper.tacticShortcuts(),
      ...Object.values(arrows),
      ...DeckKeyHelper.editing(),
      ...DeckKeyHelper.keypad(),
      DeckKeyHelper.quit(),
    ]) {
      if (!seen.has(entry.id)) seen.set(entry.id, entry);
    }
    return [...seen.values()];
  }
}
