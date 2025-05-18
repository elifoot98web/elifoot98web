import { Injectable } from '@angular/core';
import { DosCI } from '../models/jsdos';
import { EMULATOR_RAM_SIZE, MEMORY_SEARCH_PARAMS } from '../models/constants';

@Injectable({
  providedIn: 'root'
})
export class CheatOmaticService {
  dosCI?: DosCI

  currentResults: any[] = [];

  constructor() { }

  async startSearch(dosCI: DosCI, value: Uint8Array): Promise<number[]> {
    this.dosCI = dosCI;
    this.currentResults = [];
    console.log('#### Starting search for value:', value);
    console.log('Memory size:', EMULATOR_RAM_SIZE);
    console.log('Chunk size:', MEMORY_SEARCH_PARAMS.CHUNK_SIZE);
    console.log('Value length:', value.length);
    // Search for the value in the emulator's memory in chunks
    const chunkSize = MEMORY_SEARCH_PARAMS.CHUNK_SIZE
    const memorySize = EMULATOR_RAM_SIZE;
    const valueLength = value.length;

    for (let address = 0; address <= memorySize - valueLength; address += chunkSize) {
      const readSize = Math.min(chunkSize + valueLength - 1, memorySize - address);
      const chunk = await dosCI.readMemory(address, readSize);

      for (let offset = 0; offset <= chunk.length - valueLength; offset++) {
        let match = true;
        for (let i = 0; i < valueLength; i++) {
          if (chunk[offset + i] !== value[i]) {
            match = false;
            break;
          }
        }
        if (match) {
          this.currentResults.push(address + offset);
        }
      }
    }

    console.log('Search completed. Found ' + this.currentResults.length + ' results.');
    return this.currentResults;
  }

  async nextSearch(value: Uint8Array): Promise<number[]> {
    if (!this.dosCI) {
      console.error('DosCI is not initialized.');
      return [-1];
    }

    console.log('#### Starting next search for next value:', value);

    const valueLength = value.length;
    const newResults: number[] = [];

    for (const address of this.currentResults) {
      const chunk = await this.dosCI.readMemory(address, valueLength);
      let match = true;
      for (let i = 0; i < valueLength; i++) {
        if (chunk[i] !== value[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        newResults.push(address);
      }
    }

    this.currentResults = newResults;

    console.log('Next search completed. Found ' + this.currentResults.length + ' results.');
    return this.currentResults;
  }


}
