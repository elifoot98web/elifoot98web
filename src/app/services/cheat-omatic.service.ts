import { Injectable } from '@angular/core';
import { DosCI } from '../models/jsdos';
import { EMULATOR_RAM_SIZE, Endianness, MEMORY_SEARCH_PARAMS, STORAGE_KEY } from '../models/constants';
import { LocalStorageService } from './local-storage.service';
import { DataType, SavedCheat, SearchState } from '../models/omatic-models';

@Injectable({
  providedIn: 'root'
})
export class CheatOmaticService {
  
  currentResults: number[] = [];
  searchValue: string = '';
  savedCheats: SavedCheat[] = [];
  private endianness: Endianness = Endianness.LITTLE_ENDIAN;
  private dosCI?: DosCI;
  private _searchState: SearchState = SearchState.NEW;
  private inferredDataType: DataType = DataType.BYTE;

  constructor(private storageService: LocalStorageService) {
    this.loadSavedCheats();
  }

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
      this.setMatchDirectly(term);
      return
    }

    const searchBuffer = this.parseValueToByteArray(term)
    this.updateInferredDataType(searchBuffer);
    const results = await this.performSearch(searchBuffer);
    if(results.length === 0) {
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
    
    // Filter current results to keep only those that match the new search results
    this.currentResults = this.currentResults.filter(result => results.includes(result));
    if (this.currentResults.length == 0) {
      this.searchState = SearchState.NO_MATCHES;
      return;
    } else if (this.currentResults.length == 1) {
      this.searchState = SearchState.MATCHES_FOUND;
    }
  }

  async setValue(): Promise<void> {
    if (!this.dosCI) {
      throw new Error('DosCI is not initialized.');
    }

    if (this.searchState !== SearchState.MATCHES_FOUND || this.searchValue.length === 0 || this.currentResults.length !== 1) {
      throw new Error(`Cannot set value. Inconsistent state ${ this.searchState }, searchValue: ${ this.searchValue }, currentResults length: ${ this.currentResults.length }`);
    }

    const value = this.searchValue;
    const address = this.currentResults[0];

    let parsedValue = this.parseValueToByteArray(value);
    this.updateInferredDataType(parsedValue);
    if(this.inferredDataType < DataType.STRING && parsedValue.length < this.inferredDataType) {
      // complete the buffer with zeros to match the inferred data type
      const paddedValue = new Uint8Array(this.inferredDataType);
      
      if (this.endianness == Endianness.BIG_ENDIAN) {
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

  setMatchDirectly(addressHex: string) {
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

    
    // Search for the value in the emulator's memory in chunks
    const chunkSize = MEMORY_SEARCH_PARAMS.CHUNK_SIZE
    const memorySize = EMULATOR_RAM_SIZE;
    const valueLength = value.length;
    
    const foundResults = [];
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
          foundResults.push(address + offset);
        }
      }
    }

    return foundResults;
  }

  async loadSavedCheats(): Promise<void> {
    try {
      const savedCheats = await this.storageService.get<SavedCheat[]>(STORAGE_KEY.SAVED_CHEATS)
      if (savedCheats) {
        this.savedCheats = savedCheats;
      } else {
        this.savedCheats = [];
      }
    }
    catch (error) {
      console.error('Error loading saved cheats:', error);
    }
  }

  async saveCheat(name: string): Promise<void> {
    const address = this.currentResults[0];
    const dataType = this.inferredDataType;

    let hexAddress = address.toString(16);
    if(hexAddress.length % 2 !== 0) {
      hexAddress = '0' + hexAddress; // Pad with leading zero if length is odd
    }
    
    const savedCheat: SavedCheat = {
      name: name,
      hexAddress: `0x${hexAddress}`,
      dataType: dataType
    }

    // Check if a cheat with the same address already exists
    const existingCheatIndex = this.savedCheats.findIndex(cheat => cheat.hexAddress === savedCheat.hexAddress && cheat.dataType === savedCheat.dataType);
    if (existingCheatIndex !== -1) {
      // Update existing cheat
      this.savedCheats[existingCheatIndex] = savedCheat;
      console.log(`Updated existing cheat: ${savedCheat.name}`);
    } else {
      // Add new cheat
      console.log(`Saving new cheat: ${savedCheat.name}`);
      this.savedCheats.push(savedCheat);
    }
    
    try {
      await this.storageService.set<SavedCheat[]>(STORAGE_KEY.SAVED_CHEATS, this.savedCheats);
    }
    catch (error) {
      console.error('Error saving cheat:', error);
    }
  }

  selectSavedCheat(savedCheat: SavedCheat): void {
    if (!this.dosCI) {
      throw new Error('DosCI is not initialized.');
    }

    this.resetSearch(this.dosCI);
    this.inferredDataType = savedCheat.dataType;
    this.setMatchDirectly(savedCheat.hexAddress);
  }

  async deleteSavedChear(savedCheat: SavedCheat): Promise<void> {
    const index = this.savedCheats.findIndex(cheat => cheat.hexAddress === savedCheat.hexAddress && cheat.name === savedCheat.name && cheat.dataType === savedCheat.dataType);
    
    if (index !== -1) {
      this.savedCheats.splice(index, 1);
      try {
        await this.storageService.set<SavedCheat[]>(STORAGE_KEY.SAVED_CHEATS, this.savedCheats);
      } catch (error) {
        console.error('Error deleting saved cheat:', error);
      }
    } else {
      console.warn('Saved cheat not found:', savedCheat);
    }
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
        value[this.endianness === Endianness.LITTLE_ENDIAN ? i : byteLength - 1 - i] = (intValue >> (8 * i)) & 0xFF;
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
