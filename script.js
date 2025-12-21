/* Team Hub (single page)
   - Auth via PIN (/.netlify/functions/api/login)
   - State load/save (/.netlify/functions/api/state)
   - Identity picker (5 names)
   - Tasks: multi-assign + per-person done checkbox
*/

const API_BASE = "/.netlify/functions/api";
const LS_TOKEN = "teamhub.token.v1";
const LS_THEME = "teamhub.theme.v1";
const LS_USER  = "teamhub.userId.v1";
const LS_PINHASH = "teamhub.pinHash.v1";      // optional
const LS_PINHASH_SEEN = "teamhub.pinHashSeen.v1";
const LS_CACHE = "teamhub.state.cache.v1";

const MEMBERS = [
  { id: "youssef_elkhayat", name: "Youssef Elkhayat", team: "CAD Team" },
  { id: "youssef_roshdy", name: "Youssef Roshdy", team: "Prototype Team" },
  { id: "mohamed_alainiah", name: "Mohamed AlAiniah", team: "CAD Team" },
  { id: "ahmed_saeed", name: "Ahmed Saeed", team: "Prototype Team" },
  { id: "mohamed_elmansy", name: "Mohamed ElMansy", team: "CAD Team" },
];

const TEAM_TO_MEMBERS = {
  cad_team: MEMBERS.filter(m => m.team === "CAD Team").map(m => m.id),
  prototype_team: MEMBERS.filter(m => m.team === "Prototype Team").map(m => m.id),
  all: MEMBERS.map(m => m.id),
};

