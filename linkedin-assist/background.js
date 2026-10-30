// Fetches a Google Sheet as CSV. Runs here (not in the popup) so the request
// uses the extension's host permissions and the user's Google session.
function exportUrl(sheetUrl) {
  const id = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!id) throw new Error("That doesn't look like a Google Sheets URL.");
  const gid = sheetUrl.match(/[#?&]gid=(\d+)/);
  return `https://docs.google.com/spreadsheets/d/${id[1]}/export?format=csv${gid ? `&gid=${gid[1]}` : ""}`;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== "fetchSheet") return;
  (async () => {
    try {
      const res = await fetch(exportUrl(msg.url), { credentials: "include" });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || type.includes("text/html")) {
        throw new Error("Couldn't read the sheet. Make sure you're signed into Google in Chrome with access to it, or set sharing to \"Anyone with the link can view\".");
      }
      reply({ ok: true, csv: await res.text() });
    } catch (e) {
      reply({ ok: false, error: e.message });
    }
  })();
  return true;
});
