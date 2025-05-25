import { Component, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Endianess } from 'src/app/models/constants';
import { DosCI } from 'src/app/models/jsdos';
import { CheatOmaticService, SearchState } from 'src/app/services/cheat-omatic.service';
import { LayoutHelperService } from 'src/app/services/layout-helper.service';

@Component({
  selector: 'app-omatic-modal',
  templateUrl: './omatic-modal.component.html',
  styleUrls: ['./omatic-modal.component.scss'],
  standalone: false,
})
export class OmaticModalComponent implements OnInit {
  SearchState = SearchState;

  endianess: Endianess = Endianess.LITTLE_ENDIAN;
  constructor(private modalController:ModalController, 
    private layoutHelperService: LayoutHelperService,
    private cheatOmaticService: CheatOmaticService) { }

  ngOnInit() {}
  
  get isMobile(): boolean {
    return this.layoutHelperService.isMobile
  }

  get currentSearch(): number[] {
    return this.cheatOmaticService.currentResults;
  }

  get searchState(): SearchState {
    return this.cheatOmaticService.searchState;
  }

  get searchValue(): string {
    return this.cheatOmaticService.searchValue;
  }

  set searchValue(value: string) {
    this.cheatOmaticService.searchValue = value;
  }

  close(){
    this.modalController.dismiss();
  }

  async search() {
    try {
      const dosCI: DosCI | undefined = await dosInstance.ciPromise;
      if (!dosCI) {
        throw new Error('DosCI is not initialized');
      }
      await this.cheatOmaticService.newSearch(dosCI);
    } catch (error) {
      console.error('Error during search:', error);
    }
  }

  async setValue() {
    try {
      const value = this.searchValue;
      const address = this.currentSearch[0];
      this.cheatOmaticService.setValue(address, value);
    } catch (error) {
      console.error('Error during setValue:', error);
    }
  }
}