function uid(){
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function $(id){ return document.getElementById(id); }

const authOverlay = $("authOverlay");
const authForm = $("authForm");
const pinInput = $("pinInput");
const pinClearBtn = $("pinClearBtn");
const authMsg = $("authMsg");
const authFooterText = $("authFooterText");

const themeToggle = $("themeToggle");
const themeLabel = $("themeLabel");

const whoOverlay = $("whoOverlay");
const whoOptions = $("whoOptions");
const whoBtn = $("whoBtn");
const whoLabel = $("whoLabel");

const globalSearch = $("globalSearch");

const statLinks = $("statLinks");
const statTasks = $("statTasks");
const statOpen  = $("statOpen");

const newLinkBtn = $("newLinkBtn");
const linksGrid = $("linksGrid");

const newTaskBtn = $("newTaskBtn");
const tasksBody = $("tasksBody");
const tasksEmpty = $("tasksEmpty");
const taskCount = $("taskCount");

const filterStatus = $("filterStatus");
const filterPriority = $("filterPriority");
const sortTasks = $("sortTasks");

const sharedNotes = $("notesBox");

const exportBtn = $("exportBtn");
const importFile = $("importFile");

const linkDialog = $("linkDialog");
const linkForm = $("linkForm");
const linkDialogTitle = $("linkDialogTitle");
const linkTitle = $("linkTitle");
const linkUrl = $("linkUrl");
const linkDesc = $("linkDesc");
const linkSaveBtn = $("linkSaveBtn");

const taskDialog = $("taskDialog");
const taskForm = $("taskForm");
const taskDialogTitle = $("taskDialogTitle");
const taskDesc = $("taskDesc");
const taskAssigned = $("taskAssigned");
const taskDue = $("taskDue");
const taskStatus = $("taskStatus");
const taskPriority = $("taskPriority");
const taskNotes = $("taskNotes");
const taskCreateBtn = $("taskCreateBtn");

const logoutBtn = $("logoutBtn");

let state = {
  version: 1,
  workspaceName: "Team Hub",
  notes: "",
  links: [],
  tasks: [],
  updatedAt: new Date().toISOString(),
};

let token = localStorage.getItem(LS_TOKEN) || "";
let currentUser = localStorage.getItem(LS_USER) || "";

let saveTimer = null;
let lastSaveAt = 0;

function setTheme(mode){
  document.documentElement.dataset.theme = mode;
  localStorage.setItem(LS_THEME, mode);
  if(themeLabel) themeLabel.textContent = mode === "light" ? "Light" : "Dark";
}

function initTheme(){
  const saved = localStorage.getItem(LS_THEME);
  if(saved === "light" || saved === "dark") setTheme(saved);
  else setTheme("dark");
}

async function api(path, { method="GET", body=null, auth=true } = {}){
  const headers = { "Content-Type":"application/json" };
  if(auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
  const data = await res.json().catch(() => ({}));
  if(!res.ok) {
    const msg = data?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

/* Optional: detect PIN changes if backend exposes /pinhash */
async function checkPinHash(){
  try{
    const res = await fetch(`${API_BASE}/pinhash`, { method:"GET" });
    if(!res.ok) return;
    const data = await res.json().catch(() => null);
    if(!data?.hash) return;

    localStorage.setItem(LS_PINHASH_SEEN, "1");
    const old = localStorage.getItem(LS_PINHASH) || "";
    if(old && old !== data.hash){
      // PIN changed -> force re-login
      localStorage.removeItem(LS_TOKEN);
      token = "";
      showAuth("PIN changed. Please unlock again.");
    }
    localStorage.setItem(LS_PINHASH, data.hash);
  }catch(_e){
    // ignore
  }
}

function showAuth(message){
  if(authOverlay) authOverlay.hidden = false;
  if(authMsg) authMsg.textContent = message || "";
  if(pinInput) pinInput.value = "";
  if(pinInput) pinInput.focus();
}

function hideAuth(){
  if(authOverlay) authOverlay.hidden = true;
  if(authMsg) authMsg.textContent = "";
}

async function loginWithPin(pin){
  const data = await api("/login", { method:"POST", body:{ pin }, auth:false });
  if(!data?.ok || !data?.token) throw new Error("Login failed.");
  token = data.token;
  localStorage.setItem(LS_TOKEN, token);
  hideAuth();
}

async function loadState(){
  const data = await api("/state", { method:"GET" });
  if(data?.state) {
    state = normalizeState(data.state);
    localStorage.setItem(LS_CACHE, JSON.stringify(state));
    if(authFooterText) authFooterText.textContent = "Connected";
  }
}

function normalizeState(s){
  const safe = {
    version: 1,
    workspaceName: String(s?.workspaceName || "Team Hub").slice(0, 60),
    notes: String(s?.notes || "").slice(0, 20000),
    links: Array.isArray(s?.links) ? s.links.slice(0, 500) : [],
    tasks: Array.isArray(s?.tasks) ? s.tasks.slice(0, 2000) : [],
    updatedAt: s?.updatedAt || new Date().toISOString(),
  };
  // normalize tasks fields
  safe.tasks = safe.tasks.map(t => ({
    id: String(t.id || uid()),
    desc: String(t.desc || "").slice(0, 300),
    targets: Array.isArray(t.targets) ? t.targets : (t.targets ? [t.targets] : []),
    involved: Array.isArray(t.involved) ? t.involved : [],
    status: t.status || "todo",
    priority: t.priority || "med",
    due: t.due || "",
    notes: String(t.notes || "").slice(0, 2000),
    doneBy: (t.doneBy && typeof t.doneBy === "object") ? t.doneBy : {},
    createdAt: t.createdAt || new Date().toISOString(),
    updatedAt: t.updatedAt || new Date().toISOString(),
  }));
  safe.links = safe.links.map(l => ({
    id: String(l.id || uid()),
    title: String(l.title || "Untitled").slice(0, 80),
    url: String(l.url || ""),
    desc: String(l.desc || "").slice(0, 180),
    updatedAt: l.updatedAt || new Date().toISOString(),
  }));
  return safe;
}

function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try{
      lastSaveAt = Date.now();
      state.updatedAt = new Date().toISOString();
      await api("/state", { method:"POST", body: state });
      localStorage.setItem(LS_CACHE, JSON.stringify(state));
    }catch(e){
      // keep local cache if offline
      localStorage.setItem(LS_CACHE, JSON.stringify(state));
      if(authFooterText) authFooterText.textContent = "Using local cache";
    }
  }, 350);
}

/* ---------- Identity ---------- */
function getMemberName(id){
  const m = MEMBERS.find(x => x.id === id);
  return m ? m.name : id;
}
function currentMember(){
  return MEMBERS.find(m => m.id === currentUser) || null;
}

function renderWhoOptions(){
  if(!whoOptions) return;
  whoOptions.innerHTML = MEMBERS.map(m => `
    <button class="whoBtn" type="button" data-id="${m.id}">
      <div class="whoName">${m.name}</div>
      <div class="whoTeam">${m.team}</div>
    </button>
  `).join("");
}

function updateWhoLabel(){
  const me = currentMember();
  if(whoLabel) whoLabel.textContent = me ? me.name : "Pick name";
}

function openWho(force=false){
  if(!whoOverlay) return;
  renderWhoOptions();
  if(force || !currentUser){
    whoOverlay.hidden = false;
  }
}

function closeWho(){
  if(!whoOverlay) return;
  whoOverlay.hidden = true;
}

function setUser(id){
  currentUser = id;
  localStorage.setItem(LS_USER, id);
  updateWhoLabel();
  closeWho();
  renderAll();
}

function ensureUserChosen(){
  updateWhoLabel();
  if(!currentUser) openWho(true);
}

/* ---------- Links ---------- */
function renderLinks(){
  if(!linksGrid) return;

  const q = String(globalSearch?.value || "").trim().toLowerCase();
  let list = state.links.slice();

  if(q){
    list = list.filter(l =>
      (l.title||"").toLowerCase().includes(q) ||
      (l.desc||"").toLowerCase().includes(q) ||
      (l.url||"").toLowerCase().includes(q)
    );
  }

  linksGrid.innerHTML = list.map(l => `
    <div class="linkCard" data-id="${l.id}">
      <div class="linkCard__head">
        <div>
          <p class="kicker"><span class="dot"></span> LINK</p>
          <h4 class="linkCard__title">${escapeHtml(l.title)}</h4>
        </div>
        <div class="linkCard__actions">
          <button class="iconBtn js-editLink" type="button" title="Edit">
            ✎
          </button>
          <button class="iconBtn js-delLink" type="button" title="Delete">
            🗑
          </button>
        </div>
      </div>
      <p class="linkCard__desc">${escapeHtml(l.desc || "Lorem ipsum.")}</p>
      <a class="btn btn--primary" href="${escapeAttr(l.url)}" target="_blank" rel="noreferrer">Open ↗</a>
    </div>
  `).join("");
}

function openLinkDialog(link=null){
  if(!linkDialog) return;
  if(link){
    linkDialogTitle.textContent = "Edit link";
    linkTitle.value = link.title || "";
    linkUrl.value = link.url || "";
    linkDesc.value = link.desc || "";
    linkDialog.dataset.editId = link.id;
    linkSaveBtn.textContent = "Save";
  }else{
    linkDialogTitle.textContent = "New link";
    linkTitle.value = "";
    linkUrl.value = "";
    linkDesc.value = "";
    delete linkDialog.dataset.editId;
    linkSaveBtn.textContent = "Create";
  }
  linkDialog.showModal();
}

function upsertLinkFromDialog(){
  const title = linkTitle.value.trim() || "Untitled";
  const url = linkUrl.value.trim() || "#";
  const desc = linkDesc.value.trim();
  const now = new Date().toISOString();
  const editId = linkDialog.dataset.editId;

  if(editId){
    const l = state.links.find(x => x.id === editId);
    if(l){
      l.title = title; l.url = url; l.desc = desc; l.updatedAt = now;
    }
  }else{
    state.links.unshift({ id: uid(), title, url, desc, updatedAt: now });
  }
  scheduleSave();
  renderAll();
}

/* ---------- Tasks ---------- */
function expandTargets(targets){
  const picked = new Set();
  (targets || []).forEach(t => {
    if(TEAM_TO_MEMBERS[t]){
      TEAM_TO_MEMBERS[t].forEach(id => picked.add(id));
    }else if(MEMBERS.some(m => m.id === t)){
      picked.add(t);
    }
  });
  return Array.from(picked);
}

function displayTargets(targets){
  if(!targets || targets.length === 0) return `<span class="badge">Unassigned</span>`;
  return targets.map(t => {
    if(t === "cad_team") return `<span class="badge badge--team">CAD Team</span>`;
    if(t === "prototype_team") return `<span class="badge badge--team">Prototype Team</span>`;
    if(t === "all") return `<span class="badge badge--team">All</span>`;
    const me = (t === currentUser) ? " badge--mine" : "";
    return `<span class="badge${me}">${escapeHtml(getMemberName(t))}</span>`;
  }).join("");
}

function taskProgress(t){
  const involved = t.involved || [];
  const doneBy = t.doneBy || {};
  const done = involved.filter(id => doneBy[id]);
  const left = involved.filter(id => !doneBy[id]);
  if(involved.length === 0) return { text: "Not assigned", done, left, total: 0 };
  if(done.length === involved.length) return { text: `Fully done (${done.length}/${involved.length})`, done, left, total: involved.length };
  return { text: `In progress (${done.length}/${involved.length})`, done, left, total: involved.length };
}

function filteredTasks(){
  const q = String(globalSearch?.value || "").trim().toLowerCase();
  const st = filterStatus?.value || "all";
  const pr = filterPriority?.value || "all";

  let list = state.tasks.slice();

  if(st !== "all") list = list.filter(t => (t.status || "todo") === st);
  if(pr !== "all") list = list.filter(t => (t.priority || "med") === pr);

  if(q){
    list = list.filter(t =>
      (t.desc||"").toLowerCase().includes(q) ||
      (t.notes||"").toLowerCase().includes(q) ||
      (t.targets||[]).some(x => String(x).toLowerCase().includes(q))
    );
  }

  const sort = sortTasks?.value || "updatedDesc";
  if(sort === "dueAsc"){
    list.sort((a,b) => (a.due||"9999-99-99").localeCompare(b.due||"9999-99-99"));
  }else if(sort === "createdDesc"){
    list.sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||""));
  }else{
    list.sort((a,b) => (b.updatedAt||"").localeCompare(a.updatedAt||""));
  }

  return list;
}

