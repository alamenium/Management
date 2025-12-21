// Team Hub — Firebase + Netlify Email
// - Firestore stores: links, tasks, shared notes, meta/config(pinHash)
// - PIN cached (hash) locally; re-prompt only if Firebase pinHash changes
// - "Who are you?" cached locally (for per-person task checkoff)
// - New tasks trigger email via Netlify Function /.netlify/functions/sendTaskEmail
//
// IMPORTANT: Firestore rules must allow read/write (no Firebase Auth in this build)

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
try { getAnalytics(app); } catch { /* optional */ }
const db = getFirestore(app);

/* People (hardcoded) */
const MEMBERS = [
  { id:"youssef_elkhayat", name:"Youssef Elkhayat", team:"cad", teamLabel:"CAD Team", email:"youssifayman2004@gmail.com" },
  { id:"youssef_roshdy", name:"Youssef Roshdy", team:"prototype", teamLabel:"Prototype Team", email:"yousufdiaa2004@gmail.com" },
  { id:"mohamed_alainiah", name:"Mohamed AlAiniah", team:"cad", teamLabel:"CAD Team", email:"Mohammad.bashar033@gmail.com" },
  { id:"ahmed_saeed", name:"Ahmed Saeed", team:"prototype", teamLabel:"Prototype Team", email:"saeedahmedsuper@gmail.com" },
  { id:"mohamed_elmansy", name:"Mohamed ElMansy", team:"cad", teamLabel:"CAD Team", email:"mohammadadham20@gmail.com" }
];

const TEAMS = {
  cad: MEMBERS.filter(m=>m.team==="cad").map(m=>m.id),
  prototype: MEMBERS.filter(m=>m.team==="prototype").map(m=>m.id),
};

const ASSIGN_OPTIONS = [
  { key:"all", label:"All", type:"all" },
  { key:"team:cad", label:"CAD Team", type:"team", team:"cad" },
  { key:"team:prototype", label:"Prototype Team", type:"team", team:"prototype" },
  ...MEMBERS.map(m=>({ key:`member:${m.id}`, label:m.name, type:"member", id:m.id }))
];

const memberById = Object.fromEntries(MEMBERS.map(m=>[m.id,m]));

/* Defaults */
const DEFAULT_PIN = "0750"; // first run only; later edit meta/config.pinHash
const LS_THEME = "teamhub_theme_v3";
const LS_PINHASH = "teamhub_pin_hash_v3";
const LS_WHO = "teamhub_who_v1";

/* Helpers */
const $ = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => [...el.querySelectorAll(q)];

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
// Dev helper (console): await teamhubSha256("9999")
window.teamhubSha256 = sha256Hex;

function uniq(arr){ return [...new Set(arr.filter(Boolean))]; }

