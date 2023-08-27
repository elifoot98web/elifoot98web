import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { lastValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthenticationService {
  
  constructor(private afAuth: AngularFireAuth, private httpClient: HttpClient) { }

  async annonymousLogin(): Promise<string> {
    const login = await this.afAuth.signInAnonymously()
    console.log({login})
    return login.user?.uid || ''
  }

  async validateRecaptcha(token: string): Promise<boolean> {
    const response = await lastValueFrom(this.httpClient.get<RecaptchaResponse>(`https://elifoot98web-api.netlify.app/api/recaptcha?token=${token}`, { responseType: 'json' }))
    console.log({response})
    
    if (response.error) {
      throw new Error(response.error)
    }

    return response.isHuman
  }
}

interface RecaptchaResponse {
  isHuman: boolean
  error?: string
}
