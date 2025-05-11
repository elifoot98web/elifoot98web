import { NgModule, isDevMode } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { MaskitoModule } from '@maskito/angular';
import { IonicStorageModule } from '@ionic/storage-angular';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { ServiceWorkerModule } from '@angular/service-worker';


@NgModule({ declarations: [AppComponent],
    bootstrap: [AppComponent], imports: [BrowserModule, IonicModule.forRoot({
            mode: 'md' // Use Material Design mode on all platforms
        }), IonicStorageModule.forRoot(),
        AppRoutingModule, MaskitoModule, ServiceWorkerModule.register('ngsw-worker.js', {
            enabled: !isDevMode(),
            // Register the ServiceWorker as soon as the application is stable
            // or after 30 seconds (whichever comes first).
            registrationStrategy: 'registerWhenStable:30000'
        })], providers: [{ provide: RouteReuseStrategy, useClass: IonicRouteStrategy }, provideHttpClient(withInterceptorsFromDi())] })
export class AppModule { }
