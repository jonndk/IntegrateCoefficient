const $ = (id) => document.getElementById(id);

function say(text, kind = "") {
  $("msg").textContent = text;
  $("msg").className = "msg " + kind;
}

async function refresh() {
  const s = await LA.getState();
  const count = (st) => s.prospects.filter((p) => p.status === st).length;
  $("template").value = s.settings.template;
  $("cap").value = s.settings.dailyCap;
  $("sheet").value = s.settings.sheetUrl || "";
  $("stats").innerHTML = s.prospects.length
    ? `<b>${s.prospects.length}</b> prospects · ${count("pending")} pending · ${count("sent")} sent · ${count("skipped")} skipped<br>` +
      `Today: <b>${s.daily.count}</b> / ${s.settings.dailyCap}` + (s.active ? " · <b>running</b>" : "")
    : "No prospects loaded yet.";
  $("start").disabled = !count("pending");
  $("stop").disabled = !s.active;
}

async function saveSettings() {
  const s = await LA.getState();
  await LA.save({
    settings: {
      ...s.settings,
      template: $("template").value.trim() || LA.DEFAULT_TEMPLATE,
      dailyCap: Math.max(1, parseInt($("cap").value, 10) || 20),
      sheetUrl: $("sheet").value.trim(),
    },
  });
}

async function importCSV(text) {
  const s = await LA.getState();
  const { prospects, skipped } = LA.csvToProspects(text, s.prospects);
  await LA.save({ prospects });
  const tooLong = prospects.filter((p) => LA.noteFor(p, s.settings.template).length > LA.NOTE_LIMIT).length;
  say(
    `Loaded ${prospects.length} prospects` +
      (skipped ? ` (${skipped} rows skipped: no URL or duplicate)` : "") +
      (tooLong ? `. ${tooLong} notes are over 300 characters and will be cut off.` : "."),
    tooLong ? "err" : "ok"
  );
  await refresh();
}

$("load").onclick = async () => {
  await saveSettings();
  const url = $("sheet").value.trim();
  if (!url) return say("Paste your Google Sheet URL first.", "err");
  say("Loading…");
  const res = await chrome.runtime.sendMessage({ type: "fetchSheet", url });
  if (!res.ok) return say(res.error, "err");
  try { await importCSV(res.csv); } catch (e) { say(e.message, "err"); }
};

$("upload").onclick = () => $("file").click();
$("file").onchange = async () => {
  const f = $("file").files[0];
  if (!f) return;
  try { await importCSV(await f.text()); } catch (e) { say(e.message, "err"); }
  $("file").value = "";
};

$("template").onchange = saveSettings;
$("cap").onchange = async () => { await saveSettings(); await refresh(); };

$("start").onclick = async () => {
  await saveSettings();
  const s = await LA.getState();
  const next = s.prospects.find((p) => p.status === "pending");
  if (!next) return say("Nothing pending.", "err");
  await LA.save({ active: true });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.tabs.update(tab.id, { url: next.url });
  window.close();
};

$("stop").onclick = async () => { await LA.save({ active: false }); await refresh(); };

$("export").onclick = async () => {
  const s = await LA.getState();
  if (!s.prospects.length) return say("Nothing to export.", "err");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([LA.toCSV(s.prospects)], { type: "text/csv" }));
  a.download = `linkedin-assist-results-${LA.today()}.csv`;
  a.click();
};

$("clear").onclick = async () => {
  if (!confirm("Remove all loaded prospects and their sent/skipped status?")) return;
  await LA.save({ prospects: [], active: false });
  say("Cleared.");
  await refresh();
};

refresh();
