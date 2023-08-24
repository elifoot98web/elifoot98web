import { AppEnvironment } from "src/app/models/environment.interface";

export const environment: AppEnvironment = {
  production: true,
  recaptchaSiteKey: '6LcZvs8nAAAAANtGW5ISJC6s8rZEYF0xo6kFz3hE',
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
