import { Component, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Endianess } from 'src/app/models/constants';
import { CheatOmaticService } from 'src/app/services/cheat-omatic.service';
import { LayoutHelperService } from 'src/app/services/layout-helper.service';

@Component({
  selector: 'app-omatic-modal',
  templateUrl: './omatic-modal.component.html',
  styleUrls: ['./omatic-modal.component.scss'],
  standalone: false,
})
export class OmaticModalComponent implements OnInit {

  searchValue: string = '';
  endianess: Endianess = Endianess.LITTLE_ENDIAN;
  currentSearch: number[] = [];
  constructor(private modalController:ModalController, 
    private layoutHelperService: LayoutHelperService,
    private cheatOmaticService: CheatOmaticService) { }

  ngOnInit() {}
  
  get isMobile(): boolean {
    return this.layoutHelperService.isMobile
  }

  close(){
    this.modalController.dismiss();
  }

  async search() {
    // convert the search value to a Uint8Array. If it's an integer or hex string, convert it to a byte array
    let value: Uint8Array;
    if (this.searchValue.startsWith('0x')) {
      // Hexadecimal string
      const hexString = this.searchValue.slice(2);
      value = new Uint8Array(hexString.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
    } else if (!isNaN(Number(this.searchValue))) {
      // Integer
      const intValue = parseInt(this.searchValue);
      // Determine the minimum number of bytes needed
      const byteLength = Math.ceil(Math.log2(intValue + 1) / 8) || 1;
      value = new Uint8Array(byteLength);
      for (let i = 0; i < byteLength; i++) {
        value[this.endianess === Endianess.LITTLE_ENDIAN ? i : byteLength - 1 - i] = (intValue >> (8 * i)) & 0xFF;
      }
    } else {
      // String
      value = new TextEncoder().encode(this.searchValue);
    }
    console.log('Value to search:', value);
    
    if(this.currentSearch.length === 0) {
      const ci = await dosInstance.ciPromise;
      if (!ci) {
        console.error('DosCI is not initialized.');
        return;
      }
      const results = await this.cheatOmaticService.startSearch(ci, value)
      this.currentSearch = results;
      console.log('Search results:', results);
    } else {
      const results = await this.cheatOmaticService.nextSearch(value)
      this.currentSearch = results;
      console.log('Next search results:', results);
    }
    
  }
}
