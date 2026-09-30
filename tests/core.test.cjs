// Regression tests cover configuration boundaries and overlapping effect semantics.
const {test} = require('node:test');
const assert = require('node:assert/strict');
require('../src/config.js');
require('../src/input.js');
require('../src/engine.js');
const {input, engine, config} = globalThis.VideoControls;
const command = text => input.command(input.tokenize(text)[0]);
const run = (state, text, time = 0) => engine.execute(state, command(text), time);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const key = (value, extra = {}) => ({key: value, code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...extra});

test('all shipped configs parse, including original shifted shortcuts', () => {
    for (const text of Object.values(config.defaults)) assert.deepEqual(input.parse(text).errors, []);
    assert.ok(input.matches({shortcut: input.shortcut('Alt++')}, key('+', {altKey: true, shiftKey: true})));
    assert.ok(input.matches({shortcut: input.shortcut('Alt+=')}, key('=', {code: 'Equal', altKey: true})));
    assert.ok(!input.matches({shortcut: input.shortcut('Alt+=')}, key('+', {code: 'NumpadAdd', altKey: true})));
});
test('chains, comments, quoted arguments, escaped separators and line errors', () => {
    const result = input.parse('a set "speed" 2; add video-pan-x .2 # comment\nb nope speed 2\nc set speed nope\nd set speed 3');
    assert.equal(result.bindings.length, 2);
    assert.match(result.errors[0], /^Line 2:/);
    assert.match(result.errors[1], /^Line 3:/);
    assert.equal(result.bindings[0].commands.length, 2);
    assert.deepEqual(input.tokenize('"a;b" \'c#d\' x\\;y # ignored'), [['a;b', 'c#d', 'x;y']]);
    assert.equal(input.parse('a set speed "2').errors.length, 1);
});
test('invalid syntax never becomes a partially active binding', () => {
    for (const text of ['a add pause 1', 'a set speed ""', 'a set speed Infinity', 'a multiply-decay speed 2 0', 'a multiply-decay speed -1 2', 'a multiply-decay speed 2', 'a vf toggle blur', 'a cycle speed', 'a ignore x', 'a seek 1 relative+absolute', 'a set speed 2; nope', 'a-b set speed 2']) {
        const result = input.parse(text);
        assert.equal(result.bindings.length, 0, text);
        assert.equal(result.errors.length, 1, text);
    }
});
test('case, explicit shift, named keys, numpad and meta matching', () => {
    const matches = (text, event) => input.matches({shortcut: input.shortcut(text)}, event);
    assert.ok(matches('A', key('A', {shiftKey: true})));
    assert.ok(matches('Shift+a', key('A', {shiftKey: true})));
    assert.ok(!matches('a', key('A', {shiftKey: true})));
    assert.ok(matches('Super+left', key('ArrowLeft', {metaKey: true})));
    assert.ok(matches('KP_ADD', key('+', {code: 'NumpadAdd'})));
    // Shared character values must not make regular bindings capture KP keys.
    for (const [regular, numpad, value, code, shiftKey] of [
        ['Alt++', 'Alt+Shift+KP_ADD', '+', 'NumpadAdd', true],
        ['Alt+-', 'Alt+KP_SUBTRACT', '-', 'NumpadSubtract', false],
        ['Alt+*', 'Alt+Shift+KP_MULTIPLY', '*', 'NumpadMultiply', true],
        ['Alt+/', 'Alt+KP_DIVIDE', '/', 'NumpadDivide', false],
        ['Alt+1', 'Alt+KP1', '1', 'Numpad1', false],
        ['Alt+ENTER', 'Alt+KP_ENTER', 'Enter', 'NumpadEnter', false]
    ]) {
        const event = key(value, {code, altKey: true, shiftKey});
        assert.ok(matches(numpad, event), numpad);
        assert.ok(!matches(regular, event), regular);
        assert.ok(!matches(numpad, key(value, {altKey: true, shiftKey})), numpad);
        // A later regular binding must not override the explicit numpad binding.
        const configs = {common: input.parse(`${numpad} set speed 2\n${regular} set speed 3`).bindings, fullscreen: [], windowed: []};
        assert.equal(input.resolve(configs, false, event).commands[0].args[0], '2');
    }
    assert.ok(matches('Ctrl+F12', key('F12', {ctrlKey: true})));
    assert.ok(!matches('a', key('a', {metaKey: true})));
});
test('mode overrides common, last line wins, ignore masks a common key', () => {
    const configs = {common: input.parse('a set speed 2\na set speed 3').bindings, fullscreen: input.parse('a ignore').bindings, windowed: []};
    assert.equal(input.resolve(configs, false, key('a')).commands[0].args[0], '3');
    assert.equal(input.resolve(configs, true, key('a')).commands[0].op, 'ignore');
});
test('repeat behavior and no-osd prefix', () => {
    assert.equal(command('multiply-decay speed 2 1').repeat, false);
    assert.equal(command('repeatable multiply-decay speed 2 1').repeat, true);
    assert.equal(command('nonrepeatable add speed 1').repeat, false);
    assert.equal(command('no-osd add speed').repeat, true);
});
test('numeric, boolean, reverse cycles, flips and reset', () => {
    const state = engine.create();
    run(state, 'add speed'); near(state.base.speed, 2);
    run(state, 'multiply speed 2'); near(state.base.speed, 4);
    run(state, 'cycle-values !reverse speed 1 2 4'); near(state.base.speed, 2);
    run(state, 'set mute yes'); run(state, 'cycle mute down'); assert.equal(state.base.mute, false);
    run(state, 'vf add hflip'); run(state, 'vf toggle vflip');
    run(state, 'set video-pan-x 1'); run(state, 'multiply-decay video-pan-x 2 1');
    run(state, 'reset-all');
    assert.equal(state.flipX, false); assert.equal(state.flipY, false);
    near(engine.value(state, 'video-pan-x', 0), 0); near(state.base.speed, 2);
});
test('single decay restores exact original after cutoff', () => {
    const state = engine.create({speed: 1.25});
    run(state, 'multiply-decay speed 2 1');
    near(engine.value(state, 'speed', 0), 2.5);
    near(engine.value(state, 'speed', 1000), 1.875);
    near(engine.value(state, 'speed', 2000), 1.5625);
    near(engine.value(state, 'speed', 20000), 1.25);
    assert.equal(engine.active(state), false);
});
test('staggered effects compose, expire independently, and restore one baseline', () => {
    const state = engine.create();
    run(state, 'multiply-decay speed 2 1', 0);
    run(state, 'multiply-decay speed 3 2', 1000);
    near(engine.value(state, 'speed', 1000), 4.5);
    near(engine.value(state, 'speed', 3000), 1.125 * 2);
    near(engine.value(state, 'speed', 20000), 1 + 2 * 2 ** -9.5);
    near(engine.value(state, 'speed', 41000), 1);
    assert.equal(engine.active(state), false);
});
test('set cancels effects, relative edits retain them, zero and negative baselines work', () => {
    const state = engine.create();
    run(state, 'multiply-decay speed 2 1'); run(state, 'add speed 1');
    near(engine.value(state, 'speed', 0), 4);
    run(state, 'multiply speed .5'); near(engine.value(state, 'speed', 0), 2);
    run(state, 'set speed 3'); near(engine.value(state, 'speed', 1000), 3);
    run(state, 'multiply-decay video-zoom 2 1'); near(engine.value(state, 'video-zoom', 0), 0);
    run(state, 'set video-pan-x -1'); run(state, 'multiply-decay video-pan-x .5 1');
    near(engine.value(state, 'video-pan-x', 1000), -.75);
});
test('property limits do not corrupt the baseline beneath a boost', () => {
    const state = engine.create({volume: 80});
    run(state, 'multiply-decay volume 2 1');
    near(engine.value(state, 'volume', 0), 100);
    near(engine.value(state, 'volume', 3000), 90);
    near(engine.value(state, 'volume', 20000), 80);
});
test('extreme reciprocal multipliers remain finite and cancel at their start time', () => {
    const state = engine.create();
    run(state, 'multiply-decay speed 1e-300 1');
    run(state, 'multiply-decay speed 1e300 1');
    near(engine.value(state, 'speed', 0), 1);
});

