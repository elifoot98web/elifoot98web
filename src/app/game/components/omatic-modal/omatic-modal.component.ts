import { Component, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
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
        return 'Digite o valor atual que deseja modificar no jogo e clique em "Buscar"';
      case SearchState.ONGOING_SEARCH:
        return 'Volte para o jogo e tente modificar o valor desejado. Depois, reabra esta janela, atualize o campo de busca e clique em "Buscar" novamente\n\n' +
        `Filtrando ${this.currentSearch.length} resultados`;
      case SearchState.MATCHES_FOUND:
        return `Cha-ching! Agora é só inserir o novo valor desejado e clicar em "Alterar".\n\n(Código: 0x${this.currentSearch[0].toString(16).toUpperCase()})\nGuarde este código para facilitar futuras alterações sem precisar buscar novamente`;
      case SearchState.NO_MATCHES:
        return 'Nenhum resultado foi encontrado para o valor informado';
      case SearchState.ERROR:
        return 'Houve um erro na busca. Confira o valor informado e tente novamente';
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
    return 'Nova Busca'
  }

  get primaryButtonDisabled(): boolean {
    if(this.searchState == SearchState.MATCHES_FOUND) {
      return this.searchValue.length === 0 || isNaN(Number(this.searchValue));
    } else { 
      return this.searchValue.length === 0 || this.searchState == SearchState.NO_MATCHES || this.searchState == SearchState.ERROR;
    }
  }

  get secondaryButtonDisabled(): boolean {
    return this.searchState === SearchState.NEW
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
      await this.cheatOmaticService.firstSearch();
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
      await this.cheatOmaticService.setValue(address, value);
    } catch (error) {
      console.error('Error during setValue:', error);
    }
  }
}
