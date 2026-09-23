// Validate all three editors before one atomic local-storage write.
(() => {
    'use strict';
    const {config, input} = VideoControls;
    const form = document.querySelector('#settings');
    const status = document.querySelector('#status');
    const errors = document.querySelector('#errors');
    const save = document.querySelector('#save');
    const defaults = document.querySelector('#defaults');
    const fields = Object.fromEntries(Object.keys(config.defaults).map(name => [name, document.getElementById(name)]));
    const labels = {common: 'Common', fullscreen: 'Fullscreen only', windowed: 'Non-fullscreen only'};
    let dirty = false;
    const fill = values => {
        for (const [name, field] of Object.entries(fields)) field.value = typeof values?.[name] === 'string' ? values[name] : config.defaults[name];
    };
    // Prevent slow initial reads from overwriting edits made before storage loads.
    for (const field of Object.values(fields)) field.disabled = true;
    chrome.storage.local.get(config.storageKey).then(result => {
        fill(result[config.storageKey]);
        status.textContent = 'Settings loaded.';
        for (const field of Object.values(fields)) field.disabled = false;
        save.disabled = defaults.disabled = false;
    }).catch(error => { status.textContent = `Could not load settings: ${error.message}. Reload this page to retry.`; });
    form.addEventListener('input', () => { dirty = true; status.textContent = 'Unsaved changes.'; });
    defaults.addEventListener('click', () => {
        fill(config.defaults);
        dirty = true;
        errors.hidden = true;
        status.textContent = 'Defaults loaded into the editor. Save to apply.';
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const values = Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.value]));
        const issues = Object.entries(values).flatMap(([name, value]) => input.parse(value).errors.map(error => `${labels[name]} — ${error}`));
        errors.hidden = issues.length === 0;
        errors.textContent = issues.join('\n');
        if (issues.length) { status.textContent = 'Not saved. Correct the errors below.'; return; }
        save.disabled = true;
        try {
            await chrome.storage.local.set({[config.storageKey]: values});
            // Edits typed while saving still need a subsequent save.
            dirty = Object.entries(fields).some(([name, field]) => field.value !== values[name]);
            status.textContent = dirty ? 'Saved. New edits are still unsaved.' : 'Saved. Open pages now use these configurations.';
        } catch (error) { status.textContent = `Could not save: ${error.message}`; }
        finally { save.disabled = false; }
    });
    window.addEventListener('beforeunload', event => {
        if (dirty) { event.preventDefault(); event.returnValue = ''; }
    });
})();
