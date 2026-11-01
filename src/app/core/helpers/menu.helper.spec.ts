import { AdvancedMenuHelper, AdvancedContext } from './advanced-menu.helper';
import { MenuContext, MenuEntryId, MenuHelper } from './menu.helper';

/** A phone with everything the browser can offer, in a game with no room. */
function phone(overrides: Partial<MenuContext> = {}): MenuContext {
  return {
    inRoom: false,
    hostStarting: false,
    unreadMessages: 0,
    fullscreenSupported: true,
    install: { title: 'Instalar o app', subtitle: 'Abre em tela cheia' },
    touchModeOffered: true,
    canVibrate: true,
    wakeLockSupported: true,
    silentModeSupported: true,
    railsOffered: true,
    camera: { on: true, label: '2x', zoomed: true, canZoomIn: true, canZoomOut: true },
    smoothing: true,
    keyVibration: true,
    keepAwake: true,
    gameMuted: false,
    audioPlayback: false,
    volumePercent: 80,
    hideSpectatorCursors: false,
    sendSoundToSpectators: true,
    fullscreenActive: false,
    summary: {
      save: 'Salvo às 14:32', volume: 'Volume 80%', room: 'ELI-ABCD · 3 na sala', touchMode: 'Direto', deck: 'Automático · aparece neste aparelho',
      resolution: '640x480', stageView: 'Ajustar', fullscreen: 'Gira a tela', keepAwake: 'Ligada',
    },
    ...overrides,
  };
}

/** A laptop with a mouse: no touch rows, no vibration, no rails, and whatever its browser lacks. */
function desktop(overrides: Partial<MenuContext> = {}): MenuContext {
  return phone({
    install: null, touchModeOffered: false, canVibrate: false, silentModeSupported: false, railsOffered: false,
    camera: { on: false, label: 'Ajustar', zoomed: false, canZoomIn: false, canZoomOut: false },
    ...overrides,
  });
}

const ids = (context: MenuContext): MenuEntryId[] => MenuHelper.entries(MenuHelper.sections(context)).map(entry => entry.id);
const find = (context: MenuContext, id: MenuEntryId) => MenuHelper.entries(MenuHelper.sections(context)).find(entry => entry.id === id);

