import { LayoutShape } from './layout-shape.helper';
import { HelpTopic } from './help-topic.helper';

/** A bottom sheet where a finger is how the device is used, the popover where it is not. */
export type MenuPresentation = 'sheet' | 'popover';

export type MenuSectionId = 'game' | 'multiplayer' | 'input' | 'display' | 'help';

export type MenuEntryId =
  // Jogo
  | 'save-now' | 'data' | 'volume' | 'mute' | 'silent-mode' | 'reload' | 'leave'
  // Multiplayer
  | 'host' | 'room' | 'hide-cursors' | 'send-sound'
  // Entrada
  | 'type-text' | 'touch-mode' | 'deck-mode' | 'key-vibration'
  // Exibição
  | 'smoothing' | 'fullscreen' | 'install' | 'resolution' | 'stage-view' | 'zoom' | 'keep-awake'
  // Ajuda
  | 'first-steps' | 'guide' | 'about';

/**
 * What the row is. An `action` opens something and closes the menu; a `toggle`, a `range` and the `zoom` row change a setting
 * where it stands and leave the menu open, because the person is usually about to change the next one.
 */
export type MenuEntryKind = 'action' | 'toggle' | 'range' | 'zoom';

export interface MenuEntry {
  id: MenuEntryId;
  kind: MenuEntryKind;
  label: string;
  /** The line under the label: the state the row stands for, or why it cannot be used now. */
  subtitle?: string;
  /** An ionicon, for an action. */
  icon?: string;
  /** A toggle's state, in the positive: checked means the thing is on. */
  checked?: boolean;
  /** A range's value, 0 to 100. */
  value?: number;
  disabled?: boolean;
  /** A count to show beside the label (unread chat messages). */
  badge?: number;
  /** The row opens another window of its own ("Dados e avançado"), not a dialog about itself. */
  opensWindow?: boolean;
  /** The zoom row: which of its keys do something. */
  zoom?: { zoomed: boolean; canZoomIn: boolean; canZoomOut: boolean };
}

export interface MenuSection {
  id: MenuSectionId;
  title: string;
  entries: MenuEntry[];
  /** The "?" beside the title opens the guide here. The help section is the guide, so it has none. */
  help?: HelpTopic;
}

/**
 * Everything the menu depends on, as plain values the page reads off its services. The model is a pure function of this, which is
 * what lets a spec say "hosting changes these rows" and "a desktop has none of the touch rows" without a page.
 */
export interface MenuContext {
  /** A room is live (the host's page). */
  inRoom: boolean;
  /** The room is being created right now: a second tap would start a competing claim on the same code. */
  hostStarting: boolean;
  unreadMessages: number;

  // What the browser and the device can do. A row that cannot work is not offered, rather than offered and dead.
  fullscreenSupported: boolean;
  /** The install entry's words, or null where there is nothing to install (already installed, or no way to). */
  install: { title: string; subtitle: string } | null;
  /** A finger is the pointer AND the classic touchpad would work on this device (TouchModeHelper.offersChoice). */
  touchModeOffered: boolean;
  canVibrate: boolean;
  wakeLockSupported: boolean;
  /** `navigator.audioSession` exists (Safari 16.4+): the iPhone's ringer switch can be answered. */
  silentModeSupported: boolean;
  /** A landscape phone: the rails have two sizes. */
  railsOffered: boolean;
  /** The in-app camera is on, and so its zoom row is offered (the setting itself is in "Dados e avançado"). */
  camera: { on: boolean; label: string; zoomed: boolean; canZoomIn: boolean; canZoomOut: boolean };

  // The state each row shows.
  smoothing: boolean;
  keyVibration: boolean;
  keepAwake: boolean;
  gameMuted: boolean;
  /** "Som no modo silencioso" is on (`navigator.audioSession.type = 'playback'`). */
  audioPlayback: boolean;
  volumePercent: number;
  hideSpectatorCursors: boolean;
  sendSoundToSpectators: boolean;
  fullscreenActive: boolean;

  // The lines under rows whose state is a sentence, written by the services that know it.
  summary: {
    save: string;
    volume: string;
    room: string;
    touchMode: string;
    deck: string;
    resolution: string;
    stageView: string;
    fullscreen: string;
    keepAwake: string;
  };
}

