// Background service worker — minimal, handles message routing

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_PROFILE') {
    chrome.storage.local.get('profile', (data) => {
      sendResponse({ profile: data.profile || null });
    });
    return true; // keep channel open for async response
  }
});