describe('MenuHelper', () => {

  describe('the shape of the menu', () => {
    it('has the five sections, in the order they are needed', () => {
      expect(MenuHelper.sections(phone()).map(section => section.title)).toEqual(['Jogo', 'Multiplayer', 'Entrada', 'Exibição', 'Ajuda']);
    });

    it('puts "Salvar agora" first: the frequent action is the first row of the first section', () => {
      const [first] = MenuHelper.sections(phone());
      expect(first.id).toBe('game');
      expect(first.entries[0].id).toBe('save-now');
      expect(first.entries[0].subtitle).toBe('Salvo às 14:32');
    });

    it('keeps "Voltar ao menu" in the first section, ahead of every other section', () => {
      expect(MenuHelper.sections(phone())[0].entries.map(entry => entry.id)).toContain('leave');
    });

    it('never lists a row twice: no action lives in two places', () => {
      for (const context of [phone(), desktop(), phone({ inRoom: true }), desktop({ inRoom: true })]) {
        const all = ids(context);
        expect(new Set(all).size).toBe(all.length);
      }
    });

    it('has a "?" for every section but the help itself', () => {
      for (const section of MenuHelper.sections(phone())) {
        if (section.id === 'help') expect(section.help).toBeUndefined();
        else expect(section.help).toBeDefined();
      }
    });
  });

  describe('what is fenced off', () => {
    // These live in "Dados e avançado" and must not leak back into the rows a thumb hits by habit.
    const advancedIds = (): string[] => AdvancedMenuHelper.entries(AdvancedMenuHelper.groups(advancedContext({ debug: true, cameraOffered: true }))).map(entry => entry.id);

    it('holds nothing of the advanced window: backup, patches, the O Matic, the diagnostics, the experiments and the wipe', () => {
      for (const context of [phone(), desktop(), phone({ inRoom: true })]) {
        const quick = ids(context) as string[];
        for (const id of advancedIds()) expect(quick).not.toContain(id);
      }
    });

    it('opens that window with one row, "Dados e avançado", in the first section', () => {
      const data = find(phone(), 'data');
      expect(data?.label).toBe('Dados e avançado');
      expect(data?.opensWindow).toBeTrue();
    });

    it('offers nothing destructive: its two risky rows ask first, in the page, and neither is a wipe', () => {
      const labels = MenuHelper.entries(MenuHelper.sections(phone())).map(entry => entry.label.toLowerCase());
      expect(labels.some(label => label.includes('apagar') || label.includes('limpar'))).toBeFalse();
    });
  });

  describe('hosting', () => {
    it('offers to host when there is no room, and the room instead of it when there is one', () => {
      expect(ids(phone())).toContain('host');
      expect(ids(phone())).not.toContain('room');
      expect(ids(phone({ inRoom: true }))).toContain('room');
      expect(ids(phone({ inRoom: true }))).not.toContain('host');
    });

    it('shows the two room switches only while a room is live', () => {
      expect(ids(phone())).not.toContain('hide-cursors');
      expect(ids(phone())).not.toContain('send-sound');
      expect(ids(phone({ inRoom: true }))).toEqual(jasmine.arrayContaining(['hide-cursors', 'send-sound']));
    });

    it('carries the room\'s state: the summary and the unread count', () => {
      const room = find(phone({ inRoom: true, unreadMessages: 4 }), 'room');
      expect(room?.subtitle).toBe('ELI-ABCD · 3 na sala');
      expect(room?.badge).toBe(4);
    });

    it('disables hosting while the room is being created, and says so', () => {
      const host = find(phone({ hostStarting: true }), 'host');
      expect(host?.disabled).toBeTrue();
      expect(host?.label).toBe('Criando sala…');
      expect(find(phone(), 'host')?.disabled).toBeFalsy();
    });

    it('disables the resolution while a room is live (the change is a reload) and says why', () => {
      const live = find(phone({ inRoom: true }), 'resolution');
      expect(live?.disabled).toBeTrue();
      expect(live?.subtitle).toBe('Encerre a sala para trocar');
      expect(find(phone(), 'resolution')?.disabled).toBeFalsy();
      expect(find(phone(), 'resolution')?.subtitle).toBe('640x480');
    });

    it('tells the host that leaving ends the room', () => {
      expect(find(phone({ inRoom: true }), 'leave')?.subtitle).toContain('encerra a sala');
      expect(find(phone(), 'leave')?.subtitle).not.toContain('sala');
    });
  });

  describe('what the device and the browser can do', () => {
    it('gives a desktop none of the touch rows', () => {
      const all = ids(desktop());
      expect(all).not.toContain('touch-mode');
      expect(all).not.toContain('key-vibration');
      expect(all).not.toContain('stage-view');
      expect(all).not.toContain('zoom');
      expect(all).not.toContain('install');
      expect(all).not.toContain('silent-mode');
    });

    it('gives a phone every one of them', () => {
      const all = ids(phone());
      for (const id of ['touch-mode', 'key-vibration', 'stage-view', 'zoom', 'install', 'silent-mode'] as MenuEntryId[]) {
        expect(all).toContain(id);
      }
    });

    it('leaves out each row whose capability is missing, and only that row', () => {
      const without: Array<[Partial<MenuContext>, MenuEntryId]> = [
        [{ fullscreenSupported: false }, 'fullscreen'],
        [{ install: null }, 'install'],
        [{ touchModeOffered: false }, 'touch-mode'],
        [{ canVibrate: false }, 'key-vibration'],
        [{ wakeLockSupported: false }, 'keep-awake'],
        [{ silentModeSupported: false }, 'silent-mode'],
        [{ railsOffered: false }, 'stage-view'],
        [{ camera: { on: false, label: 'Ajustar', zoomed: false, canZoomIn: false, canZoomOut: false } }, 'zoom'],
      ];
      const full = ids(phone());
      for (const [override, id] of without) {
        const reduced = ids(phone(override));
        expect(reduced).not.toContain(id);
        expect(reduced).toEqual(full.filter(other => other !== id));
      }
    });

    it('keeps the rows every device has: text, the key panel, smoothing, the resolution, the volume and the help', () => {
      for (const context of [phone(), desktop()]) {
        expect(ids(context)).toEqual(jasmine.arrayContaining(['type-text', 'deck-mode', 'smoothing', 'resolution', 'volume', 'mute', 'first-steps', 'guide', 'about']));
      }
    });

    it('chooses the sheet for a finger and the popover for a mouse', () => {
      expect(MenuHelper.presentation(true)).toBe('sheet');
      expect(MenuHelper.presentation(false)).toBe('popover');
    });

    it('opens the sheet at 60% of a portrait phone and at the top of a landscape one', () => {
      expect(MenuHelper.initialBreakpoint('portrait')).toBe(0.6);
      expect(MenuHelper.initialBreakpoint('landscape-compact')).toBe(1);
      expect(MenuHelper.initialBreakpoint('landscape-regular')).toBe(1);
    });
  });

  describe('the zoom row (the camera\'s single-pointer twin)', () => {
    it('is there when the camera is on, with the key panel in whatever state: it does not depend on the deck', () => {
      const zoom = find(phone(), 'zoom');
      expect(zoom?.kind).toBe('zoom');
      expect(zoom?.zoom).toEqual({ zoomed: true, canZoomIn: true, canZoomOut: true });
      expect(zoom?.subtitle).toBe('2x');
    });

    it('says which of its keys do something', () => {
      const atTheEnd = find(phone({ camera: { on: true, label: '3x', zoomed: true, canZoomIn: false, canZoomOut: true } }), 'zoom');
      expect(atTheEnd?.zoom?.canZoomIn).toBeFalse();
      expect(atTheEnd?.zoom?.canZoomOut).toBeTrue();
    });
  });

  describe('the positive wording', () => {
    it('words the switches as what is on: "Suavizar a imagem", not "Desativar Suavização"', () => {
      const smoothing = find(phone(), 'smoothing');
      expect(smoothing?.label).toBe('Suavizar a imagem');
      expect(smoothing?.checked).toBeTrue();
      expect(find(phone({ smoothing: false }), 'smoothing')?.checked).toBeFalse();
    });

    it('has no row worded as a double negative', () => {
      for (const entry of MenuHelper.entries(MenuHelper.sections(phone({ inRoom: true })))) {
        expect(entry.label.toLowerCase().startsWith('desativar')).toBeFalse();
        expect(entry.label.toLowerCase().startsWith('desligar')).toBeFalse();
      }
    });

    it('reports a toggle\'s state as the context has it', () => {
      expect(find(phone({ gameMuted: true }), 'mute')?.checked).toBeTrue();
      expect(find(phone({ keepAwake: false }), 'keep-awake')?.checked).toBeFalse();
      expect(find(phone({ audioPlayback: true }), 'silent-mode')?.checked).toBeTrue();
      expect(find(phone({ inRoom: true, hideSpectatorCursors: true }), 'hide-cursors')?.checked).toBeTrue();
      expect(find(phone({ inRoom: true, sendSoundToSpectators: false }), 'send-sound')?.checked).toBeFalse();
    });

    it('swaps the fullscreen row\'s words and icon with its state', () => {
      expect(find(phone(), 'fullscreen')?.label).toBe('Tela cheia');
      expect(find(phone({ fullscreenActive: true }), 'fullscreen')?.label).toBe('Sair da tela cheia');
      expect(find(phone({ fullscreenActive: true }), 'fullscreen')?.icon).toBe('contract-outline');
    });
  });

  describe('what a tap does to the menu', () => {
    it('lets a switch, a slider and the zoom keys change a setting where it stands, and every other row open something', () => {
      const kinds: Record<string, string> = {};
      for (const entry of MenuHelper.entries(MenuHelper.sections(phone()))) kinds[entry.id] = entry.kind;
      // The page closes the menu for an `action` and for nothing else.
      expect(kinds['mute']).toBe('toggle');
      expect(kinds['smoothing']).toBe('toggle');
      expect(kinds['volume']).toBe('range');
      expect(kinds['zoom']).toBe('zoom');
      expect(kinds['save-now']).toBe('action');
      expect(kinds['data']).toBe('action');
      expect(kinds['leave']).toBe('action');
    });
  });
});

function advancedContext(overrides: Partial<AdvancedContext> = {}): AdvancedContext {
  return {
    inRoom: false, debug: false, cameraOffered: false,
    values: { autosaveGame: true, autosavePeriodic: false, liveKeyboard: false, idlePause: false, camera: false },
    idleSeconds: 20,
    storage: { summary: 'Protegido · 5,4 MB', warning: null },
    diagnosticsSummary: 'Desligado',
    ...overrides,
  };
}