/**
 * The options menu: which rows exist, in which section, in which order, and in what state, for the sheet that a finger opens and the
 * popover that a mouse does. It replaced a flat list of 15 rows with three nested popovers, where the same action lived in up to
 * four places and the frequent ones were buried among the rare (phase P13, the study's IA-1).
 *
 * **The rules this keeps** (menu.helper.spec.ts pins each):
 * - Five sections, in the order of how often they are needed: Jogo, Multiplayer, Entrada, Exibição, Ajuda. "Salvar agora" is the
 *   first row of the first.
 * - **No action lives in two places in this menu**, and none of "Dados e avançado" lives in it at all (the window is the one row
 *   that opens it): backup, patches, the Cheat 'O Matic, the diagnostics, the experimental switches and the wipe are fenced off
 *   from the rows a thumb hits by habit. The deck may repeat "Digitar texto" and the O Matic key; the menu does not repeat either
 *   of them.
 * - A row that cannot work on this browser or device is not there, and a row that cannot work *now* says why in its subtitle.
 * - Nothing here is destructive. What loses progress ("Salvar e recarregar", "Voltar ao menu") asks first, in the page.
 *
 * Kept free of Angular so it can be tested on plain values.
 */
export class MenuHelper {

  /** A finger gets the sheet: the popover is anchored to a mouse-sized button in a corner and needs a pointer that is small. */
  static presentation(touchPrimary: boolean): MenuPresentation {
    return touchPrimary ? 'sheet' : 'popover';
  }

  /**
   * How tall the sheet opens, as a share of the screen. A portrait phone has the picture on top (a quarter to a third of the
   * screen) and the sheet should leave it in view; a landscape one is short, and a sheet that starts at 60% of 390 px shows one
   * row, so it opens at the top. The player can drag it either way.
   */
  static initialBreakpoint(shape: LayoutShape): number {
    return shape === 'portrait' ? 0.6 : 1;
  }

  static sections(context: MenuContext): MenuSection[] {
    const sections: MenuSection[] = [
      MenuHelper.gameSection(context),
      MenuHelper.multiplayerSection(context),
      MenuHelper.inputSection(context),
      MenuHelper.displaySection(context),
      MenuHelper.helpSection(),
    ];
    return sections.filter(section => section.entries.length > 0);
  }

  /** Every row of a menu, in the order it is read. */
  static entries(sections: readonly MenuSection[]): MenuEntry[] {
    return sections.reduce<MenuEntry[]>((all, section) => all.concat(section.entries), []);
  }

  private static gameSection(c: MenuContext): MenuSection {
    const entries: MenuEntry[] = [
      // First, because it is what a player wants when the chip says nothing has been saved. The subtitle is the chip's text, for the
      // layouts that have no toolbar to show it in.
      { id: 'save-now', kind: 'action', label: 'Salvar agora', subtitle: c.summary.save, icon: 'save-outline' },
      { id: 'data', kind: 'action', label: 'Dados e avançado', subtitle: 'Backup, patches e ferramentas', icon: 'construct-outline', opensWindow: true },
      { id: 'volume', kind: 'range', label: 'Volume do jogo', subtitle: c.summary.volume, value: c.volumePercent },
      { id: 'mute', kind: 'toggle', label: 'Silenciar o jogo', checked: c.gameMuted },
    ];
    if (c.silentModeSupported) {
      // Off unless chosen, and the subtitle says why: it interrupts the music of other apps.
      entries.push({
        id: 'silent-mode', kind: 'toggle', label: 'Som no modo silencioso',
        subtitle: 'Toca o jogo mesmo com a chave de toque do iPhone no silencioso. Pode interromper a música de outros apps.',
        checked: c.audioPlayback,
      });
    }
    entries.push(
      { id: 'reload', kind: 'action', label: 'Salvar e recarregar', icon: 'refresh-outline' },
      {
        id: 'leave', kind: 'action', label: 'Voltar ao menu', icon: 'exit-outline',
        subtitle: c.inRoom ? 'Salva o jogo e encerra a sala' : 'Salva o jogo e volta para a tela inicial',
      },
    );
    return { id: 'game', title: 'Jogo', entries, help: 'menu-game' };
  }

