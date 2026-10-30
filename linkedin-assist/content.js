// Runs on linkedin.com. When a run is active and you're on the current
// prospect's profile, opens Connect -> Add a note and fills in the note.
// Nothing is sent until you click LinkedIn's own Send button; that click
// is what marks the prospect done and moves on to the next one.
(() => {
  if (window.__linkedinAssist) return;
  window.__linkedinAssist = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (min, max) => min + Math.random() * (max - min);
  async function waitFor(fn, timeout = 8000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(250);
    }
    return null;
  }

  const isVisible = (el) => !!el && el.getClientRects().length > 0;
  const ariaLabel = (el) => (el.getAttribute("aria-label") || "").trim();
  const textOf = (el) => (el.innerText || el.textContent || "").trim();
  const clickables = (root) =>
    root ? [...root.querySelectorAll('button, [role="button"]')].filter(isVisible) : [];

  // The profile's own top card. Searching only here keeps us away from the
  // Connect buttons in the "People also viewed" sidebar.
  const topCard = () => {
    const h1 = document.querySelector("main h1");
    return h1 && (h1.closest("section") || h1.closest("main"));
  };
  const openDialog = () => [...document.querySelectorAll('[role="dialog"]')].filter(isVisible).pop();
  const openMenus = () =>
    [...document.querySelectorAll('.artdeco-dropdown__content--is-open, [role="menu"]')].filter(isVisible);

  const isConnect = (b) => /^Invite .+ to connect$/i.test(ariaLabel(b)) || textOf(b) === "Connect";
  const findConnect = () =>
    clickables(topCard()).find(isConnect) || openMenus().flatMap(clickables).find(isConnect);
  const findMore = () =>
    clickables(topCard()).find((b) => /^More( actions)?$/i.test(ariaLabel(b)) || textOf(b) === "More");
  const findMessage = () =>
    clickables(topCard()).find((b) => /^Message\b/i.test(ariaLabel(b)) || textOf(b) === "Message");
  const isPending = () =>
    clickables(topCard()).some((b) => /^Pending\b/i.test(textOf(b)) || /withdraw invitation/i.test(ariaLabel(b)));

  function fillTextarea(el, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fillEditable(el, value) {
    el.focus();
    document.execCommand("selectAll", false);
    document.execCommand("insertText", false, value);
  }

  // ---------- state ----------
  let state = null;
  let current = null;   // prospect being worked on
  let armed = null;     // "connect" | "message" once a note is filled and we're waiting for Send
  let preparing = false;
  let lastPath = location.pathname;

  const onCurrentProfile = () => current && LA.profileSlug(location.href) === current.id;
  const capReached = () => state.daily.count >= state.settings.dailyCap;

  async function load() {
    state = await LA.getState();
    current = state.prospects.find((p) => p.status === "pending") || null;
  }

  async function setStatus(id, status) {
    state = await LA.getState();
    const p = state.prospects.find((x) => x.id === id);
    if (!p) return;
    p.status = status;
    if (status === "sent") {
      p.sentAt = new Date().toISOString();
      state.daily.count++;
    }
    await LA.save({ prospects: state.prospects, daily: state.daily });
  }

  // ---------- panel ----------
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .p { width: 300px; background: #fff; border: 1px solid #c7c7c7; border-radius: 10px;
           box-shadow: 0 4px 16px rgba(0,0,0,.18); font: 13px/1.4 system-ui, sans-serif; color: #1d2226; padding: 12px; }
      .h { display: flex; justify-content: space-between; font-weight: 700; margin-bottom: 6px; }
      .meta { color: #666; font-size: 12px; font-weight: 400; }
      .name { font-weight: 600; }
      textarea { width: 100%; box-sizing: border-box; height: 90px; margin: 6px 0 2px; font: inherit; padding: 6px;
                 border: 1px solid #c7c7c7; border-radius: 6px; resize: vertical; }
      .count { font-size: 11px; color: #666; text-align: right; }
      .count.over { color: #b3261e; font-weight: 700; }
      .status { margin: 6px 0; font-size: 12px; }
      .row { display: flex; gap: 6px; flex-wrap: wrap; }
      button { padding: 5px 10px; border: 1px solid #0a66c2; background: #fff; color: #0a66c2; border-radius: 14px;
               cursor: pointer; font: inherit; font-weight: 600; }
      button.primary { background: #0a66c2; color: #fff; }
      [hidden] { display: none !important; }
    </style>
    <div class="p">
      <div class="h"><span>LinkedIn Assist</span><span class="meta" id="meta"></span></div>
      <div class="name" id="name"></div>
      <textarea id="note"></textarea>
      <div class="count" id="count"></div>
      <div class="status" id="status"></div>
      <div class="row">
        <button class="primary" id="go">Go to profile</button>
        <button id="prep">Fill note</button>
        <button id="skip">Skip</button>
        <button id="stop">Stop</button>
      </div>
    </div>`;
  const $ = (id) => shadow.getElementById(id);

  function updateCount() {
    const n = $("note").value.length;
    $("count").textContent = `${n} / ${LA.NOTE_LIMIT}`;
    $("count").className = "count" + (n > LA.NOTE_LIMIT ? " over" : "");
  }

  function status(text) { $("status").textContent = text; }

  function render() {
    if (!state.active) { host.remove(); return; }
    if (!host.isConnected) document.documentElement.appendChild(host);
    const left = state.prospects.filter((p) => p.status === "pending").length;
    $("meta").textContent = `Today ${state.daily.count}/${state.settings.dailyCap} · ${left} left`;
    const done = !current;
    $("name").textContent = done ? "All done 🎉" : current.name;
    $("note").hidden = $("count").hidden = done;
    $("go").hidden = done || onCurrentProfile() || capReached();
    $("prep").hidden = done || !onCurrentProfile() || capReached();
    $("skip").hidden = done;
    if (!done && $("note").dataset.for !== current.id) {
      $("note").value = LA.noteFor(current, state.settings.template);
      $("note").dataset.for = current.id;
    }
    updateCount();
    if (done) status("Every prospect in the list has been sent or skipped.");
    else if (capReached()) status(`Daily limit of ${state.settings.dailyCap} reached. Pick up again tomorrow.`);
  }

  // ---------- actions ----------
  async function prepare() {
    if (preparing || !current || !onCurrentProfile() || capReached()) return;
    preparing = true;
    armed = null;
    try {
      status("Finding the Connect button…");
      if (!(await waitFor(topCard, 10000))) return status("Profile didn't load. Try Fill note again.");
      await sleep(jitter(800, 1600));

      if (isPending()) return status("An invitation is already pending. Skip this one.");

      let connect = findConnect();
      if (!connect) {
        const more = findMore();
        if (more) {
          more.click();
          connect = await waitFor(findConnect, 2500);
        }
      }

      if (connect) {
        connect.click();
        const addNote = await waitFor(() =>
          clickables(openDialog() || document.createElement("div")).find(
            (b) => /add a note/i.test(ariaLabel(b)) || /^add a note$/i.test(textOf(b))
          )
        );
        if (!addNote) return status("Connect dialog opened without an \"Add a note\" option. Send it from LinkedIn, or Skip.");
        addNote.click();
        const box = await waitFor(() => openDialog()?.querySelector("textarea"));
        if (!box) {
          return status("LinkedIn didn't show a note box (free accounts get a limited number of notes per month). You can still click Send without a note.");
        }
        fillTextarea(box, $("note").value.slice(0, LA.NOTE_LIMIT));
        armed = "connect";
        return status("Note filled in. Check it and click LinkedIn's Send button.");
      }

      // Already connected: write a message instead.
      const message = findMessage();
      if (message) {
        message.click();
        const box = await waitFor(() =>
          [...document.querySelectorAll('.msg-form__contenteditable, [contenteditable="true"][role="textbox"]')]
            .filter(isVisible).pop()
        );
        if (!box) return status("Couldn't find the message box. Type it in yourself, or Skip.");
        fillEditable(box, $("note").value);
        armed = "message";
        return status("You're already connected, so this is a message. Check it and click Send.");
      }

      status("No Connect or Message button on this profile. Skip this one.");
    } finally {
      preparing = false;
    }
  }

  async function advance() {
    await load();
    render();
    if (!current || capReached()) return;
    status("Opening the next profile…");
    await sleep(jitter(2000, 4000));
    location.href = current.url;
  }

  // A click on LinkedIn's own Send button is the signal that this prospect is done.
  document.addEventListener(
    "click",
    (e) => {
      if (!armed || !current) return;
      const btn = e.target.closest && e.target.closest("button");
      if (!btn) return;
      const label = `${textOf(btn)} ${ariaLabel(btn)}`;
      const sent =
        armed === "connect"
          ? btn.closest('[role="dialog"]') && /\bsend\b/i.test(label)
          : btn.matches(".msg-form__send-button") || (btn.type === "submit" && /\bsend\b/i.test(label));
      if (!sent) return;
      const id = current.id;
      armed = null;
      status("Sent ✓");
      setStatus(id, "sent").then(advance);
    },
    true
  );

  $("note").addEventListener("input", updateCount);
  $("go").onclick = () => { location.href = current.url; };
  $("prep").onclick = prepare;
  $("skip").onclick = async () => {
    armed = null;
    await setStatus(current.id, "skipped");
    advance();
  };
  $("stop").onclick = async () => { await LA.save({ active: false }); };

  chrome.storage.onChanged.addListener(async (changes) => {
    if (!("active" in changes || "prospects" in changes || "settings" in changes)) return;
    await load();
    render();
  });

  // LinkedIn is a single-page app, so watch for in-app navigation too.
  setInterval(async () => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    armed = null;
    await load();
    render();
    if (state.active && onCurrentProfile()) prepare();
  }, 1000);

  (async () => {
    await load();
    render();
    if (state.active && onCurrentProfile()) prepare();
  })();
})();
