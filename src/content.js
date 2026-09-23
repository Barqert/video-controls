// Adapt the shared input/animation engine to videos in this document or frame.
(() => {
    'use strict';
    const {config, input, engine} = VideoControls;
    const states = new Map();
    let bindings, preferredVideo, inheritedFullscreen = false, animation = null, storageRevision = 0;
    const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
    const isFullscreen = () => Boolean(fullscreenElement() || inheritedFullscreen);
    function load(raw) {
        const parsed = {};
        for (const name of Object.keys(config.defaults)) {
            const result = input.parse(typeof raw?.[name] === 'string' ? raw[name] : config.defaults[name]);
            if (result.errors.length) console.warn(`Video Controls (${name}):`, ...result.errors);
            parsed[name] = result.bindings;
        }
        bindings = parsed;
    }
    load(config.defaults);
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[config.storageKey]) {
            storageRevision++;
            load(changes[config.storageKey].newValue);
        }
    });
    const initialRevision = storageRevision;
    chrome.storage.local.get(config.storageKey).then(result => {
        if (storageRevision === initialRevision) load(result[config.storageKey]);
    }).catch(error => console.warn('Video Controls: could not load settings', error));

    // Traverse open shadow roots as well as ordinary player containers.
    function videosIn(root) {
        const videos = [...root.querySelectorAll('video')];
        if (root instanceof HTMLVideoElement) videos.unshift(root);
        if (root.shadowRoot) videos.push(...videosIn(root.shadowRoot));
        for (const element of root.querySelectorAll('*')) {
            if (element.shadowRoot) videos.push(...videosIn(element.shadowRoot));
        }
        return videos;
    }
    function visible(video) {
        const rect = video.getBoundingClientRect();
        const style = getComputedStyle(video);
        const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
        // Our transforms can move a selected video offscreen. Keep it reachable
        // so a subsequent pan/reset can bring it back into the viewport.
        const controlled = video === preferredVideo && states.get(video)?.originals;
        return video.isConnected && rect.width > 0 && rect.height > 0 && (inViewport || controlled) &&
            style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }
    function target() {
        const candidates = videosIn(fullscreenElement() || document).filter(visible);
        if (candidates.includes(preferredVideo)) return preferredVideo;
        // Prefer playback, then screen area, when the user has not selected a video.
        return candidates.sort((a, b) => Number(!b.paused && !b.ended) - Number(!a.paused && !a.ended) ||
            b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
    }
    document.addEventListener('pointerdown', event => {
        preferredVideo = event.composedPath().find(node => node instanceof HTMLVideoElement) || preferredVideo;
    }, true);
    function stateFor(video) {
        if (!states.has(video)) {
            states.set(video, {
                model: engine.create({speed: video.playbackRate, volume: video.volume * 100, pause: video.paused, mute: video.muted}),
                originals: null, last: {}
            });
        }
        return states.get(video);
    }
    function restoreStyle(video, state) {
        if (!state.originals) return;
        for (const [property, [value, priority]] of Object.entries(state.originals)) {
            if (value) video.style.setProperty(property, value, priority);
            else video.style.removeProperty(property);
        }
        state.originals = null;
    }
    function syncMedia(video, state) {
        for (const [name, value] of Object.entries({speed: video.playbackRate, volume: video.volume * 100, pause: video.paused, mute: video.muted})) {
            // A site's player controls take ownership if they change the actual value.
            if (state.last[name] === undefined || Math.abs(state.last[name] - value) > 1e-8) engine.set(state.model, name, value);
        }
    }
    function render(video, state, now) {
        const values = Object.fromEntries(input.numeric.map(name => [name, engine.value(state.model, name, now)]));
        const m = state.model;
        const neutral = ['video-pan-x', 'video-pan-y', 'video-zoom', 'video-rotate'].every(name => values[name] === 0) && !m.flipX && !m.flipY;
        if (neutral) restoreStyle(video, state);
        else {
            if (!state.originals) {
                state.originals = Object.fromEntries(['transform', 'transform-origin'].map(name => [name, [video.style.getPropertyValue(name), video.style.getPropertyPriority(name)]]));
                const base = getComputedStyle(video).transform;
                state.baseTransform = base === 'none' ? '' : ` ${base}`;
            }
            const scale = 2 ** values['video-zoom'];
            video.style.setProperty('transform-origin', 'center center', 'important');
            video.style.setProperty('transform', `translate(${values['video-pan-x'] * 100}%, ${values['video-pan-y'] * 100}%) rotate(${values['video-rotate']}deg) scale(${scale * (m.flipX ? -1 : 1)}, ${scale * (m.flipY ? -1 : 1)})${state.baseTransform}`, 'important');
        }
        for (const [property, name, desired] of [['playbackRate', 'speed', values.speed], ['volume', 'volume', values.volume / 100], ['muted', 'mute', m.base.mute]]) {
            if (video[property] !== desired) {
                try { video[property] = desired; }
                catch (error) {
                    engine.set(m, name, name === 'volume' ? video[property] * 100 : video[property]);
                    console.warn(`Video Controls: browser rejected ${name}`, error);
                }
            }
            state.last[name] = name === 'volume' ? video[property] * 100 : video[property];
        }
    }
    function cleanup(video, state) {
        restoreStyle(video, state);
        // Detached videos must not retain a temporary media boost when reused.
        for (const [name, property] of [['speed', 'playbackRate'], ['volume', 'volume']]) {
            if (state.model.effects[name]?.length) {
                try { video[property] = state.model.base[name] / (name === 'volume' ? 100 : 1); } catch { /* The media element may already be torn down. */ }
            }
        }
        states.delete(video);
    }
    function tick(now) {
        animation = null;
        for (const [video, state] of states) {
            if (!video.isConnected) cleanup(video, state);
            else if (engine.active(state.model)) {
                syncMedia(video, state);
                render(video, state, now);
            }
        }
        schedule();
    }
    function schedule() {
        if (animation === null && [...states.values()].some(state => engine.active(state.model))) animation = requestAnimationFrame(tick);
    }
    new MutationObserver(() => {
        for (const [video, state] of states) if (!video.isConnected) cleanup(video, state);
    }).observe(document, {childList: true, subtree: true});

    function seek(video, cmd) {
        const flags = (cmd.args[0] || 'relative').split('+');
        let amount = Number(cmd.property);
        if (flags.some(flag => flag.endsWith('percent'))) {
            if (!Number.isFinite(video.duration)) return;
            amount *= video.duration / 100;
        }
        const absolute = flags.includes('absolute') || flags.includes('absolute-percent');
        const next = Math.max(0, Math.min(Number.isFinite(video.duration) ? video.duration : Infinity, (absolute ? 0 : video.currentTime) + amount));
        if (flags.includes('keyframes') && video.fastSeek) video.fastSeek(next);
        else video.currentTime = next;
    }
    document.addEventListener('keydown', event => {
        // Leave text editing, sliders, and IME composition to the page.
        if (event.isComposing || event.composedPath().some(node => node instanceof Element &&
            (node.matches('input, textarea, select, [role="textbox"], [role="slider"]') || node.isContentEditable))) return;
        const binding = input.resolve(bindings, isFullscreen(), event);
        if (!binding) return;
        const video = target();
        if (!video) return;
        preferredVideo = video;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.repeat && !binding.commands[0].repeat) return;
        const state = stateFor(video), now = performance.now();
        syncMedia(video, state);
        for (const cmd of binding.commands) {
            try {
                if (cmd.op === 'seek') seek(video, cmd);
                else engine.execute(state.model, cmd, now);
            } catch (error) { console.warn('Video Controls: command failed', error); }
        }
        if (state.model.base.pause !== video.paused) {
            if (state.model.base.pause) video.pause();
            else video.play().catch(error => console.warn('Video Controls: playback was rejected', error));
        }
        state.last.pause = video.paused;
        render(video, state, now);
        schedule();
    }, true);

    // A fullscreen iframe does not expose its parent's fullscreenElement.
    // Propagate only the mode flag, and only between direct parent/child frames.
    function updateFrames() {
        const full = fullscreenElement();
        for (const frame of document.querySelectorAll('iframe')) {
            frame.contentWindow?.postMessage({videoControlsMode: true, fullscreen: Boolean(inheritedFullscreen || (full && (full === frame || full.contains(frame))))}, '*');
        }
    }
    window.addEventListener('message', event => {
        if (event.source === parent && parent !== window && event.data?.videoControlsMode === true && typeof event.data.fullscreen === 'boolean') {
            inheritedFullscreen = event.data.fullscreen;
            updateFrames();
        } else if (event.data?.videoControlsRequest === true && [...document.querySelectorAll('iframe')].some(frame => frame.contentWindow === event.source)) updateFrames();
    });
    document.addEventListener('fullscreenchange', updateFrames);
    document.addEventListener('webkitfullscreenchange', updateFrames);
    if (parent !== window) parent.postMessage({videoControlsRequest: true}, '*');
    updateFrames();
    window.addEventListener('pagehide', () => {
        for (const [video, state] of states) cleanup(video, state);
        if (animation !== null) cancelAnimationFrame(animation);
        animation = null;
    });
})();
