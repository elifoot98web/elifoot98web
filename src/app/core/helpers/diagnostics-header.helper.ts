import { DIAGNOSTICS } from '../models/constants';
import { DisplayModeHelper } from './display-mode.helper';
import { DiagnosticsReportHelper } from './diagnostics-report.helper';
import { DiagnosticsSerializer } from './diagnostics-serializer.helper';
import { TimeoutHelper } from './timeout.helper';

/*
 * The slices of `navigator`, `window` and js-dos that the header reads, written as structural types
 * so a spec can hand over a plain object. Every member is optional, because the point of the header
 * is to run on browsers nobody has tried yet: a missing API is a line that says "n/d", never a throw.
 */

export interface DiagnosticsNavigatorLike {
  userAgent?: string;
  platform?: string;
  language?: string;
  languages?: readonly string[];
  hardwareConcurrency?: number;
  /** Chromium only, and rounded on purpose. */
  deviceMemory?: number;
  maxTouchPoints?: number;
  onLine?: boolean;
  /** iOS Safari's "added to the home screen" flag. */
  standalone?: boolean;
  userAgentData?: { mobile?: boolean; platform?: string; brands?: ReadonlyArray<{ brand: string; version: string }> };
  connection?: { effectiveType?: string; saveData?: boolean; downlink?: number; rtt?: number };
  serviceWorker?: {
    controller?: { scriptURL?: string; state?: string } | null;
    getRegistration?: () => Promise<{
      scope?: string;
      active?: { state?: string } | null;
      waiting?: { state?: string } | null;
      installing?: { state?: string } | null;
    } | undefined>;
  };
  storage?: {
    persisted?: () => Promise<boolean>;
    estimate?: () => Promise<{ usage?: number; quota?: number }>;
  };
}

export interface DiagnosticsWindowLike {
  devicePixelRatio?: number;
  innerWidth?: number;
  innerHeight?: number;
  outerWidth?: number;
  outerHeight?: number;
  visualViewport?: {
    width?: number;
    height?: number;
    scale?: number;
    offsetLeft?: number;
    offsetTop?: number;
    pageLeft?: number;
    pageTop?: number;
  } | null;
  screen?: {
    width?: number;
    height?: number;
    availWidth?: number;
    availHeight?: number;
    colorDepth?: number;
    orientation?: { type?: string; angle?: number };
  };
  matchMedia?: (query: string) => { matches: boolean };
  /** Chromium only. */
  performance?: { memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number } };
  PointerEvent?: unknown;
}

/** What js-dos itself decided at boot, read off the live instance. */
export interface DiagnosticsJsdosLike {
  autolock?: boolean;
  mobileControls?: boolean;
  sensitivity?: number;
  /** Where js-dos keeps what it decided about the pointer: `dom.pointers.bind`, built once when its script loads. */
  emulatorsUi?: {
    dom?: {
      pointers?: {
        bind?: { mobile?: boolean; canLock?: boolean; starters?: readonly string[]; changers?: readonly string[] };
      };
    };
  };
}

export interface DiagnosticsHeaderSource {
  now: Date;
  version: { name: string; number: string; buildDate: string; commit: string };
  /** The route only (`/game`), never the query: a share link carries a room code. */
  route: string;
  navigator: DiagnosticsNavigatorLike;
  window: DiagnosticsWindowLike;
  /** `'ontouchstart' in window`, which a spec cannot ask a plain object. */
  hasTouchEvents: boolean;
  documentVisibility?: string;
  jsdos?: DiagnosticsJsdosLike | null;
  /** The command interface, for the guest's framebuffer. `null` before the game has booted. */
  guest?: { width: () => number; height: () => number } | null;
  /** The emulator's `<canvas>`, if there is one. */
  canvas?: { width: number; height: number; clientWidth: number; clientHeight: number } | null;
  /**
   * The log's own state. Not its entry count: the header is collected once, before the buttons
   * that use it are pressed, and the report states the live count on its own line.
   */
  log: { capacity: number; enabled: boolean };
}

const UNAVAILABLE = 'n/d';

