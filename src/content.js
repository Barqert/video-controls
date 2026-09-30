// Adapt the shared input/animation engine to videos in this document or frame.
(() => {
    'use strict';
    const {config, input, engine} = VideoControls;
    const states = new Map();
    let bindings, preferredVideo, inheritedFullscreen = false, animation = null, storageRevision = 0;
    function shadowRoot(element) {
        if (!(element instanceof HTMLElement)) return null;
        // Both browsers grant extensions access without changing attachShadow:
        // Firefox exposes an element property; Chromium exposes a DOM API.
        return element.shadowRoot || element.openOrClosedShadowRoot ||
            chrome.dom?.openOrClosedShadowRoot?.(element) || null;
    }
    function fullscreenElement() {
        let element = document.fullscreenElement || document.webkitFullscreenElement;
        // document.fullscreenElement is retargeted to the host for shadow content.
        while (element) {
            const nested = shadowRoot(element)?.fullscreenElement;
            if (!nested) break;
            element = nested;
        }
        return element;
    }
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

    // Query each tree separately: DOM selectors do not cross shadow boundaries.
    function elementsIn(root, selector) {
        const elements = [...root.querySelectorAll(selector)];
        if (root instanceof Element && root.matches(selector)) elements.unshift(root);
        const ownShadow = shadowRoot(root);
        if (ownShadow) elements.push(...elementsIn(ownShadow, selector));
        for (const element of root.querySelectorAll('*')) {
            const nested = shadowRoot(element);
            if (nested) elements.push(...elementsIn(nested, selector));
        }
        return elements;
    }
    const videosIn = root => elementsIn(root, 'video');
    const parentElement = node => node.assignedSlot || node.parentElement || node.getRootNode()?.host;
    function containsElement(container, element) {
        for (let current = element; current; current = parentElement(current)) {
            if (current === container) return true;
        }
        return false;
    }
    function activeElement() {
        let element = document.activeElement;
        while (element) {
            const nested = shadowRoot(element)?.activeElement;
            if (!nested) break;
            element = nested;
        }
        return element;
    }
    function eventElements(event) {
        const path = event.composedPath();
        let element = path.find(node => node instanceof Element);
        const keyboard = event.type === 'keydown';
        if (keyboard) element = activeElement() || element;
        // Closed roots hide their inner event path. Recover the focused element
        // for keys, or hit-test inside each root for mouse input and overlays.
        const visited = new Set();
        while (element && !visited.has(element)) {
            visited.add(element);
            const root = shadowRoot(element);
            const nested = keyboard ? root?.activeElement : root?.elementFromPoint(event.clientX, event.clientY);
            if (!nested || nested === element) break;
            element = nested;
        }
        const innerPath = [];
        for (let node = element; node; node = parentElement(node)) innerPath.push(node);
        return [...innerPath, ...path];
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
        preferredVideo = eventElements(event).find(node => node instanceof HTMLVideoElement) || preferredVideo;
    }, true);
    function stateFor(video) {
        if (!states.has(video)) {
            states.set(video, {
                model: engine.create({speed: video.playbackRate, volume: video.volume * 100, pause: video.paused, mute: video.muted}),
                originals: null, last: {}
            });
            observeVideoRoots();
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
    // Web Audio routing cannot be undone, so it outlives per-video state and
    // is created only when a delay is first requested.
    const audioGraphs = new WeakMap();
    function audioRoutable(video) {
        // Cross-origin media without CORS, and encrypted media, would become permanently silent.
        if (video.mediaKeys) return false;
        if (video.srcObject) return true;
        if (!video.currentSrc) return false;
        const url = new URL(video.currentSrc, location.href);
        return ['blob:', 'data:'].includes(url.protocol) || url.origin === location.origin || video.crossOrigin !== null;
    }
    function audioGraph(video) {
        if (audioGraphs.has(video)) return audioGraphs.get(video);
        if (!audioRoutable(video)) throw new Error('cross-origin or encrypted media cannot be routed through Web Audio');
        const context = new AudioContext();
        let source;
        try { source = context.createMediaElementSource(video); }
        catch (error) { context.close(); throw error; }
        const graph = {context, delay: null};
        const flush = () => {
            // A new delay line drops audio buffered before a seek.
            const delayTime = graph.delay?.delayTime.value ?? 0;
            graph.delay?.disconnect();
            source.disconnect();
            graph.delay = new DelayNode(context, {maxDelayTime: engine.clamp('audio-delay', Infinity), delayTime});
            source.connect(graph.delay).connect(context.destination);
        };
        // Freeze the delay line with the video so buffered audio neither leaks nor is lost.
        const follow = () => (video.paused || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA ? context.suspend() : context.resume()).catch(() => {});
        flush();
        video.addEventListener('seeking', flush);
        for (const type of ['play', 'playing', 'pause', 'waiting']) video.addEventListener(type, follow);
        follow();
        audioGraphs.set(video, graph);
        return graph;
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
            // CSS applies transforms right to left. Zoom the entire panned
            // picture last, around the fixed center of the original video box.
            // Keep flips inside translation so they do not reverse pan direction.
            video.style.setProperty('transform', `scale(${scale}) translate(${values['video-pan-x'] * 100}%, ${values['video-pan-y'] * 100}%) rotate(${values['video-rotate']}deg) scale(${m.flipX ? -1 : 1}, ${m.flipY ? -1 : 1})${state.baseTransform}`, 'important');
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
        const delay = values['audio-delay'];
        if (Math.abs(delay - (audioGraphs.get(video)?.delay.delayTime.value ?? 0)) > 1e-6) {
            try { audioGraph(video).delay.delayTime.value = delay; }
            catch (error) {
                engine.set(m, 'audio-delay', 0);
                console.warn('Video Controls: cannot delay audio', error);
            }
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
        // A reattached video starts with fresh state, so its routing must be neutral too.
        const graph = audioGraphs.get(video);
        if (graph) graph.delay.delayTime.value = 0;
        states.delete(video);
        observeVideoRoots();
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
    const removalObserver = new MutationObserver(() => {
        for (const [video, state] of states) if (!video.isConnected) cleanup(video, state);
    });
    function observeVideoRoots() {
        // Document observers cannot see removals inside shadow trees. Observe the
        // roots containing controlled videos and release them when state is removed.
        removalObserver.disconnect();
        const roots = new Set([document]);
        for (const video of states.keys()) {
            let root = video.getRootNode();
            while (root instanceof ShadowRoot) {
                roots.add(root);
                root = root.host.getRootNode();
            }
        }
        for (const root of roots) removalObserver.observe(root, {childList: true, subtree: true});
    }
    observeVideoRoots();

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
    function editing(event) {
        return event.isComposing || eventElements(event).some(node => node instanceof Element &&
            (node.matches('input, textarea, select, [role="textbox"], [role="slider"]') || node.isContentEditable));
    }
    function execute(video, binding, scale = 1) {
        preferredVideo = video;
        const state = stateFor(video), now = performance.now();
        syncMedia(video, state);
        for (const original of binding.commands) {
            const cmd = input.scaleCommand(original, scale);
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
    }
    const resolve = event => input.resolve(bindings, isFullscreen(), event);
    document.addEventListener('keydown', event => {
        // Leave text editing, sliders, and IME composition to the page.
        if (editing(event)) return;
        const binding = resolve(event);
        if (!binding) return;
        const video = target();
        if (!video) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.repeat && !binding.commands[0].repeat) return;
        execute(video, binding);
    }, true);
    function mouseTarget(event) {
        if (editing(event) || eventElements(event).some(node => node instanceof Element &&
            node.matches('button, a[href], [role="button"], [role="menuitem"]'))) return null;
        const candidates = videosIn(fullscreenElement() || document).filter(visible);
        // A mouse binding targets the video under the pointer, never an unrelated
        // playing video elsewhere on the page. Player overlays share its rectangle.
        const direct = eventElements(event).find(node => candidates.includes(node));
        if (direct) return direct;
        return candidates.filter(video => {
            const rect = video.getBoundingClientRect();
            return event.clientX >= rect.left && event.clientX <= rect.right &&
                event.clientY >= rect.top && event.clientY <= rect.bottom;
        }).sort((a, b) => {
            const aRect = a.getBoundingClientRect(), bRect = b.getBoundingClientRect();
            return aRect.width * aRect.height - bRect.width * bRect.height;
        })[0];
    }
    VideoControls.pointer.install({resolve, select: mouseTarget, execute, activate: video => {
        // Bound mousedown events cancel native focus changes. Explicitly leave
        // the previous input so subsequent keys control the selected video.
        window.focus();
        activeElement()?.blur();
        video.focus({preventScroll: true});
        preferredVideo = video;
    }});

    // A fullscreen iframe does not expose its parent's fullscreenElement.
    // Propagate only the mode flag, and only between direct parent/child frames.
    function updateFrames() {
        const full = fullscreenElement();
        for (const frame of elementsIn(document, 'iframe')) {
            frame.contentWindow?.postMessage({videoControlsMode: true, fullscreen: Boolean(inheritedFullscreen || (full && containsElement(full, frame)))}, '*');
        }
    }
    window.addEventListener('message', event => {
        if (event.source === parent && parent !== window && event.data?.videoControlsMode === true && typeof event.data.fullscreen === 'boolean') {
            inheritedFullscreen = event.data.fullscreen;
            updateFrames();
        } else if (event.data?.videoControlsRequest === true && elementsIn(document, 'iframe').some(frame => frame.contentWindow === event.source)) updateFrames();
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
