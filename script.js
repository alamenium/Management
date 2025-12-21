// Silicon Hall Team Hub — Firebase + per-user done + multi-assign + email on create
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc,
  collection, addDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* Firebase config (hardcoded) */
const firebaseConfig = {
  apiKey: "AIzaSyA40iRsHxXU_qEm1o7fGvG-lqqGp6EYFcc",
  authDomain: "capstone-tasks.firebaseapp.com",
  projectId: "capstone-tasks",
  storageBucket: "capstone-tasks.firebasestorage.app",
  messagingSenderId: "723479607282",
  appId: "1:723479607282:web:e6885d2c6b87c6c8379d6b",
  measurementId: "G-CGQNY2X37E"
};

const app = initializeApp(firebaseConfig);
try{ getAnalytics(app); }catch(_){}

/* Firestore */
const db = getFirestore(app);

/* Helpers */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const escapeHtml = (s) => String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");

async function sha256Hex(str){
  const enc = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
// Dev helper: compute SHA-256 hex (useful if you want to update meta/config.pinHash)
window.teamhubSha256 = sha256Hex;

/* Hardcoded people + teams */
const PEOPLE = [
  { key:"youssef_elkhayat", name:"Youssef Elkhayat", team:"CAD Team", email:"youssifayman2004@gmail.com" },
  { key:"youssef_roshdy",  name:"Youssef Roshdy",  team:"Prototype Team", email:"yousufdiaa2004@gmail.com" },
  { key:"mohamed_alainiah",name:"Mohamed AlAiniah",team:"CAD Team", email:"Mohammad.bashar033@gmail.com" },
  { key:"ahmed_saeed",     name:"Ahmed Saeed",     team:"Prototype Team", email:"saeedahmedsuper@gmail.com" },
  { key:"mohamed_elmansy", name:"Mohamed ElMansy", team:"CAD Team", email:"mohammadadham20@gmail.com" },
];

const TEAMS = {
  "CAD Team": PEOPLE.filter(p=>p.team==="CAD Team").map(p=>p.key),
  "Prototype Team": PEOPLE.filter(p=>p.team==="Prototype Team").map(p=>p.key),
};

function teamKeys(){
  return Object.keys(TEAMS);
}

/* DOM */
const authOverlay = $("#authOverlay");
const pinForm = $("#pinForm");
const pinInput = $("#pinInput");
const pinMsg = $("#pinMsg");
const pinFooter = $("#pinFooter");

const themeBtn = $("#themeBtn");
const themeLbl = $("#themeLbl");
const lockBtn = $("#lockBtn");
const whoSwitch = $("#whoSwitch");
const whoPill = $("#whoPill");
const whoDialog = $("#whoDialog");
const whoList = $("#whoList");
const whoOk = $("#whoOk");

const searchInput = $("#searchInput");

const statTasks = $("#statTasks");
const statMine  = $("#statMine");
const statOpen  = $("#statOpen");

const tasksBody = $("#tasksBody");
const newTaskBtn = $("#newTaskBtn");
const taskDialog = $("#taskDialog");
const taskForm = $("#taskForm");
const taskDesc = $("#taskDesc");
const taskAssigned = $("#taskAssigned"); // will be repurposed into multi-select UI
const taskDue = $("#taskDue");
const taskStatus = $("#taskStatus");
const taskPriority = $("#taskPriority");
const taskNotes = $("#taskNotes");

const linksGrid = $("#linksGrid");
const newLinkBtn = $("#newLinkBtn");
const linkDialog = $("#linkDialog");
const linkForm = $("#linkForm");
const linkTitle = $("#linkTitle");
const linkUrl = $("#linkUrl");
const linkDesc = $("#linkDesc");

const notesBox = $("#notesBox");
const notesStatus = $("#notesStatus");

const exportBtn = $("#exportBtn");
const importFile = $("#importFile");

/* State */
let remotePinHash = null;
let isUnlocked = false;
let me = null; // {key,name,team,email}
let searchQ = "";

let tasks = [];
let links = [];
let notesText = "";

/* Theme */
function applyTheme(theme){
  document.documentElement.dataset.theme = theme;
  themeLbl.textContent = theme === "light" ? "Light" : "Dark";
}
function loadTheme(){
  applyTheme(localStorage.getItem("teamhub_theme") || "dark");
}
function toggleTheme(){
  const cur = document.documentElement.dataset.theme || "dark";
  const next = cur === "dark" ? "light" : "dark";
  localStorage.setItem("teamhub_theme", next);
  applyTheme(next);
}
themeBtn?.addEventListener("click", toggleTheme);

/* LocalStorage keys */
const LS_PINHASH = "teamhub_pinHash";
const LS_UNLOCKED = "teamhub_unlocked";
const LS_ME = "teamhub_me";

/* Firestore refs */
const configRef = doc(db, "meta", "config");
const notesRef  = doc(db, "notes", "shared");
const tasksCol  = collection(db, "tasks");
const linksCol  = collection(db, "links");

/* Bootstrap: create required docs if clean slate */
async function ensureBootstrap(){
  // meta/config
  const cfgSnap = await getDoc(configRef);
  if (!cfgSnap.exists()){
    const defaultPin = "0750";
    const pinHash = await sha256Hex(defaultPin);
    await setDoc(configRef, {
      pinHash,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      note: "Change pinHash to SHA-256 hex of your PIN"
    });
  }
  // notes/shared
  const ns = await getDoc(notesRef);
  if (!ns.exists()){
    await setDoc(notesRef, { text:"", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
}

async function fetchRemotePinHash(){
  const snap = await getDoc(configRef);
  remotePinHash = snap.data()?.pinHash || null;
  return remotePinHash;
}

/* Config watch (if PIN changes while unlocked, require re-entry) */
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

/* Auth */
function showPin(msg=""){
  authOverlay.classList.remove("hidden");
  pinMsg.textContent = msg;
}
function hidePin(){
  authOverlay.classList.add("hidden");
}
function setPinFooter(t){ if (pinFooter) pinFooter.textContent = t; }

function setMeByKey(key){
  const p = PEOPLE.find(x=>x.key===key);
  if (!p) return;
  me = p;
  localStorage.setItem(LS_ME, p.key);
  whoPill.textContent = p.name;
  whoSwitch.textContent = p.name;
}

async function unlockWithPin(pin){
  if (!pin) return false;
  if (!remotePinHash) await fetchRemotePinHash();
  const h = await sha256Hex(pin);

  if (h !== remotePinHash) return false;

  // cache success
  localStorage.setItem(LS_PINHASH, remotePinHash);
  localStorage.setItem(LS_UNLOCKED, "1");
  isUnlocked = true;
  hidePin();
  return true;
}

async function tryAutoUnlock(){
  const ok = localStorage.getItem(LS_UNLOCKED) === "1";
  const cachedHash = localStorage.getItem(LS_PINHASH);
  if (!ok || !cachedHash) return false;
  if (!remotePinHash) await fetchRemotePinHash();
  if (cachedHash !== remotePinHash) return false;
  isUnlocked = true;
  hidePin();
  return true;
}

function lock(){
  isUnlocked = false;
  localStorage.removeItem(LS_UNLOCKED);
  localStorage.removeItem(LS_PINHASH);

  // stop listeners
  stopSubscriptions();

  showPin("PIN changed or session locked.");
  setPinFooter("Enter PIN to unlock.");
}

pinForm?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  pinMsg.textContent = "";
  const ok = await unlockWithPin(pinInput.value.trim());
  if (!ok){
    pinMsg.textContent = "Wrong PIN.";
    pinInput.select();
    return;
  }
  pinInput.value = "";
  await ensureIdentity();
  startSubscriptions();
});

/* Identity */
function renderWho(){
  whoList.innerHTML = PEOPLE.map(p=>{
    const sel = me?.key === p.key ? "whoItem--sel" : "";
    return `
      <button class="whoItem ${sel}" type="button" data-key="${p.key}">
        <div class="whoItem__name">${escapeHtml(p.name)}</div>
        <div class="whoItem__meta">${escapeHtml(p.team)}</div>
      </button>
    `;
  }).join("");
}

async function ensureIdentity(){
  const cached = localStorage.getItem(LS_ME);
  if (cached && PEOPLE.some(p=>p.key===cached)){
    setMeByKey(cached);
    return;
  }
  // ask
  renderWho();
  whoDialog.showModal();
  whoOk.disabled = true;
}

whoList?.addEventListener("click", (e)=>{
  const item = e.target.closest(".whoItem");
  if (!item) return;
  const key = item.dataset.key;
  setMeByKey(key);
  $$(".whoItem").forEach(x=>x.classList.remove("whoItem--sel"));
  item.classList.add("whoItem--sel");
  whoOk.disabled = false;
});

whoOk?.addEventListener("click", ()=>{
  whoDialog.close();
});

whoSwitch?.addEventListener("click", ()=>{
  renderWho();
  whoDialog.showModal();
  whoOk.disabled = true;
});

whoPill?.addEventListener("click", ()=>{
  renderWho();
  whoDialog.showModal();
  whoOk.disabled = true;
});

lockBtn?.addEventListener("click", lock);

searchInput?.addEventListener("input", ()=>{
  searchQ = searchInput.value.trim().toLowerCase();
  renderTasks();
  renderLinks();
});

/* Assignment picker (multi-select) */
const ASSIGN_OPTIONS = [
  { id:"all", label:"All", meta:"Everyone" },
  { id:"team:CAD Team", label:"CAD Team", meta:"Team" },
  { id:"team:Prototype Team", label:"Prototype Team", meta:"Team" },
  ...PEOPLE.map(p => ({ id:`person:${p.key}`, label:p.name, meta:p.team }))
];

let selectedAssign = new Set();

function buildAssignUI(){
  // replace the old single-line input with a multi-select chip picker (without changing HTML file)
  const field = taskAssigned?.closest(".field");
  if (!field) return;

  // If already built, skip
  if ($("#assignPicker")) return;

  const label = field.querySelector(".field__label");
  const old = taskAssigned;

  const wrap = document.createElement("div");
  wrap.id = "assignPicker";
  wrap.className = "assignPicker";

  wrap.innerHTML = `
    <div class="assignPicker__chips" id="assignChips"></div>
    <div class="assignPicker__row">
      <select id="assignSelect" class="select">
        <option value="" selected>Select assignees…</option>
        ${ASSIGN_OPTIONS.map(o=>`<option value="${escapeHtml(o.id)}">${escapeHtml(o.label)} — ${escapeHtml(o.meta)}</option>`).join("")}
      </select>
      <button type="button" class="smallBtn" id="assignClear">Clear</button>
    </div>
    <div class="muted2" style="margin-top:8px">Pick multiple (people/teams/all). Duplicates are merged.</div>
  `;

  // keep label
  if (label) label.textContent = "Assign to (multi)";

  // hide old input
  old.classList.add("hidden");
  old.disabled = true;

  field.appendChild(wrap);

  const select = $("#assignSelect");
  const chips = $("#assignChips");
  const clear = $("#assignClear");

  function renderAssignChips(){
    const arr = Array.from(selectedAssign);
    if (!arr.length){
      chips.innerHTML = `<span class="muted2">No one selected.</span>`;
      return;
    }
    chips.innerHTML = arr.map(id=>{
      const o = ASSIGN_OPTIONS.find(x=>x.id===id);
      const label = o ? o.label : id;
      return `<button type="button" class="chip chip--x" data-id="${escapeHtml(id)}">${escapeHtml(label)} <span aria-hidden="true">×</span></button>`;
    }).join("");
  }

  select.addEventListener("change", ()=>{
    const v = select.value;
    if (!v) return;
    selectedAssign.add(v);
    select.value = "";
    renderAssignChips();
  });

  chips.addEventListener("click", (e)=>{
    const btn = e.target.closest(".chip--x");
    if (!btn) return;
    selectedAssign.delete(btn.dataset.id);
    renderAssignChips();
  });

  clear.addEventListener("click", ()=>{
    selectedAssign.clear();
    renderAssignChips();
  });

  renderAssignChips();
}

function expandTargetsToPeople(targetIds){
  const result = new Set();

  // If "all" selected => everyone
  if (targetIds.includes("all")){
    PEOPLE.forEach(p=>result.add(p.key));
    return Array.from(result);
  }

  for (const tid of targetIds){
    if (tid.startsWith("person:")){
      result.add(tid.slice("person:".length));
    } else if (tid.startsWith("team:")){
      const team = tid.slice("team:".length);
      (TEAMS[team] || []).forEach(k=>result.add(k));
    }
  }
  return Array.from(result);
}

/* Tasks */
function isTaskMine(t){
  if (!me) return false;
  const involved = Array.isArray(t.involvedPeople) ? t.involvedPeople : [];
  return involved.includes(me.key);
}

function isFullyDone(t){
  const involved = Array.isArray(t.involvedPeople) ? t.involvedPeople : [];
  const doneBy = t.doneBy || {};
  if (!involved.length) return false;
  return involved.every(k => !!doneBy[k]);
}

function progressChips(t){
  const involved = Array.isArray(t.involvedPeople) ? t.involvedPeople : [];
  const doneBy = t.doneBy || {};
  if (!involved.length) return `<span class="muted2">—</span>`;

  const chips = involved.map(k=>{
    const p = PEOPLE.find(x=>x.key===k);
    const name = p ? p.name : k;
    const initials = name.split(/\s+/).slice(0,2).map(s=>s[0]?.toUpperCase()||"").join("");
    const done = !!doneBy[k];
    const cls = done ? "pchip pchip--done" : "pchip";
    return `<span class="${cls}" title="${escapeHtml(name)}">${escapeHtml(initials||"?")}</span>`;
  }).join("");

  const doneCount = involved.filter(k=>!!doneBy[k]).length;
  return `<div class="pwrap">${chips}</div><div class="muted2" style="margin-top:6px">${doneCount}/${involved.length} done</div>`;
}

function assignedBadges(t){
  const targets = Array.isArray(t.assignTargets) ? t.assignTargets : [];
  if (!targets.length) return `<span class="muted2">—</span>`;
  return targets.map(id=>{
    const o = ASSIGN_OPTIONS.find(x=>x.id===id);
    const label = o ? o.label : id;
    return `<span class="chip">${escapeHtml(label)}</span>`;
  }).join("");
}

function matchesSearchTask(t){
  if (!searchQ) return true;
  const hay = [
    t.desc, t.notes, t.priority, t.status,
    ...(t.assignTargets||[]),
    ...(t.involvedPeople||[])
  ].join(" ").toLowerCase();
  return hay.includes(searchQ);
}

function renderTasks(){
  const view = tasks.filter(matchesSearchTask);

  tasksBody.innerHTML = view.map((t)=>{
    const mine = isTaskMine(t);
    const fully = isFullyDone(t);

    const rowCls = [
      mine ? "row--mine" : "",
      fully ? "row--done" : ""
    ].join(" ").trim();

    const desc = escapeHtml(t.desc || "Lorem ipsum");
    const due = escapeHtml(t.due || "");
    const notes = escapeHtml(t.notes || "");
    const pr = escapeHtml(t.priority || "med");

    // show checkbox only if you’re involved
    const myCell = mine
        ? `
        <label class="myDoneWrap" title="Only marks your own completion">
          <input type="checkbox" class="myDone" data-id="${t.id}" ${t.doneBy?.[me.key] ? "checked" : ""} />
          <span class="muted2">My done</span>
        </label>
      `
        : `<span class="muted2">—</span>`;

    const doneBadge = fully
        ? `<span class="badge badge--done">Fully done</span>`
        : `<span class="badge badge--todo">In progress</span>`;

    return `
      <tr data-id="${t.id}" class="${rowCls}">
        <td class="checkCell">${myCell}</td>
        <td><input class="cellInput taskEdit" data-field="desc" value="${desc}" placeholder="Task…" /></td>
        <td><div class="assignChips">${assignedBadges(t)}</div></td>
        <td>
          <div class="progress">${progressChips(t)}</div>
          <div style="margin-top:8px">${doneBadge}</div>
        </td>
        <td><input class="cellInput taskEdit" data-field="due" type="date" value="${due}" /></td>
        <td><input class="cellInput taskEdit" data-field="notes" value="${notes}" placeholder="Notes…" /></td>
        <td>
          <select class="select taskEdit" data-field="priority" aria-label="Priority">
            <option value="low" ${pr==="low"?"selected":""}>Low</option>
            <option value="med" ${pr==="med"?"selected":""}>Med</option>
            <option value="high" ${pr==="high"?"selected":""}>High</option>
          </select>
        </td>
        <td>
          <div class="actionsRight">
            <button class="smallBtn danger" data-act="del">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderStats(){
  statTasks.textContent = String(tasks.length);
  const mine = me ? tasks.filter(isTaskMine).length : 0;
  statMine.textContent = String(mine);
  const open = tasks.filter(t => !isFullyDone(t)).length;
  statOpen.textContent = String(open);
}

/* Task creation */
newTaskBtn?.addEventListener("click", ()=>{
  buildAssignUI();
  // reset
  taskForm.reset();
  selectedAssign.clear();
  const chips = $("#assignChips");
  if (chips) chips.innerHTML = `<span class="muted2">No one selected.</span>`;
  taskDialog.showModal();
});

taskForm?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  if (!isUnlocked) return;

  const desc = taskDesc.value.trim();
  if (!desc) return;

  const targets = Array.from(selectedAssign);
  // fallback if user didn't pick anything => Lorem ipsum targets
  const assignTargets = targets.length ? targets : ["all"];

  const involvedPeople = expandTargetsToPeople(assignTargets);
  const doneBy = {};
  involvedPeople.forEach(k => doneBy[k] = false);

  const task = {
    desc,
    due: taskDue.value || "",
    status: taskStatus.value || "todo",
    priority: taskPriority.value || "med",
    notes: taskNotes.value || "",
    assignTargets,
    involvedPeople,
    doneBy,
    createdBy: me?.key || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try{
    const ref = await addDoc(tasksCol, task);
    taskDialog.close();

    // Email (best-effort)
    try{
      await sendTaskEmail({
        ...task,
        id: ref.id
      }, involvedPeople);
    }catch(_){}
  }catch(err){
    console.error(err);
    alert("Create failed. Check Firestore rules.");
  }
});

/* Email on create via Netlify Function */
async function sendTaskEmail(task, recipientsKeys){
  // compute emails from keys (hardcoded list only)
  const recipients = recipientsKeys
      .map(k => PEOPLE.find(p=>p.key===k)?.email)
      .filter(Boolean);

  if (!recipients.length) return;

  try{
    const res = await fetch("/.netlify/functions/sendTaskEmail", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task: {
          desc: task.desc,
          due: task.due,
          status: task.status,
          priority: task.priority,
          notes: task.notes,
          assignTargets: task.assignTargets || [],
          involvedPeople: task.involvedPeople || [],
          id: task.id
        },
        recipients
      })
    });
    if (!res.ok){
      const txt = await res.text().catch(()=> "");
      console.warn("Email function failed:", res.status, txt);
    }
  }catch(e){
    console.warn("Email skipped:", e);
  }
}

/* Task editing (desc/due/notes/priority only; assignments locked) */
const patchTimers = new Map();      // taskId -> timeout
const pendingPatches = new Map();  // taskId -> merged patch

function scheduleTaskPatch(id, patch){
  const curr = pendingPatches.get(id) || {};
  pendingPatches.set(id, { ...curr, ...patch });

  if (patchTimers.has(id)) clearTimeout(patchTimers.get(id));
  patchTimers.set(id, setTimeout(async ()=>{
    const pp = pendingPatches.get(id);
    pendingPatches.delete(id);
    patchTimers.delete(id);
    if (!pp) return;

    try{
      pp.updatedAt = serverTimestamp();
      await updateDoc(doc(db, "tasks", id), pp);
    }catch(err){
      console.error(err);
    }
  }, 400));
}

// Task field edits — commit on blur/change (NOT on every keystroke)
function commitTaskField(el){
  const row = el.closest("tr[data-id]");
  if (!row) return;
  const id = row.dataset.id;
  const field = el.dataset.field;
  if (!field) return;

  let val = el.value;
  if (el.type === "date") val = val || "";

  scheduleTaskPatch(id, { [field]: val });
}

// Date/select changes: save immediately (one write per user action)
tasksBody.addEventListener("change", (e)=>{
  const el = e.target.closest(".taskEdit");
  if (!el) return;

  // ignore "my done" checkbox here (handled below)
  if (el.classList.contains("myDone")) return;

  commitTaskField(el);
});

// Text inputs: save when user leaves the field (one write per edit)
tasksBody.addEventListener("blur", (e)=>{
  const el = e.target.closest(".taskEdit");
  if (!el) return;

  // ignore "my done" checkbox here (handled below)
  if (el.classList.contains("myDone")) return;

  commitTaskField(el);
}, true);

/* My done checkbox (ONLY your own) */
tasksBody.addEventListener("change", async (e)=>{
  const cb = e.target.closest(".myDone");
  if (!cb) return;
  const id = cb.dataset.id;
  if (!me) return;

  // Confirm you’re actually involved (defensive)
  const t = tasks.find(x=>x.id===id);
  if (!t) return;
  const involved = Array.isArray(t.involvedPeople) ? t.involvedPeople : [];
  if (!involved.includes(me.key)) return;

  const next = !!cb.checked;

  try{
    const key = `doneBy.${me.key}`;
    await updateDoc(doc(db, "tasks", id), { [key]: next, updatedAt: serverTimestamp() });
  }catch(err){
    console.error(err);
    cb.checked = !next; // revert
    alert("Update failed. Check Firestore rules.");
  }
});

/* Delete (available to everyone) */
tasksBody.addEventListener("click", async (e)=>{
  const btn = e.target.closest("[data-act='del']");
  if (!btn) return;
  const row = e.target.closest("tr[data-id]");
  if (!row) return;
  const id = row.dataset.id;

  if (!confirm("Delete this task?")) return;

  try{
    await deleteDoc(doc(db,"tasks", id));
  }catch(err){
    console.error(err);
    alert("Delete failed. Check Firestore rules.");
  }
});

/* Notes (throttled + debounced to avoid Firestore per-doc write limits) */
let notesTimer = null;
let lastNotesWriteAt = 0;

async function saveNotesNow(){
  const v = notesBox.value;

  // Don’t write if nothing changed vs latest synced value
  if (v === notesText){
    notesStatus.textContent = "Synced";
    return;
  }

  // Throttle: don’t write more often than every 2500ms
  const now = Date.now();
  const wait = Math.max(0, 2500 - (now - lastNotesWriteAt));
  if (wait > 0){
    clearTimeout(notesTimer);
    notesTimer = setTimeout(saveNotesNow, wait);
    return;
  }

  notesStatus.textContent = "Saving…";
  try{
    await updateDoc(notesRef, { text: v, updatedAt: serverTimestamp() });
    lastNotesWriteAt = Date.now();
    notesStatus.textContent = "Saved";
  }catch(err){
    console.error(err);
    notesStatus.textContent = "Save failed";
  }
}

notesBox.addEventListener("input", ()=>{
  notesStatus.textContent = "Typing…";
  clearTimeout(notesTimer);
  notesTimer = setTimeout(saveNotesNow, 2000); // only after user stops typing
});

notesBox.addEventListener("blur", ()=>{
  saveNotesNow(); // save when leaving the box
});

/* Links (simple CRUD) */
let editingLinkId = null;
function linkCardHTML(l){
  const title = escapeHtml(l.title || "Lorem ipsum");
  const desc = escapeHtml(l.desc || "Lorem ipsum");
  const url = escapeHtml(l.url || "#");
  return `
    <div class="linkCard" data-id="${l.id}">
      <div class="linkCard__top">
        <div>
          <div class="linkCard__title">${title}</div>
          <div class="linkCard__url">${url}</div>
        </div>
        <div class="linkCard__actions">
          <button class="linkCard__btn" data-act="edit" title="Edit">
            <svg class="ico" viewBox="0 0 24 24" fill="none"><path d="M12 20h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
          </button>
          <button class="linkCard__btn" data-act="del" title="Delete">
            <svg class="ico" viewBox="0 0 24 24" fill="none"><path d="M3 6h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 6V4h8v2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
      <div class="linkCard__desc">${desc}</div>
      <a class="linkCard__open" href="${url}" target="_blank" rel="noopener">Open</a>
    </div>
  `;
}

function matchesSearchLink(l){
  if (!searchQ) return true;
  const hay = [l.title,l.desc,l.url].join(" ").toLowerCase();
  return hay.includes(searchQ);
}

function renderLinks(){
  const view = links.filter(matchesSearchLink);
  linksGrid.innerHTML = view.map(linkCardHTML).join("");
}

newLinkBtn?.addEventListener("click", ()=>{
  editingLinkId = null;
  linkForm.reset();
  linkDialog.showModal();
});

linkForm?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  if (!isUnlocked) return;

  const title = linkTitle.value.trim() || "Lorem ipsum";
  const url = linkUrl.value.trim() || "#";
  const desc = linkDesc.value.trim() || "Lorem ipsum";

  try{
    if (editingLinkId){
      await updateDoc(doc(db,"links", editingLinkId), { title, url, desc, updatedAt: serverTimestamp() });
    } else {
      const order = links.length ? (Math.max(...links.map(x=>Number(x.order||0))) + 1) : 1;
      await addDoc(linksCol, { title, url, desc, order, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    linkDialog.close();
  }catch(err){
    console.error(err);
    alert("Link save failed. Check Firestore rules.");
  }
});

linksGrid?.addEventListener("click", async (e)=>{
  const card = e.target.closest(".linkCard");
  if (!card) return;
  const id = card.dataset.id;

  if (e.target.closest("[data-act='edit']")){
    const l = links.find(x=>x.id===id);
    if (!l) return;
    editingLinkId = id;
    linkTitle.value = l.title || "";
    linkUrl.value = l.url || "";
    linkDesc.value = l.desc || "";
    linkDialog.showModal();
    return;
  }

  if (e.target.closest("[data-act='del']")){
    if (!confirm("Delete this link?")) return;
    try{
      await deleteDoc(doc(db,"links", id));
    }catch(err){
      console.error(err);
      alert("Delete failed. Check Firestore rules.");
    }
  }
});

/* Drag reorder links (writes only on drop) */
let dragId = null;
linksGrid?.addEventListener("dragstart", (e)=>{
  const card = e.target.closest(".linkCard");
  if (!card) return;
  dragId = card.dataset.id;
  e.dataTransfer.effectAllowed = "move";
});

linksGrid?.addEventListener("dragover", (e)=>{
  if (!dragId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
});

linksGrid?.addEventListener("drop", async (e)=>{
  if (!dragId) return;
  e.preventDefault();
  const target = e.target.closest(".linkCard");
  if (!target) return;
  const dropId = target.dataset.id;
  if (dropId === dragId) return;

  const from = links.findIndex(x=>x.id===dragId);
  const to   = links.findIndex(x=>x.id===dropId);
  if (from<0 || to<0) return;

  const next = links.slice();
  const [moved] = next.splice(from,1);
  next.splice(to,0,moved);

  // set consecutive order values
  try{
    const batch = writeBatch(db);
    next.forEach((l, i)=>{
      batch.update(doc(db,"links", l.id), { order: i+1, updatedAt: serverTimestamp() });
    });
    await batch.commit();
  }catch(err){
    console.error(err);
    alert("Reorder failed. Check Firestore rules.");
  }finally{
    dragId = null;
  }
});

/* Export/Import */
exportBtn?.addEventListener("click", ()=>{
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks,
    links,
    notesText
  };
  const blob = new Blob([JSON.stringify(payload,null,2)], { type:"application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "teamhub-export.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

importFile?.addEventListener("change", async ()=>{
  const file = importFile.files?.[0];
  if (!file) return;

  try{
    const text = await file.text();
    const data = JSON.parse(text);

    if (!confirm("Import will overwrite your current tasks/links/notes. Continue?")){
      importFile.value = "";
      return;
    }

    // wipe + restore
    // NOTE: this is best-effort and may be slow; use carefully
    const batch = writeBatch(db);

    // delete existing tasks/links by batching (limited; for big data consider server-side)
    tasks.forEach(t => batch.delete(doc(db,"tasks", t.id)));
    links.forEach(l => batch.delete(doc(db,"links", l.id)));

    // commit deletes first
    await batch.commit();

    // add new docs
    for (const t of (data.tasks||[])){
      const clean = { ...t };
      delete clean.id;
      clean.createdAt = serverTimestamp();
      clean.updatedAt = serverTimestamp();
      await addDoc(tasksCol, clean);
    }
    for (const l of (data.links||[])){
      const clean = { ...l };
      delete clean.id;
      clean.createdAt = serverTimestamp();
      clean.updatedAt = serverTimestamp();
      await addDoc(linksCol, clean);
    }

    await updateDoc(notesRef, { text: String(data.notesText||""), updatedAt: serverTimestamp() });

    alert("Imported.");
  }catch(err){
    console.error(err);
    alert("Import failed.");
  }finally{
    importFile.value = "";
  }
});

/* Subscriptions */
let unsubTasks = null;
let unsubLinks = null;
let unsubNotes = null;

function startSubscriptions(){
  if (unsubTasks) unsubTasks();
  if (unsubLinks) unsubLinks();
  if (unsubNotes) unsubNotes();

  unsubTasks = onSnapshot(query(tasksCol, orderBy("updatedAt","desc")), (snap)=>{
    tasks = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderTasks();
    renderStats();
  });

  unsubLinks = onSnapshot(query(linksCol, orderBy("order","asc")), (snap)=>{
    links = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderLinks();
  });

  unsubNotes = onSnapshot(notesRef, (snap)=>{
    const data = snap.data() || {};
    notesText = String(data.text ?? "");
    if (notesBox.value !== notesText) notesBox.value = notesText;
    notesStatus.textContent = "Synced";
  });
}

function stopSubscriptions(){
  if (unsubTasks) unsubTasks();
  if (unsubLinks) unsubLinks();
  if (unsubNotes) unsubNotes();
  unsubTasks = unsubLinks = unsubNotes = null;
}

/* Init */
(async function init(){
  loadTheme();
  showPin("");
  setPinFooter("Preparing database…");

  try{
    await ensureBootstrap();
    await fetchRemotePinHash();
    startConfigWatch();

    const auto = await tryAutoUnlock();
    if (!auto){
      showPin("");
      setPinFooter("Enter PIN to unlock.");
      return;
    }

    // identity
    await ensureIdentity();
    if (!me){
      // Wait for dialog to close with selection
      const wait = () => new Promise(res=>{
        const handler = ()=>{ whoDialog.removeEventListener("close", handler); res(); };
        whoDialog.addEventListener("close", handler);
      });
      await wait();
    }
    if (!me){
      // fallback
      setMeByKey(PEOPLE[0].key);
    }

    startSubscriptions();
  }catch(err){
    console.error(err);
    showPin("Connection error. Check Firebase config/rules, and disable blockers for Firestore.");
    setPinFooter("Failed to connect.");
  }
})();
