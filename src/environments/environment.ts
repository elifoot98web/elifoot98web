// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  prefixPath: 'assets/js-dos/',
  gameBundleURL: 'assets/elifoot/elifoot98.jsdos',
  versionConfig: {
    versionNumber: "%VERSION%", // set this to test migrations. On production build this will be the value from the package.json
    buildDate: "%BUILD_DATE%",
    commitHash: "%COMMIT_HASH%",
    versionName: "%VERSION%-DEV" 
  },
  multiplayerConfig: {
    turnConfig: [
      {
        urls: "turn:standard.relay.metered.ca:80",
        username: "631c75ecc434a6d0a9c26c92",
        credential: "8hamzirIerfjeAXw",
      },
      {
        urls: "turn:standard.relay.metered.ca:80?transport=tcp",
        username: "631c75ecc434a6d0a9c26c92",
        credential: "8hamzirIerfjeAXw",
      },
      {
        urls: "turn:standard.relay.metered.ca:443",
        username: "631c75ecc434a6d0a9c26c92",
        credential: "8hamzirIerfjeAXw",
      },
      {
        urls: "turns:standard.relay.metered.ca:443?transport=tcp",
        username: "631c75ecc434a6d0a9c26c92",
        credential: "8hamzirIerfjeAXw",
      },
    ],
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
