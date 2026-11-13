// Brief property feedback, isolated from site styles and outside video transforms.
(() => {
    'use strict';
    const number = value => String(Number(value.toFixed(3)));
    function describe(values) {
        const labels = {
            'video-pan-x': value => `Pan X: ${number(value * 100)}%`,
            'video-pan-y': value => `Pan Y: ${number(value * 100)}%`,
            'video-zoom': value => `Zoom: ${number(2 ** value)}×`,
            'video-rotate': value => `Rotation: ${number(value)}°`,
            speed: value => `Speed: ${number(value)}×`,
            volume: value => `Volume: ${number(value)}%`,
            'audio-delay': value => `Audio delay: ${number(value)} s`,
            pause: value => value ? 'Paused' : 'Playing',
            mute: value => `Mute: ${value ? 'on' : 'off'}`,
            flipX: value => `Horizontal flip: ${value ? 'on' : 'off'}`,
            flipY: value => `Vertical flip: ${value ? 'on' : 'off'}`,
            position: value => {
                const seconds = Math.max(0, Math.floor(value));
                return `Position: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
            },
            reset: () => 'Picture reset'
        };
        return Object.entries(values).map(([key, value]) => labels[key]?.(value)).filter(Boolean).join('\n');
    }
    function create({viewRect, fullscreenElement}) {
        let current, timeout, frame;
        const resize = new ResizeObserver(() => reposition());
        function hide(video) {
            if (!current || (video && current.video !== video)) return;
            clearTimeout(timeout);
            cancelAnimationFrame(frame);
            resize.disconnect();
            current.host.remove();
            current = null;
        }
        function position() {
            if (!current) return;
            if (!current.video.isConnected) { hide(); return; }
            const rect = viewRect(current.video);
            const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
            const width = Math.min(innerWidth, rect.right) - left;
            const height = Math.min(innerHeight, rect.bottom) - top;
            // Keep feedback in the visible part of a partially scrolled video.
            current.message.style.visibility = width > 0 && height > 0 ? 'visible' : 'hidden';
            current.message.style.left = `${left + 12}px`;
            current.message.style.top = `${top + 12}px`;
            current.message.style.maxWidth = `${Math.max(0, width - 24)}px`;
            current.message.style.maxHeight = `${Math.max(0, height - 24)}px`;
        }
        function reposition() {
            if (!current) return;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(position);
        }
        function refresh(video) {
            if (current?.video !== video) return;
            if (!video.isConnected) { hide(); return; }
            const text = describe(current.read());
            if (current.message.textContent !== text) current.message.textContent = text;
        }
        function raise() {
            if (!current) return;
            const {host, message} = current;
            if (typeof message.showPopover === 'function') {
                // A manual popover can sit above a fullscreen video without
                // opening a modal dialog, stealing focus, or blocking clicks.
                if (message.matches(':popover-open')) message.hidePopover();
                message.showPopover();
            } else {
                // Older browsers can still show feedback in ordinary players
                // and fullscreen containers (native video fullscreen needs Popover).
                const full = fullscreenElement();
                const parent = full && !(full instanceof HTMLVideoElement) ? full : document.documentElement;
                if (host.parentNode !== parent) parent.append(host);
            }
            position();
        }
        function show(video, read) {
            hide();
            const host = document.createElement('div');
            host.setAttribute('data-video-controls-osd', '');
            // The host has no layout footprint; all visible styling lives in its root.
            host.style.cssText = 'all:initial!important;position:fixed!important;width:0!important;height:0!important;pointer-events:none!important;z-index:2147483647!important';
            const root = host.attachShadow({mode: 'open'});
            const style = document.createElement('style');
            style.textContent = `
                div { all:initial; position:fixed; inset:auto; margin:0; border:0;
                    box-sizing:border-box; padding:6px 10px; border-radius:4px;
                    color:white; background:rgb(0 0 0 / 65%); font:600 20px/1.4 system-ui,sans-serif;
                    text-shadow:0 1px 2px black; white-space:pre-line; overflow:hidden;
                    overflow-wrap:anywhere; direction:ltr; pointer-events:none;
                    user-select:none; z-index:2147483647; }
                div::backdrop { background:transparent; pointer-events:none; }
            `;
            const message = document.createElement('div');
            message.setAttribute('role', 'status');
            if (typeof message.showPopover === 'function') message.setAttribute('popover', 'manual');
            root.append(style, message);
            document.documentElement.append(host);
            current = {video, host, message, read};
            refresh(video);
            raise();
            resize.observe(video);
            timeout = setTimeout(() => hide(), 1500);
        }
        // Re-raise after entering fullscreen so the newer fullscreen layer cannot
        // cover existing feedback. Scroll/resize updates last only while visible.
        document.addEventListener('fullscreenchange', raise);
        window.addEventListener('scroll', reposition, {capture: true, passive: true});
        window.addEventListener('resize', reposition);
        window.addEventListener('pagehide', () => hide());
        return {show, refresh, hide};
    }
    VideoControls.osd = {create, describe};
})();