function toISODate(x){
  if (!x) return "";
  if (typeof x === "string") return x;
  if (x.seconds){
    const d = new Date(x.seconds * 1000);
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const dd = String(d.getDate()).padStart(2,"0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  }
  return "";
}

/* Assignment expansion */
function expandTargets(targets){
  const t = Array.isArray(targets) ? targets : [];
  const out = new Set();

  if (t.includes("all")){
    MEMBERS.forEach(m => out.add(m.id));
  }
  if (t.includes("team:cad")){
    TEAMS.cad.forEach(id => out.add(id));
  }
  if (t.includes("team:prototype")){
    TEAMS.prototype.forEach(id => out.add(id));
  }
  for (const x of t){
    if (typeof x !== "string") continue;
    if (x.startsWith("member:")){
      const id = x.slice("member:".length);
      if (memberById[id]) out.add(id);
    }
  }
  return [...out];
}

function normalizeTargetsFromCheckboxes(root){
  return $$(".assignItem input[type=checkbox]", root)
    .filter(cb => cb.checked)
    .map(cb => cb.value);
}

function targetsToChips(targets){
  const t = Array.isArray(targets) ? targets : [];
  const labels = [];
  for (const opt of ASSIGN_OPTIONS){
    if (t.includes(opt.key)){
      labels.push(opt.label);
    }
  }
  return labels;
}

function progressState(involved, doneBy){
  const inv = Array.isArray(involved) ? involved : [];
  const done = new Set(Array.isArray(doneBy) ? doneBy : []);
  const doneCount = inv.filter(id => done.has(id)).length;
  const total = inv.length;

  if (total === 0) return { state:"open", label:"Open", fullyDone:false, doneCount, total };
  if (doneCount === 0) return { state:"open", label:"Open", fullyDone:false, doneCount, total };
  if (doneCount < total) return { state:"partial", label:`In progress (${doneCount}/${total})`, fullyDone:false, doneCount, total };
  return { state:"done", label:"Done", fullyDone:true, doneCount, total };
}

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

const whoOverlay = $("#whoOverlay");
const whoList = $("#whoList");

const userPill = $("#userPill");
const userNameEl = $("#userName");
const userTeamEl = $("#userTeam");

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
const taskDesc = $("#taskDesc");
const taskDue = $("#taskDue");
const taskPriority = $("#taskPriority");
const taskNotes = $("#taskNotes");
const assignPicker = $("#assignPicker");

const assignDialog = $("#assignDialog");
const assignEditPicker = $("#assignEditPicker");

const filterMine = $("#filterMine");
const sortTasks = $("#sortTasks");
const tasksBody = $("#tasksBody");
const tasksEmpty = $("#tasksEmpty");
const taskCount = $("#taskCount");

const notesBox = $("#notesBox");
const notesStatus = $("#notesStatus");

const exportBtn = $("#exportBtn");
const importFile = $("#importFile");

/* Local state */
let remotePinHash = null;
let isUnlocked = false;
let currentUserId = null;

let links = [];
let tasks = [];
let notesText = "";
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

/* Bootstrap (clean slate) */
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
    await setDoc(notesRef, { text: "", updatedAt: serverTimestamp() });
  }
}

/* Auth overlay */
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
  if (!remotePinHash) await fetchRemotePinHash();
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

/* Who */
function teamLabel(team){
  return team === "cad" ? "CAD TEAM" : team === "prototype" ? "PROTOTYPE TEAM" : "—";
}
function renderUserPill(){
  const me = memberById[currentUserId] || null;
  userNameEl.textContent = me ? me.name : "—";
  userTeamEl.textContent = me ? teamLabel(me.team) : "—";
}
function showWho(){
  whoOverlay.hidden = false;
  whoList.innerHTML = MEMBERS.map(m => `
    <button class="whoBtn" data-id="${m.id}" type="button">
      <div class="whoMeta">
        <div class="whoName">${escapeHtml(m.name)}</div>
        <div class="whoTeam">${escapeHtml(teamLabel(m.team))}</div>
      </div>
      <span class="stateBadge">Select</span>
    </button>
  `).join("");
}
function hideWho(){
  whoOverlay.hidden = true;
}
function ensureWho(){
  const cached = localStorage.getItem(LS_WHO);
  if (cached && memberById[cached]){
    currentUserId = cached;
    renderUserPill();
    return true;
  }
  showWho();
  return false;
}

/* Config watcher */
let unsubConfig = null;
function startConfigWatch(){
  if (unsubConfig) unsubConfig();
  unsubConfig = onSnapshot(configRef, (snap)=>{
    const ph = snap.data()?.pinHash || null;
    if (ph && ph !== remotePinHash){
      remotePinHash = ph;
      const cached = localStorage.getItem(LS_PINHASH);
      if (isUnlocked && (!cached || cached !== remotePinHash)){
        lock();
      }
    } else {
      remotePinHash = ph;
    }
  });
}

/* Realtime subscriptions */
let unsubLinks = null;
let unsubTasks = null;
let unsubNotes = null;

