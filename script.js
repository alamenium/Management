// Team Hub — Firebase edition (no Netlify functions, no localStorage data)
// - Data stored in Firestore: links, tasks, shared notes, config(pinHash)
// - PIN cached (hash) locally; re-prompt only if Firestore pinHash changes
// - Theme cached locally
//
// NOTE: Firestore security rules must allow your team to read/write.
// If you see "permission-denied", update rules in Firebase console.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-analytics.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc,
  collection, addDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp, writeBatch, deleteField
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

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
const DEFAULT_PIN = "0750"; // first run only; change later by editing meta/config.pinHash
const LS_THEME = "teamhub_theme_v2";
const LS_PINHASH = "teamhub_pin_hash_v2";

const LS_WHO = "teamhub_who_v1";

// Hardcoded members (used for "Who are you?", task assignment, and emailing)
const MEMBERS = [
  { id:"youssef_elkhayat", name:"Youssef Elkhayat", team:"CAD Team", email:"youssifayman2004@gmail.com" },
  { id:"youssef_roshdy", name:"Youssef Roshdy", team:"Prototype Team", email:"yousufdiaa2004@gmail.com" },
  { id:"mohamed_alainiah", name:"Mohamed AlAiniah", team:"CAD Team", email:"Mohammad.bashar033@gmail.com" },
  { id:"ahmed_saeed", name:"Ahmed Saeed", team:"Prototype Team", email:"saeedahmedsuper@gmail.com" },
  { id:"mohamed_elmansy", name:"Mohamed ElMansy", team:"CAD Team", email:"mohammadadham20@gmail.com" },
];
const MEMBER_BY_ID = Object.fromEntries(MEMBERS.map(m => [m.id, m]));
const CAD_IDS = MEMBERS.filter(m=>m.team==="CAD Team").map(m=>m.id);
const PROTO_IDS = MEMBERS.filter(m=>m.team==="Prototype Team").map(m=>m.id);
const ALL_IDS = MEMBERS.map(m=>m.id);

function resolveAssignment(key){
  // key examples: "user:youssef_elkhayat" | "team:cad" | "team:prototype" | "all"
  if (!key) return { key:"", label:"", targets:[] };
  if (key === "all") return { key, label:"All", targets:[...ALL_IDS] };
  if (key.startsWith("team:cad")) return { key:"team:cad", label:"CAD Team", targets:[...CAD_IDS] };
  if (key.startsWith("team:prototype")) return { key:"team:prototype", label:"Prototype Team", targets:[...PROTO_IDS] };
  if (key.startsWith("user:")){
    const id = key.slice("user:".length);
    const m = MEMBER_BY_ID[id];
    return m ? { key:`user:${id}`, label:m.name, targets:[id] } : { key, label:"", targets:[] };
  }
  return { key, label:key, targets:[] };
}

let currentUserId = localStorage.getItem(LS_WHO) || "";
if (currentUserId && MEMBER_BY_ID[currentUserId]) { whoLabel.textContent = MEMBER_BY_ID[currentUserId].name; }
function setCurrentUser(id){
  currentUserId = id;
  localStorage.setItem(LS_WHO, id);
  const m = MEMBER_BY_ID[id];
  whoLabel.textContent = m ? m.name : "Select user";
  renderTasks();
}
function openWhoOverlay(){
  // build buttons (fresh each time in case we change the list)
  whoList.innerHTML = MEMBERS.map(m => {
    const initials = m.name.split(" ").map(x=>x[0]).slice(0,2).join("").toUpperCase();
    const active = m.id === currentUserId ? " isActive" : "";
    return `
      <button class="whoCard${active}" type="button" data-who="${m.id}">
        <div class="whoAvatar">${initials}</div>
        <div class="whoMeta">
          <div class="whoName">${escapeHtml(m.name)}</div>
          <div class="whoTeam">${escapeHtml(m.team)}</div>
        </div>
      </button>
    `;
  }).join("");
  whoOverlay.hidden = false;
  setTimeout(()=> whoList.querySelector("button")?.focus(), 30);
}
function closeWhoOverlay(){ whoOverlay.hidden = true; }
async function ensureWhoSelected(){
  if (currentUserId && MEMBER_BY_ID[currentUserId]){
    whoLabel.textContent = MEMBER_BY_ID[currentUserId].name;
    return;
  }
  openWhoOverlay();
}


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