  private static multiplayerSection(c: MenuContext): MenuSection {
    const entries: MenuEntry[] = [];
    if (!c.inRoom) {
      entries.push({
        id: 'host', kind: 'action', icon: 'people-outline', disabled: c.hostStarting,
        label: c.hostStarting ? 'Criando sala…' : 'Hospedar jogo multiplayer',
        subtitle: c.hostStarting ? undefined : 'Transmita o jogo para os amigos assistirem',
      });
    } else {
      // One row for the whole room; its subtitle answers "which room, how many people" without opening it.
      entries.push(
        { id: 'room', kind: 'action', label: 'Sala multiplayer', subtitle: c.summary.room, icon: 'people-outline', badge: c.unreadMessages, opensWindow: true },
        // Local and silent: the guests are not told, because there is nothing for them to do about it.
        { id: 'hide-cursors', kind: 'toggle', label: 'Ocultar cursores dos espectadores', checked: c.hideSpectatorCursors },
        // The track stays in the stream either way and is only switched, so nothing renegotiates.
        { id: 'send-sound', kind: 'toggle', label: 'Enviar o som do jogo aos espectadores', checked: c.sendSoundToSpectators },
      );
    }
    return { id: 'multiplayer', title: 'Multiplayer', entries, help: 'multiplayer' };
  }

  private static inputSection(c: MenuContext): MenuSection {
    const entries: MenuEntry[] = [
      { id: 'type-text', kind: 'action', label: 'Digitar texto', subtitle: 'Escreva no jogo, com acentos', icon: 'terminal-outline' },
    ];
    if (c.touchModeOffered) {
      entries.push({ id: 'touch-mode', kind: 'action', label: 'Modo de toque', subtitle: c.summary.touchMode, icon: 'hand-left-outline' });
    }
    entries.push({ id: 'deck-mode', kind: 'action', label: 'Mostrar painel de teclas', subtitle: c.summary.deck, icon: 'keypad-outline' });
    if (c.canVibrate) {
      entries.push({ id: 'key-vibration', kind: 'toggle', label: 'Vibração nas teclas', checked: c.keyVibration });
    }
    return { id: 'input', title: 'Entrada', entries, help: 'menu-input' };
  }

  private static displaySection(c: MenuContext): MenuSection {
    const entries: MenuEntry[] = [
      { id: 'smoothing', kind: 'toggle', label: 'Suavizar a imagem', subtitle: 'Desligue para ver os pixels quadrados', checked: c.smoothing },
    ];
    if (c.fullscreenSupported) {
      entries.push({
        id: 'fullscreen', kind: 'action', icon: c.fullscreenActive ? 'contract-outline' : 'expand-outline',
        label: c.fullscreenActive ? 'Sair da tela cheia' : 'Tela cheia', subtitle: c.summary.fullscreen,
      });
    }
    if (c.install) {
      entries.push({ id: 'install', kind: 'action', label: c.install.title, subtitle: c.install.subtitle, icon: 'download-outline' });
    }
    entries.push({
      // A change of mode is a reload, and a host's reload ends the room for everyone: the row is there and says why it is not usable.
      id: 'resolution', kind: 'action', label: 'Resolução do jogo', icon: 'resize-outline',
      subtitle: c.inRoom ? 'Encerre a sala para trocar' : c.summary.resolution,
      disabled: c.inRoom || c.hostStarting,
    });
    if (c.railsOffered) {
      entries.push({ id: 'stage-view', kind: 'action', label: 'Tamanho da imagem', subtitle: c.summary.stageView, icon: 'scan-outline' });
    }
    if (c.camera.on) {
      // The single-pointer twin of the two-finger gesture: it has to be reachable with the key panel off. In landscape the sheet opens
      // over the whole picture (initialBreakpoint), so a rung is seen by dragging the sheet down or closing it; portrait keeps it in view.
      entries.push({
        id: 'zoom', kind: 'zoom', label: 'Zoom', subtitle: c.camera.label,
        zoom: { zoomed: c.camera.zoomed, canZoomIn: c.camera.canZoomIn, canZoomOut: c.camera.canZoomOut },
      });
    }
    if (c.wakeLockSupported) {
      entries.push({ id: 'keep-awake', kind: 'toggle', label: 'Manter a tela ligada', subtitle: c.summary.keepAwake, checked: c.keepAwake });
    }
    return { id: 'display', title: 'Exibição', entries, help: 'menu-display' };
  }

  private static helpSection(): MenuSection {
    return {
      id: 'help', title: 'Ajuda',
      entries: [
        { id: 'first-steps', kind: 'action', label: 'Primeiros passos', icon: 'footsteps-outline' },
        { id: 'guide', kind: 'action', label: 'FAQ e manual', icon: 'help-circle-outline' },
        { id: 'about', kind: 'action', label: 'Sobre e créditos', icon: 'information-circle-outline' },
      ],
    };
  }
}