function startSubscriptions(){
  if (unsubLinks) unsubLinks();
  if (unsubTasks) unsubTasks();
  if (unsubNotes) unsubNotes();

  unsubLinks = onSnapshot(query(linksCol, orderBy("order", "asc")), (snap)=>{
    links = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderLinks();
    renderStats();
  });

  unsubTasks = onSnapshot(query(tasksCol, orderBy("updatedAt", "desc")), async (snap)=>{
    tasks = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    // auto-heal older tasks missing involved/doneBy
    await healTasksIfNeeded(tasks);
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

/* Heal tasks (if older docs exist) */
async function healTasksIfNeeded(list){
  const fixes = [];
  for (const t of list){
    const targets = Array.isArray(t.targets) ? t.targets : [];
    const involved = Array.isArray(t.involved) ? t.involved : expandTargets(targets);
    const doneBy = Array.isArray(t.doneBy) ? t.doneBy : [];
    const patch = {};
    if (!Array.isArray(t.targets)) patch.targets = targets;
    if (!Array.isArray(t.involved)) patch.involved = involved;
    if (!Array.isArray(t.doneBy)) patch.doneBy = doneBy;

    // prune doneBy to involved
    const invSet = new Set(involved);
    const pruned = doneBy.filter(id=>invSet.has(id));
    if (pruned.length !== doneBy.length) patch.doneBy = pruned;

    const st = progressState(involved, patch.doneBy ?? doneBy);
    patch.fullyDone = st.fullyDone;
    patch.doneCount = st.doneCount;
    patch.involvedCount = st.total;

    if (Object.keys(patch).length){
      fixes.push({ id:t.id, patch });
    }
  }
  if (!fixes.length) return;

  const batch = writeBatch(db);
  for (const f of fixes){
    batch.update(doc(db,"tasks", f.id), { ...f.patch, updatedAt: serverTimestamp() });
  }
  try{ await batch.commit(); }catch(e){ /* non-fatal */ }
}

/* Stats */
function renderStats(){
  statLinks.textContent = String(links.length);
  statTasks.textContent = String(tasks.length);
  const open = tasks.filter(t => !progressState(t.involved, t.doneBy).fullyDone).length;
  statOpen.textContent = String(open);
}

/* Links UI */
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
    ? links.filter(l => `${l.title||""} ${l.desc||""} ${l.url||""}`.toLowerCase().includes(q))
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
async function persistLinkOrder(domIds){
  const batch = writeBatch(db);
  domIds.forEach((id, idx)=>{
    batch.update(doc(db,"links", id), { order: idx*100, updatedAt: serverTimestamp() });
  });
  await batch.commit();
}

/* Assign picker UI */
function renderAssignPicker(root, selectedKeys){
  const selected = new Set(Array.isArray(selectedKeys) ? selectedKeys : []);
  const teamSection = `
    <div class="assignGroupTitle">Groups</div>
    <div class="assignGrid">
      ${ASSIGN_OPTIONS.filter(o=>o.type!=="member").map(o=>assignItem(o, selected.has(o.key))).join("")}
    </div>
  `;
  const peopleSection = `
    <div class="assignGroupTitle">People</div>
    <div class="assignGrid">
      ${ASSIGN_OPTIONS.filter(o=>o.type==="member").map(o=>assignItem(o, selected.has(o.key))).join("")}
    </div>
  `;

  const chips = targetsToChips([...selected]).map(lbl=>`<span class="chip"><strong>${escapeHtml(lbl)}</strong></span>`).join("");
  root.innerHTML = `${teamSection}${peopleSection}<div class="assignChips">${chips || `<span class="chip">No one selected yet</span>`}</div>`;
}

function assignItem(opt, checked){
  const id = `as_${opt.key.replace(/[^a-z0-9:_-]/gi,"_")}_${Math.random().toString(16).slice(2)}`;
  return `
    <div class="assignItem">
      <input id="${id}" type="checkbox" value="${escapeHtml(opt.key)}" ${checked ? "checked":""} />
      <label for="${id}">${escapeHtml(opt.label)}</label>
    </div>
  `;
}

/* Tasks UI */
function renderTasks(){
  const q = searchQuery.trim().toLowerCase();
  const mineOnly = filterMine.value === "mine";
  const sortMode = sortTasks.value;

  let list = [...tasks];

  if (q){
    list = list.filter(t => {
      const s = `${t.desc||""} ${t.notes||""} ${(targetsToChips(t.targets)||[]).join(" ")}`.toLowerCase();
      return s.includes(q);
    });
  }

  if (mineOnly && currentUserId){
    list = list.filter(t => (t.involved || []).includes(currentUserId));
  }

  list.sort((a,b)=>{
    if (sortMode === "dueAsc"){
      const da = toISODate(a.due) || "9999-12-31";
      const dbb = toISODate(b.due) || "9999-12-31";
      return da.localeCompare(dbb);
    }
    if (sortMode === "createdDesc"){
      const ca = a.createdAt?.seconds || 0;
      const cb = b.createdAt?.seconds || 0;
      return cb - ca;
    }
    const ua = a.updatedAt?.seconds || 0;
    const ub = b.updatedAt?.seconds || 0;
    return ub - ua;
  });

  taskCount.textContent = String(list.length);

  tasksBody.innerHTML = list.map(t=>{
    const involved = Array.isArray(t.involved) ? t.involved : [];
    const doneBy = Array.isArray(t.doneBy) ? t.doneBy : [];
    const st = progressState(involved, doneBy);

    const mine = currentUserId && involved.includes(currentUserId);
    const myDone = mine && doneBy.includes(currentUserId);

    const chips = targetsToChips(t.targets).map(lbl=>`<span class="chip"><strong>${escapeHtml(lbl)}</strong></span>`).join("");
    const due = escapeHtml(toISODate(t.due));
    const desc = escapeHtml(t.desc || "");
    const notes = escapeHtml(t.notes || "");
    const stateClass = st.fullyDone ? "stateBadge done" : "stateBadge";

    const progress = involved.map(id=>{
      const m = memberById[id];
      const initials = m ? m.name.split(" ").map(x=>x[0]).slice(0,2).join("") : id.slice(0,2).toUpperCase();
      const done = doneBy.includes(id);
      return `<span class="pip ${done ? "pipDone":""}" title="${escapeHtml(m ? m.name : id)}"><span class="miniDot"></span>${escapeHtml(initials)}</span>`;
    }).join("") || `<span class="stateBadge">No assignees</span>`;

    return `
      <tr data-id="${t.id}" class="${mine ? "taskMine":""}">
        <td>
          ${mine
            ? `<input class="myCheck" type="checkbox" data-act="myDone" ${myDone ? "checked":""} />`
            : `<input class="myCheck" type="checkbox" disabled />`
          }
        </td>
        <td><input class="cellInput" data-field="desc" value="${desc}" placeholder="Task description" /></td>
        <td>
          <div class="assignChips">${chips || `<span class="chip">—</span>`}</div>
          <button class="smallBtn" data-act="editAssign" style="margin-top:8px;">Edit</button>
        </td>
        <td><input class="cellInput" data-field="due" type="date" value="${due}" /></td>
        <td><input class="cellInput" data-field="notes" value="${notes}" placeholder="Notes" /></td>
        <td>
          <div class="progress">
            <span class="${stateClass}" title="${escapeHtml(st.label)}">${escapeHtml(st.fullyDone ? "Done" : st.doneCount ? `${st.doneCount}/${st.total}` : "Open")}</span>
            ${progress}
          </div>
        </td>
        <td class="th--right">
          <button class="smallBtn danger" data-act="del">Delete</button>
        </td>
      </tr>
    `;
  }).join("");

  tasksEmpty.hidden = list.length !== 0;
}

/* Tasks CRUD */
async function createTask(data){
  const targets = Array.isArray(data.targets) ? data.targets : [];
  const involved = expandTargets(targets);
  const st = progressState(involved, []);

  const ref = await addDoc(tasksCol, {
    desc: data.desc || "Lorem ipsum",
    notes: data.notes || "",
    due: data.due || "",
    priority: data.priority || "med",
    targets,
    involved,
    doneBy: [],
    fullyDone: st.fullyDone,
    doneCount: st.doneCount,
    involvedCount: st.total,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  // Fire-and-forget email (don’t block UI too hard)
  sendTaskEmail({
    taskId: ref.id,
    desc: data.desc || "Lorem ipsum",
    notes: data.notes || "",
    due: data.due || "",
    priority: data.priority || "med",
    involved
  }).catch(()=>{});

  return ref.id;
}

async function patchTask(id, patch){
  patch.updatedAt = serverTimestamp();

  // if targets changed, recompute involved + prune doneBy
  if (patch.targets){
    const involved = expandTargets(patch.targets);
    patch.involved = involved;

    const old = tasks.find(x=>x.id===id) || {};
    const oldDone = Array.isArray(old.doneBy) ? old.doneBy : [];
    const invSet = new Set(involved);
    const pruned = oldDone.filter(x=>invSet.has(x));
    patch.doneBy = pruned;

    const st = progressState(involved, pruned);
    patch.fullyDone = st.fullyDone;
    patch.doneCount = st.doneCount;
    patch.involvedCount = st.total;
  }

  // if doneBy changed explicitly, recompute done state
  if (patch.doneBy && !patch.involved){
    const old = tasks.find(x=>x.id===id) || {};
    const involved = Array.isArray(old.involved) ? old.involved : [];
    const st = progressState(involved, patch.doneBy);
    patch.fullyDone = st.fullyDone;
    patch.doneCount = st.doneCount;
    patch.involvedCount = st.total;
  }

  await updateDoc(doc(db, "tasks", id), patch);
}

async function deleteTask(id){
  await deleteDoc(doc(db, "tasks", id));
}

/* Email function call */
async function sendTaskEmail(payload){
  // Only send if function exists on Netlify; ignore errors locally
  const res = await fetch("/.netlify/functions/sendTaskEmail", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok){
    // swallow, but log for debugging
    const txt = await res.text().catch(()=> "");
    console.warn("Email failed:", res.status, txt);
  }
}

/* Notes (debounced) */
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
  return JSON.stringify({
    links: links.map(l => ({ title:l.title||"", url:l.url||"", desc:l.desc||"", order:Number(l.order||0) })),
    tasks: tasks.map(t => ({ desc:t.desc||"", notes:t.notes||"", due: toISODate(t.due)||"", priority:t.priority||"med", targets:t.targets||[] })),
    notes: notesBox.value || ""
  }, null, 2);
}

async function importFromJSON(obj){
  const batch = writeBatch(db);

  for (const l of links) batch.delete(doc(db,"links", l.id));
  for (const t of tasks) batch.delete(doc(db,"tasks", t.id));

  batch.set(notesRef, { text: String(obj.notes||""), updatedAt: serverTimestamp() }, { merge:true });

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
    const targets = Array.isArray(t.targets) ? t.targets : [];
    const involved = expandTargets(targets);
    const st = progressState(involved, []);
    const ref = doc(collection(db,"tasks"));
    batch.set(ref, {
      desc: String(t.desc || "Lorem ipsum"),
      notes: String(t.notes || ""),
      due: String(t.due || ""),
      priority: String(t.priority || "med"),
      targets,
      involved,
      doneBy: [],
      fullyDone: st.fullyDone,
      doneCount: st.doneCount,
      involvedCount: st.total,
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
    // after unlock, ensure who
    if (ensureWho()){
      startSubscriptions();
    }
  } else {
    authMsg.textContent = "Wrong PIN.";
    pinInput.select();
  }
});

whoList.addEventListener("click", (e)=>{
  const btn = e.target.closest(".whoBtn");
  if (!btn) return;
  const id = btn.dataset.id;
  if (!memberById[id]) return;
  currentUserId = id;
  localStorage.setItem(LS_WHO, id);
  renderUserPill();
  hideWho();
  // now start realtime
  startSubscriptions();
});

userPill.addEventListener("click", ()=>{
  // allow switching identity on this device
  showWho();
});

globalSearch.addEventListener("input", ()=>{
  searchQuery = globalSearch.value || "";
  renderLinks();
  renderTasks();
});

newLinkBtn.addEventListener("click", ()=> openLinkDialog("new"));

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
let dragId = null;
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
    const domIds = $$(".linkCard", linksGrid).map(el=> el.dataset.id);
    if (domIds.length) await persistLinkOrder(domIds);
  }catch(err){ console.error(err); }
});

/* Task create dialog */
let createSelectedTargets = [];

// Keep these listeners attached once. We re-render the picker UI after each change.
assignPicker.addEventListener("change", ()=>{
  createSelectedTargets = normalizeTargetsFromCheckboxes(assignPicker);
  renderAssignPicker(assignPicker, createSelectedTargets);
});

assignEditPicker.addEventListener("change", ()=>{
  editSelectedTargets = normalizeTargetsFromCheckboxes(assignEditPicker);
  renderAssignPicker(assignEditPicker, editSelectedTargets);
});

newTaskBtn.addEventListener("click", ()=>{
  createSelectedTargets = [];
  renderAssignPicker(assignPicker, createSelectedTargets);

  taskDesc.value = "";
  taskDue.value = "";
  taskPriority.value = "med";
  taskNotes.value = "";
  taskDialog.showModal();
  setTimeout(()=> taskDesc.focus(), 30);
});

taskDialog.addEventListener("close", async ()=>{
  if (taskDialog.returnValue !== "ok") return;
  const targets = uniq(createSelectedTargets);
  if (!targets.length){
    alert("Pick at least one assignee (person, team, or all).");
    return;
  }
  try{
    await createTask({
      desc: taskDesc.value.trim() || "Lorem ipsum",
      notes: taskNotes.value.trim(),
      due: taskDue.value || "",
      priority: taskPriority.value || "med",
      targets
    });
  }catch(err){ console.error(err); }
});
/* Task inline edits */
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
  const t = tasks.find(x=>x.id===id);
  if (!t) return;

  const act = e.target.closest("[data-act]")?.dataset.act;

  if (act === "del"){
    if (confirm("Delete this task?")){
      try{ await deleteTask(id); } catch(err){ console.error(err); }
    }
    return;
  }

  if (act === "myDone"){
    // handled on change event instead
    return;
  }

  if (act === "editAssign"){
    // open assignDialog with current selections
    editingTaskId = id;
    editSelectedTargets = Array.isArray(t.targets) ? [...t.targets] : [];
    renderAssignPicker(assignEditPicker, editSelectedTargets);
    assignDialog.showModal();
    return;
  }
});

