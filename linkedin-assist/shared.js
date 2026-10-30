// Helpers shared by the popup and the LinkedIn content script.
const LA = (() => {
  const DEFAULT_TEMPLATE =
    "Hi {first_name}, I came across your work at {company} and would love to connect.";
  const NOTE_LIMIT = 300; // LinkedIn's max length for a connection note

  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((v) => v.trim() !== ""));
  }

  // Returns the lowercase profile slug for a linkedin.com/in/... URL, or null.
  function profileSlug(url) {
    if (!url) return null;
    try {
      const u = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : "https://" + url.trim());
      if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
      const m = u.pathname.match(/^\/in\/([^/]+)/i);
      return m ? decodeURIComponent(m[1]).toLowerCase() : null;
    } catch {
      return null;
    }
  }

  const normKey = (h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const pick = (fields, keys) => {
    for (const k of keys) if (fields[k]) return fields[k].trim();
    return "";
  };

  // Turns CSV text into prospects, keeping the status of ones already in `existing`.
  function csvToProspects(text, existing = []) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error("The sheet needs a header row and at least one prospect.");
    const headers = rows[0].map(normKey);
    const known = new Map(existing.map((p) => [p.id, p]));
    const seen = new Set();
    const prospects = [];
    let skipped = 0;
    for (const r of rows.slice(1)) {
      const fields = {};
      headers.forEach((h, i) => { if (h) fields[h] = (r[i] || "").trim(); });
      const id = profileSlug(
        pick(fields, ["linkedin_url", "linkedin", "profile_url", "linkedin_profile", "url", "profile"]) ||
          Object.values(fields).find((v) => /linkedin\.com\/in\//i.test(v))
      );
      if (!id || seen.has(id)) { skipped++; continue; }
      seen.add(id);
      const fullName = pick(fields, ["name", "full_name"]);
      fields.first_name = pick(fields, ["first_name", "firstname", "first"]) || fullName.split(/\s+/)[0] || "";
      const prev = known.get(id);
      prospects.push({
        id,
        url: `https://www.linkedin.com/in/${encodeURIComponent(id)}/`,
        name: fullName || [fields.first_name, pick(fields, ["last_name", "lastname", "last"])].join(" ").trim() || id,
        note: pick(fields, ["note", "message", "connection_note", "personalized_note"]),
        fields,
        status: prev ? prev.status : "pending",
        sentAt: prev ? prev.sentAt : null,
      });
    }
    if (!prospects.length) throw new Error("No LinkedIn profile URLs found. Add a column named linkedin_url.");
    return { prospects, skipped };
  }

  // The note for a prospect: their own note column, or the template filled in.
  function noteFor(p, template) {
    if (p.note) return p.note;
    return (template || DEFAULT_TEMPLATE)
      .replace(/\{(\w+)\}/g, (_, k) => p.fields[normKey(k)] || "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/ ([,.!?])/g, "$1")
      .trim();
  }

  const today = () => new Date().toLocaleDateString("en-CA");

  async function getState() {
    const s = await chrome.storage.local.get(["prospects", "settings", "daily", "active"]);
    const d = today();
    return {
      prospects: s.prospects || [],
      settings: { dailyCap: 20, template: DEFAULT_TEMPLATE, ...(s.settings || {}) },
      daily: s.daily && s.daily.date === d ? s.daily : { date: d, count: 0 },
      active: !!s.active,
    };
  }

  const save = (patch) => chrome.storage.local.set(patch);

  function toCSV(prospects) {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["name", "linkedin_url", "status", "sent_at"].join(",")];
    for (const p of prospects) lines.push([p.name, p.url, p.status, p.sentAt || ""].map(esc).join(","));
    return lines.join("\n");
  }

  return { DEFAULT_TEMPLATE, NOTE_LIMIT, parseCSV, profileSlug, csvToProspects, noteFor, today, getState, save, toCSV };
})();
