# Video Controls

A standalone Manifest V3 extension for Chrome/Chromium. No dependencies, build, or server required.

## Install

1. Open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select this directory (`/home/amit/repos/amit/video-controls`).
3. Reload open video pages. Click the extension's toolbar button to open settings.
4. Reload the old ChromeExt extension after this extraction to stop its previous copy of the shortcuts. Reload pages that already had the old content script injected.

The previous fullscreen shortcuts are the Common defaults, available in both modes. Fullscreen-only and non-fullscreen-only editors override Common per key. Settings persist in `chrome.storage.local` and apply to open tabs after saving. The options page contains the full supported syntax, limitations, and examples.

`multiply-decay PROPERTY X Y` adds a temporary multiplicative effect; Y is its half-life in seconds. Effects compose multiplicatively over a shared baseline. `reset-all` restores transforms and clears transform effects.

## Structure

- `src/config.js`: shared default configurations.
- `src/input.js`: parsing, validation, keyboard matching, and mode precedence.
- `src/engine.js`: pure property arithmetic and independently decaying effects.
- `src/content.js`: video selection, page styles, playback, fullscreen frames, and animation.
- `src/options.js`, `options.html`, `options.css`: settings and syntax reference.
- `src/background.js`: toolbar settings shortcut.

Run `npm test` for parser and arithmetic regressions; it uses Node's built-in test runner and does not build the extension. Transform edits persist across fullscreen changes. Reset restores the original inline transform values and priorities. Only regular HTML videos and open shadow roots are supported; embedded frames need keyboard focus. Browser shortcuts, media restrictions, and protected pages still apply.

For the real Chromium integration check, install Playwright in a separate tools directory and run `PLAYWRIGHT_PATH=/path/to/node_modules/playwright CHROMIUM_PATH=/path/to/chrome npm run test:browser`. With Playwright resolvable normally and its browser installed, `npm run test:browser` needs no environment variables. This loads the actual unpacked extension and verifies options persistence/validation, live updates, video selection, editing guards, style restoration, mode overrides, decay composition, media controls, and iframe fullscreen propagation.
