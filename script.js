// Team Hub — Firebase edition (no Netlify functions, no localStorage data)
// - Data stored in Firestore: links, tasks, shared notes, config(pinHash)
// - PIN cached (hash) locally; re-prompt only if Firestore pinHash changes
// - Theme cached locally
//
// NOTE: Firestore security rules must allow your team to read/write.
// If you see "permission-denied", update rules in Firebase console.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc,
  collection, addDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* Firebase config (hardcoded) */
const firebaseConfig = {
  apiKey: "AIzaSyDGcdvcNW-zJTeMBozHaBET81IA3LmYdlE",
  authDomain: "capstone-management-eb363.firebaseapp.com",
  projectId: "capstone-management-eb363",
  storageBucket: "capstone-management-eb363.firebasestorage.app",
  messagingSenderId: "859371424164",
  appId: "1:859371424164:web:24861b1adfcb31f5621931",
  measurementId: "G-DK1TCKMCVZ"
};

const app = initializeApp(firebaseConfig);
try { getAnalytics(app); } catch { /* analytics optional */ }
const db = getFirestore(app);

/* Defaults */
const DEFAULT_PIN = "1234"; // first run only; change later by editing meta/config.pinHash
const LS_THEME = "teamhub_theme_v2";
const LS_PINHASH = "teamhub_pin_hash_v2";

/* Helpers */
const $ = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => [...el.querySelectorAll(q)];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function nowISODate(){
  const d = new Date();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
async function sha256Hex(text){
  const enc = new TextEncoder().encode(String(text));
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,"0")).join("");
}
// Dev helper: compute SHA-256 hex (useful if you want to update meta/config.pinHash)
window.teamhubSha256 = sha256Hex;


/* Firestore refs */
const configRef = doc(db, "meta", "config");
const notesRef = doc(db, "notes", "shared");
const linksCol = collection(db, "links");
const tasksCol = collection(db, "tasks");

/* UI refs */
const authOverlay = $("#authOverlay");
const authForm = $("#authForm");
const pinInput = $("#pinInput");
const pinClearBtn = $("#pinClearBtn");
const authMsg = $("#authMsg");
const authFooterText = $("#authFooterText");

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
const linkForm = $("#linkForm");
const linkDialogTitle = $("#linkDialogTitle");
const linkTitle = $("#linkTitle");
const linkUrl = $("#linkUrl");
const linkDesc = $("#linkDesc");
const linkSaveBtn = $("#linkSaveBtn");

const newTaskBtn = $("#newTaskBtn");
const taskDialog = $("#taskDialog");
const taskForm = $("#taskForm");
const taskDialogTitle = $("#taskDialogTitle");
const taskDesc = $("#taskDesc");
const taskAssigned = $("#taskAssigned");
const taskStatus = $("#taskStatus");
const taskPriority = $("#taskPriority");
const taskDue = $("#taskDue");
const taskNotes = $("#taskNotes");
const taskCreateBtn = $("#taskCreateBtn");

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

/* Local state (in-memory only) */
let remotePinHash = null;
let links = []; // {id, title, url, desc, order, updatedAt}
let tasks = []; // {id, ...}
let notesText = "";
let isUnlocked = false;
let dragId = null;
let searchQuery = "";

/* Theme */
function applyTheme(theme){
  document.documentElement.dataset.theme = theme;
  themeLabel.textContent = theme === "light" ? "Light" : "Dark";
}
function loadTheme(){
  const t = localStorage.getItem(LS_THEME) || "dark";
  applyTheme(t);
}
function toggleTheme(){
  const cur = document.documentElement.dataset.theme || "dark";
  const next = cur === "dark" ? "light" : "dark";
  localStorage.setItem(LS_THEME, next);
  applyTheme(next);
}

/* Bootstrap Firestore docs (clean slate) */
async function ensureBootstrap(){
  const cfgSnap = await getDoc(configRef);
  if (!cfgSnap.exists()){
    const pinHash = await sha256Hex(DEFAULT_PIN);
    await setDoc(configRef, {
      pinHash,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      version: 1
    });
  }

  const notesSnap = await getDoc(notesRef);
  if (!notesSnap.exists()){
    await setDoc(notesRef, {
      text: "",
      updatedAt: serverTimestamp()
    });
  }
}

