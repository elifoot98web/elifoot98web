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

    // support only IBM PC KEYBOARD LAYOUT
    const supportedCharsRegex = /^[a-zA-Z0-9!@#$%^&*()_+{}|:"<>?`~\[\]\\;',./-=\n\r\s]+$/;

    // replace unsupported characters with an empty space
    const sanitizedStr = str.split('').map((char) => { 
      if (supportedCharsRegex.test(char)) {
        return char;
      } else {
        console.warn(`Unsupported character: ${char}`);
        return ' '; // replace with a space or any other placeholder
      }
     }).join('');
    
    const individualStrokes = sanitizedStr.split('').map((char) => {
      return EmulatorKeyCodeHelper.getKeyStrokeForCharacter(char);
    })

    // iterate over the array of key strokes and send them to the emulator
    for (const keyStroke of individualStrokes) {
      this.sendKey(dosCI, ...keyStroke);
      // Add a small delay between key presses for the emulator to process them
      await new Promise(resolve => setTimeout(resolve, 80)); 
    }
  }
}
