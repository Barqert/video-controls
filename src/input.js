// Parse only commands we can execute; the same validation runs in the editor.
(() => {
    'use strict';
    const numeric = ['video-pan-x', 'video-pan-y', 'video-zoom', 'video-rotate', 'speed', 'volume'];
    const boolean = ['pause', 'mute'];
    const namedKeys = {
        LEFT: 'ArrowLeft', RIGHT: 'ArrowRight', UP: 'ArrowUp', DOWN: 'ArrowDown',
        SPACE: ' ', ENTER: 'Enter', ESC: 'Escape', ESCAPE: 'Escape', TAB: 'Tab',
        BS: 'Backspace', BACKSPACE: 'Backspace', DEL: 'Delete', INS: 'Insert',
        HOME: 'Home', END: 'End', PGUP: 'PageUp', PGDWN: 'PageDown',
        KP_ADD: 'code:NumpadAdd', KP_SUBTRACT: 'code:NumpadSubtract',
        KP_MULTIPLY: 'code:NumpadMultiply', KP_DIVIDE: 'code:NumpadDivide',
        KP_ENTER: 'code:NumpadEnter', KP_DEC: 'code:NumpadDecimal'
    };
    const shiftedSymbols = '~!@#$%^&*()_+{}|:"<>?';
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
        if (!key && [...text].length === 1) {
            key = text;
            if (/[A-Z]/.test(key) || shiftedSymbols.includes(key)) mods.shift = true;
            if (mods.shift && /^[a-z]$/.test(key)) key = key.toUpperCase();
        }
        if (!key) throw new Error(`Unsupported key: ${text}`);
        return {...mods, key};
    }
    function matches(binding, event) {
        const s = binding.shortcut;
        // Keep the old Alt+= / Alt+- numpad aliases, while allowing explicit KP bindings.
        const keyMatches = s.key.startsWith('code:') ? event.code === s.key.slice(5) :
            event.key === s.key || (s.key === '=' && event.code === 'NumpadAdd') ||
            (s.key === '-' && event.code === 'NumpadSubtract');
        return keyMatches && s.ctrl === event.ctrlKey && s.alt === event.altKey &&
            s.shift === event.shiftKey && s.meta === event.metaKey;
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
        while (['repeatable', 'nonrepeatable', 'no-osd'].includes(parts[0])) {
            const prefix = parts.shift();
            if (prefix !== 'no-osd') repeat = prefix === 'repeatable';
        }
        const op = parts.shift();
        const reverse = op === 'cycle-values' && parts[0] === '!reverse';
        if (reverse) parts.shift();
        const [property, ...args] = parts;
        const count = (min, max = min) => args.length >= min && args.length <= max;
        const number = value => typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
        const bool = value => ['yes', 'no'].includes(value);
        let valid = false;
        if (['add', 'multiply', 'multiply-decay'].includes(op)) {
            valid = numeric.includes(property) && count(op === 'add' ? 0 : 1, op === 'multiply-decay' ? 2 : 1) && args.every(number);
            if (op === 'multiply-decay') valid = valid && count(2) && args.every(value => Number(value) > 0);
        } else if (op === 'set') {
            valid = count(1) && (numeric.includes(property) ? number(args[0]) : boolean.includes(property) && bool(args[0]));
        } else if (op === 'cycle') {
            valid = boolean.includes(property) && count(0, 1) && (!args.length || ['up', 'down'].includes(args[0]));
        } else if (op === 'cycle-values') {
            valid = count(1, Infinity) && (numeric.includes(property) ? args.every(number) : boolean.includes(property) && args.every(bool));
        } else if (op === 'vf') {
            valid = ['toggle', 'add', 'remove'].includes(property) && count(1) && ['hflip', 'vflip'].includes(args[0]);
        } else if (op === 'seek') {
            const flags = (args[0] || 'relative').split('+');
            valid = number(property) && count(0, 1) && flags.every(flag => ['relative', 'absolute', 'absolute-percent', 'relative-percent', 'exact', 'keyframes'].includes(flag)) &&
                flags.filter(flag => !['exact', 'keyframes'].includes(flag)).length <= 1 && !(flags.includes('exact') && flags.includes('keyframes'));
        } else if (['ignore', 'reset-all'].includes(op)) valid = parts.length === 0;
        if (!valid) throw new Error(`Unsupported command or arguments: ${[op, ...parts].join(' ')}`);
        return {op, property, args, reverse, repeat: repeat ?? ['add', 'multiply', 'seek'].includes(op)};
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
    VideoControls.input = {numeric, boolean, shortcut, matches, tokenize, command, parse, resolve};
})();