test('mpv text keys follow produced characters, including SHARP, Unicode and AltGr', () => {
    const matches = (text, event) => input.matches({shortcut: input.shortcut(text)}, event);
    assert.ok(matches('SHARP', key('#', {shiftKey: true})));
    assert.ok(matches('sharp', key('#')));
    assert.ok(matches('Ctrl+SHARP', key('#', {ctrlKey: true, shiftKey: true})));
    assert.ok(matches('0x23', key('#', {shiftKey: true})));
    assert.ok(matches('0x1f600', key('😀')));
    assert.ok(matches('IDEOGRAPHIC_SPACE', key('\u3000')));
    assert.ok(matches('Alt++', key('+', {altKey: true})));
    assert.ok(matches('Alt+_', key('_', {altKey: true})));
    assert.ok(matches('A', key('A'))); // Caps Lock need not hold Shift.
    assert.ok(matches('Shift+6', key('6'))); // mpv ignores Shift for non-letter text keys.
    assert.ok(!matches('Shift+6', key('^', {shiftKey: true})));
    assert.ok(matches('Ctrl+Alt+^', key('^', {ctrlKey: true, altKey: true, shiftKey: true})));
    assert.ok(matches('@', key('@', {ctrlKey: true, altKey: true, getModifierState: name => name === 'AltGraph'})));
    assert.ok(!matches('Ctrl+Alt+@', key('@', {ctrlKey: true, altKey: true, getModifierState: () => true})));
    assert.ok(!matches('UP', key('ArrowUp', {shiftKey: true})));
    assert.ok(matches('Shift+UP', key('ArrowUp', {shiftKey: true})));
    assert.ok(matches('KP_RIGHT', key('ArrowRight', {code: 'Numpad6', location: 3})));
    assert.ok(matches('PRINT', key('PrintScreen')));
    assert.ok(matches('PLAYPAUSE', key('MediaPlayPause')));
    assert.equal(input.parse('SHARP cycle mute # a comment').bindings.length, 1);
    assert.equal(input.parse('# cycle mute').bindings.length, 0);
    for (const name of ['0x110000', '0xd800', '0x00']) assert.throws(() => input.shortcut(name));
});
test('mpv numeric fractions are finite and work in all numeric commands', () => {
    const state = engine.create();
    run(state, 'multiply speed 1/1.1'); near(state.base.speed, 1 / 1.1);
    run(state, 'set video-pan-x -1/4'); near(state.base['video-pan-x'], -.25);
    run(state, 'cycle-values speed 1/2 1 3/2'); near(state.base.speed, .5);
    run(state, 'multiply-decay speed 2/1 1/2'); near(engine.value(state, 'speed', 500), .75);
    assert.equal(command('seek 1/2').property, '0.5');
    for (const value of ['1/0', '1/', '/2', '1/2/3', '1+2', '0/0']) assert.throws(() => command(`set speed ${value}`));
});
test('mouse aliases, modifiers, wheel axes and scalable commands', () => {
    const event = {ctrlKey: false, altKey: false, shiftKey: false, metaKey: false};
    for (const [alias, name] of [['MOUSE_BTN0', 'MBTN_LEFT'], ['MOUSE_BTN1', 'MBTN_MID'], ['MOUSE_BTN2', 'MBTN_RIGHT'],
        ['MOUSE_BTN3', 'WHEEL_UP'], ['MOUSE_BTN4', 'WHEEL_DOWN'], ['MOUSE_BTN5', 'WHEEL_LEFT'],
        ['MOUSE_BTN6', 'WHEEL_RIGHT'], ['MOUSE_BTN7', 'MBTN_BACK'], ['MOUSE_BTN8', 'MBTN_FORWARD'],
        ['MOUSE_BTN0_DBL', 'MBTN_LEFT_DBL'], ['MOUSE_BTN1_DBL', 'MBTN_MID_DBL'],
        ['MOUSE_BTN2_DBL', 'MBTN_RIGHT_DBL'], ['AXIS_UP', 'WHEEL_UP']]) {
        assert.ok(input.matches({shortcut: input.shortcut(alias)}, input.mouseInput(event, name)), alias);
    }
    const ctrlWheel = input.wheelInput({...event, ctrlKey: true, deltaX: 0, deltaY: -25, deltaMode: 0});
    assert.equal(ctrlWheel.key, 'mouse:WHEEL_UP'); near(ctrlWheel.scale, .25);
    assert.ok(input.matches({shortcut: input.shortcut('Ctrl+WHEEL_UP')}, ctrlWheel));
    assert.ok(!input.matches({shortcut: input.shortcut('WHEEL_UP')}, ctrlWheel));
    assert.equal(input.wheelInput({...event, deltaX: -100, deltaY: 1, deltaMode: 0}).key, 'mouse:WHEEL_LEFT');
    assert.equal(input.wheelInput({...event, deltaX: 1, deltaY: 0, deltaMode: 2}).key, 'mouse:WHEEL_RIGHT');
    near(input.wheelInput({...event, deltaX: 0, deltaY: 3, deltaMode: 1}).scale, 1);
    assert.equal(input.wheelInput({...event, deltaX: 0, deltaY: 0}), null);
    const add = command('add volume 10');
    assert.equal(input.scaleCommand(add, .25).args[0], '2.5');
    assert.equal(add.args[0], '10'); // Scaling must never mutate the saved binding.
    assert.equal(input.scaleCommand(command('add volume'), .25).args[0], '0.25');
    assert.equal(input.scaleCommand(command('seek -4'), .25).property, '-1');
    assert.equal(input.scaleCommand(command('nonscalable add volume 10'), .25).args[0], '10');
    assert.equal(input.scaleCommand(command('multiply speed 2'), .25).args[0], '2');
});
test('audio-delay is numeric, non-negative and bounded', () => {
    const state = engine.create();
    assert.equal(engine.value(state, 'audio-delay', 0), 0);
    run(state, 'add audio-delay 1/10');
    run(state, 'add audio-delay .1');
    near(engine.value(state, 'audio-delay', 0), 0.2);
    run(state, 'add audio-delay -1');
    assert.equal(engine.value(state, 'audio-delay', 0), 0);
    run(state, 'set audio-delay 99');
    assert.equal(engine.value(state, 'audio-delay', 0), 10);
    run(state, 'reset-all');
    assert.equal(engine.value(state, 'audio-delay', 0), 10);
    assert.equal(input.parse('a cycle audio-delay').errors.length, 1);
});
