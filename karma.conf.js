// Karma configuration file, see link for more information
// https://karma-runner.github.io/1.0/config/configuration-file.html

module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
      require('@angular-devkit/build-angular/plugins/karma')
    ],
    client: {
      jasmine: {
        // you can add configuration options for Jasmine here
        // the possible options are listed at https://jasmine.github.io/api/edge/Configuration.html
        // for example, you can disable the random execution with `random: false`
        // or set a specific seed with `seed: 4321`
      },
      clearContext: false // leave Jasmine Spec Runner output visible in browser
    },
    jasmineHtmlReporter: {
      suppressAll: true // removes the duplicated traces
    },
    coverageReporter: {
      dir: require('path').join(__dirname, './coverage/app'),
      subdir: '.',
      reporters: [
        { type: 'html' },
        { type: 'text-summary' }
      ]
    },
    reporters: ['progress', 'kjhtml'],
    port: 9876,
    // Loopback only. Karma's default listenAddress is '0.0.0.0' (lib/constants.js), and
    // combined with autoWatch/singleRun below it listens on every interface for as long as
    // the session runs, not just for one pass -- so anything on the same network can reach
    // the test server. That reachability is the only thing giving karma's websocket stack
    // (engine.io, socket.io-parser, ws) any exposure at all; bound to loopback there is no
    // remote attack surface for those advisories to apply to.
    //
    // hostname is pinned to the same literal deliberately, for two reasons: karma warns
    // when listenAddress is set while hostname is left at its default, and more
    // importantly 'localhost' can resolve to IPv6 ::1 while '127.0.0.1' binds IPv4 only,
    // which would leave the launched browser unable to reach a server that is running
    // perfectly well. Keeping both on the same stack avoids that mismatch.
    listenAddress: '127.0.0.1',
    hostname: '127.0.0.1',
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: true,
    browsers: ['Chrome'],
    singleRun: false,
    restartOnFileChange: true
  });
};
