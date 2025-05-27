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
    console.log('New search:', { term, searchBuffer });

    const results = await this.performSearch(searchBuffer);
    if(results.length == 0) {
      this.searchState = SearchState.NO_MATCHES;
      console.log('No matches found for term:', term);
      return;
    }

    if(results.length == 1 && results[0] === -1) {
      this.searchState = SearchState.ERROR;
      throw new Error(`Error during search for term: ${ term }`);
    }

    this.currentResults = results;
    if(results.length == 1) {
      this.searchState = SearchState.MATCHES_FOUND;
      console.log('Single match found for term:', term, 'at address:', results[0]);
      return;
    } else {
      this.searchState = SearchState.ONGOING_SEARCH;
    }
    console.log('Search completed. Found ' + results.length + ' results.');
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
    console.log('Continuing search:', {term, searchBuffer});

    const results = await this.performSearch(searchBuffer);
    if (results.length == 0) {
      this.searchState = SearchState.NO_MATCHES;
      console.log('No matches found for term:', term);
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
      console.log('No matches found for term:', term);
      return;
    } else if (this.currentResults.length == 1) {
      this.searchState = SearchState.MATCHES_FOUND;
      console.log('Single match found for term:', term, 'at address:', this.currentResults[0]);
    }

    console.log(`Search continued. Found ${this.currentResults.length} results. (from ${oldLength} to ${newLength})`);
  }

  async setValue(address: number, value: string): Promise<void> {
    if (!this.dosCI) {
      throw new Error('DosCI is not initialized.');
    }

    const parsedValue = this.parseValueToByteArray(value);
    console.log('Setting value at address:', address, 'to:', parsedValue);

    try {
      await this.dosCI.writeMemory(address, parsedValue);
      console.log('Value set successfully.');
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
    console.log('Directly set match to address:', address);
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
          currentResults.push(address + offset);
        }
      }
    }

    console.log('Search completed. Found ' + currentResults.length + ' results.');
    return currentResults;
  }

  private parseValueToByteArray(term: string): Uint8Array {
    let value: Uint8Array;
    if (term.startsWith('0x')) {
      // Hexadecimal string
      const hexString = term.slice(2);
      value = new Uint8Array(hexString.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
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
