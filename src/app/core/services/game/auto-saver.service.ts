import { Injectable } from '@angular/core';
import { SaveGameService } from './save-game.service';
import { DosCI } from '../../typings/jsdos';
import { EmulatorControlService } from './emulator-control.service';
import { LoadingController } from '@ionic/angular';
import { AUTO_SAVER } from '../../models/constants';

@Injectable({
  providedIn: 'root'
})
export class AutoSaverService {
  private state: AutoSaverState = AutoSaverState.IDLE
  private tickIntervalMs: number = AUTO_SAVER.DEFAULT_TICK_INTERVAL_MS
  private dosCI!: DosCI
  private periodicSaveInterval: any = 0

  constructor(
    private saveGameService: SaveGameService, 
    private emulatorControlService: EmulatorControlService,
    private loadingController: LoadingController) {
    this.state = AutoSaverState.IDLE
  }

  
  public start(dosCI: DosCI, tickIntervalMs: number = AUTO_SAVER.DEFAULT_TICK_INTERVAL_MS) {
    if (this.state !== AutoSaverState.IDLE) {
      console.warn('AutoSaverService is already running')
      return
    }

    console.log('AutoSaverService started with tick interval:', tickIntervalMs)
    this.tickIntervalMs = tickIntervalMs
    this.dosCI = dosCI
    this.state = AutoSaverState.MONITORING
    this.tick()
  }

  public stop() {
    console.log('AutoSaverService stopped')
    this.state = AutoSaverState.IDLE
  }

  public startPeriodicSave(periodInMs: number = AUTO_SAVER.DEFAULT_PERIODIC_SAVE_INTERVAL_MS) {
    console.log('Periodic save started with interval:', periodInMs)
    clearInterval(this.periodicSaveInterval)
    this.periodicSaveInterval = setInterval(() => {
      console.log('Periodic save triggered')
      this.saveGameService.saveGame()
    }, periodInMs)
  }

  public stopPeriodicSave() {
    console.log('Periodic save stopped')
    clearInterval(this.periodicSaveInterval)
  }

  private async tick() {
    if(this.state !== AutoSaverState.MONITORING) {
      return
    }

    try {
      await this.monitor()
    } catch (error) {
      console.error('Error in AutoSaver monitor:', error)
      this.state = AutoSaverState.ERROR
    }
      
    setTimeout(() => this.tick(), this.tickIntervalMs)
  }

  private async monitor() {
    // detect if game is saving in the emulator
    // if game is saving, set state to GAME_SAVING_DETECTED
    let isGameSaving = await this.emulatorControlService.isGameSaving(this.dosCI)
    if (isGameSaving) {
      console.log('Game is saving...')
      const waitUntil = Date.now() + AUTO_SAVER.MAX_WAITING_TIME_FOR_GAME_SAVE_DETECTED
      while(isGameSaving && waitUntil > Date.now()) {
        console.log('Game is still saving...')
        await new Promise(resolve => setTimeout(resolve, AUTO_SAVER.DEFAULT_GAME_SAVING_DETECTED_TIMEOUT_MS))
        isGameSaving = await this.emulatorControlService.isGameSaving(this.dosCI)
      }
      const loading = await this.loadingController.create({
        message: 'Salvando máquina virtual...',
        backdropDismiss: false,
      })
      await loading.present()
      await this.saveGameService.saveGame()
      console.log('Emulator data saved')
      await loading.dismiss()
    }
  }
}

enum AutoSaverState {
    IDLE = 'IDLE',
    MONITORING = 'MONITORING',
    ERROR = 'ERROR',
}
