// Deterministic clocks verify seek arithmetic independently of decoder timing.
const {test} = require('node:test');
const assert = require('node:assert/strict');
require('../src/config.js');
require('../src/playback.js');
function fixture(ranges = [[0, 100]]) {
    const video = Object.assign(new EventTarget(), {
        playbackRate: 16, currentTime: 0, duration: 100,
        paused: false, ended: false, seeking: false, readyState: 4,
        seekable: {length: ranges.length, start: i => ranges[i][0], end: i => ranges[i][1]}
    });
    return {video, controller: VideoControls.playback.create(video)};
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('32× adds only the progress missing from 16× native playback, in batched seeks', () => {
    const {video, controller} = fixture();
    controller.update(32, 0);
    video.currentTime = .8; // Native progress after 50 ms.
    controller.update(32, 50);
    near(video.currentTime, .8);
    video.currentTime = 1.6;
    controller.update(32, 100);
    near(video.currentTime, 3.2);
    // Varying speed integrates adjacent samples instead of keeping the old boost.
    controller.update(24, 200);
    near(video.currentTime, 4.4);
});
test('returning to native speed cancels partial skips', () => {
    const {video, controller} = fixture();
    controller.update(32, 0);
    controller.update(32, 80);
    video.playbackRate = 8;
    controller.update(8, 100);
    controller.update(8, 1000);
    near(video.currentTime, 0);
    video.playbackRate = 16;
    controller.update(32, 1100);
    controller.update(32, 1200);
    near(video.currentTime, 1.6);
});
test('paused, ended, buffering, seeking, and non-seekable media never accumulate skips', () => {
    for (const blocked of [{paused: true}, {ended: true}, {readyState: 2}, {seeking: true}, {seekable: {length: 0}}]) {
        const {video, controller} = fixture();
        const original = Object.fromEntries(Object.keys(blocked).map(key => [key, video[key]]));
        controller.update(32, 0);
        controller.update(32, 80);
        Object.assign(video, blocked);
        controller.update(32, 100);
        controller.update(32, 10000);
        near(video.currentTime, 0);
        Object.assign(video, original);
        controller.update(32, 10100);
        controller.update(32, 10200);
        near(video.currentTime, 1.6);
    }
});
test('playback interruptions and background suspension discard pending progress', () => {
    for (const event of ['pause', 'playing', 'waiting', 'seeking', 'seeked', 'emptied', 'ended']) {
        const {video, controller} = fixture();
        controller.update(32, 0);
        controller.update(32, 80);
        video.dispatchEvent(new Event(event));
        controller.update(32, 10000);
        near(video.currentTime, 0);
        controller.update(32, 10100);
        near(video.currentTime, 1.6);
    }
    const {video, controller} = fixture();
    controller.update(32, 0);
    controller.update(32, 80);
    controller.update(32, 10000);
    near(video.currentTime, 0);
    controller.update(32, 10100);
    near(video.currentTime, 1.6);
});
test('seeks stay within duration and live ranges, crossing gaps only forwards', () => {
    const {video, controller} = fixture([[10, 20], [30, 40]]);
    video.duration = Infinity;
    video.currentTime = 19;
    controller.update(32, 0);
    controller.update(32, 100);
    near(video.currentTime, 30);
    // Even extremely large requested rates produce a finite, bounded seek.
    controller.update(Number.MAX_VALUE, 200);
    near(video.currentTime, 40);
    video.currentTime = 45;
    controller.update(Number.MAX_VALUE, 300);
    near(video.currentTime, 45);
    const finite = fixture();
    finite.video.duration = 1;
    finite.controller.update(32, 0);
    finite.controller.update(32, 100);
    near(finite.video.currentTime, 1);
});
