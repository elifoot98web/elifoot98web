export const environment = {
  production: true,
  prefixPath: 'assets/js-dos/',
  gameBundleURL: 'assets/elifoot/elifoot98.jsdos',
  versionConfig: {
    versionNumber: "%VERSION%", // set this to test migrations. On production build this will be the value from the package.json
    buildDate: "%BUILD_DATE%",
    commitHash: "%COMMIT_HASH%",
    versionName: "%VERSION%-PROD" // This will be set to the production version name
  },
  multiplayerConfig: {
    turnConfig: [
      {
        urls: "turn:a.relay.metered.ca:80",
        username: "631c75ecc434a6d0a9c26c92",
        credential: "8hamzirIerfjeAXw",
      },
      {
        urls: "turn:a.relay.metered.ca:80?transport=tcp",
        username: "631c75ecc434a6d0a9c26c92",
        credential: "8hamzirIerfjeAXw",
      },
      {
        urls: "turn:a.relay.metered.ca:443",
        username: "631c75ecc434a6d0a9c26c92",
        credential: "8hamzirIerfjeAXw",
      },
      {
        urls: "turn:a.relay.metered.ca:443?transport=tcp",
        username: "631c75ecc434a6d0a9c26c92",
        credential: "8hamzirIerfjeAXw",
      },
    ],
  }
};
