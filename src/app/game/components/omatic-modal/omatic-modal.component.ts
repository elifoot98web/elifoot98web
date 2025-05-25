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

  /** UI elements getters */
  get infoText(): string {
    switch (this.searchState) {
      case SearchState.NEW:
        return 'Informe o valor atual que você quer alterar dentro do jogo e clique em "Buscar"';
      case SearchState.ONGOING_SEARCH:
        return 'Mude o valor dentro do jogo, atualize a caixinha de busca e clique em "Buscar" novamente\n'+
        `Tentando filtrar de ${this.currentSearch.length} resultados`;      
      case SearchState.MATCHES_FOUND:
        return `Cha-ching! Funcionou. Insira o valor que você quer colocar e clique em "Alterar"`;
      case SearchState.NO_MATCHES:
        return 'No matches found';
      case SearchState.ERROR:
        return 'An error occurred during the search';
      default:
        return '';
    }
  }

  get inputLabel(): string {
    switch (this.searchState) {
      case SearchState.NEW:
        return 'Valor atual';
      case SearchState.ONGOING_SEARCH:
        return 'Valor atualizado';
      case SearchState.MATCHES_FOUND:
        return 'Novo valor';
      default:
        return '';
    }
  }

  close(){
    this.modalController.dismiss();
  }

  searchAction() {
    switch (this.searchState) {
      case SearchState.ONGOING_SEARCH:
        this.searchNext();
        break;
      default:
        this.newSearch()
    }
  }

  async newSearch() {
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

  async searchNext() {
    await this.cheatOmaticService.continueSearch();
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
