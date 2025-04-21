import { Injectable } from '@angular/core';
import { DosCI } from '../models/jsdos';
import { EmulatorKeyCode, EmulatorKeyCodeHelper } from '../models/emulator-keycodes';

@Injectable({
  providedIn: 'root'
})
export class EmulatorControlService {

  constructor() { }

  public sendKey(dosCI: DosCI & any, ...keyCodes: EmulatorKeyCode[]): void {
    if(dosCI && dosCI.simulateKeyPress) {
      dosCI.simulateKeyPress(...keyCodes);
    }
  }

  public async sendString(dosCI: DosCI & any, str: string): Promise<void> {
    if(!dosCI || !dosCI.simulateKeyPress || !str) {
      return;
    }
    
    const individualStrokes = str.split('').map((char) => {
      const keyStroke = EmulatorKeyCodeHelper.getKeyStrokeForCharacter(char);
      if (keyStroke.length === 0) {
        return [EmulatorKeyCode.KBD_space]; // Default to space for unsupported characters
      }
      return EmulatorKeyCodeHelper.getKeyStrokeForCharacter(char);
    })

    // iterate over the array of key strokes and send them to the emulator
    for (const keyStroke of individualStrokes) {
      this.sendKey(dosCI, ...keyStroke);
      // Add a small delay between key presses for the emulator to process them
      await new Promise(resolve => setTimeout(resolve, 30)); 
    }
  }
}