function renderTasks(){
  if(!tasksBody) return;

  const list = filteredTasks();
  taskCount.textContent = String(list.length);

  tasksBody.innerHTML = list.map(t => {
    const involved = t.involved || [];
    const mine = currentUser && involved.includes(currentUser);
    const prog = taskProgress(t);

    const doneMine = !!(currentUser && t.doneBy && t.doneBy[currentUser]);

    const doneBox = mine ? `
      <label class="chk" title="Mark done for you">
        <input class="js-doneMine" type="checkbox" ${doneMine ? "checked":""}/>
        <span>Done (me)</span>
      </label>
    ` : `
      <label class="chk" title="Not assigned to you" style="opacity:.55; cursor:not-allowed;">
        <input type="checkbox" disabled />
        <span>Not assigned</span>
      </label>
    `;

    const doneNames = prog.done.map(getMemberName).join(", ");
    const leftNames = prog.left.map(getMemberName).join(", ");

    return `
      <tr class="${mine ? "rowMine":""}" data-id="${t.id}">
        <td contenteditable="true" class="js-desc">${escapeHtml(t.desc)}</td>
        <td>
          <div class="badges">${displayTargets(t.targets)}</div>
          <div class="progress">
            <b>${escapeHtml(prog.text)}</b>
            ${prog.total ? `<span>• done: ${escapeHtml(doneNames || "—")}</span>` : ""}
            ${prog.total ? `<span>• left: ${escapeHtml(leftNames || "—")}</span>` : ""}
          </div>
        </td>
        <td>
          <select class="select js-status">
            ${opt("todo","To do", t.status)}
            ${opt("doing","In progress", t.status)}
            ${opt("blocked","Blocked", t.status)}
            ${opt("done","Done", t.status)}
          </select>
          <div style="margin-top:10px;">${doneBox}</div>
        </td>
        <td>
          <select class="select js-priority">
            ${opt("low","Low", t.priority)}
            ${opt("med","Medium", t.priority)}
            ${opt("high","High", t.priority)}
          </select>
        </td>
        <td>
          <input class="input js-due" type="date" value="${escapeAttr(t.due||"")}"/>
        </td>
        <td>
          <textarea class="input mini js-notes" rows="2" placeholder="Notes…">${escapeHtml(t.notes||"")}</textarea>
        </td>
        <td class="th--right">
          <button class="btn btn--ghost js-editTask" type="button">Edit</button>
          <button class="btn btn--ghost js-delTask" type="button">Delete</button>
        </td>
      </tr>
    `;
  }).join("");

  tasksEmpty.hidden = list.length !== 0;
}

