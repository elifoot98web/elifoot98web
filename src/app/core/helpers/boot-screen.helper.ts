import { BOOT_SCREEN } from '../models/constants';
import { BootPhase, BootStatus } from './boot-progress.helper';
import { BootStage, BootStageHelper } from './boot-stage.helper';

export type BootStepId = 'download' | 'prepare' | 'windows' | 'game';

export interface BootStep {
  id: BootStepId;
  label: string;
  state: 'done' | 'active' | 'todo';
}

export interface BootBar {
  /** False when the app does not know how far along the step is, and the bar says so by moving without a length. */
  determinate: boolean;
  /** 0 to 100; 0 when it is not determinate. */
  percent: number;
}

export interface BootScreenView {
  title: string;
  /** The line under the title: the P6 stage text, unchanged. */
  message: string;
  steps: BootStep[];
  bar: BootBar;
  /** What to tell a person who has been looking at the screen for a while, or null. */
  hint: string | null;
}

const STEPS: ReadonlyArray<{ id: BootStepId; label: string }> = [
  { id: 'download', label: 'Baixar' },
  { id: 'prepare', label: 'Preparar' },
  { id: 'windows', label: 'Windows 3.1' },
  { id: 'game', label: 'Elifoot' },
];

/** The step each phase belongs to. The guest has two stages before the game's own (DOS, then Windows) and the screen shows one. */
const STEP_OF: Readonly<Record<BootPhase, BootStepId>> = {
  download: 'download',
  extract: 'prepare',
  emulator: 'prepare',
  dos: 'windows',
  windows: 'windows',
  elifoot: 'game',
  game: 'game',
};

/**
 * What the inline boot screen shows, from where the boot is and for how long it has been going. It replaced a spinner with a
 * sentence in it (`ion-loading`) that said "Carregando game…" for the 4 to 20 seconds the game takes to come up, which is the
 * first thing a new player sees and the one place the app can be honest about what is slow.
 *
 * **The bar does not make up a number.** It is determinate only while js-dos reports a percentage (the download and the unpacking),
 * and moves without a length the rest of the time (the emulator starting, then DOS, Windows 3.1 and the game, which have no
 * progress to read, only a frame to classify). Weighting the four steps into one percentage would have looked better and been
 * wrong, and a bar that sits at 90% for twenty seconds is the thing that makes people reload. What fills the gap is the list of
 * steps: which one it is on, which are done, and the P6 line that has always said it in words.
 *
 * Kept free of Angular so it can be tested on plain values.
 */
export class BootScreenHelper {

  static readonly TITLE = 'Carregando o Elifoot 98';

  /** The status a stage label stands for (the guest's frames, polled once the emulator is up). */
  static fromStage(stage: BootStage): BootStatus {
    return { phase: stage, message: BootStageHelper.message(stage), percent: null };
  }

  /** Before js-dos has said anything: the first line is the same one the download starts with, with no figure. */
  static initial(): BootStatus {
    return { phase: 'download', message: 'Baixando o jogo…', percent: null };
  }

  static view(status: BootStatus, elapsedMs: number): BootScreenView {
    const at = STEPS.findIndex(step => step.id === STEP_OF[status.phase]);
    // The game's own screen has been seen: every step is behind us.
    const finished = status.phase === 'game';
    return {
      title: BootScreenHelper.TITLE,
      message: status.message,
      steps: STEPS.map((step, index) => ({
        ...step,
        state: finished || index < at ? 'done' : index === at ? 'active' : 'todo',
      })),
      bar: BootScreenHelper.bar(status),
      hint: BootScreenHelper.hint(status.phase, elapsedMs),
    };
  }

  static bar(status: BootStatus): BootBar {
    const known = (status.phase === 'download' || status.phase === 'extract') && status.percent !== null;
    return known
      ? { determinate: true, percent: Math.min(100, Math.max(0, Math.round(status.percent as number))) }
      : { determinate: false, percent: 0 };
  }

  /**
   * Nothing for the first seconds, which are the normal case. The first time the download is named for what it is (a visit that
   * happens once); after `SLOW_AFTER_MS` that the wait is not the app's fault; after `LONG_AFTER_MS` that leaving is allowed.
   * No figure is promised: how long Windows 3.1 takes on a given phone is not known.
   */
  static hint(phase: BootPhase, elapsedMs: number): string | null {
    if (elapsedMs >= BOOT_SCREEN.LONG_AFTER_MS) {
      return 'Ainda carregando. Se preferir, volte ao menu e tente de novo mais tarde.';
    }
    if (elapsedMs >= BOOT_SCREEN.SLOW_AFTER_MS) {
      return 'Celulares e redes lentas demoram mais. O jogo continua carregando.';
    }
    if (phase === 'download') {
      return 'Na primeira visita o jogo é baixado. Nas próximas, ele costuma já estar no aparelho.';
    }
    return null;
  }
}
