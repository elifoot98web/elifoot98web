import { Component, Injector } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { AlertController, LoadingController, Platform } from '@ionic/angular/lazy';
import { TimeoutError, TimeoutHelper } from './core/helpers/timeout.helper';
import { APP_UPDATE, STORAGE_KEY } from './core/models/constants';
import { DiagnosticsService, InstallService, LayoutHelperService, LocalStorageService, SaveStatusService } from './core/services/shared';

@Component({
    selector: 'app-root',
    templateUrl: 'app.component.html',
    styleUrls: ['app.component.scss'],
    standalone: false
})
export class AppComponent {

  constructor(platform: Platform, 
    private alertController: AlertController, 
    private loadingController: LoadingController,
    private injector: Injector,
    private updates: SwUpdate, 
    private localStorage: LocalStorageService, 
    private layoutHelperService: LayoutHelperService,
    // Injected here, and not left for the first page that logs, so the service exists from the
    // first moment of the visit: it reads `?diag=1` and the stored choice in its constructor, and
    // the window listeners that explain a tab eviction must be on before the game page is.
    private diagnostics: DiagnosticsService,
    private saveStatus: SaveStatusService,
    // Injected here for the same reason, and not left for the page that offers the install: Chromium
    // fires `beforeinstallprompt` once, early, and a listener added by a lazy page misses it.
    private install: InstallService) {

    platform.ready().then(async () => {
      console.log('Platform ready', { 
        isMobile: this.layoutHelperService.isMobile, 
        isDesktop: this.layoutHelperService.isDesktop, 
        isLandscape: this.layoutHelperService.isLandscape, 
        isPortrait: this.layoutHelperService.isPortrait
      });
      // Check if a refresh is needed
      const pendingUpdate = await this.localStorage.get<boolean>(STORAGE_KEY.PENDING_UPDATE);
      this.diagnostics.log('update', 'launch', () => ({ pendingUpdate: !!pendingUpdate, serviceWorkerEnabled: this.updates.isEnabled }));
      if(pendingUpdate) {
        console.log('Pending update detected');
        this.installUpdate()
      } else {
        this.checkForUpdates();
      }
    });    
  }
  
  async checkForUpdates() {
    if (this.updates.isEnabled) {
      this.updates.versionUpdates.subscribe(async (evt) => {
        switch(evt.type) {
          case 'VERSION_DETECTED':
            this.diagnostics.log('update', 'version detected', () => ({ hash: evt.version.hash }));
            console.info(`Downloading new app version: ${evt.version.hash}`);
            break;
          case 'VERSION_READY':
            this.diagnostics.log('update', 'version ready', () => ({ current: evt.currentVersion.hash, latest: evt.latestVersion.hash }));
            console.info(`Current app version is now available: ${evt.currentVersion.hash}`);
            this.localStorage.set(STORAGE_KEY.PENDING_UPDATE, true);
            // Show an alert to the user to inform them that a new version is available
            // and that they need to refresh the app to get the latest version
            await this.showUpdateAlert()
            break;
          case 'VERSION_INSTALLATION_FAILED':
            this.diagnostics.log('update', 'installation failed', () => ({ version: evt.version.hash, error: evt.error }));
            console.error(`Failed to install app version: ${evt.error}`);
            break;
          case 'NO_NEW_VERSION_DETECTED':
            console.info('No new version detected');
            return;
        }
      });
    }
  }

  private async showUpdateAlert() {
    this.diagnostics.log('update', 'prompt shown');
    const alert = await this.alertController.create({
      header: 'Atualização disponível',
      cssClass: 'win9x-alert alert-whitespace',
      backdropDismiss: false,
      message: 'Uma nova versão do aplicativo está disponível.\n\nVocê pode instalar agora ou optar por fazê-la na próxima inicialização.',
      buttons: [
        {
          text: 'Instalar agora',
          handler: () => {
            this.diagnostics.log('update', 'prompt answered: install now');
            this.installUpdateFromPrompt()
          }
        },
        {
          text: 'Atualizar depois',
          role: 'cancel',
          handler: () => {
            this.diagnostics.log('update', 'prompt answered: later');
          }
        }
      ]
    });
    await alert.present();
  }

  /**
   * "Instalar agora": the user asked for it, possibly with a room open. Hosting is the one
   * state a reload takes from other people, so it needs a second yes. "Atualizar depois"
   * leaves PENDING_UPDATE set, which makes the next launch install it, before any room exists.
   */
  private async installUpdateFromPrompt() {
    const hosting = await this.isHostingRoom();
    this.diagnostics.log('update', 'hosting check', () => ({ hosting }));
    if (hosting && !(await this.confirmCloseRoom())) {
      this.diagnostics.log('update', 'host kept the room; update postponed');
      return;
    }
    await this.installUpdate();
  }