function openTaskDialog(task=null){
  if(!taskDialog) return;

  if(task){
    taskDialogTitle.textContent = "Edit task";
    taskDesc.value = task.desc || "";
    taskDue.value = task.due || "";
    taskStatus.value = task.status || "todo";
    taskPriority.value = task.priority || "med";
    taskNotes.value = task.notes || "";
    taskDialog.dataset.editId = task.id;

    // multi-select
    const selected = new Set(task.targets || []);
    for(const optEl of taskAssigned.options){
      optEl.selected = selected.has(optEl.value);
    }

    taskCreateBtn.textContent = "Save";
  }else{
    taskDialogTitle.textContent = "New task";
    taskDesc.value = "";
    taskDue.value = "";
    taskStatus.value = "todo";
    taskPriority.value = "med";
    taskNotes.value = "";
    delete taskDialog.dataset.editId;

    for(const optEl of taskAssigned.options){
      optEl.selected = false;
    }

    taskCreateBtn.textContent = "Create";
  }
  taskDialog.showModal();
}

function selectedTargets(){
  const out = [];
  for(const optEl of taskAssigned.options){
    if(optEl.selected) out.push(optEl.value);
  }
  return out;
}

function upsertTaskFromDialog(){
  const desc = taskDesc.value.trim();
  if(!desc) return;

  const targets = selectedTargets();
  const involved = expandTargets(targets);
  const now = new Date().toISOString();

  const editId = taskDialog.dataset.editId;
  if(editId){
    const t = state.tasks.find(x => x.id === editId);
    if(t){
      t.desc = desc;
      t.targets = targets;
      t.involved = involved;
      t.due = taskDue.value || "";
      t.status = taskStatus.value || "todo";
      t.priority = taskPriority.value || "med";
      t.notes = taskNotes.value || "";
      // if assignees changed, keep doneBy only for still-involved
      const nextDone = {};
      for(const id of involved){
        if(t.doneBy && t.doneBy[id]) nextDone[id] = t.doneBy[id];
      }
      t.doneBy = nextDone;
      t.updatedAt = now;
    }
  }else{
    state.tasks.unshift({
      id: uid(),
      desc,
      targets,
      involved,
      due: taskDue.value || "",
      status: taskStatus.value || "todo",
      priority: taskPriority.value || "med",
      notes: taskNotes.value || "",
      doneBy: {},
      createdAt: now,
      updatedAt: now,
    });
  }

  scheduleSave();
  renderAll();
}

