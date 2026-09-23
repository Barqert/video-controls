// Make the toolbar button a direct route to the configuration editor.
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
