import { fakeAsync, tick } from '@angular/core/testing';
import { DIAGNOSTICS } from '../models/constants';
import {
  DiagnosticsHeaderHelper, DiagnosticsHeaderSource, DiagnosticsNavigatorLike, DiagnosticsWindowLike
} from './diagnostics-header.helper';

const GALAXY_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A075M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IPAD_AS_MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

/** A phone, as far as the header can tell. Every member is overridable. */
function source(overrides: Partial<DiagnosticsHeaderSource> = {}, navigator: DiagnosticsNavigatorLike = {}, win: DiagnosticsWindowLike = {}): DiagnosticsHeaderSource {
  const queries = new Set(['(pointer: coarse)', '(any-pointer: coarse)', '(hover: none)', '(any-hover: none)', '(orientation: portrait)']);
  return {
    now: new Date(Date.UTC(2026, 9, 28, 17, 3, 22)),
    version: { name: '3.2.0-DEV', number: '3.2.0', buildDate: '2026-10-28', commit: 'abc1234' },
    route: '/game#/game',
    navigator: {
      userAgent: GALAXY_UA,
      platform: 'Linux armv81',
      language: 'pt-BR',
      hardwareConcurrency: 8,
      deviceMemory: 4,
      maxTouchPoints: 5,
      onLine: true,
      ...navigator,
    },
    window: {
      devicePixelRatio: 2.625,
      innerWidth: 412,
      innerHeight: 780,
      outerWidth: 412,
      outerHeight: 915,
      visualViewport: { width: 412, height: 700, scale: 1, offsetLeft: 0, offsetTop: 80, pageLeft: 0, pageTop: 0 },
      screen: { width: 412, height: 915, availWidth: 412, availHeight: 915, colorDepth: 24, orientation: { type: 'portrait-primary', angle: 0 } },
      matchMedia: (query: string) => ({ matches: queries.has(query) }),
      PointerEvent: class { },
      ...win,
    },
    hasTouchEvents: true,
    documentVisibility: 'visible',
    log: { capacity: 5000, enabled: true },
    ...overrides,
  };
}

const value = (lines: string[], label: string): string | undefined => {
  const line = lines.find(l => l.startsWith(`${label}: `));
  return line?.slice(label.length + 2);
};