const whoOverlay = $("#whoOverlay");
const whoList = $("#whoList");
const whoBtn = $("#whoBtn");
const whoLabel = $("#whoLabel");
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
    await ensureWhoSelected();
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
    await ensureWhoSelected();
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
  const open = tasks.filter(t => !isFullyDone(t)).length;
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

/* Tasks */
function guessAssignedKey(t){
  if (t.assignedKey) return t.assignedKey;
  // best-effort for older docs
  const a = String(t.assignedLabel || t.assigned || "").trim();
  const found = MEMBERS.find(m => m.name.toLowerCase() === a.toLowerCase());
  if (found) return `user:${found.id}`;
  if (a.toLowerCase() === "cad team") return "team:cad";
  if (a.toLowerCase() === "prototype team") return "team:prototype";
  if (a.toLowerCase() === "all") return "all";
  return "";
}

function getTargets(t){
  if (Array.isArray(t.targets) && t.targets.length) return t.targets;
  // migrate older docs: single assignee text -> try match
  const key = guessAssignedKey(t);
  return resolveAssignment(key).targets || [];
}

function isFullyDone(t){
  if (typeof t.fullyDone === "boolean") return t.fullyDone;
  const targets = getTargets(t);
  const doneBy = t.doneBy || {};
  const doneCount = targets.filter(id => !!doneBy?.[id]).length;
  return targets.length > 0 && doneCount === targets.length;
}

function initials(name){
  return String(name||"").split(" ").filter(Boolean).slice(0,2).map(s=>s[0]).join("").toUpperCase() || "?";
}

