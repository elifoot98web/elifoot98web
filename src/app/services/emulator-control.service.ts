import { Injectable } from '@angular/core';
import { DosCI } from '../models/jsdos';
import { EmulatorKeyCode, EmulatorKeyCodeHelper } from '../models/emulator-keycodes';
import { createWorker, Rectangle, Worker } from 'tesseract.js';
import { EMULATOR_CONTROL_CONFIG } from '../models/constants';

@Injectable({
  providedIn: 'root'
})
export class EmulatorControlService {
  private _worker: Worker | null = null;
  private areaOfInterest: Rectangle = EMULATOR_CONTROL_CONFIG.DEFAULT_AREA_OF_INTEREST

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
      await new Promise(resolve => setTimeout(resolve, EMULATOR_CONTROL_CONFIG.KEYSTROKE_DELAY)); 
    }
  }

  public async isGameSaving(dosCI: DosCI): Promise<boolean> {
    return this.findTextOnGameScreen(dosCI, 
      'a gravar o jogo...', 
      this.areaOfInterest, 
      EMULATOR_CONTROL_CONFIG.DEFAULT_TOLERANCE_GAME_SAVING_DETECTION)
  }

  public async findTextOnGameScreen(dosCI: DosCI, searchString: string, areaOfInterest?: Rectangle, editDistanceTolerance: number = 0): Promise<boolean> {
    // use tesseract.js to detect text on the screen
    // and return the result if the text is found
    let found = false;
    try {
      const imageData = await dosCI.screenshot()
      if (!imageData) {
        console.warn('No image data found');
        return false;
      }
      const worker = await this.getWorker();

      // convert imagedata to base64
      const base64 = this.imageDataToImage(imageData);
      if (!base64) {
        console.warn('No base64 image data found');
        return false;
      }
      const recognizeOptions: Partial<Tesseract.RecognizeOptions> = {}

      if (areaOfInterest) {
        recognizeOptions.rectangle = areaOfInterest;
      }

      const result = await worker.recognize(base64, recognizeOptions)
      const foundText = this.stringWithoutAccents(result.data.text.toLowerCase().trim())
      const searchText = this.stringWithoutAccents(searchString.toLowerCase())
      
      // if text is too short, return false
      if (foundText.length == 0 || foundText.length < searchText.length / 2) {
        return false
      }

      const distance = this.minimunDistanceWithSlidingWindow(foundText, searchText)
      const includes = foundText.includes(searchText)
      // console.log('Recognizer:', {foundText, searchText, distance, includes})
      

      if (includes || distance <= editDistanceTolerance) {
        console.log('Text found on game screen:', foundText, searchString)
        found = true  
      }
    } catch (error) {
      console.error('Error finding text on game screen:', error)
    }
    return found
  }

  private async getWorker(): Promise<Worker> {
    if (this._worker == null) {
      this._worker = await createWorker('por')
    }
    return this._worker;
  }

  private imageDataToImage(imageData: ImageData): string {
    const canvas = document.createElement('canvas');

    const scale = 1
    
    // use double the size of the image to improve recognition
    canvas.width = imageData.width * scale;
    canvas.height = imageData.height * scale;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // draw the image on the full
      ctx.putImageData(imageData, 0, 0);
      if(scale > 1) {
        ctx.scale(scale, scale);
        ctx.drawImage(canvas, 0, 0, imageData.width, imageData.height, 0, 0, imageData.width, imageData.height);
      }
      return canvas.toDataURL('image/png');
    }
    return '';
  }

  private minimunDistanceWithSlidingWindow(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    
    const smallerStr = len1 < len2 ? str1 : str2;
    const largerStr = len1 < len2 ? str2 : str1;
    
    let smallestDistance = largerStr.length + 1;

    // sliding the smaller string over the larger string
    for(let i = 0; i <= largerStr.length - smallerStr.length; i++) {
      const subStr = largerStr.substring(i, i + smallerStr.length);
      const distance = this.editDistDP(smallerStr, subStr);
      if (distance < smallestDistance) {
        smallestDistance = distance;
      }
    }

    return smallestDistance;
  }

  /**
   * Calculate the edit distance between two strings using dynamic programming.
   * @param str1 The first string.
   * @param str2 The second string.
   * @returns The edit distance between the two strings.
   */
  private editDistDP(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
  
    // Matrix to store intermediate values
    const editDistance: number[][] = Array.from({ length: m + 1 }, () =>
      Array(n + 1).fill(0)
    );
  
    // Initialize first column
    for (let i = 0; i <= m; i++) {
      editDistance[i][0] = i;
    }
  
    // Initialize first row
    for (let j = 0; j <= n; j++) {
      editDistance[0][j] = j;
    }
  
    // Fill the matrix
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          // If characters match, no cost
          editDistance[i][j] = editDistance[i - 1][j - 1];
        } else {
          // If characters are different, take min of insert, delete, replace
          editDistance[i][j] = 1 + Math.min(
            editDistance[i][j - 1],     // Insertion
            editDistance[i - 1][j],     // Deletion
            editDistance[i - 1][j - 1]  // Substitution
          );
        }
      }
    }
  
    return editDistance[m][n];
  }

  public stringWithoutAccents(str: string): string {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  
}
