import { Component } from '@angular/core';
import { AlertController, ModalController } from '@ionic/angular';
import { DosCI } from 'src/app/models/jsdos';
import { SavedCheat, SearchState } from 'src/app/models/omatic-models';
import { CheatOmaticService } from 'src/app/services/cheat-omatic.service';
import { LayoutHelperService } from 'src/app/services/layout-helper.service';

@Component({
  selector: 'app-omatic-modal',
  templateUrl: './omatic-modal.component.html',
  styleUrls: ['./omatic-modal.component.scss'],
  standalone: false,
})
export class OmaticModalComponent {
  SearchState = SearchState;

  constructor(private modalController:ModalController,
    private alertController: AlertController,
    private layoutHelperService: LayoutHelperService,
    private cheatOmaticService: CheatOmaticService) { }
  
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
    return this.cheatOmaticService.inputValue;
  }

  set searchValue(value: string) {
    this.cheatOmaticService.inputValue = value;
  }

  get savedCheats(): SavedCheat[] {
    return this.cheatOmaticService.savedCheats;
  }

  get foundMatchHex(): string {
    return `0x${this.currentSearch[0].toString(16).toUpperCase()}`
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
      await this.cheatOmaticService.setValue();
    } catch (error) {
      console.error('Error during setValue:', error);
    }
  }

  async showSavedCheats() {
    const alert = await this.alertController.create({
      header: 'Cheats Salvos',
      buttons: [
        {
          text: 'Excluir',
          role: 'destructive',
          cssClass: 'alert-danger',          
          handler: async (cheat: SavedCheat) => {
            if(cheat) {
              await this.deleteCheat(cheat);
            }
          }
        },
        {
          text: 'Cancelar',
          role: 'cancel',
        },
        {
          text: 'Carregar Cheat',
          handler: async (cheat: SavedCheat) => {
            await this.selectSavedCheat(cheat);
          }
        }
      ],
      inputs: this.cheatOmaticService.savedCheats.map((cheat, index) => {
        return {
          type: 'radio',
          label: `${cheat.name} (${cheat.hexAddress})`,
          value: cheat,
          checked: index === 0, // Select the first cheat by default
        }
      })
      
    })

    await alert.present();
  }

  async saveCheatDialog() {
    const alert = await this.alertController.create({
      header: `Salvar Cheat (${this.foundMatchHex})`,
      message: 'Dê um nome para este cheat.\n\nObservação: O cheat não é salvo permanentemente entre sessões, pois o endereço de memória muda a cada vez que o jogo é iniciado.',
      cssClass: 'alert-whitespace',
      inputs: [
      {
        name: 'cheatName',
        type: 'text',
        placeholder: 'Nome do Cheat',
        attributes: {
        maxlength: 25,
        minlength: 1,
        }
      }
      ],
      buttons: [
      {
        text: 'Cancelar',
        role: 'cancel',
      },
      {
        text: 'Salvar',
        handler: async (data) => {
        if (data?.cheatName?.trim().length > 0) {
          await this.cheatOmaticService.saveCheat(data.cheatName);
        } else {
          const alert = await this.alertController.create({
          header: 'Erro',
          message: 'O nome do cheat não pode estar vazio.',
          buttons: ['OK']
          });
          await alert.present();
        }
        }
      }
      ]
    });
    await alert.present();
  }

  async selectSavedCheat(cheat: SavedCheat) {
    try {
      const dosCI: DosCI | undefined = await dosInstance.ciPromise;
      if (!dosCI) {
        throw new Error('DosCI is not initialized');
      }
      this.cheatOmaticService.resetSearch(dosCI);
      this.cheatOmaticService.selectSavedCheat(cheat)
    } catch (error) {
      console.error('Error during selectValueSavedMemoryAddress:', error);
    }
  }

  async deleteCheat(cheat: SavedCheat) {
    try {
      await this.cheatOmaticService.deleteSavedCheat(cheat);
    } catch (error) {
      console.error('Error deleting saved cheat:', error);
    }
    const alert = await this.alertController.create({
      message: `Cheat "${cheat.name}" excluído`,
      buttons: ['OK']
    });
    await alert.present();
  }
}
