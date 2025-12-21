// Team Hub — Netlify Functions edition
// - Auth via PIN -> token (cached in localStorage)
// - Storage via Netlify Blobs (through /.netlify/functions/api)
// - Who-am-I picker (cached) + per-user task completion
// - Multi-assignee targets (multiple people + teams + All)
// - Email on new task creation (/.netlify/functions/sendTaskEmail)

(() => {
  const API_BASE = "/.netlify/functions/api";
  const EMAIL_FN = "/.netlify/functions/sendTaskEmail";

  // Local keys
  const LS_TOKEN = "teamhub_token_v1";
  const LS_PINHASH = "teamhub_pinhash_v1";
  const LS_THEME = "teamhub_theme_v2";
  const LS_WHO = "teamhub_who_v1";

  const MEMBERS = [
    { id: "Youssef Elkhayat", team: "CAD Team", email: "youssifayman2004@gmail.com" },
    { id: "Youssef Roshdy", team: "Prototype Team", email: "yousufdiaa2004@gmail.com" },
    { id: "Mohamed AlAiniah", team: "CAD Team", email: "Mohammad.bashar033@gmail.com" },
    { id: "Ahmed Saeed", team: "Prototype Team", email: "saeedahmedsuper@gmail.com" },
    { id: "Mohamed ElMansy", team: "CAD Team", email: "mohammadadham20@gmail.com" },
  ];

  const TEAM_MEMBERS = {
    "CAD Team": MEMBERS.filter(m => m.team === "CAD Team").map(m => m.id),
    "Prototype Team": MEMBERS.filter(m => m.team === "Prototype Team").map(m => m.id),
  };

  const ALL_MEMBER_IDS = MEMBERS.map(m => m.id);
  const MEMBER_BY_ID = Object.fromEntries(MEMBERS.map(m => [m.id, m]));
  const TEAMS = ["CAD Team", "Prototype Team"];
  const TARGETS = [...ALL_MEMBER_IDS, ...TEAMS, "All"];

  // DOM helpers
  const $ = (q, el = document) => el.querySelector(q);
  const $$ = (q, el = document) => [...el.querySelectorAll(q)];

  const escapeHtml = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  // UI refs
  const authOverlay = $("#authOverlay");
  const authForm = $("#authForm");
  const pinInput = $("#pinInput");
  const pinClearBtn = $("#pinClearBtn");
  const authMsg = $("#authMsg");
  const authFooterText = $("#authFooterText");

  const whoOverlay = $("#whoOverlay");
  const whoList = $("#whoList");
  const whoBtn = $("#whoBtn");
  const whoLabel = $("#whoLabel");

  const themeToggle = $("#themeToggle");
  const themeLabel = $("#themeLabel");
  const logoutBtn = $("#logoutBtn");

  const globalSearch = $("#globalSearch");

  const statLinks = $("#statLinks");
  const statTasks = $("#statTasks");
  const statOpen = $("#statOpen");

  const linksGrid = $("#linksGrid");
  const newLinkBtn = $("#newLinkBtn");
  const linkDialog = $("#linkDialog");
  const linkDialogTitle = $("#linkDialogTitle");
  const linkTitle = $("#linkTitle");
  const linkUrl = $("#linkUrl");
  const linkDesc = $("#linkDesc");
  const linkSaveBtn = $("#linkSaveBtn");

  const newTaskBtn = $("#newTaskBtn");
  const taskDialog = $("#taskDialog");
  const taskDialogTitle = $("#taskDialogTitle");
  const taskDesc = $("#taskDesc");
  const taskAssignees = $("#taskAssignees");
  const taskDue = $("#taskDue");
  const taskPriority = $("#taskPriority");
  const taskNotes = $("#taskNotes");
  const taskSaveBtn = $("#taskSaveBtn");

  const filterStatus = $("#filterStatus");
  const filterPriority = $("#filterPriority");
  const sortTasks = $("#sortTasks");
  const tasksBody = $("#tasksBody");
  const tasksEmpty = $("#tasksEmpty");
  const taskCount = $("#taskCount");

  const notesBox = $("#notesBox");
  const notesStatus = $("#notesStatus");

  const exportBtn = $("#exportBtn");
  const importFile = $("#importFile");

  // State
  let token = localStorage.getItem(LS_TOKEN) || "";
  let pinHash = localStorage.getItem(LS_PINHASH) || "";
  let me = localStorage.getItem(LS_WHO) || "";

  let state = {
    version: 1,
    workspaceName: "Team Hub",
    notes: "",
    links: [],
    tasks: [],
  };

  let searchQuery = "";
  let showLinkEditId = null;
  let showTaskEditId = null;

  // ---------------------------
  // Theme
  // ---------------------------
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    themeLabel.textContent = t === "light" ? "Light" : "Dark";
  }
  function loadTheme() {
    applyTheme(localStorage.getItem(LS_THEME) || "dark");
  }
  function toggleTheme() {
    const cur = document.documentElement.dataset.theme || "dark";
    const next = cur === "dark" ? "light" : "dark";
    localStorage.setItem(LS_THEME, next);
    applyTheme(next);
  }

  // ---------------------------
  // Auth overlay helpers
  // ---------------------------
  function setAuthFooter(t) {
    authFooterText.textContent = t;
  }
  function showAuth(msg = "") {
    authOverlay.hidden = false;
    authMsg.textContent = msg;
    setTimeout(() => pinInput?.focus(), 30);
  }
  function hideAuth() {
    authOverlay.hidden = true;
    authMsg.textContent = "";
  }
  function lock(msg = "Locked. Enter PIN to continue.") {
    token = "";
    localStorage.removeItem(LS_TOKEN);
    showAuth(msg);
  }

  async function apiFetch(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(API_BASE + path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function getServerPinHash() {
    // Public endpoint (no token)
    const res = await fetch(API_BASE + "/pinhash");
    const data = await res.json().catch(() => ({}));
    return data?.pinhash || "";
  }

  async function loginWithPin(pin) {
    const data = await apiFetch("/login", { method: "POST", body: JSON.stringify({ pin }) });
    token = data.token || "";
    if (!token) throw new Error("Login failed");
    localStorage.setItem(LS_TOKEN, token);

    // refresh pinHash from server (so we can detect changes later)
    const ph = await getServerPinHash();
    pinHash = ph || "";
    if (pinHash) localStorage.setItem(LS_PINHASH, pinHash);
  }

  // ---------------------------
  // Who picker
  // ---------------------------
  function renderWhoList() {
    if (!whoList) return;
    if (!Array.isArray(MEMBERS) || MEMBERS.length === 0) return;
    whoList.innerHTML = MEMBERS.map((m) => {
      return `
        <button class="btn btn--ghost whoBtn" type="button" data-who="${escapeHtml(m.id)}">
          <span class="whoBtn__left">
            <span class="whoBtn__name">${escapeHtml(m.id)}</span>
            <span class="whoBtn__team">${escapeHtml(m.team)}</span>
          </span>
          <span class="whoBtn__tag">${escapeHtml(m.team)}</span>
        </button>
      `;
    }).join("");
  }

  function showWhoPicker() {
    renderWhoList();
    whoOverlay.hidden = false;
  }
  function hideWhoPicker() {
    whoOverlay.hidden = true;
  }
  function setMe(next) {
    me = next || "";
    if (me) localStorage.setItem(LS_WHO, me);
    whoLabel.textContent = me ? `${me} (${MEMBER_BY_ID[me]?.team || "—"})` : "Pick user";
    renderTasks();
  }

  // ---------------------------
  // Targets / involvement / done
  // ---------------------------
  function normalizeTargets(arr) {
    const raw = Array.isArray(arr) ? arr.filter(Boolean).map(String) : [];
    const set = new Set();
    for (const t of raw) {
      if (TARGETS.includes(t)) set.add(t);
    }
    // If "All" exists, keep only "All"
    if (set.has("All")) return ["All"];
    return [...set];
  }

  function expandTargets(targets) {
    const t = normalizeTargets(targets);
    const out = new Set();
    for (const x of t) {
      if (x === "All") {
        ALL_MEMBER_IDS.forEach((id) => out.add(id));
      } else if (TEAM_MEMBERS[x]) {
        TEAM_MEMBERS[x].forEach((id) => out.add(id));
      } else if (MEMBER_BY_ID[x]) {
        out.add(x);
      }
    }
    return [...out];
  }

  function isInvolved(task, who) {
    if (!who) return false;
    const involved = expandTargets(task.targets || []);
    return involved.includes(who);
  }

  function getProgress(task) {
    const involved = expandTargets(task.targets || []);
    const doneBy = task.doneBy && typeof task.doneBy === "object" ? task.doneBy : {};
    const done = involved.filter((id) => doneBy[id]);
    return { involved, done, total: involved.length, count: done.length, fullyDone: involved.length > 0 && done.length === involved.length };
  }

  // ---------------------------
  // State save/load
  // ---------------------------
  let saveTimer = null;
  function scheduleSave(label = "Saving…") {
    notesStatus.textContent = label;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const resp = await apiFetch("/state", { method: "POST", body: JSON.stringify({ state }) });
        state = resp.state || state;
        notesStatus.textContent = "Saved";
        renderStats();
      } catch (e) {
        console.error(e);
        notesStatus.textContent = "Save failed";
        if (e.status === 401) lock("Session expired. Enter PIN again.");
      }
    }, 350);
  }

  async function loadState() {
    const resp = await apiFetch("/state", { method: "GET" });
    state = resp.state || state;

    // Ensure shapes
    state.links = Array.isArray(state.links) ? state.links : [];
    state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
    state.notes = String(state.notes || "");

    notesBox.value = state.notes;
    renderLinks();
    renderTasks();
    renderStats();
  }

  // ---------------------------
  // Links
  // ---------------------------
  function linkCardHTML(l) {
    return `
      <div class="linkCard" draggable="true" data-id="${escapeHtml(l.id)}">
        <div class="linkCard__top">
          <div>
            <div class="linkCard__title">${escapeHtml(l.title || "Lorem ipsum")}</div>
            <div class="linkCard__url">${escapeHtml(l.url || "#")}</div>
          </div>
          <div class="linkCard__actions">
            <button class="linkCard__btn" data-act="edit" title="Edit">
              <svg class="ico" viewBox="0 0 24 24" fill="none"><path d="M4 20h4l10.5-10.5a1.5 1.5 0 0 0 0-2.1L15.6 4.5a1.5 1.5 0 0 0-2.1 0L3 15v5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
            </button>
            <button class="linkCard__btn" data-act="del" title="Delete">
              <svg class="ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6 7l1-2h10l1 2v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>
        <div class="linkCard__desc">${escapeHtml(l.desc || "Lorem ipsum")}</div>
        <a class="linkCard__open" href="${escapeHtml(l.url || "#")}" target="_blank" rel="noopener">Open ↗</a>
      </div>
    `;
  }

  function renderLinks() {
    const q = searchQuery.trim().toLowerCase();
    const list = (state.links || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const filtered = q
      ? list.filter((l) => `${l.title || ""} ${l.desc || ""} ${l.url || ""}`.toLowerCase().includes(q))
      : list;

    linksGrid.innerHTML = filtered.length
      ? filtered.map(linkCardHTML).join("")
      : `<div class="empty">No links yet. Click <b>+ New link</b>.</div>`;
  }

  function openLinkDialog(mode, link) {
    showLinkEditId = mode === "edit" ? link?.id : null;
    linkDialogTitle.textContent = mode === "edit" ? "Edit link" : "New link";
    linkSaveBtn.textContent = mode === "edit" ? "Save" : "Create";
    linkTitle.value = link?.title || "";
    linkUrl.value = link?.url || "";
    linkDesc.value = link?.desc || "";
    linkDialog.showModal();
    setTimeout(() => linkTitle.focus(), 30);
  }

  // ---------------------------
  // Tasks
  // ---------------------------
  const PRIORITY_SCORE = { low: 1, med: 2, high: 3 };

  function chipsHTML(targets) {
    const t = normalizeTargets(targets);
    if (!t.length) return `<span class="chip">—</span>`;
    return t
      .map((x) => {
        const cls = x === "All" ? "chip chip--all" : TEAM_MEMBERS[x] ? "chip chip--team" : "chip";
        return `<span class="${cls}" title="${escapeHtml(x)}">${escapeHtml(x)}</span>`;
      })
      .join("");
  }

  function progressHTML(task) {
    const p = getProgress(task);
    if (p.total === 0) return `<div class="progressLine">No assignees</div>`;
    if (p.fullyDone) return `<div class="progressLine"><b>Fully done</b> (${p.count}/${p.total})</div>`;

    const doneNames = p.done.length ? `Done: ${p.done.join(", ")}` : "Done: —";
    const left = p.involved.filter((x) => !p.done.includes(x));
    const leftNames = left.length ? `Left: ${left.join(", ")}` : "Left: —";

    return `
      <div class="progressLine"><b>In progress</b> (${p.count}/${p.total})</div>
      <div class="progressNames">${escapeHtml(doneNames)}</div>
      <div class="progressNames">${escapeHtml(leftNames)}</div>
    `;
  }

  function renderTasks() {
    const q = searchQuery.trim().toLowerCase();
    const pr = filterPriority.value;
    const st = filterStatus.value;
    const sortMode = sortTasks.value;

    let list = Array.isArray(state.tasks) ? [...state.tasks] : [];

    // search
    if (q) {
      list = list.filter((t) => `${t.desc || ""} ${t.notes || ""}`.toLowerCase().includes(q));
    }

    // priority filter
    if (pr !== "all") list = list.filter((t) => (t.priority || "med") === pr);

    // status filter (computed)
    if (st === "open") list = list.filter((t) => !getProgress(t).fullyDone);
    if (st === "done") list = list.filter((t) => getProgress(t).fullyDone);
    if (st === "mine") list = list.filter((t) => isInvolved(t, me));

    // sort
    list.sort((a, b) => {
      if (sortMode === "dueAsc") return String(a.due || "9999-12-31").localeCompare(String(b.due || "9999-12-31"));
      if (sortMode === "priorityDesc") return (PRIORITY_SCORE[b.priority || "med"] || 2) - (PRIORITY_SCORE[a.priority || "med"] || 2);
      if (sortMode === "createdDesc") return (b.createdAt || 0) - (a.createdAt || 0);
      // updatedDesc
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    taskCount.textContent = String(list.length);
    tasksEmpty.hidden = list.length !== 0;

    tasksBody.innerHTML = list
      .map((t) => {
        const mine = isInvolved(t, me);
        const p = getProgress(t);
        const checked = !!(t.doneBy && t.doneBy[me]);
        const checkbox = mine
          ? `<label class="myDone"><input type="checkbox" data-act="myDone" ${checked ? "checked" : ""}/>Done (me)</label>`
          : `<div class="myDone myDone--disabled"><input type="checkbox" disabled />Not assigned</div>`;

        return `
          <tr data-id="${escapeHtml(t.id)}" class="${mine ? "taskRow--mine" : ""}">
            <td><input class="cellInput" data-field="desc" value="${escapeHtml(t.desc || "")}" placeholder="Task description" /></td>

            <td>
              <div class="chips">${chipsHTML(t.targets || [])}</div>
              <div class="inlineActions">
                <button class="smallBtn" data-act="editAssign" type="button">Edit</button>
              </div>
            </td>

            <td>
              <select class="select" data-field="priority">
                <option value="low" ${t.priority === "low" ? "selected" : ""}>Low</option>
                <option value="med" ${!t.priority || t.priority === "med" ? "selected" : ""}>Medium</option>
                <option value="high" ${t.priority === "high" ? "selected" : ""}>High</option>
              </select>
            </td>

            <td><input class="cellInput" data-field="due" type="date" value="${escapeHtml(t.due || "")}" /></td>

            <td>
              <div class="statusCell">
                ${checkbox}
                ${progressHTML(t)}
              </div>
            </td>

            <td><input class="cellInput" data-field="notes" value="${escapeHtml(t.notes || "")}" placeholder="Notes" /></td>

            <td class="th--right">
              <div class="actionsRight">
                <button class="smallBtn danger" data-act="del" type="button">Delete</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function renderStats() {
    statLinks.textContent = String(state.links?.length || 0);
    statTasks.textContent = String(state.tasks?.length || 0);
    const open = (state.tasks || []).filter((t) => !getProgress(t).fullyDone).length;
    statOpen.textContent = String(open);
  }

  function openTaskDialog(mode, task) {
    showTaskEditId = mode === "edit" ? task?.id : null;
    taskDialogTitle.textContent = mode === "edit" ? "Edit task" : "New task";
    taskSaveBtn.textContent = mode === "edit" ? "Save" : "Create";

    taskDesc.value = task?.desc || "";
    taskDue.value = task?.due || "";
    taskPriority.value = task?.priority || "med";
    taskNotes.value = task?.notes || "";

    const targets = normalizeTargets(task?.targets || []);
    // clear selections
    [...taskAssignees.options].forEach((o) => (o.selected = targets.includes(o.value)));

    taskDialog.showModal();
    setTimeout(() => taskDesc.focus(), 30);
  }

  function getSelectedTargets() {
    const selected = [...taskAssignees.selectedOptions].map((o) => o.value);
    return normalizeTargets(selected);
  }

  async function sendTaskEmail(task) {
    try {
      await fetch(EMAIL_FN, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({
          task: {
            desc: task.desc,
            targets: task.targets,
            due: task.due,
            priority: task.priority,
            notes: task.notes,
            createdBy: task.createdBy,
          },
        }),
      });
    } catch (e) {
      console.warn("Email failed:", e);
    }
  }

  // ---------------------------
  // Notes
  // ---------------------------
  function scheduleNotesSave() {
    state.notes = notesBox.value;
    scheduleSave("Saving notes…");
  }

  // ---------------------------
  // Export / Import
  // ---------------------------
  function download(filename, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function stateAsJSON() {
    return JSON.stringify(state, null, 2);
  }

  function replaceStateFromJSON(obj) {
    // Keep workspaceName + version if missing
    state = {
      version: 1,
      workspaceName: String(obj?.workspaceName || "Team Hub"),
      notes: String(obj?.notes || ""),
      links: Array.isArray(obj?.links) ? obj.links : [],
      tasks: Array.isArray(obj?.tasks) ? obj.tasks : [],
    };
  }

  // ---------------------------
  // Events
  // ---------------------------
  themeToggle.addEventListener("click", toggleTheme);
  logoutBtn.addEventListener("click", () => lock());
  whoBtn.addEventListener("click", () => showWhoPicker());

  pinClearBtn.addEventListener("click", () => {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_PINHASH);
    token = "";
    pinHash = "";
    authMsg.textContent = "Forgotten on this device.";
  });

  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    authMsg.textContent = "Checking…";
    try {
      await loginWithPin(pinInput.value.trim());
      pinInput.value = "";
      hideAuth();
      await loadState();
      if (!me) showWhoPicker();
      authMsg.textContent = "";
    } catch (err) {
      console.error(err);
      authMsg.textContent = "Wrong PIN (or server error).";
      pinInput.select();
    }
  });

  whoList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-who]");
    if (!btn) return;
    setMe(btn.dataset.who || "");
    hideWhoPicker();
  });

  globalSearch.addEventListener("input", () => {
    searchQuery = globalSearch.value || "";
    renderLinks();
    renderTasks();
  });

  // Links dialog open
  newLinkBtn.addEventListener("click", () => openLinkDialog("new"));
  linkDialog.addEventListener("close", () => {
    if (linkDialog.returnValue !== "ok") return;
    const title = linkTitle.value.trim() || "Lorem ipsum";
    const url = linkUrl.value.trim() || "#";
    const desc = linkDesc.value.trim() || "Lorem ipsum";

    if (showLinkEditId) {
      const i = state.links.findIndex((x) => x.id === showLinkEditId);
      if (i >= 0) {
        state.links[i] = { ...state.links[i], title, url, desc, updatedAt: Date.now() };
      }
    } else {
      const maxOrder = state.links.reduce((m, l) => Math.max(m, Number(l.order || 0)), 0);
      state.links.push({ id: uid(), title, url, desc, order: maxOrder + 100, createdAt: Date.now(), updatedAt: Date.now() });
    }
    showLinkEditId = null;
    renderLinks();
    renderStats();
    scheduleSave();
  });

  // Link card actions
  linksGrid.addEventListener("click", (e) => {
    const card = e.target.closest(".linkCard");
    if (!card) return;
    const id = card.dataset.id;
    const act = e.target.closest("[data-act]")?.dataset?.act;
    if (!act) return;
    const link = state.links.find((x) => x.id === id);
    if (act === "edit" && link) openLinkDialog("edit", link);
    if (act === "del") {
      if (!confirm("Delete this link?")) return;
      state.links = state.links.filter((x) => x.id !== id);
      renderLinks();
      renderStats();
      scheduleSave();
    }
  });

  // Basic drag reorder (links)
  let dragId = null;
  linksGrid.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".linkCard");
    if (!card) return;
    dragId = card.dataset.id;
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  linksGrid.addEventListener("dragend", (e) => {
    const card = e.target.closest(".linkCard");
    if (!card) return;
    card.classList.remove("dragging");
    dragId = null;
  });
  linksGrid.addEventListener("dragover", (e) => {
    e.preventDefault();
    const over = e.target.closest(".linkCard");
    if (!over || !dragId) return;
    const overId = over.dataset.id;
    if (overId === dragId) return;

    const list = state.links.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const a = list.findIndex((x) => x.id === dragId);
    const b = list.findIndex((x) => x.id === overId);
    if (a < 0 || b < 0) return;
    const [moved] = list.splice(a, 1);
    list.splice(b, 0, moved);
    list.forEach((l, idx) => (l.order = idx * 100));
    state.links = list;
    renderLinks();
  });
  linksGrid.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!dragId) return;
    scheduleSave();
  });

  // Tasks
  newTaskBtn.addEventListener("click", () => openTaskDialog("new"));
  taskDialog.addEventListener("close", async () => {
    if (taskDialog.returnValue !== "ok") return;

    const next = {
      desc: taskDesc.value.trim() || "Lorem ipsum",
      targets: getSelectedTargets(),
      due: taskDue.value || "",
      priority: taskPriority.value || "med",
      notes: taskNotes.value.trim() || "",
      updatedAt: Date.now(),
    };

    if (!next.targets.length) {
      alert("Please select at least one assignee (person/team/all).");
      return;
    }

    if (showTaskEditId) {
      const i = state.tasks.findIndex((x) => x.id === showTaskEditId);
      if (i >= 0) {
        state.tasks[i] = { ...state.tasks[i], ...next };
      }
      showTaskEditId = null;
      renderTasks();
      renderStats();
      scheduleSave();
      return;
    }

    const task = {
      id: uid(),
      ...next,
      createdAt: Date.now(),
      createdBy: me || "Unknown",
      doneBy: {}, // per-person
    };

    state.tasks.push(task);
    renderTasks();
    renderStats();
    scheduleSave();

    // Email (best-effort)
    await sendTaskEmail(task);
  });

  // inline edits + actions
  let patchTimer = null;
  let pendingPatches = new Map();

  function queueTaskPatch(id, patch) {
    const existing = pendingPatches.get(id) || {};
    pendingPatches.set(id, { ...existing, ...patch, updatedAt: Date.now() });

    if (patchTimer) clearTimeout(patchTimer);
    patchTimer = setTimeout(() => {
      if (!pendingPatches.size) return;
      for (const [tid, p] of pendingPatches) {
        const i = state.tasks.findIndex((x) => x.id === tid);
        if (i >= 0) state.tasks[i] = { ...state.tasks[i], ...p };
      }
      pendingPatches.clear();
      renderTasks();
      renderStats();
      scheduleSave();
    }, 300);
  }

  tasksBody.addEventListener("input", (e) => {
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    const id = row.dataset.id;
    const field = e.target.dataset.field;
    if (!field) return;
    queueTaskPatch(id, { [field]: e.target.value });
  });

  tasksBody.addEventListener("change", (e) => {
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    const id = row.dataset.id;

    // Priority select uses data-field too
    const field = e.target.dataset.field;
    if (field === "priority") {
      queueTaskPatch(id, { priority: e.target.value });
      return;
    }

    // My Done checkbox
    const act = e.target.dataset.act;
    if (act === "myDone") {
      const i = state.tasks.findIndex((x) => x.id === id);
      if (i < 0) return;
      const task = state.tasks[i];

      if (!isInvolved(task, me)) return; // safety
      const doneBy = { ...(task.doneBy || {}) };
      doneBy[me] = !!e.target.checked;
      queueTaskPatch(id, { doneBy });
      return;
    }
  });

  tasksBody.addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    const id = row.dataset.id;

    const act = e.target.closest("[data-act]")?.dataset?.act;
    if (!act) return;

    const task = state.tasks.find((x) => x.id === id);
    if (!task) return;

    if (act === "del") {
      if (!confirm("Delete this task?")) return;
      state.tasks = state.tasks.filter((x) => x.id !== id);
      renderTasks();
      renderStats();
      scheduleSave();
    }

    if (act === "editAssign") {
      openTaskDialog("edit", task);
    }
  });

  filterStatus.addEventListener("change", renderTasks);
  filterPriority.addEventListener("change", renderTasks);
  sortTasks.addEventListener("change", renderTasks);

  // Notes
  notesBox.addEventListener("input", scheduleNotesSave);

  // Export/Import
  exportBtn.addEventListener("click", () => download(`teamhub-export-${Date.now()}.json`, stateAsJSON()));
  importFile.addEventListener("change", async () => {
    const f = importFile.files?.[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      if (!confirm("Import will replace current data. Continue?")) return;
      replaceStateFromJSON(obj);
      notesBox.value = state.notes || "";
      renderLinks();
      renderTasks();
      renderStats();
      scheduleSave("Importing…");
    } catch (e) {
      console.error(e);
      alert("Import failed. Check JSON format.");
    } finally {
      importFile.value = "";
    }
  });

  // ---------------------------
  // Init
  // ---------------------------
  async function init() {
    loadTheme();
    whoLabel.textContent = "Pick user";

    showAuth("");
    setAuthFooter("Preparing…");

    // Detect PIN change (client-side)
    try {
      const current = await getServerPinHash();
      if (current && pinHash && current !== pinHash) {
        // PIN changed -> force re-login
        localStorage.removeItem(LS_TOKEN);
        token = "";
      }
      if (current) {
        pinHash = current;
        localStorage.setItem(LS_PINHASH, current);
      }
    } catch {
      // ignore
    }

    // If we already have token, try to load state
    if (token) {
      setAuthFooter("Restoring session…");
      try {
        hideAuth();
        await loadState();
      } catch (e) {
        console.error(e);
        lock("Session expired. Enter PIN again.");
      }
    } else {
      setAuthFooter("Enter PIN to unlock.");
    }

    // Ask who after unlock
    if (!authOverlay.hidden && token) {
      // rare, but keep safe
    }
    if (token) {
      if (me) setMe(me);
      else showWhoPicker();
    }
  }

  init();
})();
