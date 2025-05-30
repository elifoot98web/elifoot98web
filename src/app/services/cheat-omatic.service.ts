import { Injectable } from '@angular/core';
import { DosCI } from '../models/jsdos';
import { EMULATOR_RAM_SIZE, Endianess, MEMORY_SEARCH_PARAMS } from '../models/constants';

@Injectable({
  providedIn: 'root'
})
export class CheatOmaticService {
  
  currentResults: number[] = [];
  searchValue: string = '';
  
  private endianess: Endianess = Endianess.LITTLE_ENDIAN;
  private dosCI?: DosCI;
  private _searchState: SearchState = SearchState.NEW;
  private inferredDataType: DataType = DataType.BYTE;

  constructor() { }

  get searchState(): SearchState {
    return this._searchState;
  }

  private set searchState(value: SearchState) {
    this._searchState = value;
  }

  resetSearch(dosCI: DosCI): void {
    this.currentResults = []; 
    this.searchState = SearchState.NEW;
    this.inferredDataType = DataType.BYTE; // Reset inferred data type to smallest unit
    this.dosCI = dosCI;
  }

  async firstSearch(): Promise<void> {
    const term = this.searchValue
    if(!this.dosCI) {
      throw new Error('DosCI is not initialized');
    }

    if(term.length === 0) {
      throw new Error('Search term is empty.');
    }

    if(term.startsWith('0x')) {
      // set matches directly to the address
      this.setMatchesDirectly(term);
      return
    }

    const searchBuffer = this.parseValueToByteArray(term)
    this.updateInferredDataType(searchBuffer);
    const results = await this.performSearch(searchBuffer);
    if(results.length == 0) {
      this.searchState = SearchState.NO_MATCHES;
      return;
    }

    if(results.length == 1 && results[0] === -1) {
      this.searchState = SearchState.ERROR;
      throw new Error(`Error during search for term: ${ term }`);
    }

    this.currentResults = results;
    if(results.length == 1) {
      this.searchState = SearchState.MATCHES_FOUND;
      return;
    } else {
      this.searchState = SearchState.ONGOING_SEARCH;
    }
  }

  async continueSearch(): Promise<void> {
    if (this.searchState !== SearchState.ONGOING_SEARCH) {
      throw new Error(`Cannot continue search. Current state: ${ this.searchState }`);
    }

    if (!this.dosCI) {
      throw new Error('DosCI is not initialized.');
    }

    const term = this.searchValue

    if (term.length === 0) {
      throw new Error('Search term is empty.');
    }

    const searchBuffer = this.parseValueToByteArray(term)
    this.updateInferredDataType(searchBuffer);
    const results = await this.performSearch(searchBuffer);
    if (results.length == 0) {
      this.searchState = SearchState.NO_MATCHES;
      return;
    }

    if (results.length == 1 && results[0] === -1) {
      this.searchState = SearchState.ERROR;
      throw new Error(`Error during search for term: ${ term }`);
    }
    const oldLength = this.currentResults.length;
    this.currentResults = this.currentResults.filter(result => results.includes(result));
    const newLength = this.currentResults.length;
    if (this.currentResults.length == 0) {
      this.searchState = SearchState.NO_MATCHES;
      return;
    } else if (this.currentResults.length == 1) {
      this.searchState = SearchState.MATCHES_FOUND;
    }
  }

  async setValue(address: number, value: string): Promise<void> {
    if (!this.dosCI) {
      throw new Error('DosCI is not initialized.');
    }

    let parsedValue = this.parseValueToByteArray(value);
    this.updateInferredDataType(parsedValue);
    if(this.inferredDataType < DataType.STRING && parsedValue.length < this.inferredDataType) {
      // complete the buffer with zeros to match the inferred data type
      const paddedValue = new Uint8Array(this.inferredDataType);
      
      if (this.endianess == Endianess.BIG_ENDIAN) {
        paddedValue.set(parsedValue, this.inferredDataType - parsedValue.length);
      } else {
        paddedValue.set(parsedValue, 0);
      }
      parsedValue = paddedValue;
    }
    try {
      await this.dosCI.writeMemory(address, parsedValue);
    } catch (error) {
      console.error('Error setting value:', error);
      throw error;
    }
  }

  private setMatchesDirectly(addressHex: string) {
    const address = parseInt(addressHex, 16);
    if (isNaN(address) || address < 0 || address >= EMULATOR_RAM_SIZE) {
      console.error('Invalid address:', addressHex);
      this.searchState = SearchState.NO_MATCHES;
      return;
    }
    this.currentResults = [address];
    this.searchState = SearchState.MATCHES_FOUND;
    this.searchValue = '';
  }

  private async performSearch(value: Uint8Array): Promise<number[]> {
    const dosCI = this.dosCI
    if (!dosCI) {
      console.error('DosCI is not initialized.');
      return [-1];
    }

    if (value.length === 0) {
      console.error('Search value is empty.');
      return [-1];
    }

    const currentResults = [];
    
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
          currentResults.push(address + offset);
        }
      }
    }

    return currentResults;
  }

  private parseValueToByteArray(term: string): Uint8Array {
    let value: Uint8Array;
    if (term.startsWith('0x')) {
      // Hexadecimal string
      let hexString = term.slice(2);  
      if (hexString.length % 2 !== 0) {  
        hexString = '0' + hexString; // Pad with leading zero if length is odd  
      }  
      value = new Uint8Array(hexString.match(/../g)?.map(byte => parseInt(byte, 16)) || []);
    } else if (!isNaN(Number(term))) {
      // Integer
      const intValue = parseInt(term);
      // Determine the minimum number of bytes needed
      const byteLength = Math.ceil(Math.log2(intValue + 1) / 8) || 1;
      value = new Uint8Array(byteLength);
      for (let i = 0; i < byteLength; i++) {
        value[this.endianess === Endianess.LITTLE_ENDIAN ? i : byteLength - 1 - i] = (intValue >> (8 * i)) & 0xFF;
      }
    } else {
      // String
      value = new TextEncoder().encode(term);
    }
    return value;
  }

  private updateInferredDataType(value: Uint8Array): void {
    let valueDataType: DataType = DataType.BYTE;
    if (value.length === 1) {
      valueDataType = DataType.BYTE;
    } else if (value.length === 2) {
      valueDataType = DataType.WORD;
    } else if (value.length < 5) {
      valueDataType = DataType.DWORD;
    } else {
      valueDataType = DataType.STRING; // Default to string for larger values
    }

    if(valueDataType > this.inferredDataType) { // Only update if the new type is larger
      this.inferredDataType = valueDataType;
    }
  }
}

export enum SearchType {
  STRING,
  INTEGER
}

export enum SearchState {
  NEW,
  ONGOING_SEARCH,
  MATCHES_FOUND,
  NO_MATCHES,
  ERROR
}

export enum DataType {
  BYTE = 1,
  WORD = 2,
  DWORD = 4,
  STRING = 5 // from 5 bytes and up
}