/** The regular expression js-dos tests the user agent with to decide a device is a phone or tablet. */
const JSDOS_MOBILE_USER_AGENT = /iPhone|iPad|iPod|Android/i;

/**
 * The device facts at the top of every export. The log says what the app did; this says on what,
 * and a phone's answer to "is this device coarse-pointered, how big is its visual viewport, did
 * js-dos think it was a phone" is the first thing needed to read any of it.
 *
 * Built from a source object, never from the globals directly, so a spec drives it with a stub
 * `navigator`. Every fact is read on its own: a browser that lacks one (Safari has no
 * `deviceMemory`, Firefox no `storage.estimate` in a private window) prints "n/d" for that line
 * and the rest still print. The asynchronous ones (storage, service worker) have a deadline,
 * because a probe that hangs must not hold the export hostage.
 *
 * Nothing that identifies a person goes in: no URL beyond the route, no storage contents, no
 * cookies. The user agent and screen size are what any website sees anyway.
 */
export class DiagnosticsHeaderHelper {

  static async build(source: DiagnosticsHeaderSource): Promise<string[]> {
    const { navigator: nav, window: win, now } = source;
    const matches = (query: string) => DiagnosticsHeaderHelper.safe(() => win.matchMedia?.(query).matches === true, false);
    const lines: string[] = [];
    const add = (label: string, value: unknown) => lines.push(`${label}: ${value === undefined || value === '' ? UNAVAILABLE : value}`);

    lines.push('=== Elifoot 98 Online: relatório de diagnóstico ===');
    add('Gerado em', `${now.toISOString()} (${DiagnosticsReportHelper.timezone(now)})`);
    add('Versão do app', `${source.version.name} (versão ${source.version.number}, build ${source.version.buildDate}, commit ${source.version.commit})`);
    add('Página', source.route);
    add('Visibilidade', source.documentVisibility);
    add('Instalado como app (PWA)', DiagnosticsHeaderHelper.yesNo(
      matches('(display-mode: standalone)') || matches('(display-mode: fullscreen)') || nav.standalone === true));

    lines.push('', '-- Aparelho --');
    add('User agent', nav.userAgent);
    add('Plataforma', nav.platform);
    add('Client hints', nav.userAgentData
      ? `móvel=${DiagnosticsHeaderHelper.yesNo(nav.userAgentData.mobile)}, plataforma=${nav.userAgentData.platform ?? UNAVAILABLE}, marcas=${(nav.userAgentData.brands ?? []).map(b => `${b.brand} ${b.version}`).join('; ') || UNAVAILABLE}`
      : undefined);
    add('Idioma', nav.language);
    add('Núcleos de CPU', nav.hardwareConcurrency);
    add('Memória do aparelho (GB, arredondada)', nav.deviceMemory);
    add('Memória do JavaScript', DiagnosticsHeaderHelper.heap(win.performance?.memory));
    add('Conexão', nav.connection
      ? `${nav.connection.effectiveType ?? UNAVAILABLE}, economia de dados=${DiagnosticsHeaderHelper.yesNo(nav.connection.saveData)}, rtt=${nav.connection.rtt ?? UNAVAILABLE} ms, downlink=${nav.connection.downlink ?? UNAVAILABLE} Mb/s`
      : undefined);
    add('Online', DiagnosticsHeaderHelper.yesNo(nav.onLine));

    lines.push('', '-- Tela e janela --');
    add('devicePixelRatio', win.devicePixelRatio);
    add('Janela (innerWidth x innerHeight)', DiagnosticsHeaderHelper.size(win.innerWidth, win.innerHeight));
    add('Janela externa', DiagnosticsHeaderHelper.size(win.outerWidth, win.outerHeight));
    add('visualViewport', win.visualViewport
      ? `${DiagnosticsHeaderHelper.size(win.visualViewport.width, win.visualViewport.height)}, escala ${win.visualViewport.scale}, deslocamento (${win.visualViewport.offsetLeft}, ${win.visualViewport.offsetTop}), página (${win.visualViewport.pageLeft}, ${win.visualViewport.pageTop})`
      : undefined);
    add('Tela', win.screen
      ? `${DiagnosticsHeaderHelper.size(win.screen.width, win.screen.height)}, útil ${DiagnosticsHeaderHelper.size(win.screen.availWidth, win.screen.availHeight)}, ${win.screen.colorDepth} bits`
      : undefined);
    add('Orientação', win.screen?.orientation
      ? `${win.screen.orientation.type} (${win.screen.orientation.angle}°)`
      : undefined);
    add('Orientação (media query)', matches('(orientation: portrait)') ? 'retrato' : matches('(orientation: landscape)') ? 'paisagem' : undefined);

    lines.push('', '-- Entrada --');
    add('pointer', DiagnosticsHeaderHelper.which(matches, 'pointer', ['fine', 'coarse', 'none']));
    add('hover', DiagnosticsHeaderHelper.which(matches, 'hover', ['hover', 'none']));
    add('any-pointer', DiagnosticsHeaderHelper.which(matches, 'any-pointer', ['fine', 'coarse', 'none']));
    add('any-hover', DiagnosticsHeaderHelper.which(matches, 'any-hover', ['hover', 'none']));
    add('Pontos de toque (maxTouchPoints)', nav.maxTouchPoints);
    add('ontouchstart na janela', DiagnosticsHeaderHelper.yesNo(source.hasTouchEvents));
    add('PointerEvent', DiagnosticsHeaderHelper.yesNo(typeof win.PointerEvent !== 'undefined'));

    lines.push('', '-- js-dos e o jogo --');
    const mobileUserAgent = JSDOS_MOBILE_USER_AGENT.test(nav.userAgent ?? '');
    add('js-dos: user agent tratado como móvel', `${DiagnosticsHeaderHelper.yesNo(mobileUserAgent)} (teste ${JSDOS_MOBILE_USER_AGENT})`);
    const bind = source.jsdos?.emulatorsUi?.dom?.pointers?.bind;
    add('js-dos: detecção que ele fez (bind.mobile)', DiagnosticsHeaderHelper.yesNo(bind?.mobile));
    add('js-dos: pode travar o ponteiro (bind.canLock)', DiagnosticsHeaderHelper.yesNo(bind?.canLock));
    add('js-dos: eventos de início de toque', bind?.starters?.join(', '));
    add('js-dos: eventos de movimento', bind?.changers?.join(', '));
    add('js-dos: autolock', DiagnosticsHeaderHelper.yesNo(source.jsdos?.autolock));
    add('js-dos: controles móveis', DiagnosticsHeaderHelper.yesNo(source.jsdos?.mobileControls));
    add('js-dos: sensibilidade', source.jsdos?.sensitivity);
    const guest = DiagnosticsHeaderHelper.safe(() => source.guest ? { width: source.guest.width(), height: source.guest.height() } : null, null);
    const mode = guest ? DisplayModeHelper.fromFrameSize(guest.width, guest.height) : null;
    add('Tela do convidado (framebuffer)', guest
      ? `${DiagnosticsHeaderHelper.size(guest.width, guest.height)}${mode ? ` (modo ${mode})` : ' (nenhum dos dois modos)'}`
      : 'o jogo ainda não iniciou');
    add('Canvas do emulador', source.canvas
      ? `${DiagnosticsHeaderHelper.size(source.canvas.width, source.canvas.height)} desenhado, ${DiagnosticsHeaderHelper.size(Math.round(source.canvas.clientWidth), Math.round(source.canvas.clientHeight))} na página`
      : undefined);

    lines.push('', '-- Service worker e armazenamento --');
    add('Service worker', await DiagnosticsHeaderHelper.serviceWorker(nav));
    add('Armazenamento persistente', await DiagnosticsHeaderHelper.probe(
      () => nav.storage?.persisted?.(), persisted => DiagnosticsHeaderHelper.yesNo(persisted)));
    add('Armazenamento usado', await DiagnosticsHeaderHelper.probe(
      () => nav.storage?.estimate?.(),
      estimate => `${DiagnosticsHeaderHelper.megabytes(estimate?.usage)} de ${DiagnosticsHeaderHelper.megabytes(estimate?.quota)}`));

    lines.push('', '-- Este registro --');
    add('Registro', source.log.enabled ? 'ligado' : 'desligado');
    add('Capacidade do registro', `${source.log.capacity} eventos`);
    add('Aviso', 'O texto digitado no jogo ou no app pode aparecer neste relatório. Revise antes de enviar.');
    return lines;
  }

