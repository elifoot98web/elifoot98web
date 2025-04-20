import { Injectable } from '@angular/core';
import { DosCI } from '../models/jsdos';
import { EmulatorKeyCode } from '../models/emulator-keycodes';

@Injectable({
  providedIn: 'root'
})
export class EmulatorControlService {

  constructor() { }

  public sendKey(dosCI: DosCI & any, keyCode: EmulatorKeyCode): void {
    if(dosCI && dosCI.simulateKeyPress) {
      dosCI.simulateKeyPress(keyCode);
    }
  }

  public sendString(dosCI: DosCI & any, str: string): void {
    // TODO: transform string into separate key codes, accounting for the symbols, new lines, capitalization, etc, with the limitations of the EmulatorKeyCode dataset.
    
  }
}
