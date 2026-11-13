// Parse only commands we can execute; the same validation runs in the editor.
(() => {
    'use strict';
    const numeric = ['video-pan-x', 'video-pan-y', 'video-zoom', 'video-rotate', 'speed', 'volume', 'audio-delay'];
    const boolean = ['pause', 'mute'];
    const namedKeys = {
        LEFT: 'ArrowLeft', RIGHT: 'ArrowRight', UP: 'ArrowUp', DOWN: 'ArrowDown',
        SPACE: ' ', SHARP: '#', IDEOGRAPHIC_SPACE: '\u3000',
        ENTER: 'Enter', ESC: 'Escape', ESCAPE: 'Escape', TAB: 'Tab',
        BS: 'Backspace', BACKSPACE: 'Backspace', DEL: 'Delete', INS: 'Insert',
        HOME: 'Home', END: 'End', PGUP: 'PageUp', PGDWN: 'PageDown',
        PRINT: 'PrintScreen', MENU: 'ContextMenu',
        PLAY: 'MediaPlayPause', PLAYPAUSE: 'MediaPlayPause', PAUSE: 'Pause',
        PLAYONLY: 'MediaPlay', PAUSEONLY: 'MediaPause', STOP: 'MediaStop',
        NEXT: 'MediaTrackNext', PREV: 'MediaTrackPrevious',
        FORWARD: 'MediaFastForward', REWIND: 'MediaRewind',
        VOLUME_UP: 'AudioVolumeUp', VOLUME_DOWN: 'AudioVolumeDown', MUTE: 'AudioVolumeMute',
        KP_ADD: 'code:NumpadAdd', KP_SUBTRACT: 'code:NumpadSubtract',
        KP_MULTIPLY: 'code:NumpadMultiply', KP_DIVIDE: 'code:NumpadDivide',
        KP_ENTER: 'code:NumpadEnter', KP_DEC: 'code:NumpadDecimal',
        KP_DEL: 'code:NumpadDecimal', KP_INS: 'code:Numpad0',
        KP_END: 'code:Numpad1', KP_DOWN: 'code:Numpad2', KP_PGDWN: 'code:Numpad3',
        KP_LEFT: 'code:Numpad4', KP_BEGIN: 'code:Numpad5', KP_RIGHT: 'code:Numpad6',
        KP_HOME: 'code:Numpad7', KP_UP: 'code:Numpad8', KP_PGUP: 'code:Numpad9'
    };
    const mouseButtons = ['MBTN_LEFT', 'MBTN_MID', 'MBTN_RIGHT', 'MBTN_BACK', 'MBTN_FORWARD'];
    const wheelKeys = ['WHEEL_UP', 'WHEEL_DOWN', 'WHEEL_LEFT', 'WHEEL_RIGHT'];
    const mouseNames = [...mouseButtons, ...mouseButtons.slice(0, 3).map(name => `${name}_DBL`), ...wheelKeys];
    for (const name of mouseNames) namedKeys[name] = `mouse:${name}`;
    // mpv's old numeric names include wheel directions between right and back.
    [...mouseButtons.slice(0, 3), ...wheelKeys, ...mouseButtons.slice(3)].forEach((name, index) => {
        namedKeys[`MOUSE_BTN${index}`] = namedKeys[name];
    });
    mouseButtons.slice(0, 3).forEach((name, index) => { namedKeys[`MOUSE_BTN${index}_DBL`] = namedKeys[`${name}_DBL`]; });
    for (const direction of ['UP', 'DOWN', 'LEFT', 'RIGHT']) namedKeys[`AXIS_${direction}`] = namedKeys[`WHEEL_${direction}`];

    function shortcut(text) {
        const mods = {ctrl: false, alt: false, shift: false, meta: false};
        let match;
        while ((match = text.match(/^(Ctrl|Alt|Shift|Meta|Super)\+/i))) {
            const name = match[1].toLowerCase();
            mods[name === 'super' ? 'meta' : name] = true;
            text = text.slice(match[0].length);
        }
        let key = namedKeys[text.toUpperCase()];
        if (!key && /^F([1-9]|1[0-9]|2[0-4])$/i.test(text)) key = text.toUpperCase();
        if (!key && /^KP[0-9]$/i.test(text)) key = `code:Numpad${text[2]}`;
        if (!key && /^0x[0-9a-f]+$/i.test(text)) {
            const point = Number(text);
            if (point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)) key = String.fromCodePoint(point);
        }
        if (!key && [...text].length === 1) key = text;
        if (!key) throw new Error(`Unsupported key: ${text}`);
        const kind = key.startsWith('mouse:') ? 'mouse' : [...key].length === 1 ? 'text' : 'key';
        // mpv ignores Shift on text keys, except to normalize Shift+a to A.
        // The produced character already reflects the keyboard layout and Caps Lock.
        if (kind === 'text') {
            if (mods.shift && /^[a-z]$/.test(key)) key = key.toUpperCase();
            mods.shift = false;
        }
        return {...mods, key, kind};
    }
    function matches(binding, event) {
        const s = binding.shortcut;
        const isNumpad = event.code?.startsWith('Numpad') || event.location === 3;
        const keyMatches = s.key.startsWith('code:') ? event.code === s.key.slice(5) :
            !isNumpad && event.key === s.key;
        // Treat AltGr as character input, not Ctrl+Alt, as mpv does by default.
        const altGraph = s.kind === 'text' && event.getModifierState?.('AltGraph');
        return keyMatches && s.ctrl === (altGraph ? false : event.ctrlKey) &&
            s.alt === (altGraph ? false : event.altKey) &&
            (s.kind === 'text' || s.shift === event.shiftKey) && s.meta === event.metaKey;
    }
    function mouseInput(event, name, scale = 1) {
        // DOM event fields are not enumerable, so copy the modifiers explicitly.
        return {key: `mouse:${name}`, ctrlKey: event.ctrlKey, altKey: event.altKey,
            shiftKey: event.shiftKey, metaKey: event.metaKey, scale};
    }
    function wheelInput(event) {
        // Browsers expose pixels, lines, or pages rather than physical wheel notches.
        // Use the dominant axis and a documented 100px / 3 lines / 1 page per step.
        const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
        const delta = horizontal ? event.deltaX : event.deltaY;
        if (!Number.isFinite(delta) || delta === 0) return null;
        const unit = event.deltaMode === 1 ? 3 : event.deltaMode === 2 ? 1 : 100;
        return mouseInput(event, horizontal ? (delta < 0 ? 'WHEEL_LEFT' : 'WHEEL_RIGHT') :
            (delta < 0 ? 'WHEEL_UP' : 'WHEEL_DOWN'), Math.abs(delta) / unit);
    }
    function number(value) {
        // Accept mpv-style fractions without evaluating arbitrary expressions.
        if (typeof value !== 'string' || !value.trim()) return NaN;
        const parts = value.split('/');
        if (parts.length > 2 || parts.some(part => !part.trim() || !Number.isFinite(Number(part)))) return NaN;
        const result = Number(parts[0]) / (parts.length === 2 ? Number(parts[1]) : 1);
        return Number.isFinite(result) ? result : NaN;
    }
    function tokenize(text) {
        const commands = [[]];
        let token = '', started = false, quote = null;
        const flush = () => { if (started) commands.at(-1).push(token); token = ''; started = false; };
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === '\\' && quote !== "'") {
                if (++i === text.length) throw new Error('Trailing escape');
                token += text[i]; started = true;
            } else if (quote) {
                if (ch === quote) quote = null;
                else token += ch;
            } else if (ch === '"' || ch === "'") { quote = ch; started = true;
            } else if (ch === '#') { break;
            } else if (ch === ';') { flush(); commands.push([]);
            } else if (/\s/.test(ch)) { flush();
            } else { token += ch; started = true; }
        }
        if (quote) throw new Error('Unclosed quote');
        flush();
        return commands.filter(parts => parts.length);
    }
    function command(parts) {
        parts = [...parts];
        let repeat;
        let scalable = true;
        let osd = true;
        while (['repeatable', 'nonrepeatable', 'no-osd', 'nonscalable'].includes(parts[0])) {
            const prefix = parts.shift();
            if (prefix === 'nonscalable') scalable = false;
            if (prefix === 'no-osd') osd = false;
            if (prefix === 'repeatable' || prefix === 'nonrepeatable') repeat = prefix === 'repeatable';
        }
        const op = parts.shift();
        const reverse = op === 'cycle-values' && parts[0] === '!reverse';
        if (reverse) parts.shift();
        const [property, ...args] = parts;
        const count = (min, max = min) => args.length >= min && args.length <= max;
        const isNumber = value => Number.isFinite(number(value));
        const bool = value => ['yes', 'no'].includes(value);
        let valid = false;
        if (['add', 'multiply', 'multiply-decay'].includes(op)) {
            valid = numeric.includes(property) && count(op === 'add' ? 0 : 1, op === 'multiply-decay' ? 2 : 1) && args.every(isNumber);
            if (op === 'multiply-decay') valid = valid && count(2) && args.every(value => number(value) > 0);
        } else if (op === 'set') {
            valid = count(1) && (numeric.includes(property) ? isNumber(args[0]) : boolean.includes(property) && bool(args[0]));
        } else if (op === 'cycle') {
            valid = boolean.includes(property) && count(0, 1) && (!args.length || ['up', 'down'].includes(args[0]));
        } else if (op === 'cycle-values') {
            valid = count(1, Infinity) && (numeric.includes(property) ? args.every(isNumber) : boolean.includes(property) && args.every(bool));
        } else if (op === 'vf') {
            valid = ['toggle', 'add', 'remove'].includes(property) && count(1) && ['hflip', 'vflip'].includes(args[0]);
        } else if (op === 'seek') {
            const flags = (args[0] || 'relative').split('+');
            valid = isNumber(property) && count(0, 1) && flags.every(flag => ['relative', 'absolute', 'absolute-percent', 'relative-percent', 'exact', 'keyframes'].includes(flag)) &&
                flags.filter(flag => !['exact', 'keyframes'].includes(flag)).length <= 1 && !(flags.includes('exact') && flags.includes('keyframes'));
        } else if (['ignore', 'reset-all'].includes(op)) valid = parts.length === 0;
        if (!valid) throw new Error(`Unsupported command or arguments: ${[op, ...parts].join(' ')}`);
        // Normalize numeric arguments once so every executor uses the same syntax.
        const normalizedArgs = numeric.includes(property) ? args.map(value => String(number(value))) : args;
        return {op, property: op === 'seek' ? String(number(property)) : property,
            args: normalizedArgs, reverse, scalable, osd, repeat: repeat ?? ['add', 'multiply', 'seek'].includes(op)};
    }
    function parse(text) {
        const bindings = [], errors = [];
        text.split(/\r?\n/).forEach((line, index) => {
            if (!line.trim() || line.trimStart().startsWith('#')) return;
            try {
                const match = line.trim().match(/^(\S+)\s+(.+)$/);
                if (!match) throw new Error('Expected KEY COMMAND');
                const commands = tokenize(match[2]).map(command);
                if (!commands.length) throw new Error('Missing command');
                bindings.push({shortcut: shortcut(match[1]), commands, line: index + 1});
            } catch (error) { errors.push(`Line ${index + 1}: ${error.message}`); }
        });
        return {bindings, errors};
    }
    function resolve(configs, fullscreen, event) {
        // Reverse lookup gives later lines precedence, then mode-specific overrides.
        return [...configs.common, ...configs[fullscreen ? 'fullscreen' : 'windowed']].reverse()
            .find(binding => matches(binding, event));
    }
    function scaleCommand(cmd, scale) {
        if (!cmd.scalable || scale === 1) return cmd;
        if (cmd.op === 'add') return {...cmd, args: [String(Number(cmd.args[0] ?? 1) * scale)]};
        if (cmd.op === 'seek') return {...cmd, property: String(Number(cmd.property) * scale)};
        return cmd;
    }
    VideoControls.input = {numeric, boolean, shortcut, matches, tokenize, command, parse, resolve,
        mouseButtons, mouseInput, wheelInput, scaleCommand};
})();
