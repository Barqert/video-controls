# Video Controls

A standalone Manifest V3 extension for Chrome/Chromium 121+ and Firefox 121+. No dependencies, build, or server required.

## Install

1. Open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select this directory (`/home/amit/repos/amit/video-controls`).
3. Reload open video pages. Click the extension's toolbar button to open settings.
4. Reload the old ChromeExt extension after this extraction to stop its previous copy of the shortcuts. Reload pages that already had the old content script injected.

For Firefox, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select this directory's `manifest.json`. Reload open video pages. This temporary installation lasts until Firefox restarts; a permanent installation in regular Firefox needs Mozilla signing. The same manifest supports both browsers: Chromium uses the background service worker, and Firefox uses the background script.

The previous fullscreen shortcuts are the Common defaults, available in both modes. Fullscreen-only and non-fullscreen-only editors override Common per key. Settings persist in `chrome.storage.local` and apply to open tabs after saving. The options page contains the command reference. The input additions below cover keyboard layout handling, mouse buttons, and wheels.

`audio-delay` delays sound by 0–10 seconds (for example `Ctrl+= add audio-delay 0.1`). Unlike mpv, negative values (delaying the picture) are not possible; they clamp to 0. The first nonzero delay routes that video's audio through Web Audio, which cannot be undone until the page reloads. Cross-origin media without CORS and encrypted (EME) media are refused, since routing them would silence them; the delay stays at 0 and a console warning explains why. Seeking discards buffered audio, and pausing freezes it.

`multiply-decay PROPERTY X Y` adds a temporary multiplicative effect; Y is its half-life in seconds. Effects compose multiplicatively over a shared baseline. `reset-all` restores transforms and clears transform effects.

## Structure

- `src/config.js`: shared default configurations.
- `src/input.js`: parsing, validation, keyboard/mouse names, wheel scaling, and mode precedence.
- `src/pointer.js`: mouse gestures, double clicks, wheel events, and suppression of bound page actions.
- `src/engine.js`: pure property arithmetic and independently decaying effects.
- `src/content.js`: video selection, page styles, playback, fullscreen frames, and animation.
- `src/options.js`, `options.html`, `options.css`: settings and syntax reference.
- `src/background.js`: toolbar settings shortcut.

Run `npm test` for parser and arithmetic regressions; it uses Node's built-in test runner and does not build the extension. Transform edits persist across fullscreen changes. Reset restores the original inline transform values and priorities. Regular HTML videos in both open and closed shadow roots are supported on Chromium and Firefox. The extension uses Chromium's `chrome.dom.openOrClosedShadowRoot` API or Firefox's `element.openOrClosedShadowRoot` property; the page's roots stay closed. Embedded frames need keyboard focus. Browser shortcuts, media restrictions, and protected pages still apply.

For the real Chromium integration check, install Playwright in a separate tools directory and run `PLAYWRIGHT_PATH=/path/to/node_modules/playwright CHROMIUM_PATH=/path/to/chrome npm run test:browser`. With Playwright resolvable normally and its browser installed, `npm run test:browser` needs no environment variables. This loads the actual unpacked extension and verifies options persistence/validation, live updates, video selection, editing guards, style restoration, mode overrides, decay composition, media controls, and iframe fullscreen propagation.

Use `BROWSER=firefox PLAYWRIGHT_PATH=/path/to/node_modules/playwright npm run test:browser` for Firefox, with Playwright's Firefox installed (or `FIREFOX_PATH` pointing to a compatible binary). The test loads the actual extension into a temporary profile through a local debugging connection. It runs the video and closed-shadow checks; Firefox options UI checks are skipped because Playwright cannot control its extension pages. Test configs are saved through the background's storage API.

## Keyboard and mouse input

