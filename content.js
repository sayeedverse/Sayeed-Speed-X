
// Sayeed Speed X v1.0
// This content script is only a bridge. Playback control itself runs once
// in the page MAIN world, so it does not fight with another controller.
chrome.runtime.sendMessage({ action: "pageReady" }, () => {
  void chrome.runtime.lastError;
});
