// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

import { AppEnvironment } from "src/app/models/environment.interface";

export const environment: AppEnvironment = {
  recaptchaSiteKey: '6LcZvs8nAAAAANtGW5ISJC6s8rZEYF0xo6kFz3hE',
  production: false,
  firebase: {
    apiKey: "AIzaSyCH8nnk_j_7yijK_TVP-BmqLokzlV9-4OY",
    authDomain: "elifoot-98.firebaseapp.com",
    projectId: "elifoot-98",
    storageBucket: "elifoot-98.appspot.com",
    messagingSenderId: "691480207812",
    appId: "1:691480207812:web:8fb4c67c0b6d7e68454491",
    measurementId: "G-5KTX6CSDQL"
  },
  multiplayer: {
    iceServers: [
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
    ],
    iceCandidatePoolSize: 10
  }
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
