import { Injectable } from '@angular/core';
import { SaveGameService } from './save-game.service';
import { AutoSaverState } from '../models/auto-saver-state';
import { DosCI } from '../models/jsdos';
import { EmulatorControlService } from './emulator-control.service';
import { Rectangle } from 'tesseract.js';
import { LoadingController } from '@ionic/angular';

@Injectable({
  providedIn: 'root'
})
export class AutoSaverService {
  private state: AutoSaverState = AutoSaverState.IDLE
  private tickIntervalMs: number = 100
  private dosCI!: DosCI
 
  constructor(
    private saveGameService: SaveGameService, 
    private emulatorControlService: EmulatorControlService,
    private loadingController: LoadingController) {
    this.state = AutoSaverState.IDLE
  }

  public start(dosCI: DosCI, tickIntervalMs: number = 100) {
    console.log('AutoSaverService started')
    this.tickIntervalMs = tickIntervalMs
    this.dosCI = dosCI
    this.state = AutoSaverState.MONITORING
    this.tick()
  }

  public stop() {
    console.log('AutoSaverService stopped')
    this.state = AutoSaverState.IDLE
  }

  private async tick() {
    switch (this.state) {
      case AutoSaverState.IDLE:
      case AutoSaverState.ERROR:
        return
      case AutoSaverState.MONITORING:
        // Check if the game is saving
        await this.monitor()
        break
      case AutoSaverState.GAME_SAVING_DETECTED:
        // Wait for the game to finish save
        await this.checkGameSaveFinished()
        break
    }
    setTimeout(() => this.tick(), this.tickIntervalMs)
  }

  private async monitor() {
    // detect if game is saving in the emulator
    // if game is saving, set state to GAME_SAVING_DETECTED
    console.time('autosaver monitor')
    let isGameSaving = await this.emulatorControlService.isGameSaving(this.dosCI)
    if (isGameSaving) {
      console.log('Game is saving...')
      const loading = await this.loadingController.create({
        message: 'Saving game...',
        backdropDismiss: false,
      })
      await loading.present()

      while(isGameSaving) {
        console.log('Game is still saving...')
        await new Promise(resolve => setTimeout(resolve, 1000))
        isGameSaving = await this.emulatorControlService.isGameSaving(this.dosCI)
      }
      await this.saveGameService.saveGame()
      console.log('Emulator data saved')
      await loading.dismiss()
    }
    console.timeEnd('autosaver monitor')
  }

  private async checkGameSaveFinished() {
    console.time('autosaver checkGameSaveFinished')
    const isGameSaving = await this.emulatorControlService.isGameSaving(this.dosCI)
    if (!isGameSaving) {
      console.log('Game save finished')
      await this.saveGameService.saveGame()
      console.log('Emulator data saved')
      
      // go back to monitoring mode if the saver is not stopped
      this.setStateProtected(AutoSaverState.MONITORING)
    }
    console.timeEnd('autosaver checkGameSaveFinished')
  }

  private setStateProtected(state: AutoSaverState) {
    if(this.state !== AutoSaverState.IDLE) {
      this.state = state
    }
  }
}
