// MedShield background service worker: fetches backend to avoid mixed-content issues
// Runs in extension origin (chrome-extension://...), so http://localhost calls are allowed.

const SCAN_ENDPOINT = "http://localhost:5000/scan";

async function postWithTimeout(url, body, timeoutMs = 15000) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: String(err && err.message || err) } };
  } finally {
    clearTimeout(tid);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "medshield:scan") {
    (async () => {
      const { text, url } = message;
      const result = await postWithTimeout(SCAN_ENDPOINT, { text, url });
      sendResponse(result);
    })();
    // keep the message channel open for async sendResponse
    return true;
  }
});
