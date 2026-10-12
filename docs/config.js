// config.js — Apps Script Web App URL ("Deploy > New deployment > Web app").
// Re-deploy karne par agar URL badle to yahan update karo.
window.SG_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxRMj8PZHeu2R1aQ2aLHca53jnTIhwpMoZAluzh95PssakhV3GYS-yRTMEW1C9Uz-ZUCg/exec',
  // Cloudflare Worker (cloudflare/README.md). Empty = the app calls API_URL directly. If the Worker fails, the app falls back to API_URL.
  WORKER_URL: 'https://sg-data-manage-api.star-mis2.workers.dev/'
};
