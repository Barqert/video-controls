// Pure property arithmetic: effects share a baseline, never competing timers.
(() => {
    'use strict';
    const defaults = {'video-pan-x': 0, 'video-pan-y': 0, 'video-zoom': 0, 'video-rotate': 0, speed: 1, volume: 100, pause: true, mute: false};
    const clamp = (property, value) => {
        const limits = {speed: [0.0625, 16], volume: [0, 100], 'video-zoom': [-10, 10], 'video-pan-x': [-100, 100], 'video-pan-y': [-100, 100], 'video-rotate': [-360000, 360000]};
        const [min, max] = limits[property] || [-Number.MAX_VALUE, Number.MAX_VALUE];
        return Math.min(max, Math.max(min, value));
    };
    function create(initial = {}) { return {base: {...defaults, ...initial}, effects: {}, flipX: false, flipY: false}; }
    function value(state, property, now) {
        // Discard each effect after 20 half-lives, restoring the exact baseline.
        const effects = (state.effects[property] || []).filter(effect => now - effect.start < effect.halfLife * 20000);
        state.effects[property] = effects;
        if (!effects.length) return state.base[property];
        // Weighted interpolation preserves tiny X at t=0; log-space composition
        // avoids intermediate overflow/underflow for reciprocal multipliers.
        const logFactor = effects.reduce((sum, effect) => {
            const weight = 2 ** (-(now - effect.start) / (effect.halfLife * 1000));
            return sum + Math.log(effect.factor * weight + (1 - weight));
        }, 0);
        const base = state.base[property];
        return clamp(property, base === 0 ? 0 : Math.sign(base) * Math.exp(Math.log(Math.abs(base)) + logFactor));
    }
    function set(state, property, next) {
        state.base[property] = typeof next === 'number' ? clamp(property, next) : next;
        delete state.effects[property];
    }
    function execute(state, cmd, now) {
        const {op, property, args} = cmd;
        if (op === 'reset-all') {
            for (const name of Object.keys(defaults).filter(name => name.startsWith('video-'))) set(state, name, 0);
            state.flipX = state.flipY = false;
        } else if (op === 'vf') {
            const name = args[0] === 'hflip' ? 'flipX' : 'flipY';
            state[name] = property === 'toggle' ? !state[name] : property === 'add';
        } else if (op === 'multiply-decay') {
            (state.effects[property] ||= []).push({factor: Number(args[0]), halfLife: Number(args[1]), start: now});
        } else if (op === 'set') {
            set(state, property, VideoControls.input.boolean.includes(property) ? args[0] === 'yes' : Number(args[0]));
        } else if (op === 'cycle') set(state, property, !state.base[property]);
        else if (op === 'cycle-values') {
            const values = args.map(arg => VideoControls.input.boolean.includes(property) ? arg === 'yes' : Number(arg));
            const current = typeof state.base[property] === 'number' ? value(state, property, now) : state.base[property];
            const index = values.indexOf(current);
            set(state, property, values[index < 0 ? (cmd.reverse ? values.length - 1 : 0) : (index + (cmd.reverse ? -1 : 1) + values.length) % values.length]);
        } else if (op === 'add' || op === 'multiply') {
            // Relative edits change the baseline and preserve active decay factors.
            const next = op === 'add' ? Math.round((state.base[property] + Number(args[0] ?? 1)) * 1e6) / 1e6 : state.base[property] * Number(args[0]);
            state.base[property] = clamp(property, next);
        }
    }
    const active = state => Object.values(state.effects).some(effects => effects.length > 0);
    VideoControls.engine = {defaults, clamp, create, value, set, execute, active};
})();
