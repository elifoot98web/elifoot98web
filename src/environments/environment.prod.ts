export const environment = {
  production: true,
  prefixPath: 'assets/js-dos/',
  gameBundleURL: 'assets/elifoot/elifoot98.jsdos',
  versionConfig: {
    versionNumber: "%VERSION%", // set this to test migrations. On production build this will be the value from the package.json
    buildDate: "%BUILD_DATE%",
    commitHash: "%COMMIT_HASH%",
    versionName: "%VERSION%-DEV" 
  }
};