/* Auth */
function showAuth(msg=""){
  authOverlay.hidden = false;
  authMsg.textContent = msg;
  setTimeout(()=> pinInput?.focus(), 50);
}
function hideAuth(){
  authOverlay.hidden = true;
  authMsg.textContent = "";
}
function setAuthFooter(s){ authFooterText.textContent = s; }

async function fetchRemotePinHash(){
  const snap = await getDoc(configRef);
  remotePinHash = snap.data()?.pinHash || null;
  return remotePinHash;
}
function startConfigWatch(){
  if (unsubConfig) unsubConfig();

  unsubConfig = onSnapshot(configRef, (snap)=>{
    const ph = snap.data()?.pinHash || null;
    if (ph && ph !== remotePinHash){
      remotePinHash = ph;
      const cached = localStorage.getItem(LS_PINHASH);

      // If PIN changed while unlocked or cached, require re-entry.
      if (isUnlocked && (!cached || cached !== remotePinHash)){
        lock();
      }
    } else {
      remotePinHash = ph;
    }
  });
}



async function tryAutoUnlock(){
  const cached = localStorage.getItem(LS_PINHASH);
  if (cached && remotePinHash && cached === remotePinHash){
    isUnlocked = true;
    hideAuth();
    return true;
  }
  return false;
}

async function unlockWithPin(pin){
  const hash = await sha256Hex(pin);
  if (!remotePinHash){
    await fetchRemotePinHash();
  }
  if (hash && remotePinHash && hash === remotePinHash){
    localStorage.setItem(LS_PINHASH, remotePinHash);
    isUnlocked = true;
    hideAuth();
    return true;
  }
  return false;
}

function lock(){
  isUnlocked = false;
  localStorage.removeItem(LS_PINHASH);
  showAuth("Locked. Enter PIN to continue.");
}

/* Realtime subscriptions */
let unsubLinks = null;
let unsubTasks = null;
let unsubNotes = null;
let unsubConfig = null;

function startSubscriptions(){
  if (unsubLinks) unsubLinks();
  if (unsubTasks) unsubTasks();
  if (unsubNotes) unsubNotes();

  // Config watcher is started once in init (keeps remotePinHash fresh)
  unsubLinks = onSnapshot(query(linksCol, orderBy("order", "asc")), (snap)=>{
    links = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderLinks();
    renderStats();
  });

  unsubTasks = onSnapshot(query(tasksCol, orderBy("updatedAt", "desc")), (snap)=>{
    tasks = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderTasks();
    renderStats();
  });

  unsubNotes = onSnapshot(notesRef, (snap)=>{
    const data = snap.data() || {};
    notesText = String(data.text ?? "");
    if (notesBox.value !== notesText) notesBox.value = notesText;
    notesStatus.textContent = "Synced";
  });
}
/* Render: stats */
function renderStats(){
  statLinks.textContent = String(links.length);
  statTasks.textContent = String(tasks.length);
  const open = tasks.filter(t => (t.status ?? "todo") !== "done").length;
  statOpen.textContent = String(open);
}

/* Links */
function linkCardHTML(l){
  const title = escapeHtml(l.title || "Lorem ipsum");
  const desc = escapeHtml(l.desc || "Lorem ipsum");
  const url = escapeHtml(l.url || "#");
  return `
    <div class="linkCard" draggable="true" data-id="${l.id}">
      <div class="linkCard__top">
        <div>
          <div class="linkCard__title">${title}</div>
          <div class="linkCard__url">${url}</div>
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
      <div class="linkCard__desc">${desc}</div>
      <a class="linkCard__open" href="${url}" target="_blank" rel="noopener">Open ↗</a>
    </div>
  `;
}

function renderLinks(){
  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? links.filter(l => {
        const s = `${l.title||""} ${l.desc||""} ${l.url||""}`.toLowerCase();
        return s.includes(q);
      })
    : links;

  linksGrid.innerHTML = filtered.map(linkCardHTML).join("") || `<div class="empty">No links yet. Click <b>+ New link</b>.</div>`;
}

