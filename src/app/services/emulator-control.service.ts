import { Injectable } from '@angular/core';
import { DosCI } from '../models/jsdos';
import { EmulatorKeyCode, EmulatorKeyCodeHelper } from '../models/emulator-keycodes';
import { createWorker, Worker } from 'tesseract.js';

@Injectable({
  providedIn: 'root'
})
export class EmulatorControlService {
  private _worker: Worker | null = null;
  constructor() {
    this.getWorker()
  }
  
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

  public async findTextOnGameScreen(dosCI: DosCI, searchString: string): Promise<boolean> {
    // use tesseract.js to detect text on the screen
    // and return the result if the text is found
    console.time('findTextOnGameScreen');
    try {
      const imageData = await dosCI.screenshot()
      if (!imageData) {
        console.error('No image data found');
        return false;
      }
      console.time('findTextOnGameScreen: getWorker');
      const worker = await this.getWorker();
      console.timeEnd('findTextOnGameScreen: getWorker');

      // convert imagedata to base64
      console.time('findTextOnGameScreen: imageDataToImage');
      const base64 = this.imageDataToImage(imageData);
      if (!base64) {
        console.error('No base64 image data found');
        return false;
      }
      console.timeEnd('findTextOnGameScreen: imageDataToImage');

      console.time('findTextOnGameScreen: recognize');
      const result = await worker.recognize(base64)
      console.timeEnd('findTextOnGameScreen: recognize');
      
      console.time('findTextOnGameScreen: includes');
      const found = result.data.text.toLowerCase().includes(searchString.toLowerCase());
      console.timeEnd('findTextOnGameScreen: includes');
      console.timeEnd('findTextOnGameScreen');
      console.log('findTextOnGameScreen: ', result);
      
      return found
    } catch (error) {
      console.error('Error finding text on game screen:', error);
      return false;
    }
  }

  private async getWorker(): Promise<Worker> {
    if (this._worker == null) {
      this._worker = await createWorker('por')
    }
    return this._worker;
  }

  private imageDataToImage(imageData: ImageData): string {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.putImageData(imageData, 0, 0);
      return canvas.toDataURL('image/png');
    }
    return '';
  }

}
