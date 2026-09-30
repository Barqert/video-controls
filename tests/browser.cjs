// Optional real-browser integration check: supply Playwright via PLAYWRIGHT_PATH.
const assert = require('node:assert/strict');
const {createServer} = require('node:http');
const {mkdtemp, rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {chromium, firefox} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const fixture = `<!doctype html><title>Video fixture</title>
<style>video { display:block; background:#333; } #large { width:400px;height:220px; } #small { width:120px;height:80px; }</style>
<video id="large" style="transform:translateX(3px) !important;transform-origin:10px 20px"></video><video id="small"></video>
<input id="typing"><button id="fullscreen" onclick="document.documentElement.requestFullscreen()">Fullscreen</button>`;
// Keep roots closed even to page scripts; references below are fixture-only handles.
const closedFixture = `<!doctype html><title>Closed shadow player</title>
<div id="host" style="display:block;position:relative;width:420px"></div>
<script>
const host = document.querySelector('#host');
const outer = host.attachShadow({mode:'closed'});
outer.innerHTML = '<video id="large" tabindex="0" style="display:block;width:400px;height:180px;background:#333"></video><input id="typing"><button id="control" style="position:absolute;left:30px;top:30px">Control</button><div id="nested"></div>';
const inner = outer.querySelector('#nested').attachShadow({mode:'closed'});
inner.innerHTML = '<video id="small" tabindex="0" style="display:block;width:160px;height:90px;background:#444;transform:translateX(3px)"></video><input id="inner-typing">';
window.closedFixture = {outer, inner, large:outer.querySelector('#large'), small:inner.querySelector('#small'),
  typing:outer.querySelector('#typing'), innerTyping:inner.querySelector('#inner-typing'), control:outer.querySelector('#control'), clicks:0};
closedFixture.control.addEventListener('click', () => closedFixture.clicks++);
</script>`;
(async () => {
    const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(req.url === '/closed-shadow' ? closedFixture : req.url === '/frames' ? '<iframe src="/video" style="width:700px;height:500px"></iframe><button onclick="document.querySelector(\'iframe\').requestFullscreen()">Fullscreen frame</button>' : fixture); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    const profile = await mkdtemp(path.join(tmpdir(), 'video-controls-test-'));
    let context;
    try {
        let optionsURL, save;
        if (process.env.BROWSER === 'firefox') {
            ({context, save} = await require('./firefox.cjs')(firefox, profile, root));
        } else {
            context = await chromium.launchPersistentContext(profile, {
                headless: true, executablePath: process.env.CHROMIUM_PATH,
                args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-sandbox']
            });
            const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
            optionsURL = `chrome-extension://${new URL(worker.url()).host}/options.html`;
        }
        const configs = {
            common: 'o set video-pan-x 100\nz add video-zoom 1\nu add video-zoom -1\nf vf toggle hflip; set video-rotate 90\nr reset-all\nb multiply-decay speed 2 .1\ns set speed 1.25\nx set speed 2\nv set volume 25\nm cycle mute\na set video-pan-x 1; set video-pan-y 2',
            fullscreen: 'x set speed 3', windowed: 'x set speed 1.5'
        };
        const errors = [];
        context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
        if (process.env.BROWSER === 'firefox') {
            await save(configs);
            console.log('SKIP options UI: Playwright cannot control Firefox extension pages');
        } else {
            const options = await context.newPage();
            await options.goto(optionsURL);
            await options.waitForFunction(() => !document.querySelector('#defaults').disabled);
            assert.match(await options.locator('#common').inputValue(), /Alt\+left/);
            assert.equal(await options.locator('#save').isDisabled(), true);
            await options.locator('#defaults').click();
            assert.equal(await options.locator('#save').isDisabled(), true);
            save = async function (values) {
                for (const [name, text] of Object.entries(values)) await options.locator(`#${name}`).fill(text);
                await options.locator('#save').click();
                await options.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Saved.'));
            };
            await save(configs);
            assert.equal(await options.locator('#save').isDisabled(), true);
            await options.locator('#common').fill(configs.common + '\n# temporary edit');
            assert.equal(await options.locator('#save').isDisabled(), false);
            await options.locator('#common').fill(configs.common);
            assert.equal(await options.locator('#save').isDisabled(), true);
            // Ctrl+S shares button validation and saves while a textarea has focus.
            const keyboardConfig = configs.common + '\n# saved with Ctrl+S';
            await options.locator('#common').fill(keyboardConfig);
            await options.keyboard.press('Control+s');
            await options.waitForFunction(() => document.querySelector('#status').textContent === 'Saved.');
            assert.equal(await options.locator('#save').isDisabled(), true);
            await options.reload();
            await options.waitForFunction(() => !document.querySelector('#defaults').disabled);
            assert.equal(await options.locator('#common').inputValue(), keyboardConfig);
            await save(configs);
            await options.reload();
            await options.waitForFunction(() => !document.querySelector('#defaults').disabled);
            assert.equal(await options.locator('#windowed').inputValue(), configs.windowed);
            await options.locator('#fullscreen').fill('a multiply-decay speed 2 0');
            await options.keyboard.press('Control+s');
            assert.equal(await options.locator('#save').isDisabled(), false);
            assert.match(await options.locator('#errors').textContent(), /Fullscreen only — Line 1/);
            await options.reload();
            await options.waitForFunction(() => !document.querySelector('#defaults').disabled);
            assert.equal(await options.locator('#fullscreen').inputValue(), configs.fullscreen);
            console.log('PASS Ctrl+S, unchanged/reverted/default button state, persistence, and invalid-config rejection');

            // Control storage completion to verify failures and edits made during a save.
            await options.evaluate(() => {
                const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
                window.saveCalls = 0;
                chrome.storage.local.set = values => {
                    window.saveCalls++;
                    return new Promise((resolve, reject) => {
                        window.finishSave = () => originalSet(values).then(resolve, reject);
                        window.failSave = () => reject(new Error('Test storage failure'));
                    });
                };
                window.restoreStorage = () => { chrome.storage.local.set = originalSet; };
            });
            await options.keyboard.press('Control+s');
            assert.equal(await options.evaluate(() => window.saveCalls), 0);
            await options.locator('#windowed').fill(configs.windowed + '\n# first edit');
            await options.keyboard.press('Control+s');
            assert.equal(await options.locator('#save').isDisabled(), true);
            await options.keyboard.press('Control+s');
            assert.equal(await options.evaluate(() => window.saveCalls), 1);
            await options.locator('#windowed').fill(configs.windowed + '\n# newer edit');
            assert.equal(await options.locator('#save').isDisabled(), true);
            await options.evaluate(() => window.finishSave());
            await options.waitForFunction(() => document.querySelector('#status').textContent.includes('New edits'));
            assert.equal(await options.locator('#save').isDisabled(), false);
            await options.keyboard.press('Control+s');
            await options.evaluate(() => window.failSave());
            await options.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Could not save:'));
            assert.equal(await options.locator('#save').isDisabled(), false);
            await options.keyboard.press('Control+s');
            await options.evaluate(() => window.finishSave());
            await options.waitForFunction(() => document.querySelector('#status').textContent === 'Saved.');
            assert.equal(await options.locator('#save').isDisabled(), true);
            await options.evaluate(() => window.restoreStorage());
            await save(configs);
            console.log('PASS duplicate-save prevention, in-flight edits, failed save, and retry');

        }

        const page = await context.newPage();
        await page.goto(`${baseURL}/video`);
        // Firefox includes the zero Z coordinate when serializing this value.
        const originalOrigin = await page.locator('#large').evaluate(el => el.style.transformOrigin);
        await page.keyboard.press('z');
        await page.waitForFunction(() => document.querySelector('#large').style.transform.includes('scale(2'));
        assert.equal(await page.locator('#small').evaluate(el => el.style.transform), '');
        await page.keyboard.press('r');
        assert.equal(await page.locator('#large').evaluate(el => el.style.transform), 'translateX(3px)');
        assert.equal(await page.locator('#large').evaluate(el => el.style.getPropertyPriority('transform')), 'important');
        assert.equal(await page.locator('#large').evaluate(el => el.style.transformOrigin), originalOrigin);
        await page.locator('#typing').focus();
        await page.keyboard.press('z');
        assert.equal(await page.locator('#typing').inputValue(), 'z');
        assert.equal(await page.locator('#large').evaluate(el => el.style.transform), 'translateX(3px)');
        await page.locator('#small').click();
        await page.keyboard.press('z');
        assert.match(await page.locator('#small').evaluate(el => el.style.transform), /scale\(2/);
        await page.keyboard.press('r');
        await page.locator('#large').click();
        await page.keyboard.press('a');
        assert.match(await page.locator('#large').evaluate(el => el.style.transform), /translate\(100%, 200%\)/);
        await page.keyboard.press('r');
        // Panning offscreen must not make the same video impossible to reset.
        await page.keyboard.press('o');
        await page.keyboard.press('r');
        assert.equal(await page.locator('#large').evaluate(el => el.style.transform), 'translateX(3px)');
        console.log('PASS selection, typing guard, chains, offscreen reset, and exact style restoration');

        // Zoom must scale the entire panned picture around the fixed view center.
        // Using a neutral site transform isolates the extension's anchor geometry.
        await page.locator('#large').evaluate(el => { el.style.transform = 'none'; });
        const center = () => page.locator('#large').evaluate(el => {
            const rect = el.getBoundingClientRect();
            return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
        });
        const anchor = await center();
        await page.keyboard.press('a');
        await page.keyboard.press('f');
        const beforeZoom = await center();
        await page.keyboard.press('z');
        const afterZoom = await center();
        for (const axis of ['x', 'y']) {
            assert.ok(Math.abs(afterZoom[axis] - (anchor[axis] + 2 * (beforeZoom[axis] - anchor[axis]))) < .01,
                `Zoom moved the ${axis} anchor: ${JSON.stringify({anchor, beforeZoom, afterZoom})}`);
        }
        await page.keyboard.press('u');
        const afterZoomOut = await center();
        for (const axis of ['x', 'y']) assert.ok(Math.abs(afterZoomOut[axis] - beforeZoom[axis]) < .01);
        await page.keyboard.press('r');
        await page.locator('#large').evaluate(el => { el.style.setProperty('transform', 'translateX(3px)', 'important'); });
        console.log('PASS zoom around the fixed view center after pan, rotation, and flip');

        await page.keyboard.press('x');
        assert.equal(await page.locator('#large').evaluate(el => el.playbackRate), 1.5);
        await page.locator('#fullscreen').click();
        await page.waitForFunction(() => Boolean(document.fullscreenElement));
        await page.keyboard.press('x');
        assert.equal(await page.locator('#large').evaluate(el => el.playbackRate), 3);
        await page.evaluate(() => document.exitFullscreen());
        await page.keyboard.press('s');
        assert.equal(await page.locator('#large').evaluate(el => el.playbackRate), 1.25);
        // Dispatch both boosts in one task so their immediate product is observable.
        const boosted = await page.evaluate(() => {
            for (let i = 0; i < 2; i++) document.dispatchEvent(new KeyboardEvent('keydown', {key: 'b', code: 'KeyB', bubbles: true}));
            return document.querySelector('#large').playbackRate;
        });
        assert.ok(boosted > 4.8 && boosted <= 5.000001, String(boosted));
        await page.waitForFunction(() => document.querySelector('#large').playbackRate === 1.25);
        await page.keyboard.press('b');
        await page.evaluate(() => { document.querySelector('#large').playbackRate = 1.75; });
        await page.waitForTimeout(150);
        assert.equal(await page.locator('#large').evaluate(el => el.playbackRate), 1.75);
        await page.keyboard.press('v'); await page.keyboard.press('m');
        assert.equal(await page.locator('#large').evaluate(el => el.volume), .25);
        assert.equal(await page.locator('#large').evaluate(el => el.muted), true);
        console.log('PASS mode precedence, overlapping decay, media controls and external changes');

        await save({...configs, common: configs.common + '\nq set speed 4'});
        await page.bringToFront();
        await page.keyboard.press('q');
        await page.waitForFunction(() => document.querySelector('#large').playbackRate === 4);
        await page.keyboard.press('z');
        const detached = await page.evaluate(() => {
            const video = document.querySelector('#large');
            video.remove();
            return new Promise(resolve => setTimeout(() => resolve(video.style.transform), 0));
        });
        assert.equal(detached, 'translateX(3px)');
        console.log('PASS live configuration updates and detached-video cleanup');

        const frames = await context.newPage();
        await frames.goto(`${baseURL}/frames`);
        await frames.locator('button').click();
        const child = frames.frames().find(frame => frame.parentFrame());
        await child.locator('#large').click();
        await frames.keyboard.press('x');
        await child.waitForFunction(() => document.querySelector('#large').playbackRate === 3);
        await frames.evaluate(() => document.exitFullscreen());
        await child.locator('#large').click();
        await frames.keyboard.press('x');
        await child.waitForFunction(() => document.querySelector('#large').playbackRate === 1.5);
        console.log('PASS fullscreen mode propagation into embedded video frames');
        // Exercise actual browser mouse event sequences, not just key-name parsing.
        await save({common: [
            'SHARP set video-rotate 90', 'Ctrl+Alt+^ set speed 3', 'r reset-all',
            'MBTN_LEFT add volume -10', 'MBTN_LEFT_DBL set volume 25',
            'MBTN_MID cycle mute', 'MBTN_RIGHT add speed 0.25',
            'MBTN_BACK set speed 0.5', 'MBTN_FORWARD set speed 1.5',
            'Shift+MBTN_LEFT set speed 4',
            'WHEEL_UP add volume 10', 'WHEEL_DOWN add volume -10',
            'WHEEL_LEFT add speed -0.1', 'WHEEL_RIGHT add speed 0.1',
            'Ctrl+WHEEL_UP nonscalable add video-zoom 0.1',
            'Ctrl+WHEEL_DOWN nonscalable add video-zoom -0.1'
        ].join('\n'), fullscreen: 'WHEEL_UP set volume 70', windowed: ''});
        const mousePage = await context.newPage();
        await mousePage.goto(`${baseURL}/video`);
        const large = mousePage.locator('#large');
        const small = mousePage.locator('#small');
        const volume = () => large.evaluate(el => el.volume);
        await mousePage.keyboard.press('Shift+Digit3');
        assert.match(await large.evaluate(el => el.style.transform), /rotate\(90deg\)/);
        await mousePage.keyboard.press('r');
        await mousePage.keyboard.press('Control+Alt+Shift+Digit6');
        assert.equal(await large.evaluate(el => el.playbackRate), 3);
        await mousePage.evaluate(() => {
            window.received = [];
            for (const name of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'auxclick', 'dblclick', 'contextmenu', 'wheel']) {
                document.addEventListener(name, () => window.received.push(name));
            }
        });
        await large.click();
        assert.equal(await volume(), .9);
        await large.click({button: 'middle'});
        assert.equal(await large.evaluate(el => el.muted), true);
        await large.click({button: 'right'});
        assert.equal(await large.evaluate(el => el.playbackRate), 3.25);
        await large.dblclick();
        assert.equal(await volume(), .25);
        await large.click({modifiers: ['Shift']});
        assert.equal(await large.evaluate(el => el.playbackRate), 4);
        assert.deepEqual(await mousePage.evaluate(() => window.received), []);
        await small.click();
        assert.equal(await small.evaluate(el => el.volume), .9);
        assert.equal(await volume(), .25);
        await large.hover();
        await mousePage.mouse.wheel(0, -100);
        await mousePage.waitForFunction(() => Math.abs(document.querySelector('#large').volume - .35) < 1e-8);
        await mousePage.mouse.wheel(0, 50);
        await mousePage.waitForFunction(() => Math.abs(document.querySelector('#large').volume - .3) < 1e-8);
        await mousePage.mouse.wheel(-100, 0);
        await mousePage.waitForFunction(() => Math.abs(document.querySelector('#large').playbackRate - 3.9) < 1e-8);
        await mousePage.mouse.wheel(100, 0);
        await mousePage.waitForFunction(() => document.querySelector('#large').playbackRate === 4);
        await mousePage.keyboard.down('Control');
        await mousePage.mouse.wheel(0, -10);
        await mousePage.keyboard.up('Control');
        await mousePage.waitForFunction(() => document.querySelector('#large').style.transform.includes('scale(1.07177'));
        assert.deepEqual(await mousePage.evaluate(() => window.received), []);
        await mousePage.keyboard.press('r');
        // Browser automation exposes back/forward via DOM events, not mouse.click.
        for (const [button, expected] of [[3, .5], [4, 1.5]]) {
            const consumed = await large.evaluate((el, button) => {
                const rect = el.getBoundingClientRect();
                return ['mousedown', 'mouseup', 'auxclick'].map(type => !el.dispatchEvent(new MouseEvent(type, {
                    button, clientX: rect.x + 30, clientY: rect.y + 30, bubbles: true, cancelable: true
                })));
            }, button);
            assert.deepEqual(consumed, [true, true, true]);
            assert.equal(await large.evaluate(el => el.playbackRate), expected);
        }
        // Inputs, controls, and empty page space keep their ordinary mouse behavior.
        await mousePage.locator('#typing').click();
        assert.ok((await mousePage.evaluate(() => window.received)).includes('click'));
        const unbound = await large.evaluate(el => el.dispatchEvent(new WheelEvent('wheel', {
            deltaY: -100, altKey: true, bubbles: true, cancelable: true
        })));
        assert.equal(unbound, true);
        const outside = await mousePage.evaluate(() => document.body.dispatchEvent(new WheelEvent('wheel', {
            deltaY: 100, clientX: 900, clientY: 700, bubbles: true, cancelable: true
        })));
        assert.equal(outside, true);
        await mousePage.evaluate(() => {
            const button = document.createElement('button');
            button.id = 'overlay-control'; button.textContent = 'Player control';
            button.style.cssText = 'position:absolute;left:30px;top:30px';
            document.body.append(button);
        });
        const control = await mousePage.locator('#overlay-control').evaluate(el => el.dispatchEvent(new WheelEvent('wheel', {
            deltaY: -100, clientX: 40, clientY: 40, bubbles: true, cancelable: true
        })));
        assert.equal(control, true);
        await mousePage.evaluate(() => document.querySelector('#overlay-control').remove());
        await mousePage.locator('#fullscreen').click();
        await mousePage.waitForFunction(() => Boolean(document.fullscreenElement));
        await large.hover();
        await mousePage.mouse.wheel(0, -100);
        await mousePage.waitForFunction(() => document.querySelector('#large').volume === .7);
        await mousePage.evaluate(() => document.exitFullscreen());
        console.log('PASS SHARP, shifted text, mouse buttons/double clicks, smooth wheel, controls, and mode overrides');
        await save({common: 'z add video-zoom 1\nr reset-all\nx set speed 1.5\nMBTN_LEFT add volume -10\nMBTN_RIGHT cycle mute\nWHEEL_UP add volume -10',
            fullscreen: 'x set speed 3', windowed: ''});
        const closedPage = await context.newPage();
        await closedPage.goto(`${baseURL}/closed-shadow`);
        assert.equal(await closedPage.evaluate(() => document.querySelector('#host').shadowRoot), null);
        const readClosed = (name, property) => closedPage.evaluate(([name, property]) => window.closedFixture[name][property], [name, property]);
        const closedTransform = name => closedPage.evaluate(name => window.closedFixture[name].style.transform, name);
        async function closedPoint(name) {
            return closedPage.evaluate(name => {
                const rect = window.closedFixture[name].getBoundingClientRect();
                return {x:rect.left + rect.width / 2, y:rect.top + rect.height / 2};
            }, name);
        }
        await closedPage.keyboard.press('z');
        assert.match(await closedTransform('large'), /scale\(2\)/);
        await closedPage.keyboard.press('r');
        for (const name of ['typing', 'innerTyping']) {
            await closedPage.evaluate(name => window.closedFixture[name].focus(), name);
            await closedPage.keyboard.press('z');
            assert.equal(await readClosed(name, 'value'), 'z');
            assert.equal(await closedTransform('large'), '');
        }
        let point = await closedPoint('small');
        await closedPage.mouse.click(point.x, point.y);
        assert.equal(await readClosed('small', 'volume'), .9);
        assert.equal(await readClosed('large', 'volume'), 1);
        await closedPage.keyboard.press('z');
        assert.match(await closedTransform('small'), /scale\(2\)/);
        assert.equal(await closedTransform('large'), '');
        await closedPage.keyboard.press('r');
        point = await closedPoint('small');
        await closedPage.mouse.click(point.x, point.y, {button:'right'});
        assert.equal(await readClosed('small', 'muted'), true);
        await closedPage.mouse.wheel(0, -100);
        await closedPage.waitForFunction(() => Math.abs(closedFixture.small.volume - .8) < 1e-8);
        point = await closedPoint('control');
        await closedPage.mouse.click(point.x, point.y);
        assert.equal(await closedPage.evaluate(() => closedFixture.clicks), 1);
        await closedPage.mouse.wheel(0, -100);
        // The button overlaps the video, but must not run the video's mouse binding.
        assert.equal(await readClosed('large', 'volume'), 1);
        point = await closedPoint('large');
        await closedPage.mouse.click(point.x, point.y);
        await closedPage.evaluate(() => closedFixture.small.requestFullscreen());
        await closedPage.waitForFunction(() => Boolean(document.fullscreenElement));
        await closedPage.keyboard.press('x');
        assert.equal(await readClosed('small', 'playbackRate'), 3);
        assert.equal(await readClosed('large', 'playbackRate'), 1);
        await closedPage.keyboard.press('z');
        await closedPage.evaluate(() => document.exitFullscreen());
        await closedPage.evaluate(() => closedFixture.small.remove());
        await closedPage.waitForFunction(() => closedFixture.small.style.transform === 'translateX(3px)');
        // Newly attached closed roots must also be discovered without attachShadow hooks.
        await closedPage.evaluate(() => {
            const host = document.createElement('div');
            closedFixture.inner.append(host);
            const root = host.attachShadow({mode:'closed'});
            const video = document.createElement('video');
            video.style.cssText = 'display:block;width:160px;height:90px;background:#555';
            root.append(video); closedFixture.late = video;
        });
        point = await closedPoint('late');
        await closedPage.mouse.click(point.x, point.y);
        await closedPage.keyboard.press('z');
        assert.match(await closedTransform('late'), /scale\(2\)/);
        await closedPage.keyboard.press('r');
        console.log('PASS closed/nested/late shadow roots, input/button guards, mouse targeting, fullscreen, and removal cleanup');

        // Fullscreen state must reach an iframe whose ancestor is a closed root.
        const attachedFrame = closedPage.waitForEvent('frameattached');
        await closedPage.evaluate(url => {
            const frame = document.createElement('iframe');
            frame.src = url; frame.style.cssText = 'width:600px;height:500px';
            closedFixture.inner.append(frame);
        }, `${baseURL}/video`);
        const frameInShadow = await attachedFrame;
        await frameInShadow.waitForURL(`${baseURL}/video`);
        await closedPage.evaluate(() => document.querySelector('#host').requestFullscreen());
        await frameInShadow.locator('#large').click();
        await closedPage.keyboard.press('x');
        await frameInShadow.waitForFunction(() => document.querySelector('#large').playbackRate === 3);
        await closedPage.evaluate(() => document.exitFullscreen());
        await frameInShadow.locator('#large').click();
        await closedPage.keyboard.press('x');
        await frameInShadow.waitForFunction(() => document.querySelector('#large').playbackRate === 1.5);
        console.log('PASS fullscreen mode for iframe players nested inside closed roots');
        assert.deepEqual(errors, []);
    } finally {
        await context?.close();
        await new Promise(resolve => server.close(resolve));
        await rm(profile, {recursive: true, force: true});
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
