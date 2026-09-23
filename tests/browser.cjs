// Optional real-browser integration check: supply Playwright via PLAYWRIGHT_PATH.
const assert = require('node:assert/strict');
const {createServer} = require('node:http');
const {mkdtemp, rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const fixture = `<!doctype html><title>Video fixture</title>
<style>video { display:block; background:#333; } #large { width:400px;height:220px; } #small { width:120px;height:80px; }</style>
<video id="large" style="transform:translateX(3px) !important;transform-origin:10px 20px"></video><video id="small"></video>
<input id="typing"><button id="fullscreen" onclick="document.documentElement.requestFullscreen()">Fullscreen</button>`;
(async () => {
    const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(req.url === '/frames' ? '<iframe src="/video" style="width:700px;height:500px"></iframe><button onclick="document.querySelector(\'iframe\').requestFullscreen()">Fullscreen frame</button>' : fixture); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    const profile = await mkdtemp(path.join(tmpdir(), 'video-controls-test-'));
    let context;
    try {
        context = await chromium.launchPersistentContext(profile, {
            headless: true, executablePath: process.env.CHROMIUM_PATH,
            args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-sandbox']
        });
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        const extensionId = new URL(worker.url()).host;
        const options = await context.newPage();
        const errors = [];
        context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
        await options.goto(`chrome-extension://${extensionId}/options.html`);
        await options.waitForFunction(() => !document.querySelector('#save').disabled);
        assert.match(await options.locator('#common').inputValue(), /Alt\+left/);
        const configs = {
            common: 'o set video-pan-x 100\nz add video-zoom 1\nr reset-all\nb multiply-decay speed 2 .1\ns set speed 1.25\nx set speed 2\nv set volume 25\nm cycle mute\na set video-pan-x 1; set video-pan-y 2',
            fullscreen: 'x set speed 3', windowed: 'x set speed 1.5'
        };
        async function save(values) {
            for (const [name, text] of Object.entries(values)) await options.locator(`#${name}`).fill(text);
            await options.locator('#save').click();
            await options.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Saved.'));
        }
        await save(configs);
        await options.reload();
        await options.waitForFunction(() => !document.querySelector('#save').disabled);
        assert.equal(await options.locator('#windowed').inputValue(), configs.windowed);
        await options.locator('#fullscreen').fill('a multiply-decay speed 2 0');
        await options.locator('#save').click();
        assert.match(await options.locator('#errors').textContent(), /Fullscreen only — Line 1/);
        await options.reload();
        await options.waitForFunction(() => !document.querySelector('#save').disabled);
        assert.equal(await options.locator('#fullscreen').inputValue(), configs.fullscreen);
        console.log('PASS options persistence and invalid-config rejection');

        const page = await context.newPage();
        await page.goto(`${baseURL}/video`);
        await page.keyboard.press('z');
        await page.waitForFunction(() => document.querySelector('#large').style.transform.includes('scale(2'));
        assert.equal(await page.locator('#small').evaluate(el => el.style.transform), '');
        await page.keyboard.press('r');
        assert.equal(await page.locator('#large').evaluate(el => el.style.transform), 'translateX(3px)');
        assert.equal(await page.locator('#large').evaluate(el => el.style.getPropertyPriority('transform')), 'important');
        assert.equal(await page.locator('#large').evaluate(el => el.style.transformOrigin), '10px 20px');
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
        assert.deepEqual(errors, []);
    } finally {
        await context?.close();
        await new Promise(resolve => server.close(resolve));
        await rm(profile, {recursive: true, force: true});
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
