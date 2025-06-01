#!/usr/bin/env node

const replacer = require('replace-in-file')
const pkg = require('../package.json')

const buildDate = new Date().toISOString()
// get git commit hash from LAST_COMMIT_SHA environment variable set in the prepare action
const commitHash = process.env.LAST_COMMIT_SHA || 'unknown'

const options = {
    files: 'src/environments/environment*.ts',
    from: [/%VERSION%/g, /%BUILD_DATE%/g, /%COMMIT_HASH%/g],
    to: [pkg.version, buildDate, commitHash],
}

try {
    const changes = replacer.sync(options)
    console.log('Modified files:', JSON.stringify(changes, null, 2))
} catch (error) {
    console.error('Error replacing version strings occurred:', error)
}