let editingLinkId = null;
function openLinkDialog(mode, link=null){
  editingLinkId = mode === "edit" ? link?.id : null;
  linkDialogTitle.textContent = mode === "edit" ? "Edit link" : "New link";
  linkSaveBtn.textContent = mode === "edit" ? "Save" : "Create";
  linkTitle.value = link?.title || "";
  linkUrl.value = link?.url || "";
  linkDesc.value = link?.desc || "";
  linkDialog.showModal();
  setTimeout(()=> linkTitle.focus(), 30);
}

async function createLink(data){
  const maxOrder = links.reduce((m,l)=> Math.max(m, Number(l.order||0)), 0);
  const order = (isFinite(maxOrder) ? maxOrder : 0) + 100;
  await addDoc(linksCol, {
    title: data.title || "Lorem ipsum",
    url: data.url || "#",
    desc: data.desc || "Lorem ipsum",
    order,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

async function updateLink(id, data){
  await updateDoc(doc(db, "links", id), {
    title: data.title || "Lorem ipsum",
    url: data.url || "#",
    desc: data.desc || "Lorem ipsum",
    updatedAt: serverTimestamp()
  });
}

async function deleteLinkById(id){
  await deleteDoc(doc(db, "links", id));
}

async function persistLinkOrder(idsInOrder){
  const batch = writeBatch(db);
  idsInOrder.forEach((id, idx)=>{
    batch.update(doc(db,"links", id), { order: idx*100, updatedAt: serverTimestamp() });
  });
  await batch.commit();
}

/* Tasks */
const PRIORITY_SCORE = { low:1, med:2, high:3 };
function statusBadge(status){
  const s = status || "todo";
  const map = {
    todo: { label:"To do", dot:"rgba(255,255,255,.35)" },
    doing:{ label:"Doing", dot:"rgba(16,184,215,.65)" },
    blocked:{ label:"Blocked", dot:"rgba(255,207,90,.7)" },
    done:{ label:"Done", dot:"rgba(62,227,138,.7)" }
  };
  const it = map[s] || map.todo;
  return `<span class="badge"><span class="dot" style="background:${it.dot};border-color:transparent"></span>${it.label}</span>`;
}
function priorityBadge(p){
  const v = p || "med";
  const map = {
    low:{ label:"Low", dot:"rgba(255,255,255,.35)" },
    med:{ label:"Medium", dot:"rgba(16,184,215,.55)" },
    high:{ label:"High", dot:"rgba(255,91,107,.65)" }
  };
  const it = map[v] || map.med;
  return `<span class="badge"><span class="dot" style="background:${it.dot};border-color:transparent"></span>${it.label}</span>`;
}

function parseFSDate(x){
  // x can be string(YYYY-MM-DD) or Firestore Timestamp-like
  if (!x) return null;
  if (typeof x === "string") return x;
  if (x.seconds) {
    const d = new Date(x.seconds * 1000);
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const dd = String(d.getDate()).padStart(2,"0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  }
  return null;
}

function renderTasks(){
  const q = searchQuery.trim().toLowerCase();
  const st = filterStatus.value;
  const pr = filterPriority.value;
  const sortMode = sortTasks.value;

  let list = [...tasks];

  // search
  if (q){
    list = list.filter(t => {
      const s = `${t.desc||""} ${t.assigned||""} ${t.notes||""} ${t.status||""} ${t.priority||""}`.toLowerCase();
      return s.includes(q);
    });
  }

  // filters
  if (st !== "all") list = list.filter(t => (t.status||"todo") === st);
  if (pr !== "all") list = list.filter(t => (t.priority||"med") === pr);

  // sort
  list.sort((a,b)=>{
    if (sortMode === "dueAsc"){
      const da = parseFSDate(a.due) || "9999-12-31";
      const dbb = parseFSDate(b.due) || "9999-12-31";
      return da.localeCompare(dbb);
    }
    if (sortMode === "priorityDesc"){
      return (PRIORITY_SCORE[b.priority||"med"]||2) - (PRIORITY_SCORE[a.priority||"med"]||2);
    }
    if (sortMode === "createdDesc"){
      const ca = a.createdAt?.seconds || 0;
      const cb = b.createdAt?.seconds || 0;
      return cb - ca;
    }
    // updatedDesc default
    const ua = a.updatedAt?.seconds || 0;
    const ub = b.updatedAt?.seconds || 0;
    return ub - ua;
  });

  taskCount.textContent = String(list.length);

  tasksBody.innerHTML = list.map(t=>{
    const due = parseFSDate(t.due) || "";
    const safeDesc = escapeHtml(t.desc || "");
    const safeAssigned = escapeHtml(t.assigned || "");
    const safeNotes = escapeHtml(t.notes || "");
    return `
      <tr data-id="${t.id}">
        <td><input class="cellInput" data-field="desc" value="${safeDesc}" placeholder="Task description" /></td>
        <td><input class="cellInput" data-field="assigned" value="${safeAssigned}" placeholder="Name" /></td>
        <td>
          <select class="select" data-field="status">
            <option value="todo" ${t.status==="todo"?"selected":""}>To do</option>
            <option value="doing" ${t.status==="doing"?"selected":""}>Doing</option>
            <option value="blocked" ${t.status==="blocked"?"selected":""}>Blocked</option>
            <option value="done" ${t.status==="done"?"selected":""}>Done</option>
          </select>
        </td>
        <td>
          <select class="select" data-field="priority">
            <option value="low" ${t.priority==="low"?"selected":""}>Low</option>
            <option value="med" ${(!t.priority || t.priority==="med")?"selected":""}>Medium</option>
            <option value="high" ${t.priority==="high"?"selected":""}>High</option>
          </select>
        </td>
        <td><input class="cellInput" data-field="due" type="date" value="${escapeHtml(due)}" /></td>
        <td><input class="cellInput" data-field="notes" value="${safeNotes}" placeholder="Notes" /></td>
        <td class="th--right">
          <div class="actionsRight">
            <button class="smallBtn danger" data-act="del">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  tasksEmpty.hidden = list.length !== 0;
}

async function createTask(data){
  await addDoc(tasksCol, {
    desc: data.desc || "Lorem ipsum",
    assigned: data.assigned || "",
    status: data.status || "todo",
    priority: data.priority || "med",
    due: data.due || "",
    notes: data.notes || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

async function patchTask(id, patch){
  patch.updatedAt = serverTimestamp();
  await updateDoc(doc(db, "tasks", id), patch);
}

async function deleteTask(id){
  await deleteDoc(doc(db, "tasks", id));
}

/* Notes (debounced save) */
let notesTimer = null;
function scheduleNotesSave(){
  notesStatus.textContent = "Typing…";
  if (notesTimer) clearTimeout(notesTimer);
  notesTimer = setTimeout(async ()=>{
    try{
      await updateDoc(notesRef, { text: notesBox.value, updatedAt: serverTimestamp() });
      notesStatus.textContent = "Saved";
    }catch(e){
      notesStatus.textContent = "Save failed";
      console.error(e);
    }
  }, 450);
}

/* Export / Import */
function download(filename, text){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], {type:"application/json"}));
  a.download = filename;
  a.click();
  setTimeout(()=> URL.revokeObjectURL(a.href), 1000);
}

function stateAsJSON(){
  const out = {
    links: links.map(l => ({
      title:l.title||"",
      url:l.url||"",
      desc:l.desc||"",
      order:Number(l.order||0)
    })),
    tasks: tasks.map(t => ({
      desc:t.desc||"",
      assigned:t.assigned||"",
      status:t.status||"todo",
      priority:t.priority||"med",
      due: parseFSDate(t.due) || "",
      notes:t.notes||""
    })),
    notes: notesBox.value || ""
  };
  return JSON.stringify(out, null, 2);
}

async function importFromJSON(obj){
  const batch = writeBatch(db);

  // wipe existing (batched deletes in chunks)
  // (safe for small teams; for huge datasets you'd paginate)
  for (const l of links) batch.delete(doc(db,"links", l.id));
  for (const t of tasks) batch.delete(doc(db,"tasks", t.id));
  batch.set(notesRef, { text: String(obj.notes||""), updatedAt: serverTimestamp() }, { merge:true });

  // add new docs
  (obj.links || []).forEach((l, idx)=>{
    const ref = doc(collection(db,"links"));
    batch.set(ref, {
      title: String(l.title || "Lorem ipsum"),
      url: String(l.url || "#"),
      desc: String(l.desc || "Lorem ipsum"),
      order: Number.isFinite(Number(l.order)) ? Number(l.order) : idx*100,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });

  (obj.tasks || []).forEach((t)=>{
    const ref = doc(collection(db,"tasks"));
    batch.set(ref, {
      desc: String(t.desc || "Lorem ipsum"),
      assigned: String(t.assigned || ""),
      status: String(t.status || "todo"),
      priority: String(t.priority || "med"),
      due: String(t.due || ""),
      notes: String(t.notes || ""),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });

  await batch.commit();
}

/* Events */
themeToggle.addEventListener("click", toggleTheme);
logoutBtn.addEventListener("click", lock);

pinClearBtn.addEventListener("click", ()=>{
  localStorage.removeItem(LS_PINHASH);
  authMsg.textContent = "Forgotten on this device.";
});

authForm.addEventListener("submit", async (e)=>{
  e.preventDefault();
  authMsg.textContent = "Checking…";
  const ok = await unlockWithPin(pinInput.value.trim());
  if (ok){
    authMsg.textContent = "";
    pinInput.value = "";
    // ensure subscriptions only after unlock
    startSubscriptions();
  } else {
    authMsg.textContent = "Wrong PIN.";
    pinInput.select();
  }
});

globalSearch.addEventListener("input", ()=>{
  searchQuery = globalSearch.value || "";
  renderLinks();
  renderTasks();
});

newLinkBtn.addEventListener("click", ()=> openLinkDialog("new"));
linkForm.addEventListener("submit", async (e)=>{
  e.preventDefault();
});
linkDialog.addEventListener("close", async ()=>{
  if (linkDialog.returnValue !== "ok") return;
  const data = {
    title: linkTitle.value.trim() || "Lorem ipsum",
    url: linkUrl.value.trim() || "#",
    desc: linkDesc.value.trim() || "Lorem ipsum"
  };
  try{
    if (editingLinkId) await updateLink(editingLinkId, data);
    else await createLink(data);
  }catch(err){ console.error(err); }
  editingLinkId = null;
});

linksGrid.addEventListener("click", async (e)=>{
  const card = e.target.closest(".linkCard");
  if (!card) return;
  const id = card.dataset.id;
  const actBtn = e.target.closest("[data-act]");
  if (!actBtn) return;
  const act = actBtn.dataset.act;
  const link = links.find(x=> x.id === id);
  if (act === "edit" && link){
    openLinkDialog("edit", link);
  }
  if (act === "del"){
    if (confirm("Delete this link?")){
      try{ await deleteLinkById(id); } catch(err){ console.error(err); }
    }
  }
});

/* Drag reorder links */
linksGrid.addEventListener("dragstart", (e)=>{
  const card = e.target.closest(".linkCard");
  if (!card) return;
  dragId = card.dataset.id;
  card.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
});
linksGrid.addEventListener("dragend", (e)=>{
  const card = e.target.closest(".linkCard");
  if (!card) return;
  card.classList.remove("dragging");
  dragId = null;
});
linksGrid.addEventListener("dragover", (e)=>{
  e.preventDefault();
  const over = e.target.closest(".linkCard");
  if (!over || !dragId) return;
  const overId = over.dataset.id;
  if (overId === dragId) return;

  // reorder in-memory for instant UI
  const a = links.findIndex(x=> x.id === dragId);
  const b = links.findIndex(x=> x.id === overId);
  if (a < 0 || b < 0) return;

  const next = [...links];
  const [moved] = next.splice(a, 1);
  next.splice(b, 0, moved);
  links = next;
  renderLinks();
});
linksGrid.addEventListener("drop", async (e)=>{
  e.preventDefault();
  if (!dragId) return;
  try{
    const ids = [...links].sort((x,y)=>Number(x.order||0)-Number(y.order||0)).map(x=>x.id);
    // our render drag reorders links array, but Firestore ordering is by "order"
    // so persist current visual order by reading DOM order:
    const domIds = $$(".linkCard", linksGrid).map(el=> el.dataset.id);
    if (domIds.length) await persistLinkOrder(domIds);
  }catch(err){ console.error(err); }
});

/* Tasks dialogs */
newTaskBtn.addEventListener("click", ()=>{
  taskDialogTitle.textContent = "New task";
  taskCreateBtn.textContent = "Create";
  taskDesc.value = "";
  taskAssigned.value = "";
  taskStatus.value = "todo";
  taskPriority.value = "med";
  taskDue.value = "";
  taskNotes.value = "";
  taskDialog.showModal();
  setTimeout(()=> taskDesc.focus(), 30);
});
taskDialog.addEventListener("close", async ()=>{
  if (taskDialog.returnValue !== "ok") return;
  try{
    await createTask({
      desc: taskDesc.value.trim() || "Lorem ipsum",
      assigned: taskAssigned.value.trim(),
      status: taskStatus.value,
      priority: taskPriority.value,
      due: taskDue.value || "",
      notes: taskNotes.value.trim()
    });
  }catch(err){ console.error(err); }
});

/* Tasks inline editing */
let patchTimer = null;
let pendingPatch = null;
function scheduleTaskPatch(id, patch){
  pendingPatch = { id, patch: { ...pendingPatch?.patch, ...patch } };
  if (patchTimer) clearTimeout(patchTimer);
  patchTimer = setTimeout(async ()=>{
    if (!pendingPatch) return;
    const { id:tid, patch:pp } = pendingPatch;
    pendingPatch = null;
    try{ await patchTask(tid, pp); } catch(err){ console.error(err); }
  }, 350);
}

tasksBody.addEventListener("input", (e)=>{
  const row = e.target.closest("tr[data-id]");
  if (!row) return;
  const id = row.dataset.id;
  const field = e.target.dataset.field;
  if (!field) return;

  let val = e.target.value;
  if (field === "due") val = val || "";
  scheduleTaskPatch(id, { [field]: val });
});

tasksBody.addEventListener("click", async (e)=>{
  const row = e.target.closest("tr[data-id]");
  if (!row) return;
  const id = row.dataset.id;
  const btn = e.target.closest("[data-act='del']");
  if (!btn) return;
  if (confirm("Delete this task?")){
    try{ await deleteTask(id); } catch(err){ console.error(err); }
  }
});

filterStatus.addEventListener("change", renderTasks);
filterPriority.addEventListener("change", renderTasks);
sortTasks.addEventListener("change", renderTasks);

/* Notes */
notesBox.addEventListener("input", scheduleNotesSave);

/* Export/Import */
exportBtn.addEventListener("click", ()=>{
  download(`teamhub-export-${Date.now()}.json`, stateAsJSON());
});
importFile.addEventListener("change", async ()=>{
  const f = importFile.files?.[0];
  if (!f) return;
  try{
    const txt = await f.text();
    const obj = JSON.parse(txt);
    if (!confirm("Import will replace current data. Continue?")) return;
    await importFromJSON(obj);
  }catch(err){
    alert("Import failed. Check JSON format.");
    console.error(err);
  }finally{
    importFile.value = "";
  }
});

/* Init */
(async function init(){
  loadTheme();

  showAuth("");
  setAuthFooter("Preparing database…");

  try{
    await ensureBootstrap();
    setAuthFooter("Checking PIN…");
    await fetchRemotePinHash();
    startConfigWatch();

    const auto = await tryAutoUnlock();
    if (!auto){
      showAuth("");
      setAuthFooter("Enter PIN to unlock.");
    } else {
      startSubscriptions();
    }
  }catch(err){
    console.error(err);
    showAuth("Connection error. Check Firebase config/rules.");
    setAuthFooter("Failed to connect.");
  }
})();
