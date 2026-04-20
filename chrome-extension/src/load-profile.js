const DEFAULT_JOB_TRACKER_URL = 'http://localhost:8000';

function normalizeProfile(profile) {
  const nextProfile = { ...profile };
  const rawUrl = typeof nextProfile.job_tracker_url === 'string'
    ? nextProfile.job_tracker_url.trim()
    : '';

  nextProfile.job_tracker_url = (rawUrl || DEFAULT_JOB_TRACKER_URL).replace(/\/$/, '');
  return nextProfile;
}

// Pre-fill with stored profile
chrome.storage.local.get('profile', data => {
  if (data.profile) {
    document.getElementById('json-input').value = JSON.stringify(data.profile, null, 2);
  }
});

document.getElementById('save-btn').addEventListener('click', () => {
  const raw = document.getElementById('json-input').value.trim();
  try {
    const profile = normalizeProfile(JSON.parse(raw));
    chrome.storage.local.set({ profile }, () => {
      document.getElementById('status').textContent = `✓ Profile saved! Using backend: ${profile.job_tracker_url}`;
      document.getElementById('err').textContent = '';
      document.getElementById('json-input').value = JSON.stringify(profile, null, 2);
    });
  } catch (e) {
    document.getElementById('err').textContent = 'Invalid JSON: ' + e.message;
    document.getElementById('status').textContent = '';
  }
});
