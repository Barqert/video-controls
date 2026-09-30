// Own the complete mouse gesture so a bound click does not also reach the player.
(() => {
    'use strict';
    const {input} = VideoControls;
    function install({resolve, select, execute, activate}) {
        const pressed = new Map();
        const suppressed = new Map();
        let lastClick = null;
        const consume = event => { event.preventDefault(); event.stopImmediatePropagation(); };
        function gesture(event) {
            const name = input.mouseButtons[event.button];
            if (!name) return null;
            const key = input.mouseInput(event, name);
            const single = resolve(key);
            const double = event.button < 3 ? resolve(input.mouseInput(event, `${name}_DBL`)) : null;
            if (!single && !double) return null;
            const video = select(event);
            return video ? {video, single, double, key, x: event.clientX, y: event.clientY} : null;
        }
        document.addEventListener('pointerdown', event => {
            // Prevent page pointer handlers too, but keep compatibility mouse events.
            if (event.pointerType === 'mouse' && gesture(event)) event.stopImmediatePropagation();
        }, true);
        document.addEventListener('mousedown', event => {
            suppressed.delete(event.button);
            const action = gesture(event);
            if (!action) { lastClick = null; return; }
            pressed.set(event.button, action);
            consume(event);
            activate(action.video);
        }, true);
        document.addEventListener('pointerup', event => {
            if (event.pointerType === 'mouse' && pressed.has(event.button)) event.stopImmediatePropagation();
        }, true);
        document.addEventListener('mouseup', event => {
            const action = pressed.get(event.button);
            if (!action) return;
            pressed.delete(event.button);
            consume(event);
            const now = performance.now();
            suppressed.set(event.button, now);
            // Do not turn a drag or release over a player control into a shortcut.
            if (!action.video.isConnected || select(event) !== action.video ||
                Math.hypot(event.clientX - action.x, event.clientY - action.y) > 6) {
                lastClick = null;
                return;
            }
            const signature = JSON.stringify(action.key);
            const isDouble = lastClick && now - lastClick.time <= 400 &&
                lastClick.video === action.video && lastClick.signature === signature &&
                Math.hypot(event.clientX - lastClick.x, event.clientY - lastClick.y) <= 6;
            // Like mpv, the first click can run its single binding immediately.
            // The second runs the double binding when one exists, otherwise single.
            const binding = isDouble && action.double ? action.double : action.single;
            if (binding) execute(action.video, binding);
            lastClick = isDouble ? null : {video: action.video, signature, time: now, x: event.clientX, y: event.clientY};
        }, true);
        for (const name of ['click', 'auxclick', 'dblclick', 'contextmenu']) {
            document.addEventListener(name, event => {
                // Context menus can appear before mouseup; clicks appear after it.
                if (pressed.has(event.button) || performance.now() - (suppressed.get(event.button) ?? -Infinity) < 1000) consume(event);
            }, true);
        }
        document.addEventListener('wheel', event => {
            const key = input.wheelInput(event);
            if (!key) return;
            const binding = resolve(key);
            if (!binding) return;
            const video = select(event);
            if (!video) return;
            consume(event);
            execute(video, binding, key.scale);
        }, {capture: true, passive: false});
        const clear = () => { pressed.clear(); suppressed.clear(); lastClick = null; };
        window.addEventListener('blur', clear);
        window.addEventListener('pagehide', clear);
        document.addEventListener('pointercancel', clear, true);
    }
    VideoControls.pointer = {install};
})();
