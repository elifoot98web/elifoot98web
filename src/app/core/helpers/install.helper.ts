/**
 * What the app can offer about being installed:
 * - `prompt`: the browser handed over its install prompt (`beforeinstallprompt`, Chromium only), so
 *   one tap installs.
 * - `ios`: iOS or iPadOS in a browser, which has no prompt: the person has to use the share sheet, so
 *   the app shows how.
 * - `installed`: already running as an installed app (or just installed): nothing is offered.
 * - `none`: nothing to offer here (Firefox, desktop Safari, a Chromium that has not made the prompt available).
 */
export type InstallMode = 'none' | 'prompt' | 'ios' | 'installed';

export class InstallHelper {

  /**
   * Whether the page runs as an installed app: the `standalone` display mode (what the manifest asks
   * for) or `navigator.standalone` (iOS's own flag, which the media query also reports from iOS 13 on,
   * but not on every version).
   *
   * **The `android-app://` referrer is not asked, on purpose.** It marks a trusted web activity, which
   * this app is not shipped as, and Chrome on Android also sets it on an ordinary tab opened from
   * another app (the Google app, Gmail, a messenger) for the whole life of the document: reading it as
   * "installed" hid the install offer from exactly the people arriving from a link. An installed copy
   * of this manifest always matches the display mode. Re-add the test only if the app is ever wrapped
   * as a TWA.
   *
   * **`(display-mode: fullscreen)` is not asked, on purpose.** It also matches whenever the Fullscreen
   * API has the page fullscreen, which is what the "Tela cheia" entry does in a browser tab: measured,
   * pressing it flipped the mode to `installed` and took the install entry away until the player left
   * fullscreen. The manifest says `standalone`, so an installed copy always matches that one.
   */
  static isStandalone(state: { displayStandalone: boolean; navigatorStandalone: boolean | undefined }): boolean {
    return state.displayStandalone || state.navigatorStandalone === true;
  }

  /**
   * iPhone, iPod and iPad. An iPad asks for the desktop site by default, and its user agent then says
   * Macintosh: the only tell is a Mac that has a touch screen, which no Mac has.
   */
  static isIos(state: { userAgent: string; platform: string; maxTouchPoints: number }): boolean {
    if (/iPhone|iPad|iPod/.test(state.userAgent)) return true;
    return /Macintosh|MacIntel/.test(`${state.userAgent} ${state.platform}`) && state.maxTouchPoints > 1;
  }

  static mode(state: { standalone: boolean; hasPrompt: boolean; ios: boolean }): InstallMode {
    if (state.standalone) return 'installed';
    if (state.hasPrompt) return 'prompt';
    if (state.ios) return 'ios';
    return 'none';
  }

  /** The menu entry's label, or null when the entry is not offered. */
  static menuLabel(mode: InstallMode): { title: string; subtitle: string } | null {
    switch (mode) {
      case 'prompt':
        return { title: 'Instalar o app', subtitle: 'Abre em tela cheia, sem a barra do navegador' };
      case 'ios':
        return { title: 'Instalar o app', subtitle: 'Adicionar à Tela de Início' };
      default:
        return null;
    }
  }

  /** The install banner's words. */
  static bannerMessage(mode: InstallMode): string {
    return mode === 'ios'
      ? 'Quer o Elifoot 98 na Tela de Início? Ele abre em tela cheia, sem a barra do navegador.'
      : 'Quer instalar o Elifoot 98? Ele abre em tela cheia, sem a barra do navegador.';
  }

  /**
   * The how-to for iOS, which has no install prompt, and the warning that matters more than the steps:
   * an app on the Home Screen keeps its own browser storage, apart from Safari's, so the saves made in
   * Safari are not in it. The way across is the backup.
   */
  static iosHowTo(): { header: string; message: string } {
    return {
      header: 'Adicionar à Tela de Início',
      message:
        '1. Toque em Compartilhar (o quadrado com a seta para cima).\n' +
        '2. Escolha Adicionar à Tela de Início.\n' +
        '3. Toque em Adicionar.\n' +
        '\n' +
        'Atenção: o app da Tela de Início guarda os jogos salvos separado do navegador, e os que estão aqui não aparecem lá. ' +
        'Antes de instalar, use Exportar jogos salvos. Depois de abrir o app, use Importar jogos salvos.',
    };
  }
}
