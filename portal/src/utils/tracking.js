// Visitor tracking for the public pitch page. The device ID is a random value
// kept in this browser only; it carries no personal data. It lets the
// Marketing tab tell "the same phone opened the link again" from "the link
// was forwarded to someone else".
const DEVICE_KEY = 'lt_device_id';
const ATTR_KEY = 'lt_attribution';

function randomId() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      id = randomId();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return null; // storage blocked: the server falls back to a rough device signature
  }
}

/** What the page can say about this device, for the server's records. */
export async function deviceInfo() {
  let model = null;
  try {
    if (navigator.userAgentData?.getHighEntropyValues) {
      const v = await navigator.userAgentData.getHighEntropyValues(['model']);
      model = v.model || null;
    }
  } catch { /* not available */ }
  return {
    device_id: getDeviceId(),
    model,
    screen: `${window.screen.width}x${window.screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
  };
}

/** Remember which link brought this visitor, so a later sign-up is credited to it. */
export function rememberAttribution(slug) {
  try { localStorage.setItem(ATTR_KEY, JSON.stringify({ slug: slug || null, device_id: getDeviceId(), at: Date.now() })); } catch { /* ignore */ }
}

/** Attribution for sign-up: only within 60 days of the visit. */
export function getAttribution() {
  try {
    const a = JSON.parse(localStorage.getItem(ATTR_KEY) || 'null');
    if (!a || Date.now() - a.at > 60 * 864e5) return null;
    return { slug: a.slug, device_id: a.device_id };
  } catch {
    return null;
  }
}
