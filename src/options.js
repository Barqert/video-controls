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
    let savedValues = null;
    let saving = false;
    const readValues = () => Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.value]));
    const updateSaveState = () => {
        // Compare text with the last successful save, so undoing edits is clean too.
        dirty = savedValues !== null && Object.entries(fields).some(([name, field]) => field.value !== savedValues[name]);
        save.disabled = savedValues === null || saving || !dirty;
    };
    const fill = values => {
        for (const [name, field] of Object.entries(fields)) field.value = typeof values?.[name] === 'string' ? values[name] : config.defaults[name];
    };
    // Prevent slow initial reads from overwriting edits made before storage loads.
    for (const field of Object.values(fields)) field.disabled = true;
    chrome.storage.local.get(config.storageKey).then(result => {
        fill(result[config.storageKey]);
        savedValues = readValues();
        status.textContent = '';
        for (const field of Object.values(fields)) field.disabled = false;
        defaults.disabled = false;
        updateSaveState();
    }).catch(error => { status.textContent = `Could not load settings: ${error.message}. Reload this page to retry.`; });
    form.addEventListener('input', () => {
        updateSaveState();
        status.textContent = saving ? 'Saving…' : dirty ? '*Unsaved changes.' : 'No unsaved changes.';
    });
    defaults.addEventListener('click', () => {
        fill(config.defaults);
        updateSaveState();
        errors.hidden = true;
        status.textContent = dirty ? 'Defaults loaded into the editor. Save to apply.' : 'No unsaved changes.';
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (savedValues === null || saving || !dirty) return;
        const values = readValues();
        const issues = Object.entries(values).flatMap(([name, value]) => input.parse(value).errors.map(error => `${labels[name]} — ${error}`));
        errors.hidden = issues.length === 0;
        errors.textContent = issues.join('\n');
        if (issues.length) { status.textContent = 'Not saved. Correct the errors below.'; return; }
        saving = true;
        updateSaveState();
        status.textContent = 'Saving…';
        try {
            await chrome.storage.local.set({[config.storageKey]: values});
            savedValues = values;
            // Edits typed while saving still need a subsequent save.
            updateSaveState();
            status.textContent = dirty ? 'Saved. New edits are still unsaved.' : 'Saved.';
        } catch (error) { status.textContent = `Could not save: ${error.message}`; }
        finally { saving = false; updateSaveState(); }
    });
    document.addEventListener('keydown', event => {
        if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || event.key.toLowerCase() !== 's') return;
        // Suppress the browser's Save Page dialog even when there is nothing to save.
        event.preventDefault();
        if (!event.repeat && !save.disabled) form.requestSubmit();
    });
    window.addEventListener('beforeunload', event => {
        if (dirty) { event.preventDefault(); event.returnValue = ''; }
    });
})();
