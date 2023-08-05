import { Component, OnInit } from '@angular/core';
import { LoadingController, AlertController, ToastController } from '@ionic/angular';
import { MaskitoOptions, MaskitoElementPredicateAsync } from '@maskito/core';

@Component({
  selector: 'app-ativador',
  templateUrl: './ativador.page.html',
  styleUrls: ['./ativador.page.scss'],
})
export class AtivadorPage {
  regType: { id: number, nome: string } = { id: 0, nome: '' };
  senha: string = '';
  contraSenha: string = '';
  tipoRegistro = [
    { id: 1, nome: 'Simples' },
    { id: 2, nome: 'VIP' },
    { id: 3, nome: 'Super-VIP' },
    { id: 4, nome: 'Amigo dos autores' },
    { id: 5, nome: 'Grande amigo dos autores' },
    { id: 6, nome: 'Experimentadores' },
    { id: 7, nome: 'Experimentador especial' },
    { id: 8, nome: 'Autor 1' },
    { id: 9, nome: 'Autor 2' },
  ]
  
  readonly senhaMask: MaskitoOptions = {
    mask: [
      /\d/, /\d/, /\d/, '-', /\d/, /\d/, /\d/, '-', /\d/, /\d/, /\d/, '-', /\d/, /\d/, /\d/, '-', /\d/, /\d/, /\d/, '-', /\d/, /\d/, /\d/
    ],
  };
  
  readonly maskPredicate: MaskitoElementPredicateAsync = async (el) => (el as HTMLIonInputElement).getInputElement();

  constructor(private loadingCtrl: LoadingController, private alertController: AlertController, private toastController: ToastController) {}

  async gerarContraSenha() {
    const loading = await this.loadingCtrl.create({
      message: 'Gerando contra-senha...',
      backdropDismiss: false
    });
    await loading.present();
    try {
    const contraSenha = await elikgMain(this.senha, this.regType.id.toString());
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

  reloadApp() {
    window.location.reload();
  }

  openGame() {
    window.location.href = 'game';
  }

  async copyContraSenha() {
    navigator.clipboard.writeText(this.contraSenha);
    const toast = await this.toastController.create({
      message: 'Contra-senha copiada para a área de transferência.',
      duration: 2000,
      position: 'middle'
    });
    toast.present();
  }

  get canGenerateKey(): boolean {
    return this.regType.id > 0 && this.regType.id < 10 && this.isSenhaWellFormed;
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