function opt(value, label, current){
  const sel = (String(current || "") === value) ? "selected" : "";
  return `<option value="${value}" ${sel}>${label}</option>`;
}

/* Inline edits */
function wireTaskTableEvents(){
  tasksBody.addEventListener("change", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if(!tr) return;
    const id = tr.dataset.id;
    const t = state.tasks.find(x => x.id === id);
    if(!t) return;

    const now = new Date().toISOString();

    if(e.target.classList.contains("js-status")){
      t.status = e.target.value;
      t.updatedAt = now;
      scheduleSave();
      renderTasks();
    }
    if(e.target.classList.contains("js-priority")){
      t.priority = e.target.value;
      t.updatedAt = now;
      scheduleSave();
      renderTasks();
    }
    if(e.target.classList.contains("js-due")){
      t.due = e.target.value;
      t.updatedAt = now;
      scheduleSave();
      renderTasks();
    }
    if(e.target.classList.contains("js-doneMine")){
      if(!currentUser) return;
      t.doneBy = t.doneBy || {};
      if(e.target.checked){
        t.doneBy[currentUser] = new Date().toISOString();
      }else{
        delete t.doneBy[currentUser];
      }
      t.updatedAt = now;
      // if all involved done -> auto status done
      if(t.involved?.length && t.involved.every(id => t.doneBy && t.doneBy[id])){
        t.status = "done";
      }
      scheduleSave();
      renderTasks();
    }
    if(e.target.classList.contains("js-notes")){
      t.notes = e.target.value;
      t.updatedAt = now;
      scheduleSave();
      // no need to re-render for typing
    }
  });

  tasksBody.addEventListener("input", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if(!tr) return;
    if(e.target.classList.contains("js-desc")){
      const id = tr.dataset.id;
      const t = state.tasks.find(x => x.id === id);
      if(!t) return;
      t.desc = e.target.textContent.trim().slice(0, 300);
      t.updatedAt = new Date().toISOString();
      scheduleSave();
    }
  });

  tasksBody.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if(!tr) return;
    const id = tr.dataset.id;

    if(e.target.closest(".js-delTask")){
      const t = state.tasks.find(x => x.id === id);
      if(!t) return;
      if(confirm("Delete this task?")){
        state.tasks = state.tasks.filter(x => x.id !== id);
        scheduleSave();
        renderAll();
      }
      return;
    }
    if(e.target.closest(".js-editTask")){
      const t = state.tasks.find(x => x.id === id);
      if(t) openTaskDialog(t);
      return;
    }
  });
}