  /** A yes/no fact as text; "n/d" when the browser did not say. */
  private static yesNo(value: boolean | undefined): string {
    return value === undefined ? UNAVAILABLE : value ? 'sim' : 'não';
  }

  private static size(width: number | undefined, height: number | undefined): string | undefined {
    return width === undefined || height === undefined ? undefined : `${width}x${height}`;
  }

  private static megabytes(bytes: number | undefined): string {
    return bytes === undefined ? UNAVAILABLE : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private static heap(memory: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number } | undefined): string | undefined {
    if (!memory) return undefined;
    return `em uso ${DiagnosticsHeaderHelper.megabytes(memory.usedJSHeapSize)}, total ${DiagnosticsHeaderHelper.megabytes(memory.totalJSHeapSize)}, limite ${DiagnosticsHeaderHelper.megabytes(memory.jsHeapSizeLimit)}`;
  }

  /** Every value of a media feature that matches, so `any-pointer` can say "fine e coarse". */
  private static which(matches: (query: string) => boolean, feature: string, values: readonly string[]): string | undefined {
    const hit = values.filter(value => matches(`(${feature}: ${value})`));
    return hit.length > 0 ? hit.join(' + ') : undefined;
  }

  private static safe<T>(read: () => T, fallback: T): T {
    try {
      return read();
    } catch {
      return fallback;
    }
  }

