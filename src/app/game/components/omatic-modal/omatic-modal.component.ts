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
        return 'Mude o valor dentro do jogo, atualize a caixinha de busca e clique em "Buscar" novamente\n\n'+
        `Tentando filtrar de ${this.currentSearch.length} resultados`;      
      case SearchState.MATCHES_FOUND:
        return `Cha-ching! Funcionou. Insira o valor que você quer colocar e clique em "Alterar\n\n(Código: 0x${this.currentSearch[0].toString(16).toUpperCase()})`;
      case SearchState.NO_MATCHES:
        return 'Infelizmente não foi possível filtrar nenhum resultado para o valor informado';
      case SearchState.ERROR:
        return 'Ocorreu um erro durante a busca. Verifique o valor informado e tente novamente';
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

  get primaryButtonText(): string {
    if(this.searchState == SearchState.MATCHES_FOUND) {
      return 'Alterar';
    } else {
      return 'Buscar';
    }
  }

  get secondaryButtonText(): string {
    return "Nova Busca"
  }

  get primaryButtonDisabled(): boolean {
    if(this.searchState == SearchState.MATCHES_FOUND) {
      return this.searchValue.length === 0 || isNaN(Number(this.searchValue));
    } else { 
      return this.searchValue.length === 0 || this.searchState == SearchState.NO_MATCHES || this.searchState == SearchState.ERROR;
    }
  }

  close(){
    this.modalController.dismiss();
  }

  async primaryButtonAction() {
    switch (this.searchState) {
      case SearchState.MATCHES_FOUND:
        await this.setValue();
        break;
      default:
        await this.searchAction();
    }
  }

  async secondaryButtonAction() {
    try {
      const dosCI: DosCI | undefined = await dosInstance.ciPromise;
      if (!dosCI) {
        throw new Error('DosCI is not initialized');
      }
      this.cheatOmaticService.resetSearch(dosCI);
    } catch (error) {
      console.error('Error during reset search:', error);
    }
  }

  async searchAction() {
    switch (this.searchState) {
      case SearchState.ONGOING_SEARCH:
        await this.searchNext();
        break;
      default:
        await this.newSearch()
    }
  }

  async newSearch() {
    try {
      const dosCI: DosCI | undefined = await dosInstance.ciPromise;
      if (!dosCI) {
        throw new Error('DosCI is not initialized');
      }
      this.cheatOmaticService.resetSearch(dosCI);
      this.cheatOmaticService.firstSearch();
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