Input names follow [mpv’s key-name rules](https://mpv.io/manual/stable/#key-names) where browser events provide an equivalent. Only commands implemented by this extension are supported; this is not a full mpv interpreter.

```text
SHARP cycle mute                         # The # character
Ctrl+Alt+^ set video-rotate 0             # Ctrl+Alt+Shift+6 on a US layout
Alt++ add video-zoom 0.04                 # The + character, on your layout
Alt+KP_ADD add video-zoom 0.1              # Separate number-pad plus key
[ multiply speed 1/1.1                    # Fractions are accepted

MBTN_LEFT cycle pause
MBTN_RIGHT cycle mute
MBTN_MID reset-all
MBTN_LEFT_DBL reset-all
MBTN_BACK seek -5
MBTN_FORWARD seek 5
Ctrl+MBTN_LEFT vf toggle hflip
WHEEL_UP add volume 2
WHEEL_DOWN add volume -2
WHEEL_LEFT seek -5
WHEEL_RIGHT seek 5
Ctrl+WHEEL_UP add video-zoom 0.04
Ctrl+WHEEL_DOWN add video-zoom -0.04
Alt+WHEEL_UP nonscalable add video-rotate 90
```

These are examples to paste into your configs, not new default bindings. Saved configs and default shortcuts are preserved.

### Text and special keys

- Text keys match the character produced by your keyboard, including non-English characters. `+`, `_`, and `SHARP` no longer assume that Shift is held. Caps Lock works too: `A` matches the produced uppercase character.
- As in mpv, Shift is ignored for text keys, except that `Shift+a` becomes `A`. Write the produced symbol: `Ctrl+Alt+^` for Ctrl+Alt+Shift+6 on a US layout. `Shift+6` means the character `6`, not `^`. Explicit Shift still matters for special keys, mouse buttons, and wheels.
- `SHARP` names `#` without starting a comment. `SPACE` and `IDEOGRAPHIC_SPACE` name their space characters. Hex Unicode names such as `0x23` also work. Hex values must represent Unicode characters; mpv’s internal numeric key codes are not supported.
- AltGr produces text rather than acting as Ctrl+Alt when the browser identifies it as AltGraph. Operating-system shortcuts may never reach the browser.
- Special names include arrows, `ENTER`, `TAB`, `BS`, `DEL`, `INS`, `HOME`, `END`, `PGUP`, `PGDWN`, `ESC`, `PRINT`, `MENU`, and `F1`–`F24`. Names and modifier names are case-insensitive; text characters are case-sensitive.
- Numpad keys stay separate: `KP0`–`KP9`, `KP_ADD`, `KP_SUBTRACT`, `KP_MULTIPLY`, `KP_DIVIDE`, `KP_ENTER`, and `KP_DEC`. Browser physical key codes also support `KP_INS`, `KP_END`, `KP_DOWN`, `KP_PGDWN`, `KP_LEFT`, `KP_BEGIN`, `KP_RIGHT`, `KP_HOME`, `KP_UP`, `KP_PGUP`, and `KP_DEL` as aliases of the corresponding numpad positions. These aliases work regardless of Num Lock.
- Browser-exposed media keys include `PLAY`, `PLAYPAUSE`, `PLAYONLY`, `PAUSEONLY`, `PAUSE`, `STOP`, `NEXT`, `PREV`, `FORWARD`, `REWIND`, `VOLUME_UP`, `VOLUME_DOWN`, and `MUTE`. The OS or browser may consume them first.
- Numeric arguments accept fractions such as `1/1.1` and `-1/4`. Division by zero and arbitrary expressions are rejected.

### Mouse buttons and wheels

The five browser mouse buttons use `MBTN_LEFT`, `MBTN_MID`, `MBTN_RIGHT`, `MBTN_BACK`, and `MBTN_FORWARD`. Left, middle, and right also support `_DBL`. Add modifiers as with keys: `Shift+MBTN_LEFT`, `Ctrl+WHEEL_UP`, etc.

Older mpv aliases are accepted: `MOUSE_BTN0/1/2` for left/middle/right, `MOUSE_BTN3/4/5/6` for wheel up/down/left/right, and `MOUSE_BTN7/8` for back/forward. `MOUSE_BTN0_DBL`, `MOUSE_BTN1_DBL`, `MOUSE_BTN2_DBL`, and `AXIS_UP/DOWN/LEFT/RIGHT` also work. Buttons beyond the browser’s standard five, hover bindings, and mouse dragging commands are not implemented.

Mouse bindings select the video under the pointer, including an overlay within its displayed rectangle. Page inputs, links, and HTML buttons keep their normal behavior. Unbound buttons and wheel directions are left to the site. Bound gestures consume their click, context menu, or scrolling action; handlers that ran before the extension cannot be undone. Native video controls are part of the video element and may also be intercepted by mouse bindings.

Button commands run on release, without auto-repeat. A double click means two nearby clicks within 400 ms. If both single and double bindings exist, the first click runs the single command; the second runs the double command. If only a double binding exists, the first click is consumed and waits for the second. Drags do not run click commands. There are no separate touch or pen bindings; a browser may translate a tap into a mouse click.

Wheel input uses the dominant scroll direction. `add` and `seek` scale with the distance reported by the browser, so touchpads can make small changes. One configured step corresponds to 100 pixels, 3 lines, or 1 page, depending on the event’s units. Put `nonscalable` before a command to use its exact amount once per wheel event. Other commands run once per event without changing their arguments. Browser wheel events do not expose physical notches, so feel can differ from native mpv. A chain scales each command independently; one command’s `nonscalable` prefix does not affect the rest.

Fullscreen-specific configs also override common mouse and wheel bindings. Multi-step key sequences, mpv input sections, property expansion, scripts, and unsupported commands still produce validation errors. The extension’s `multiply-decay` and `reset-all` commands remain available.