function renderTasks(){
  const statusVal = filterStatus.value || "all";
  const prioVal = filterPriority.value || "all";
  const s = (searchQuery || "").trim().toLowerCase();

  let list = tasks.slice();
  list = list.filter(t=>{
    const fully = isFullyDone(t);
    if (statusVal === "open" && fully) return false;
    if (statusVal === "done" && !fully) return false;
    if (prioVal !== "all" && (t.priority || "med") !== prioVal) return false;
    if (s){
      const hay = [t.desc, t.assignedLabel, t.assigned, t.notes].join(" ").toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });

  list.sort((a,b)=>{
    const mode = sortTasks.value || "recent";
    if (mode === "due"){
      const da = parseFSDate(a.due) || "9999-12-31";
      const dbb = parseFSDate(b.due) || "9999-12-31";
      return da.localeCompare(dbb);
    }
    if (mode === "priority"){
      const rank = (p)=> ({high:0, med:1, low:2})[p||"med"] ?? 9;
      const ra = rank(a.priority);
      const rb = rank(b.priority);
      if (ra !== rb) return ra - rb;
      const ua = a.updatedAt?.seconds || 0;
      const ub = b.updatedAt?.seconds || 0;
      return ub - ua;
    }
    // recent
    const ua = a.updatedAt?.seconds || 0;
    const ub = b.updatedAt?.seconds || 0;
    return ub - ua;
  });

  taskCount.textContent = String(list.length);

  tasksBody.innerHTML = list.map(t=>{
    const due = parseFSDate(t.due) || "";
    const safeDesc = escapeHtml(t.desc || "");
    const safeNotes = escapeHtml(t.notes || "");

    const key = guessAssignedKey(t);
    const resolved = resolveAssignment(key);
    const label = t.assignedLabel || resolved.label || t.assigned || "";
    const targets = getTargets(t);
    const doneBy = t.doneBy || {};
    const doneCount = targets.filter(id => !!doneBy?.[id]).length;
    const fully = isFullyDone(t);
    const mine = currentUserId && targets.includes(currentUserId);

    const chips = targets.length ? targets.map(id=>{
      const m = MEMBER_BY_ID[id];
      const nm = m ? m.name : id;
      const isMe = id === currentUserId;
      const isDone = !!doneBy?.[id];
      const cls = ["chip", isMe?"chip--me":"", isDone?"chip--done":""].filter(Boolean).join(" ");
      const title = `${nm}${isMe?" (you)":""}${isDone?" — done":""}`;
      // only you can toggle your own chip
      const attr = isMe ? `data-act="toggleDone" data-who="${id}"` : "";
      return `<span class="${cls}" title="${escapeHtml(title)}" ${attr}>${escapeHtml(initials(nm))}</span>`;
    }).join("") : `<span class="muted">—</span>`;

    const assigneeOptions = [
      ['user:youssef_elkhayat','Youssef Elkhayat'],
      ['user:youssef_roshdy','Youssef Roshdy'],
      ['user:mohamed_alainiah','Mohamed AlAiniah'],
      ['user:ahmed_saeed','Ahmed Saeed'],
      ['user:mohamed_elmansy','Mohamed ElMansy'],
      ['team:cad','CAD Team'],
      ['team:prototype','Prototype Team'],
      ['all','All'],
    ].map(([v,txt])=>`<option value="${v}" ${v===key?"selected":""}>${txt}</option>`).join("");

    return `
      <tr data-id="${t.id}" class="${mine?"row--mine":""}">
        <td><input class="cellInput" data-field="desc" value="${safeDesc}" placeholder="Task description" /></td>
        <td>
          <div class="assignedCell">
            <select class="select" data-field="assignedKey">${assigneeOptions}</select>
            <div class="assignedMeta">${escapeHtml(label)}${targets.length?` • ${targets.length} member${targets.length>1?'s':''}`:""}</div>
          </div>
        </td>
        <td>
          <div class="progressCell">
            <div class="progressChips">${chips}</div>
            <div class="progressMeta">
              <span class="badge">${doneCount}/${targets.length || 0} done</span>
              ${fully?`<span class="badge badge--done">Fully done</span>`:""}
            </div>
          </div>
        </td>
        <td>
          <select class="select" data-field="priority">
            <option value="low" ${(t.priority==="low")?"selected":""}>Low</option>
            <option value="med" ${(!t.priority || t.priority==="med")?"selected":""}>Medium</option>
            <option value="high" ${(t.priority==="high")?"selected":""}>High</option>
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

async function patchTask(id, patch){
  patch.updatedAt = serverTimestamp();
  await updateDoc(doc(db, "tasks", id), patch);
}

async function reassignTask(id, assignedKey){
  const r = resolveAssignment(assignedKey);
  await patchTask(id, {
    assignedKey: r.key || assignedKey,
    assignedLabel: r.label || "",
    targets: r.targets || [],
    doneBy: {},
    fullyDone: false,
  });
}

async function toggleMyDone(task){
  if (!currentUserId) return;
  const targets = getTargets(task);
  if (!targets.includes(currentUserId)) return;
  const doneBy = task.doneBy || {};
  const isDone = !!doneBy?.[currentUserId];

  const patch = {};
  patch[`doneBy.${currentUserId}`] = isDone ? deleteField() : serverTimestamp();
  // compute next done count locally
  const nextDone = new Set(targets.filter(id => !!doneBy?.[id]));
  if (isDone) nextDone.delete(currentUserId); else nextDone.add(currentUserId);
  const fully = targets.length > 0 && nextDone.size === targets.length;
  patch.fullyDone = fully;

  await patchTask(task.id, patch);
}

async function createTask(data){
  const r = resolveAssignment(data.assignedKey);
  const docRef = await addDoc(tasksCol, {
    desc: data.desc || "Lorem ipsum",
    assignedKey: r.key || data.assignedKey || "",
    assignedLabel: r.label || "",
    targets: r.targets || [],
    priority: data.priority || "med",
    due: data.due || "",
    notes: data.notes || "",
    doneBy: {},
    fullyDone: false,
    createdBy: currentUserId || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  // Email members involved (best-effort; task creation should not fail if email fails)
  try{
    const recipients = (r.targets || []).map(id => MEMBER_BY_ID[id]?.email).filter(Boolean);
    if (recipients.length){
      await fetch("/.netlify/functions/sendTaskEmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: docRef.id,
          task: {
            description: data.desc || "Lorem ipsum",
            assignedTo: r.label || "",
            priority: data.priority || "med",
            due: data.due || "",
            notes: data.notes || "",
            createdBy: MEMBER_BY_ID[currentUserId]?.name || "",
          },
          recipients,
        })
      });
    }
  }catch(err){ console.warn("Email notify failed", err); }
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
      desc: t.desc || "",
      assignedKey: guessAssignedKey(t),
      assignedLabel: t.assignedLabel || "",
      targets: getTargets(t),
      priority: t.priority || "med",
      due: parseFSDate(t.due) || "",
      notes: t.notes || "",
      doneBy: Object.keys(t.doneBy || {}),
      fullyDone: isFullyDone(t)
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
      assignedKey: String(t.assignedKey || guessAssignedKey(t) || ""),
      assignedLabel: String(t.assignedLabel || resolveAssignment(String(t.assignedKey || "")).label || ""),
      targets: Array.isArray(t.targets) && t.targets.length ? t.targets : resolveAssignment(String(t.assignedKey || "")).targets,
      priority: String(t.priority || "med"),
      due: String(t.due || ""),
      notes: String(t.notes || ""),
      doneBy: Array.isArray(t.doneBy) ? Object.fromEntries(t.doneBy.map(id => [id, true])) : (t.doneBy || {}),
      fullyDone: Boolean(t.fullyDone),
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

// Who are you? (identity used for per-person task completion)
whoBtn?.addEventListener("click", ()=> openWhoOverlay());
whoOverlay?.addEventListener("click", (e)=>{
  if (e.target === whoOverlay) closeWhoOverlay();
});
document.addEventListener("keydown", (e)=>{
  if (e.key === "Escape" && !whoOverlay.hidden) closeWhoOverlay();
});
whoList?.addEventListener("click", (e)=>{
  const btn = e.target.closest("[data-who]");
  if (!btn) return;
  setCurrentUser(btn.dataset.who);
  closeWhoOverlay();
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
const taskTimers = new Map();
function scheduleTaskPatch(id, patch){
  const cur = taskTimers.get(id) || { t:null, patch:{} };
  Object.assign(cur.patch, patch);
  if (cur.t) clearTimeout(cur.t);
  cur.t = setTimeout(async ()=>{
    try{
      await patchTask(id, cur.patch);
    }catch(err){ console.warn("task patch failed", err); }
    taskTimers.delete(id);
  }, 450);
  taskTimers.set(id, cur);
}

function openNewTaskDialog(){
  taskDialogTitle.textContent = "New task";
  taskDesc.value = "";
  taskAssigned.value = currentUserId ? `user:${currentUserId}` : "all";
  taskDue.value = "";
  taskPriority.value = "med";
  taskNotes.value = "";
  taskDialog.showModal();
}

newTaskBtn.addEventListener("click", openNewTaskDialog);

taskDialog.addEventListener("close", async ()=>{
  if (taskDialog.returnValue !== "ok") return;
  const data = {
    desc: taskDesc.value.trim(),
    assignedKey: taskAssigned.value,
    due: taskDue.value || "",
    priority: taskPriority.value || "med",
    notes: taskNotes.value.trim(),
  };
  await createTask(data);
});

function getTaskById(id){ return tasks.find(t=>t.id===id); }

tasksBody.addEventListener("click", async (e)=>{
  const tr = e.target.closest("tr[data-id]");
  if (!tr) return;
  const id = tr.dataset.id;
  const act = e.target.dataset.act || e.target.closest("[data-act]")?.dataset?.act;
  if (act === "del"){
    await deleteTask(id);
    return;
  }
  if (act === "toggleDone"){
    const t = getTaskById(id);
    if (!t) return;
    await toggleMyDone(t);
    return;
  }
});

tasksBody.addEventListener("input", (e)=>{
  const tr = e.target.closest("tr[data-id]");
  if (!tr) return;
  const id = tr.dataset.id;
  const field = e.target.dataset.field;
  if (!field) return;
  if (field === "assignedKey") return; // handled on change
  const val = e.target.value;
  scheduleTaskPatch(id, { [field]: val });
});

tasksBody.addEventListener("change", async (e)=>{
  const tr = e.target.closest("tr[data-id]");
  if (!tr) return;
  const id = tr.dataset.id;
  const field = e.target.dataset.field;
  if (!field) return;
  if (field === "assignedKey"){
    await reassignTask(id, e.target.value);
    return;
  }
  scheduleTaskPatch(id, { [field]: e.target.value });
});
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