/* Links events */
function wireLinksEvents(){
  linksGrid.addEventListener("click", (e) => {
    const card = e.target.closest(".linkCard");
    if(!card) return;
    const id = card.dataset.id;
    const l = state.links.find(x => x.id === id);
    if(!l) return;

    if(e.target.closest(".js-delLink")){
      if(confirm("Delete this link?")){
        state.links = state.links.filter(x => x.id !== id);
        scheduleSave();
        renderAll();
      }
    }
    if(e.target.closest(".js-editLink")){
      openLinkDialog(l);
    }
  });
}

/* Notes */
function wireNotes(){
  if(!sharedNotes) return;
  sharedNotes.addEventListener("input", () => {
    state.notes = sharedNotes.value.slice(0, 20000);
    scheduleSave();
  });
}

/* Export / Import */
function downloadText(filename, text){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type:"application/json" }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 250);
}

/* Render */
function renderStats(){
  statLinks.textContent = String(state.links.length);
  statTasks.textContent = String(state.tasks.length);
  const open = state.tasks.filter(t => t.status !== "done").length;
  statOpen.textContent = String(open);
}

function renderNotes(){
  if(sharedNotes) sharedNotes.value = state.notes || "";
}

function renderAll(){
  renderStats();
  renderLinks();
  renderTasks();
  renderNotes();
  updateWhoLabel();
}

