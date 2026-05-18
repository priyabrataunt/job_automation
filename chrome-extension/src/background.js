// Background service worker — handles message routing, proxied fetch, and side panel

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.warn);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_PROFILE') {
    chrome.storage.local.get('profile', (data) => {
      sendResponse({ profile: data.profile || null });
    });
    return true;
  }

  // Proxy fetch requests from content script → backend (avoids mixed content block
  // when content script runs on https:// pages but backend is http://localhost).
  if (message.type === 'FETCH_PROXY') {
    const { url, options } = message;
    fetch(url, {
      method: options?.method || 'GET',
      headers: options?.headers || {},
      body: options?.body || undefined,
    })
      .then(async (res) => {
        const text = await res.text();
        sendResponse({ ok: res.ok, status: res.status, body: text });
      })
      .catch((err) => {
        sendResponse({ ok: false, status: 0, body: '', error: err.message || String(err) });
      });
    return true;
  }
});
