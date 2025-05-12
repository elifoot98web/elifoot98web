import { Component, HostListener } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { AlertController, Platform } from '@ionic/angular';
import { LocalStorageService } from './services/local-storage.service';
import { STORAGE_KEY } from './models/constants';
import { LayoutHelperService } from './services/layout-helper.service';

@Component({
    selector: 'app-root',
    templateUrl: 'app.component.html',
    styleUrls: ['app.component.scss'],
    standalone: false
})
export class AppComponent {

  @HostListener('window:resize', ['$event'])
  onWindowResize() {
    this.layoutHelperService.onWindowResize();
  }

  constructor(platform: Platform, 
    private alertController: AlertController, 
    private updates: SwUpdate, 
    private localStorage: LocalStorageService, 
    private layoutHelperService: LayoutHelperService) {

    platform.ready().then(async () => {
      // Initialize the layout helper service
      this.onWindowResize()
      // Check if a refresh is needed
      const pendingUpdate = await this.localStorage.get<boolean>(STORAGE_KEY.PENDING_UPDATE);
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
            console.info(`Downloading new app version: ${evt.version.hash}`);
            break;
          case 'VERSION_READY':
            console.info(`Current app version is now available: ${evt.currentVersion.hash}`);
            this.localStorage.set(STORAGE_KEY.PENDING_UPDATE, true);
            // Show an alert to the user to inform them that a new version is available
            // and that they need to refresh the app to get the latest version
            await this.showUpdateAlert()
            break;
          case 'VERSION_INSTALLATION_FAILED':
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
    const alert = await this.alertController.create({
      header: 'Atualização disponível',
      cssClass: 'alert-whitespace',
      backdropDismiss: false,
      message: 'Uma nova versão do aplicativo está disponível.\n\nVocê pode instalar agora ou optar por fazê-la na próxima inicialização.',
      buttons: [
        {
          text: 'Instalar agora',
          handler: () => {
            this.installUpdate()
          }
        },
        {
          text: 'Atualizar depois',
          role: 'cancel',
        }
      ]
    });
    await alert.present();
  }

  private async installUpdate() {
    // Reload the window to force the browser to load the latest version of the app
    // This is necessary because the service worker may not be able to update the app
    // if the app is already open
    await this.localStorage.set(STORAGE_KEY.PENDING_UPDATE, false);
    window.location.reload();
  }
}


