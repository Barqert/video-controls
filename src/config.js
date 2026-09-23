// Shared defaults keep the options editor and content scripts in sync.
globalThis.VideoControls = globalThis.VideoControls || {};
VideoControls.config = {
    storageKey: 'inputConfigs',
    defaults: {
    "common": `LEFT    seek -5
RIGHT    multiply-decay speed 4 0.5

Alt+left  add video-pan-x -0.02
Alt+right add video-pan-x  0.02
Alt+up    add video-pan-y -0.02
Alt+down  add video-pan-y  0.02
Alt+Shift+left  add video-pan-x -0.005
Alt+Shift+right add video-pan-x  0.005
Alt+Shift+up    add video-pan-y -0.005
Alt+Shift+down  add video-pan-y  0.005

Alt+=     add video-zoom   0.04
Alt+-     add video-zoom  -0.04
Alt++     add video-zoom   0.01 # Shift+Alt+=
Alt+_     add video-zoom  -0.01 # Shift+Alt+-

Ctrl+Alt+UP    set video-rotate 0
Ctrl+Alt+RIGHT cycle-values video-rotate 0 90 180 270
Ctrl+Alt+LEFT  cycle-values video-rotate 270 180 90 0
Ctrl+Alt+Shift+LEFT   vf toggle hflip
Ctrl+Alt+Shift+RIGHT  vf toggle hflip
Ctrl+Alt+Shift+UP     vf toggle vflip
Ctrl+Alt+Shift+DOWN   vf toggle vflip
Ctrl+Shift+LEFT     add video-rotate -3
Ctrl+Shift+RIGHT    add video-rotate 3

Alt+BACKSPACE reset-all
    `,
    "fullscreen": "",
    "windowed": ""
}
};