/* My done checkbox (change) */
tasksBody.addEventListener("change", async (e)=>{
  const cb = e.target.closest("input.myCheck");
  if (!cb) return;
  const row = e.target.closest("tr[data-id]");
  if (!row) return;
  const id = row.dataset.id;
  const t = tasks.find(x=>x.id===id);
  if (!t) return;

  const involved = Array.isArray(t.involved) ? t.involved : [];
  if (!currentUserId || !involved.includes(currentUserId)){
    // should be disabled anyway
    cb.checked = false;
    return;
  }

  const doneBy = new Set(Array.isArray(t.doneBy) ? t.doneBy : []);
  if (cb.checked) doneBy.add(currentUserId);
  else doneBy.delete(currentUserId);

  try{
    await patchTask(id, { doneBy: [...doneBy] });
  }catch(err){
    console.error(err);
  }
});

/* Assign edit dialog */
let editingTaskId = null;
let editSelectedTargets = [];
assignDialog.addEventListener("close", async ()=>{
  if (assignDialog.returnValue !== "ok") { editingTaskId = null; return; }
  const id = editingTaskId;
  editingTaskId = null;
  const targets = uniq(editSelectedTargets);
  if (!targets.length){
    alert("Pick at least one assignee (person, team, or all).");
    return;
  }
  try{
    await patchTask(id, { targets });
  }catch(err){ console.error(err); }
});

filterMine.addEventListener("change", renderTasks);
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
      // already unlocked; ask who then subscribe
      if (ensureWho()){
        startSubscriptions();
      }
    }
  }catch(err){
    console.error(err);
    showAuth("Connection error. Check Firebase config/rules or disable blockers.");
    setAuthFooter("Failed to connect.");
  }
})();