  /** The text of an asynchronous probe: its answer, "n/d" if there is none, or why it failed. */
  private static async probe<T>(start: () => Promise<T> | undefined, text: (value: T) => string): Promise<string> {
    try {
      const pending = start();
      if (!pending) return UNAVAILABLE;
      return text(await TimeoutHelper.withTimeout(() => pending, DIAGNOSTICS.HEADER_PROBE_TIMEOUT_MS));
    } catch (error) {
      return `falhou (${DiagnosticsSerializer.describe(error)})`;
    }
  }

  private static async serviceWorker(nav: DiagnosticsNavigatorLike): Promise<string> {
    const container = nav.serviceWorker;
    if (!container) return 'sem suporte';

    const controller = container.controller
      ? `controlando a página (${container.controller.scriptURL ?? UNAVAILABLE}, ${container.controller.state ?? UNAVAILABLE})`
      : 'não está controlando a página';
    const registration = await DiagnosticsHeaderHelper.probe(
      () => container.getRegistration?.(),
      found => found
        ? `ativo=${found.active?.state ?? 'nenhum'}, aguardando=${found.waiting?.state ?? 'nenhum'}, instalando=${found.installing?.state ?? 'nenhum'}, escopo ${found.scope ?? UNAVAILABLE}`
        : 'nenhum registro');
    return `${controller}; registro: ${registration}`;
  }

  /**
   * The source for the real page. Everything that touches a global is here, so the builder above
   * never does and a spec never needs a browser.
   */
  static sourceFromGlobals(
    version: DiagnosticsHeaderSource['version'],
    log: DiagnosticsHeaderSource['log'],
    guest: DiagnosticsHeaderSource['guest']
  ): DiagnosticsHeaderSource {
    const canvas = document.querySelector<HTMLCanvasElement>('#game-container canvas.emulator-canvas')
      ?? document.querySelector<HTMLCanvasElement>('.emulator-canvas');
    const instance = typeof dosInstance !== 'undefined' ? dosInstance : null;

    return {
      now: new Date(),
      version,
      // Hash routing keeps the route after the "#"; the query inside it is dropped on purpose.
      route: `${location.pathname}${location.hash.split('?')[0]}`,
      navigator: navigator as unknown as DiagnosticsNavigatorLike,
      window: window as unknown as DiagnosticsWindowLike,
      hasTouchEvents: 'ontouchstart' in window,
      documentVisibility: document.visibilityState,
      jsdos: instance,
      guest,
      canvas,
      log,
    };
  }
}
