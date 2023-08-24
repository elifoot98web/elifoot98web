import { Injectable } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { ReCaptchaV3Service } from 'ng-recaptcha';
import { lastValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthenticationService {
  
  constructor(private afAuth: AngularFireAuth, private recaptchaV3Service: ReCaptchaV3Service) { }

  async annonymousLogin(): Promise<string> {
    const login = await this.afAuth.signInAnonymously()
    console.log({login})
    return login.user?.uid || ''
  }
}
