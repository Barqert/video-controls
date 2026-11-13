// web-ext discovers this filename automatically for build, lint, and run.
const manifest = require('./manifest.json');
const metadata = require('./package.json');

// Catch forgotten version updates before linting or creating the release ZIP.
if (manifest.version !== metadata.version) {
    throw new Error('package.json and manifest.json versions must match');
}

module.exports = {
    sourceDir: '.',
    artifactsDir: 'dist',
    // Include only runtime files, including the parent directory for traversal.
    // Add new extension assets here when they are introduced.
    ignoreFiles: [
        '**/*',
        '!manifest.json', '!options.html', '!options.css', '!src',
        '!icons', '!icons/icon-*.png',
        '!src/background.js', '!src/config.js', '!src/input.js',
        '!src/engine.js', '!src/playback.js', '!src/pointer.js', '!src/osd.js', '!src/content.js', '!src/options.js'
    ],
    build: {
        filename: 'video-controls-{version}.zip',
        overwriteDest: true
    }
};