describe('DiagnosticsHeaderHelper', () => {

  it('lists the device facts a phone report needs', async () => {
    const lines = await DiagnosticsHeaderHelper.build(source());

    expect(lines[0]).toContain('relatório de diagnóstico');
    expect(value(lines, 'Gerado em')).toContain('2026-10-28T17:03:22.000Z');
    expect(value(lines, 'Versão do app')).toBe('3.2.0-DEV (versão 3.2.0, build 2026-10-28, commit abc1234)');
    expect(value(lines, 'User agent')).toBe(GALAXY_UA);
    expect(value(lines, 'devicePixelRatio')).toBe('2.625');
    expect(value(lines, 'Janela (innerWidth x innerHeight)')).toBe('412x780');
    expect(value(lines, 'visualViewport')).toBe('412x700, escala 1, deslocamento (0, 80), página (0, 0)');
    expect(value(lines, 'Tela')).toBe('412x915, útil 412x915, 24 bits');
    expect(value(lines, 'Orientação')).toBe('portrait-primary (0°)');
    expect(value(lines, 'Núcleos de CPU')).toBe('8');
    expect(value(lines, 'Memória do aparelho (GB, arredondada)')).toBe('4');
    expect(value(lines, 'Pontos de toque (maxTouchPoints)')).toBe('5');
    expect(value(lines, 'ontouchstart na janela')).toBe('sim');
    expect(value(lines, 'PointerEvent')).toBe('sim');
  });

  it('reads the pointer and hover capabilities off the media queries', async () => {
    const lines = await DiagnosticsHeaderHelper.build(source());

    expect(value(lines, 'pointer')).toBe('coarse');
    expect(value(lines, 'hover')).toBe('none');
    expect(value(lines, 'any-pointer')).toBe('coarse');
  });

  it('lists every value of an any-pointer that matches, for a tablet with a mouse', async () => {
    const win = source({}, {}, { matchMedia: (q: string) => ({ matches: ['(pointer: coarse)', '(any-pointer: coarse)', '(any-pointer: fine)'].includes(q) }) });

    expect(value(await DiagnosticsHeaderHelper.build(win), 'any-pointer')).toBe('fine + coarse');
  });

  it('says n/d, and still prints the rest, for what the browser does not have', async () => {
    // Safari: no deviceMemory, no storage API probes in a private window, no matchMedia pointer data.
    const lines = await DiagnosticsHeaderHelper.build(source({}, { deviceMemory: undefined, hardwareConcurrency: undefined }, { visualViewport: null, matchMedia: undefined, screen: undefined }));

    expect(value(lines, 'Memória do aparelho (GB, arredondada)')).toBe('n/d');
    expect(value(lines, 'Núcleos de CPU')).toBe('n/d');
    expect(value(lines, 'visualViewport')).toBe('n/d');
    expect(value(lines, 'Tela')).toBe('n/d');
    expect(value(lines, 'pointer')).toBe('n/d');
    expect(value(lines, 'User agent')).toBe(GALAXY_UA);
  });

  it('survives a navigator that is nearly empty', async () => {
    const lines = await DiagnosticsHeaderHelper.build({
      now: new Date(0), version: { name: 'v', number: 'v', buildDate: 'v', commit: 'v' }, route: '/',
      navigator: {}, window: {}, hasTouchEvents: false, log: { capacity: 1, enabled: false },
    });

    expect(value(lines, 'User agent')).toBe('n/d');
    expect(value(lines, 'Service worker')).toBe('sem suporte');
    expect(value(lines, 'Armazenamento persistente')).toBe('n/d');
    expect(value(lines, 'Registro')).toBe('desligado');
  });

  describe('what js-dos decided', () => {

    it('treats an Android user agent as mobile, the way js-dos tests it', async () => {
      const lines = await DiagnosticsHeaderHelper.build(source());

      expect(value(lines, 'js-dos: user agent tratado como móvel')).toContain('sim');
    });

    it('does not treat an iPad that reports itself as a Mac as mobile: js-dos takes the pointer-lock path there', async () => {
      const lines = await DiagnosticsHeaderHelper.build(source({}, { userAgent: IPAD_AS_MAC_UA, maxTouchPoints: 5 }));

      expect(value(lines, 'js-dos: user agent tratado como móvel')).toContain('não');
    });

    it('reports what the live js-dos instance holds', async () => {
      const lines = await DiagnosticsHeaderHelper.build(source({
        jsdos: {
          autolock: true, mobileControls: false, sensitivity: 1,
          emulatorsUi: { dom: { pointers: { bind: { mobile: true, canLock: false, starters: ['pointerdown'], changers: ['pointermove'] } } } },
        },
      }));

      expect(value(lines, 'js-dos: autolock')).toBe('sim');
      expect(value(lines, 'js-dos: detecção que ele fez (bind.mobile)')).toBe('sim');
      expect(value(lines, 'js-dos: pode travar o ponteiro (bind.canLock)')).toBe('não');
      expect(value(lines, 'js-dos: eventos de início de toque')).toBe('pointerdown');
      expect(value(lines, 'js-dos: eventos de movimento')).toBe('pointermove');
      expect(value(lines, 'js-dos: sensibilidade')).toBe('1');
    });

    it('says n/d before js-dos has started', async () => {
      const lines = await DiagnosticsHeaderHelper.build(source({ jsdos: null }));

      expect(value(lines, 'js-dos: autolock')).toBe('n/d');
      expect(value(lines, 'js-dos: detecção que ele fez (bind.mobile)')).toBe('n/d');
    });
  });

  describe('the guest framebuffer', () => {

    it('gives its size and the mode it belongs to', async () => {
      const lines = await DiagnosticsHeaderHelper.build(source({ guest: { width: () => 640, height: () => 480 } }));

      expect(value(lines, 'Tela do convidado (framebuffer)')).toBe('640x480 (modo 640)');
    });

    it('names a size that is neither mode, like DOS text mode', async () => {
      const lines = await DiagnosticsHeaderHelper.build(source({ guest: { width: () => 640, height: () => 400 } }));

      expect(value(lines, 'Tela do convidado (framebuffer)')).toBe('640x400 (nenhum dos dois modos)');
    });

    it('says the game has not started when there is no emulator, or it throws', async () => {
      expect(value(await DiagnosticsHeaderHelper.build(source({ guest: null })), 'Tela do convidado (framebuffer)')).toBe('o jogo ainda não iniciou');
      const dead = source({ guest: { width: () => { throw new Error('gone'); }, height: () => 0 } });
      expect(value(await DiagnosticsHeaderHelper.build(dead), 'Tela do convidado (framebuffer)')).toBe('o jogo ainda não iniciou');
    });

    it('gives the canvas as drawn and as laid out', async () => {
      const lines = await DiagnosticsHeaderHelper.build(source({ canvas: { width: 640, height: 480, clientWidth: 390.4, clientHeight: 292.6 } }));

      expect(value(lines, 'Canvas do emulador')).toBe('640x480 desenhado, 390x293 na página');
    });
  });

  describe('service worker and storage', () => {

    it('reports the controller, the registration and the storage numbers', async () => {
      const lines = await DiagnosticsHeaderHelper.build(source({}, {
        serviceWorker: {
          controller: { scriptURL: 'https://x/ngsw-worker.js', state: 'activated' },
          getRegistration: () => Promise.resolve({ scope: 'https://x/', active: { state: 'activated' }, waiting: null, installing: null }),
        },
        storage: {
          persisted: () => Promise.resolve(true),
          estimate: () => Promise.resolve({ usage: 5.5 * 1024 * 1024, quota: 2 * 1024 * 1024 * 1024 }),
        },
      }));

      expect(value(lines, 'Service worker')).toBe(
        'controlando a página (https://x/ngsw-worker.js, activated); registro: ativo=activated, aguardando=nenhum, instalando=nenhum, escopo https://x/');
      expect(value(lines, 'Armazenamento persistente')).toBe('sim');
      expect(value(lines, 'Armazenamento usado')).toBe('5.5 MB de 2048.0 MB');
    });

    it('says so when no worker controls the page and none is registered (a dev server)', async () => {
      const lines = await DiagnosticsHeaderHelper.build(source({}, {
        serviceWorker: { controller: null, getRegistration: () => Promise.resolve(undefined) },
      }));

      expect(value(lines, 'Service worker')).toBe('não está controlando a página; registro: nenhum registro');
    });

    it('reports a probe that fails and goes on to the next one', async () => {
      const lines = await DiagnosticsHeaderHelper.build(source({}, {
        storage: { persisted: () => Promise.reject(new Error('SecurityError')), estimate: () => Promise.resolve({ usage: 1048576, quota: 1048576 }) },
      }));

      expect(value(lines, 'Armazenamento persistente')).toBe('falhou (Error: SecurityError)');
      expect(value(lines, 'Armazenamento usado')).toBe('1.0 MB de 1.0 MB');
    });

    it('stops waiting for a probe that never answers', fakeAsync(() => {
      let lines: string[] = [];
      DiagnosticsHeaderHelper.build(source({}, { storage: { persisted: () => new Promise<boolean>(() => undefined) } })).then(out => lines = out);

      tick(DIAGNOSTICS.HEADER_PROBE_TIMEOUT_MS);

      expect(value(lines, 'Armazenamento persistente')).toContain('falhou (TimeoutError');
    }));
  });

  it('carries the log\'s own state and the warning about typed text', async () => {
    const lines = await DiagnosticsHeaderHelper.build(source());

    expect(value(lines, 'Registro')).toBe('ligado');
    expect(value(lines, 'Capacidade do registro')).toBe('5000 eventos');
    expect(value(lines, 'Aviso')).toContain('texto digitado');
  });

  it('never prints a query string: the route is all it has', async () => {
    const lines = await DiagnosticsHeaderHelper.build(source({ route: '/join-game#/join-game' }));

    expect(value(lines, 'Página')).toBe('/join-game#/join-game');
    expect(lines.join('\n')).not.toMatch(/room=/);
  });

  describe('on the real page', () => {

    it('reads the browser the spec runs in without throwing', async () => {
      const real = DiagnosticsHeaderHelper.sourceFromGlobals(
        { name: 'x', number: 'x', buildDate: 'x', commit: 'x' }, { capacity: 5000, enabled: true }, null);

      const lines = await DiagnosticsHeaderHelper.build(real);

      expect(value(lines, 'User agent')).toBe(navigator.userAgent);
      expect(value(lines, 'devicePixelRatio')).toBe(String(window.devicePixelRatio));
      expect(value(lines, 'Janela (innerWidth x innerHeight)')).toBe(`${window.innerWidth}x${window.innerHeight}`);
      expect(value(lines, 'Tela do convidado (framebuffer)')).toBe('o jogo ainda não iniciou');
      expect(value(lines, 'Núcleos de CPU')).toBe(String(navigator.hardwareConcurrency));
    });

    it('keeps the route and drops the query', () => {
      const real = DiagnosticsHeaderHelper.sourceFromGlobals(
        { name: 'x', number: 'x', buildDate: 'x', commit: 'x' }, { capacity: 1, enabled: false }, null);

      expect(real.route).toBe(`${location.pathname}${location.hash.split('?')[0]}`);
      expect(real.route).not.toContain('?');
    });
  });
});
