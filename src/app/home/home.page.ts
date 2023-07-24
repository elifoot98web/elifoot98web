import { Component } from '@angular/core';
import { AlertController, LoadingController } from '@ionic/angular';
import { MaskitoElementPredicateAsync, MaskitoOptions } from '@maskito/core';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
})
export class HomePage {
  
  regType: number = 0;
  senha: string = '';
  contraSenha: string = '';
  tipoRegistro = [
    { id: 1, nome: 'Registro simples' },
    { id: 2, nome: 'Registro VIP' },
    { id: 3, nome: 'Registro Super-VIP' },
    { id: 4, nome: 'Registro para amigo dos autores' },
    { id: 5, nome: 'Registro para grande amigo dos autores' },
    { id: 6, nome: 'Registro para experimentadores' },
    { id: 7, nome: 'Registro experimentador especial' },
    { id: 8, nome: 'Registro para autor 1' },
    { id: 9, nome: 'Registro para autor 2' },
  ]
  
  readonly senhaMask: MaskitoOptions = {
    mask: [
      /\d/, /\d/, /\d/, '-', /\d/, /\d/, /\d/, '-', /\d/, /\d/, /\d/, '-', /\d/, /\d/, /\d/, '-', /\d/, /\d/, /\d/, '-', /\d/, /\d/, /\d/
    ],
  };
  
  readonly maskPredicate: MaskitoElementPredicateAsync = async (el) => (el as HTMLIonInputElement).getInputElement();

  constructor(private loadingCtrl: LoadingController, private alertController: AlertController) {}

  async gerarContraSenha() {
    const loading = await this.loadingCtrl.create({
      message: 'Gerando contra-senha...',
      backdropDismiss: false
    });
    await loading.present();
    try {
    const contraSenha = await elikgMain(this.senha, this.regType.toString());
    console.log({ contraSenha });
    this.contraSenha = contraSenha;
    await loading.dismiss();

    } catch(e) {
      await loading.dismiss();
      const alert = await this.alertController.create({
        header: 'Erro',
        message: 'Não foi possível gerar a contra-senha. Tente novamente. \nSe o problema persistir, recarregue a página.',
        buttons: ['OK']
      });
      await alert.present();
    } 
  }

  get canGenerateKey(): boolean {
    return this.regType > 0 && this.isSenhaWellFormed;
  }

  get isSenhaWellFormed(): boolean {
    let parts = this.senha.split('-');
    
    if(parts.length != 6) {
      return false;
    } else {
      for(let part of parts) {
        if(part.length != 3) {
          return false;
        } else {
          for(let char of part) {
            if(char < '0' || char > '9') {
              return false;
            }
          }
        }
      }
    }

    return true
  }

}
