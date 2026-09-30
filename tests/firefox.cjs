// Load the real extension using Firefox's local debugging protocol. Playwright
// controls the pages; extension-only APIs remain in the browser's own sandbox.
const assert = require('node:assert/strict');
const net = require('node:net');

module.exports = async function launchFirefox(firefox, profile, root) {
    const listener = net.createServer();
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    const context = await firefox.launchPersistentContext(profile, {
        headless: true, executablePath: process.env.FIREFOX_PATH,
        args: ['--start-debugger-server', String(port)],
        firefoxUserPrefs: {
            'devtools.debugger.remote-enabled': true,
            'devtools.debugger.prompt-connection': false,
            'devtools.debugger.force-local': true
        }
    });
    const socket = net.connect(port, '127.0.0.1');
    let buffer = Buffer.alloc(0), pending;
    const events = [], waiters = [];
    function eventWhere(matches) {
        const index = events.findIndex(matches);
        if (index >= 0) return Promise.resolve(events.splice(index, 1)[0]);
        return new Promise((resolve, reject) => waiters.push({matches, resolve, reject}));
    }
    const fail = error => {
        pending?.reject(error);
        for (const waiter of waiters.splice(0)) waiter.reject(error);
    };
    socket.on('error', fail);
    socket.on('close', () => fail(new Error('Firefox debugger disconnected')));
    socket.setTimeout(30000, () => socket.destroy(new Error('Firefox debugger timed out')));
    socket.on('data', data => {
        buffer = Buffer.concat([buffer, data]);
        // Packets are UTF-8 JSON prefixed by their byte length and a colon.
        while (true) {
            const colon = buffer.indexOf(':');
            if (colon < 0) break;
            const length = Number(buffer.subarray(0, colon));
            if (buffer.length < colon + 1 + length) break;
            const packet = JSON.parse(buffer.subarray(colon + 1, colon + 1 + length));
            buffer = buffer.subarray(colon + 1 + length);
            if (packet.type) {
                const index = waiters.findIndex(waiter => waiter.matches(packet));
                if (index >= 0) waiters.splice(index, 1)[0].resolve(packet);
                else events.push(packet);
            }
            // Unsolicited events carry a type and are not command replies.
            if (pending && packet.from === pending.from && !packet.type) {
                const {resolve, reject} = pending;
                pending = null;
                if (packet.error) reject(new Error(JSON.stringify(packet)));
                else resolve(packet);
            }
        }
    });
    const receive = from => new Promise((resolve, reject) => { pending = {from, resolve, reject}; });
    const send = packet => {
        const reply = receive(packet.to);
        const json = JSON.stringify(packet);
        socket.write(`${Buffer.byteLength(json)}:${json}`);
        return reply;
    };
    try {
        await receive('root');
        const actors = await send({to: 'root', type: 'getRoot'});
        const {addon} = await send({to: actors.addonsActor, type: 'installTemporaryAddon', addonPath: root});
        const {addons} = await send({to: 'root', type: 'listAddons'});
        const installed = addons.find(item => item.id === addon.id);
        assert.deepEqual(installed.warnings, []);
        assert.equal(installed.backgroundScriptStatus, 'RUNNING');
        // Playwright cannot control Firefox's privileged extension pages. Set
        // test configs through the actual background's storage API instead.
        const watcher = await send({to: installed.actor, type: 'getWatcher'});
        await send({to: watcher.actor, type: 'watchTargets', targetType: 'frame'});
        const {target} = await eventWhere(packet => packet.type === 'target-available-form' &&
            packet.target.url.endsWith('/_generated_background_page.html'));
        async function evaluate(text) {
            const {resultID} = await send({to: target.consoleActor, type: 'evaluateJSAsync', text});
            const result = await eventWhere(packet => packet.type === 'evaluationResult' && packet.resultID === resultID);
            assert.ok(!result.exception, result.exceptionMessage);
            return result.result;
        }
        let configs = {};
        async function save(values) {
            configs = {...configs, ...values};
            await evaluate(`globalThis.testConfigSaved = false; browser.storage.local.set({inputConfigs:${JSON.stringify(configs)}}).then(() => { globalThis.testConfigSaved = true; })`);
            const deadline = Date.now() + 5000;
            while (await evaluate('globalThis.testConfigSaved') !== true) {
                assert.ok(Date.now() < deadline, 'Firefox config save timed out');
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }
        context.on('close', () => socket.destroy());
        return {context, save};
    } catch (error) {
        await context.close();
        socket.destroy();
        throw error;
    }
};