/* Helpers */
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}
function escapeAttr(s){ return escapeHtml(s).replaceAll("\n"," "); }

/* ---------- Boot ---------- */
initTheme();
checkPinHash().finally(() => { /* no-op */ });

if(themeToggle){
  themeToggle.addEventListener("click", () => {
    const next = (document.documentElement.dataset.theme === "light") ? "dark" : "light";
    setTheme(next);
  });
}

if(authForm){
  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pin = (pinInput?.value || "").trim();
    if(!pin) return;
    try{
      authMsg.textContent = "Checking…";
      await loginWithPin(pin);
      authFooterText.textContent = "Connected";
      await loadState();
      renderAll();
      ensureUserChosen();
      authMsg.textContent = "";
    }catch(err){
      authMsg.textContent = err.message || "Login failed.";
    }
  });
}

if(pinClearBtn){
  pinClearBtn.addEventListener("click", () => {
    localStorage.removeItem(LS_TOKEN);
    token = "";
    showAuth("Forgotten on this device.");
  });
}

if(logoutBtn){
  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem(LS_TOKEN);
    token = "";
    showAuth("Locked.");
  });
}

if(whoBtn){
  whoBtn.addEventListener("click", () => openWho(true));
}
if(whoOptions){
  whoOptions.addEventListener("click", (e) => {
    const btn = e.target.closest(".whoBtn");
    if(!btn) return;
    setUser(btn.dataset.id);
  });
}
if(whoOverlay){
  // allow click outside to close only if a user is already selected
  whoOverlay.addEventListener("click", (e) => {
    if(e.target === whoOverlay && currentUser) closeWho();
  });
}

if(globalSearch){
  globalSearch.addEventListener("input", () => {
    renderLinks();
    renderTasks();
  });
}
if(filterStatus) filterStatus.addEventListener("change", renderTasks);
if(filterPriority) filterPriority.addEventListener("change", renderTasks);
if(sortTasks) sortTasks.addEventListener("change", renderTasks);

if(newLinkBtn) newLinkBtn.addEventListener("click", () => openLinkDialog(null));
if(linkForm){
  linkForm.addEventListener("submit", (e) => {
    e.preventDefault();
    upsertLinkFromDialog();
    linkDialog.close();
  });
}

if(newTaskBtn) newTaskBtn.addEventListener("click", () => openTaskDialog(null));
if(taskForm){
  taskForm.addEventListener("submit", (e) => {
    e.preventDefault();
    upsertTaskFromDialog();
    taskDialog.close();
  });
}

if(exportBtn){
  exportBtn.addEventListener("click", () => {
    downloadText(`teamhub_${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(state, null, 2));
  });
}
if(importFile){
  importFile.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    if(!file) return;
    const text = await file.text();
    try{
      const obj = JSON.parse(text);
      state = normalizeState(obj);
      scheduleSave();
      renderAll();
      alert("Imported.");
    }catch{
      alert("Invalid JSON.");
    }finally{
      importFile.value = "";
    }
  });
}

/* Wire table/card events */
wireTaskTableEvents();
wireLinksEvents();
wireNotes();

/* Initial load */
(async () => {
  // Try token -> load state. If missing/invalid, show auth.
  try{
    if(!token){
      // try local cache for read-only experience
      const cached = localStorage.getItem(LS_CACHE);
      if(cached){
        state = normalizeState(JSON.parse(cached));
        renderAll();
      }
      showAuth("Enter PIN to unlock.");
      return;
    }

    authFooterText.textContent = "Connecting…";
    await loadState();
    renderAll();
    hideAuth();
    ensureUserChosen();
  }catch(err){
    // token invalid or server unreachable
    const cached = localStorage.getItem(LS_CACHE);
    if(cached){
      try{
        state = normalizeState(JSON.parse(cached));
        renderAll();
        authFooterText.textContent = "Using local cache";
      }catch{}
    }
    showAuth("Enter PIN to unlock.");
  }
})();
