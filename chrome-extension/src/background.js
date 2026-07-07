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
    const timeoutMs = Math.min(Math.max(Number(message.timeoutMs) || 30000, 1000), 120000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    fetch(url, {
      method: options?.method || 'GET',
      headers: options?.headers || {},
      body: options?.body || undefined,
      signal: controller.signal,
    })
      .then(async (res) => {
        clearTimeout(timer);
        const text = await res.text();
        sendResponse({ ok: res.ok, status: res.status, body: text });
      })
      .catch((err) => {
        clearTimeout(timer);
        const error = err?.name === 'AbortError'
          ? `Backend request timed out after ${Math.round(timeoutMs / 1000)}s`
          : err?.message === 'Failed to fetch'
            ? 'Could not reach the backend — is it running? (npm run dev in backend/)'
            : err?.message || String(err);
        sendResponse({ ok: false, status: 0, body: '', error });
      });
    return true;
  }
});
