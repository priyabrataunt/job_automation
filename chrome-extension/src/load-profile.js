// Pre-fill with stored profile
chrome.storage.local.get('profile', data => {
  if (data.profile) {
    document.getElementById('json-input').value = JSON.stringify(data.profile, null, 2);
  }
});

document.getElementById('save-btn').addEventListener('click', () => {
  const raw = document.getElementById('json-input').value.trim();
  try {
    const profile = JSON.parse(raw);
    chrome.storage.local.set({ profile }, () => {
      document.getElementById('status').textContent = '✓ Profile saved! You can close this tab.';
      document.getElementById('err').textContent = '';
    });
  } catch (e) {
    document.getElementById('err').textContent = 'Invalid JSON: ' + e.message;
    document.getElementById('status').textContent = '';
  }
});
