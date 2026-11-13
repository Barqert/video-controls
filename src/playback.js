// Supplement native playback with forward seeks for speeds above 16×.
(() => {
    'use strict';
    const nativeLimit = 16;
    function create(video) {
        let previousTime = null, previousExtra = 0, elapsed = 0, pending = 0, warned = false;
        function reset() {
            previousTime = null;
            previousExtra = elapsed = pending = 0;
        }
        // Discard unfinished skips when playback is interrupted or the user seeks.
        // Our own seeks also reset the clock, allowing the decoder to catch up.
        const events = ['pause', 'playing', 'waiting', 'seeking', 'seeked', 'emptied', 'ended'];
        for (const type of events) video.addEventListener(type, reset);
        function update(speed, now) {
            const extra = Math.max(0, speed - video.playbackRate);
            if (speed <= nativeLimit || !extra || video.paused || video.ended || video.seeking ||
                video.readyState < 3 || !video.seekable.length) {
                reset();
                return;
            }
            const delta = previousTime === null ? 0 : now - previousTime;
            if (delta < 0 || delta > 250) {
                // A suspended tab must not jump through minutes of video on return.
                reset();
            } else {
                // Integrate only the speed native playback is missing. Averaging
                // adjacent samples also follows smoothly changing decay effects.
                pending += (previousExtra / 2 + extra / 2) * delta / 1000;
                elapsed += delta;
            }
            previousTime = now;
            previousExtra = extra;
            if (elapsed < 100) return;
            const ranges = video.seekable;
            const end = Math.min(ranges.end(ranges.length - 1), Number.isFinite(video.duration) ? video.duration : Infinity);
            let next = Math.min(video.currentTime + pending, end);
            // Respect the available range of live/DVR streams and cross gaps
            // forwards rather than seeking into a hole or back behind the playhead.
            for (let i = 0; i < ranges.length; i++) {
                if (next <= ranges.end(i)) {
                    next = Math.min(Math.max(next, ranges.start(i)), end);
                    break;
                }
            }
            elapsed = pending = 0;
            if (Number.isFinite(next) && next > video.currentTime) {
                try { video.currentTime = next; }
                catch (error) {
                    // Some players reject seeking even with a reported range.
                    // Keep native playback running without flooding the console.
                    if (!warned) console.warn('Video Controls: cannot seek for high-speed playback', error);
                    warned = true;
                    reset();
                }
            }
        }
        return {update, dispose() {
            for (const type of events) video.removeEventListener(type, reset);
            reset();
        }};
    }
    VideoControls.playback = {nativeLimit, create};
})();
