import { BOOT_SCREEN } from '../models/constants';
import { BootPhase, BootProgressHelper, BootStatus } from './boot-progress.helper';
import { BootScreenHelper } from './boot-screen.helper';

const status = (phase: BootPhase, percent: number | null = null, message = 'x'): BootStatus => ({ phase, percent, message });
const states = (phase: BootPhase) => BootScreenHelper.view(status(phase), 0).steps.map(step => `${step.id}:${step.state}`);

describe('BootScreenHelper', () => {

  describe('the steps', () => {
    it('always lists the same four, in the order the boot goes through them', () => {
      for (const phase of ['download', 'extract', 'emulator', 'dos', 'windows', 'elifoot', 'game'] as BootPhase[]) {
        expect(BootScreenHelper.view(status(phase), 0).steps.map(step => step.id)).toEqual(['download', 'prepare', 'windows', 'game']);
      }
    });

    it('marks the one it is on, those behind it done and those ahead todo', () => {
      expect(states('download')).toEqual(['download:active', 'prepare:todo', 'windows:todo', 'game:todo']);
      expect(states('extract')).toEqual(['download:done', 'prepare:active', 'windows:todo', 'game:todo']);
      expect(states('emulator')).toEqual(['download:done', 'prepare:active', 'windows:todo', 'game:todo']);
      expect(states('dos')).toEqual(['download:done', 'prepare:done', 'windows:active', 'game:todo']);
      expect(states('windows')).toEqual(['download:done', 'prepare:done', 'windows:active', 'game:todo']);
      expect(states('elifoot')).toEqual(['download:done', 'prepare:done', 'windows:done', 'game:active']);
    });

    it('shows every step done once the game\'s own screen was seen', () => {
      expect(states('game').every(state => state.endsWith(':done'))).toBeTrue();
    });

    it('names DOS and Windows 3.1 as one step: the stage text says which of the two', () => {
      expect(BootScreenHelper.view(status('dos'), 0).steps.find(step => step.id === 'windows')?.label).toBe('Windows 3.1');
    });
  });

  describe('the bar', () => {
    it('is determinate while js-dos reports a percentage: the download and the unpacking', () => {
      expect(BootScreenHelper.bar(status('download', 43))).toEqual({ determinate: true, percent: 43 });
      expect(BootScreenHelper.bar(status('extract', 100))).toEqual({ determinate: true, percent: 100 });
    });

    it('does not invent a figure for what has none: it moves without a length', () => {
      for (const phase of ['emulator', 'dos', 'windows', 'elifoot', 'game'] as BootPhase[]) {
        expect(BootScreenHelper.bar(status(phase)).determinate).withContext(phase).toBeFalse();
      }
    });

    it('does not claim a figure before js-dos has given one, even in a step that will have it', () => {
      expect(BootScreenHelper.bar(status('download', null))).toEqual({ determinate: false, percent: 0 });
    });

    it('keeps a figure that arrives out of range on the bar', () => {
      expect(BootScreenHelper.bar(status('download', 140)).percent).toBe(100);
      expect(BootScreenHelper.bar(status('download', -3)).percent).toBe(0);
    });

    it('ignores a percentage that a later phase might carry over', () => {
      expect(BootScreenHelper.bar(status('dos', 80)).determinate).toBeFalse();
    });
  });

  describe('the words', () => {
    it('keeps the stage text of the boot (P6) as the line under the title', () => {
      expect(BootScreenHelper.view(BootScreenHelper.fromStage('dos'), 0).message).toBe('Iniciando o DOS…');
      expect(BootScreenHelper.view(BootScreenHelper.fromStage('windows'), 0).message).toBe('Abrindo o Windows 3.1…');
      expect(BootScreenHelper.view(BootScreenHelper.fromStage('elifoot'), 0).message).toBe('Carregando o Elifoot…');
    });

    it('turns a stage into a status with no percentage', () => {
      expect(BootScreenHelper.fromStage('windows')).toEqual({ phase: 'windows', message: 'Abrindo o Windows 3.1…', percent: null });
    });

    it('starts at the download, with no figure', () => {
      expect(BootScreenHelper.initial()).toEqual({ phase: 'download', message: 'Baixando o jogo…', percent: null });
    });

    it('carries what js-dos said, through the same status the page builds', () => {
      const view = BootScreenHelper.view(BootProgressHelper.status('Downloading bundle 61.4%')!, 0);
      expect(view.message).toBe('Baixando o jogo… 61%');
      expect(view.bar).toEqual({ determinate: true, percent: 61 });
      expect(view.steps[0].state).toBe('active');
    });
  });

  describe('the hint', () => {
    it('is silent in the normal case: after the download, in the first seconds', () => {
      expect(BootScreenHelper.hint('dos', 0)).toBeNull();
      expect(BootScreenHelper.hint('windows', BOOT_SCREEN.SLOW_AFTER_MS - 1)).toBeNull();
    });

    it('names the download for what it is, while it runs and is not slow yet', () => {
      expect(BootScreenHelper.hint('download', 0)).toContain('primeira visita');
    });

    it('admits that slow phones and networks are slow, once the wait is long', () => {
      expect(BootScreenHelper.hint('windows', BOOT_SCREEN.SLOW_AFTER_MS)).toContain('demoram mais');
      expect(BootScreenHelper.hint('download', BOOT_SCREEN.SLOW_AFTER_MS)).toContain('demoram mais');
    });

    it('says that leaving is allowed after a minute, and promises no time', () => {
      const hint = BootScreenHelper.hint('elifoot', BOOT_SCREEN.LONG_AFTER_MS);
      expect(hint).toContain('volte ao menu');
      expect(hint).not.toMatch(/\d+ ?(s|segundos|min)/);
    });

    it('is the view\'s hint for the elapsed time it was given', () => {
      expect(BootScreenHelper.view(status('windows'), BOOT_SCREEN.LONG_AFTER_MS + 1).hint).toBe(BootScreenHelper.hint('windows', BOOT_SCREEN.LONG_AFTER_MS + 1));
    });
  });
});