  private async installUpdate() {
    this.diagnostics.log('update', 'install');
    await this.localStorage.set(STORAGE_KEY.PENDING_UPDATE, false);
    await this.saveGameBeforeReload();
    // Reload the window to force the browser to load the latest version of the app
    // This is necessary because the service worker may not be able to update the app
    // if the app is already open
    this.diagnostics.log('update', 'reloading');
    // The game page asks "leave site?" of a page with unsaved input or a room; the player has just
    // answered that question (and the save above is what it was about).
    this.saveStatus.allowExit();
    window.location.reload();
  }

  /**
   * Get the emulator's changed files into IndexedDB before the page goes away. The auto-saver
   * only persists when it sees the game's own save, so everything since then (a season played
   * through without saving, a freshly imported patch) lives only in memory and a bare reload
   * would throw it away.
   *
   * Never throws and never waits past APP_UPDATE.SAVE_TIMEOUT_MS: a persist that fails or
   * hangs costs the player what it would have saved, but an update that can never install
   * costs every later release. `saveGameFileSystem` does nothing when there is no emulator
   * (the landing page, or the launch-time install), so the same path serves both.
   */
  private async saveGameBeforeReload() {
    // `dosInstance` is undefined until the game page has started js-dos.
    const hasEmulator = typeof dosInstance !== 'undefined' && dosInstance != null;
    if (hasEmulator) {
      // Never dismissed, because the page is about to be replaced. Not awaited either: the
      // save must not queue behind an overlay animation, which a backgrounded tab stalls.
      this.loadingController
        .create({ message: 'Salvando o jogo antes de atualizar...', backdropDismiss: false })
        .then(loading => loading.present())
        .catch(() => undefined);
    }

    // A persist that lands in the middle of the game's own write stores a truncated .e98 over the
    // last good one, so a save that is in progress (one the auto-saver SAW) is waited out first,
    // for a few seconds at most. This is not the check the other paths make: it persists whatever
    // the OCR could read, because the reload is certain and what is not saved is lost for sure.
    if (hasEmulator && !(await this.saveStatus.whenGameIdle(APP_UPDATE.IDLE_WAIT_MS))) {
      this.diagnostics.log('update', 'game still saving; persisting anyway');
    }

    const began = performance.now();
    try {
      await TimeoutHelper.withTimeout(() => saveGameFileSystem(), APP_UPDATE.SAVE_TIMEOUT_MS);
      this.diagnostics.log('update', 'save before reload ok', () => ({ hasEmulator, ms: Math.round(performance.now() - began) }));
    } catch (err) {
      this.diagnostics.log('update', 'save before reload failed', () => ({ hasEmulator, ms: Math.round(performance.now() - began), timedOut: err instanceof TimeoutError, error: err }));
      if (err instanceof TimeoutError) {
        console.warn(`Saving the game took over ${err.timeoutMs} ms; updating without waiting for it.`);
      } else {
        console.error('Could not save the game before updating; updating anyway.', err);
      }
    }
  }

  /**
   * Whether this browser is broadcasting a room right now.
   *
   * The service is imported on demand, not injected: a static import would move trystero and
   * every multiplayer service out of the lazy game chunk and into the main bundle every
   * visitor downloads, to answer a question asked once per release. The import cannot fail
   * for a host, whose page already loaded that chunk. If it fails, nobody has been a host
   * in this page, so "no" is the right answer rather than a guess.
   */
  private async isHostingRoom(): Promise<boolean> {
    try {
      const { MultiplayerService } = await import('./core/services/multiplayer/multiplayer.service');
      return this.injector.get(MultiplayerService).isHosting;
    } catch (err) {
      console.warn('Could not tell whether a room is open; assuming none.', err);
      return false;
    }
  }

  private async confirmCloseRoom(): Promise<boolean> {
    const alert = await this.alertController.create({
      header: 'Fechar a sala?',
      cssClass: 'win9x-alert alert-whitespace',
      message: 'Você está hospedando uma sala. Atualizar agora vai fechar a sala e desconectar quem está assistindo.\n\nO jogo será salvo antes. Se preferir, atualize depois: a atualização será instalada na próxima inicialização.',
      buttons: [
        { text: 'Atualizar depois', role: 'cancel' },
        { text: 'Fechar sala e atualizar', role: 'confirm', cssClass: 'alert-danger' },
      ],
    });
    await alert.present();

    // Backdrop and Esc report neither role, which correctly reads as "not now".
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }
}
