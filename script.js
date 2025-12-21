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
try { getAnalytics(app); } catch {}
const db = getFirestore(app);

/* People (hardcoded) */
const PEOPLE = [
  { key: "youssef_elkhayat", name: "Youssef Elkhayat", team: "CAD Team", email: "youssifayman2004@gmail.com" },
  { key: "youssef_roshdy", name: "Youssef Roshdy", team: "Prototype Team", email: "yousufdiaa2004@gmail.com" },
  { key: "mohamed_alainiah", name: "Mohamed AlAiniah", team: "CAD Team", email: "Mohammad.bashar033@gmail.com" },
  { key: "ahmed_saeed", name: "Ahmed Saeed", team: "Prototype Team", email: "saeedahmedsuper@gmail.com" },
  { key: "mohamed_elmancy", name: "Mohamed ElMansy", team: "CAD Team", email: "mohammadadham20@gmail.com" },
];

const TEAMS = {
  "CAD Team": PEOPLE.filter(p => p.team === "CAD Team").map(p => p.key),
  "Prototype Team": PEOPLE.filter(p => p.team === "Prototype Team").map(p => p.key),
};
const ALL_KEYS = PEOPLE.map(p => p.key);

/* Local cache keys */
const LS_THEME = "sh_theme_v1";
const LS_PINHASH = "sh_pin_hash_v1";
const LS_ME = "sh_me_v1";

/* First-run PIN (only if meta/config doesn’t exist yet) */
const DEFAULT_PIN = "1234";

/* Firestore refs */
const configRef = doc(db, "meta", "config");
const notesRef = doc(db, "notes", "shared");
const linksCol = collection(db, "links");
const tasksCol = collection(db, "tasks");

/* DOM helpers */
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
window.teamhubSha256 = sha256Hex;

/* UI refs */
const pinOverlay = $("#pinOverlay");
const pinForm = $("#pinForm");
const pinInput = $("#pinInput");
const pinMsg = $("#pinMsg");
const pinFooter = $("#pinFooter");
const forgetPinBtn = $("#forgetPinBtn");

const whoDialog = $("#whoDialog");
const whoList = $("#whoList");
const whoOk = $("#whoOk");
const meChip = $("#meChip");
const meName = $("#meName");
const meTeam = $("#meTeam");

const themeBtn = $("#themeBtn");
const themeLbl = $("#themeLbl");
const lockBtn = $("#lockBtn");

const statTasks = $("#statTasks");
const statMine = $("#statMine");
const statOpen = $("#statOpen");

const searchBox = $("#searchBox");
const tasksBody = $("#tasksBody");
const tasksEmpty = $("#tasksEmpty");

const taskDialog = $("#taskDialog");
const taskDesc = $("#taskDesc");
const taskDue = $("#taskDue");
const taskPriority = $("#taskPriority");
const taskNotes = $("#taskNotes");
const taskForm = $("#taskForm");

const assignPicker = $("#assignPicker");
const assignMenu = $("#assignMenu");
const assignSummary = $("#assignSummary");

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
  applyTheme(localStorage.getItem(LS_THEME) || "dark");
}
themeBtn.addEventListener("click", ()=>{
  const cur = document.documentElement.dataset.theme || "dark";
  const next = cur === "dark" ? "light" : "dark";
  localStorage.setItem(LS_THEME, next);
  applyTheme(next);
});

/* Bootstrap Firestore on clean slate */
async function ensureBootstrap(){
  const cfgSnap = await getDoc(configRef);
  if (!cfgSnap.exists()){
    const pinHash = await sha256Hex(DEFAULT_PIN);
    await setDoc(configRef, { pinHash, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), version: 1 });
  }
  const notesSnap = await getDoc(notesRef);
  if (!notesSnap.exists()){
    await setDoc(notesRef, { text: "", updatedAt: serverTimestamp() });
  }
}

/* Auth */
function showPin(msg=""){
  pinOverlay.hidden = false;
  pinMsg.textContent = msg;
  setTimeout(()=> pinInput?.focus(), 50);
}
function hidePin(){
  pinOverlay.hidden = true;
  pinMsg.textContent = "";
}
function setPinFooter(s){ pinFooter.textContent = s; }

async function fetchRemotePinHash(){
  const snap = await getDoc(configRef);
  remotePinHash = snap.data()?.pinHash || null;
}

async function tryAutoUnlock(){
  const cached = localStorage.getItem(LS_PINHASH);
  if (cached && remotePinHash && cached === remotePinHash){
    isUnlocked = true;
    hidePin();
    return true;
  }
  return false;
}

async function unlockWithPin(pin){
  const hash = await sha256Hex(pin);
  if (remotePinHash && hash === remotePinHash){
    localStorage.setItem(LS_PINHASH, remotePinHash);
    isUnlocked = true;
    hidePin();
    return true;
  }
  return false;
}

function lock(){
  isUnlocked = false;
  localStorage.removeItem(LS_PINHASH);
  showPin("Locked. Enter PIN to continue.");
}

forgetPinBtn.addEventListener("click", ()=>{
  localStorage.removeItem(LS_PINHASH);
  pinMsg.textContent = "Forgotten on this device.";
});

pinForm.addEventListener("submit", async (e)=>{
  e.preventDefault();
  pinMsg.textContent = "Checking…";
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
      <div class="whoItem ${sel}" data-key="${p.key}">
        <div>
          <div class="whoItem__name">${escapeHtml(p.name)}</div>
          <div class="whoItem__team">${escapeHtml(p.team)}</div>
        </div>
        <div class="badge badge--team">${escapeHtml(p.team)}</div>
      </div>
    `;
  }).join("");
}

function setMeByKey(key){
  const p = PEOPLE.find(x=>x.key===key) || PEOPLE[0];
  me = { ...p };
  localStorage.setItem(LS_ME, me.key);
  meName.textContent = me.name;
  meTeam.textContent = me.team;
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

whoList.addEventListener("click", (e)=>{
  const item = e.target.closest(".whoItem");
  if (!item) return;
  const key = item.dataset.key;
  $$(".whoItem", whoList).forEach(el=> el.classList.toggle("whoItem--sel", el.dataset.key === key));
  whoOk.disabled = false;
  whoOk.dataset.sel = key;
});

whoDialog.addEventListener("close", ()=>{
  if (whoDialog.returnValue !== "ok") return;
  const key = whoOk.dataset.sel;
  if (key) setMeByKey(key);
});

meChip.addEventListener("click", ()=>{
  renderWho();
  whoOk.disabled = true;
  delete whoOk.dataset.sel;
  whoDialog.showModal();
});

lockBtn.addEventListener("click", lock);

/* Assignment picker (multi-select) */
const ASSIGN_OPTIONS = [
  { id:"all", label:"All", meta:"Everyone" },
  { id:"team:CAD Team", label:"CAD Team", meta:"Team" },
  { id:"team:Prototype Team", label:"Prototype Team", meta:"Team" },
  ...PEOPLE.map(p => ({ id:`person:${p.key}`, label:p.name, meta:p.team }))
];

let selectedAssign = new Set(); // option ids

function renderAssignMenu(){
  assignMenu.innerHTML = ASSIGN_OPTIONS.map(opt=>{
    const checked = selectedAssign.has(opt.id) ? "checked" : "";
    return `
      <div class="pickerRow" data-id="${opt.id}">
        <input type="checkbox" ${checked} tabindex="-1" />
        <div>${escapeHtml(opt.label)}</div>
        <div class="pickerRow__meta">${escapeHtml(opt.meta)}</div>
      </div>
    `;
  }).join("");
}

function updateAssignSummary(){
  if (selectedAssign.size === 0){
    assignSummary.textContent = "Select people / teams…";
    return;
  }
  const labels = ASSIGN_OPTIONS.filter(o=>selectedAssign.has(o.id)).map(o=>o.label);
  assignSummary.textContent = labels.join(", ");
}

function toggleAssignMenu(force){
  const open = force ?? assignMenu.hidden;
  assignMenu.hidden = !open;
  assignPicker.setAttribute("aria-expanded", String(open));
  if (open) renderAssignMenu();
}

assignPicker.addEventListener("click", ()=> toggleAssignMenu(assignMenu.hidden));
document.addEventListener("click", (e)=>{
  if (!assignPicker.contains(e.target) && !assignMenu.contains(e.target)){
    assignMenu.hidden = true;
    assignPicker.setAttribute("aria-expanded","false");
  }
});
assignMenu.addEventListener("click", (e)=>{
  const row = e.target.closest(".pickerRow");
  if (!row) return;
  const id = row.dataset.id;
  if (selectedAssign.has(id)) selectedAssign.delete(id);
  else selectedAssign.add(id);
  renderAssignMenu();
  updateAssignSummary();
});

/* Expand assignment -> involved people keys */
function computeInvolvedPeople(assignSet){
  const s = new Set();
  const hasAll = assignSet.has("all");
  if (hasAll){
    ALL_KEYS.forEach(k=>s.add(k));
    return [...s];
  }
  for (const id of assignSet){
    if (id.startsWith("person:")){
      s.add(id.replace("person:",""));
    } else if (id.startsWith("team:")){
      const teamName = id.replace("team:","");
      (TEAMS[teamName] || []).forEach(k=>s.add(k));
    }
  }
  return [...s];
}

function computeRecipients(involvedKeys){
  const emails = new Set();
  involvedKeys.forEach(k=>{
    const p = PEOPLE.find(x=>x.key===k);
    if (p?.email) emails.add(p.email);
  });
  return [...emails];
}

/* Subscriptions */
let unsubTasks = null, unsubLinks = null, unsubNotes = null, unsubConfig = null;

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

/* Tasks rendering */
function initials(name){
  const parts = String(name||"").trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || "?";
  const b = parts[1]?.[0] || "";
  return (a+b).toUpperCase();
}

function isTaskMine(t){
  const involved = Array.isArray(t.involvedPeople) ? t.involvedPeople : [];
  return me && involved.includes(me.key);
}

function doneMap(t){
  return t.doneBy || {};
}

function isFullyDone(t){
  const involved = Array.isArray(t.involvedPeople) ? t.involvedPeople : [];
  if (involved.length === 0) return false;
  const d = doneMap(t);
  return involved.every(k => d[k] === true);
}

function progressChips(t){
  const involved = Array.isArray(t.involvedPeople) ? t.involvedPeople : [];
  const d = doneMap(t);
  if (involved.length === 0) return `<span class="badge badge--todo">No assignees</span>`;
  return involved.map(k=>{
    const p = PEOPLE.find(x=>x.key===k);
    const done = d[k] === true;
    const isMe = me && me.key === k;
    const cls = `pip ${done ? "pip--done":""} ${isMe ? "pip--me":""}`;
    return `<span class="${cls}" title="${escapeHtml(p?.name||k)}"><span class="pip__dot"></span>${escapeHtml(initials(p?.name||k))}</span>`;
  }).join("");
}

function assignedBadges(t){
  // display original selection (names/teams/all). not editable after create.
  const targets = Array.isArray(t.assignTargets) ? t.assignTargets : [];
  if (targets.length === 0){
    // fallback: infer from involvedPeople
    const inv = Array.isArray(t.involvedPeople) ? t.involvedPeople : [];
    return `<span class="badge badge--todo">${inv.length} people</span>`;
  }
  return targets.map(label=>{
    const isAll = label === "All";
    const isTeam = label.endsWith("Team");
    const isMeName = me && label === me.name;
    const cls = `badge ${isAll?"badge--all":""} ${isTeam?"badge--team":""} ${isMeName?"badge--me":""}`;
    return `<span class="${cls}">${escapeHtml(label)}</span>`;
  }).join("");
}

function renderTasks(){
  const q = (searchQ || "").trim().toLowerCase();
  let list = [...tasks];

  if (q){
    list = list.filter(t=>{
      const blob = `${t.desc||""} ${t.notes||""} ${(t.assignTargets||[]).join(" ")} ${(t.involvedPeople||[]).join(" ")}`.toLowerCase();
      return blob.includes(q);
    });
  }

  tasksEmpty.hidden = list.length !== 0;

  tasksBody.innerHTML = list.map(t=>{
    const mine = isTaskMine(t);
    const fully = isFullyDone(t);
    const rowCls = `${mine ? "taskRow--mine":""} ${fully ? "taskRow--done":""}`;
    const due = escapeHtml(t.due || "");
    const desc = escapeHtml(t.desc || "");
    const notes = escapeHtml(t.notes || "");

    // My done checkbox ONLY for involved people
    let myCell = `<div class="muted2">—</div>`;
    if (mine){
      const d = doneMap(t);
      const checked = d[me.key] === true ? "checked" : "";
      myCell = `
        <label class="myCheck">
          <input type="checkbox" class="myDone" data-id="${t.id}" ${checked} />
          <span class="muted2">My done</span>
        </label>
      `;
    }

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
        <td class="th--right">
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

/* Task editing (desc/due/notes only; assignments locked) */
let patchTimer = null;
let pendingPatch = null;

function scheduleTaskPatch(id, patch){
  pendingPatch = { id, patch: { ...pendingPatch?.patch, ...patch } };
  if (patchTimer) clearTimeout(patchTimer);
  patchTimer = setTimeout(async ()=>{
    if (!pendingPatch) return;
    const { id:tid, patch:pp } = pendingPatch;
    pendingPatch = null;
    try{
      pp.updatedAt = serverTimestamp();
      await updateDoc(doc(db, "tasks", tid), pp);
    }catch(err){
      console.error(err);
    }
  }, 350);
}

tasksBody.addEventListener("input", (e)=>{
  const inp = e.target.closest(".taskEdit");
  if (!inp) return;
  const row = e.target.closest("tr[data-id]");
  if (!row) return;
  const id = row.dataset.id;
  const field = inp.dataset.field;
  if (!field) return;
  scheduleTaskPatch(id, { [field]: inp.value });
});

/* My done checkbox (ONLY your own) */
tasksBody.addEventListener("change", async (e)=>{
  const cb = e.target.closest(".myDone");
  if (!cb) return;
  const id = cb.dataset.id;
  if (!me) return;

  // Confirm you’re actually involved (defensive)
  const t = tasks.find(x=>x.id===id);
  if (!t || !isTaskMine(t)){
    cb.checked = false;
    return;
  }

  const checked = cb.checked === true;
  try{
    const key = me.key; // safe (no dots)
    const fieldPath = `doneBy.${key}`;
    await updateDoc(doc(db,"tasks", id), {
      [fieldPath]: checked,
      updatedAt: serverTimestamp()
    });
  }catch(err){
    console.error(err);
    cb.checked = !checked;
  }
});

/* Delete (available for everyone) */
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

searchBox.addEventListener("input", ()=>{
  searchQ = searchBox.value || "";
  renderTasks();
});

/* New task */
$("#newTaskBtn").addEventListener("click", ()=>{
  selectedAssign = new Set(); // reset
  updateAssignSummary();
  assignMenu.hidden = true;
  assignPicker.setAttribute("aria-expanded","false");

  taskDesc.value = "";
  taskDue.value = "";
  taskPriority.value = "med";
  taskNotes.value = "";

  taskDialog.showModal();
  setTimeout(()=> taskDesc.focus(), 40);
});

taskDialog.addEventListener("close", async ()=>{
  if (taskDialog.returnValue !== "ok") return;

  const assignSet = new Set(selectedAssign);
  if (assignSet.size === 0){
    alert("Pick at least one assignee (person/team/all).");
    return;
  }

  const involvedPeople = computeInvolvedPeople(assignSet);
  const assignTargets = ASSIGN_OPTIONS
      .filter(o=>assignSet.has(o.id))
      .map(o=>o.label);

  const payload = {
    desc: taskDesc.value.trim() || "Lorem ipsum",
    due: taskDue.value || "",
    priority: taskPriority.value || "med",
    notes: taskNotes.value.trim() || "",
    assignTargets,
    involvedPeople,
    doneBy: {}, // map of personKey -> boolean
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  try{
    const ref = await addDoc(tasksCol, payload);

    // Email involved people (server-side)
    const recipients = computeRecipients(involvedPeople);
    await sendTaskEmail({
      id: ref.id,
      ...payload,
      due: payload.due || "",
      recipients
    });
  }catch(err){
    console.error(err);
    alert("Task create failed. Check Firestore rules / Netlify function.");
  }
});

/* Email function call */
async function sendTaskEmail(task){
  // If function not deployed, don’t block the app.
  try{
    const recipients = task.recipients || [];
    const res = await fetch("/.netlify/functions/sendTaskEmail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: {
          desc: task.desc,
          due: task.due,
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

/* Notes (debounced) */
let notesTimer = null;
notesBox.addEventListener("input", ()=>{
  notesStatus.textContent = "Typing…";
  if (notesTimer) clearTimeout(notesTimer);
  notesTimer = setTimeout(async ()=>{
    try{
      await updateDoc(notesRef, { text: notesBox.value, updatedAt: serverTimestamp() });
      notesStatus.textContent = "Saved";
    }catch(err){
      console.error(err);
      notesStatus.textContent = "Save failed";
    }
  }, 450);
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
  linksGrid.innerHTML = links.map(linkCardHTML).join("") || `<div class="empty">No links yet.</div>`;
}

newLinkBtn.addEventListener("click", ()=>{
  editingLinkId = null;
  linkTitle.value = "";
  linkUrl.value = "";
  linkDesc.value = "";
  linkDialog.showModal();
});
linkDialog.addEventListener("close", async ()=>{
  if (linkDialog.returnValue !== "ok") return;
  const data = {
    title: linkTitle.value.trim() || "Lorem ipsum",
    url: linkUrl.value.trim() || "#",
    desc: linkDesc.value.trim() || "Lorem ipsum"
  };
  try{
    if (editingLinkId){
      await updateDoc(doc(db,"links", editingLinkId), { ...data, updatedAt: serverTimestamp() });
    }else{
      const maxOrder = links.reduce((m,l)=> Math.max(m, Number(l.order||0)), 0);
      await addDoc(linksCol, { ...data, order: (maxOrder+100), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
  }catch(err){ console.error(err); }
});

linksGrid.addEventListener("click", async (e)=>{
  const card = e.target.closest(".linkCard");
  if (!card) return;
  const id = card.dataset.id;
  const act = e.target.closest("[data-act]")?.dataset?.act;
  if (!act) return;
  const l = links.find(x=>x.id===id);
  if (act === "edit" && l){
    editingLinkId = id;
    linkTitle.value = l.title || "";
    linkUrl.value = l.url || "";
    linkDesc.value = l.desc || "";
    linkDialog.showModal();
  }
  if (act === "del"){
    if (!confirm("Delete this link?")) return;
    try{ await deleteDoc(doc(db,"links", id)); }catch(err){ console.error(err); }
  }
});

/* Export/Import */
function download(filename, text){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], {type:"application/json"}));
  a.download = filename;
  a.click();
  setTimeout(()=> URL.revokeObjectURL(a.href), 800);
}
function parseFSDate(x){
  if (!x) return "";
  if (typeof x === "string") return x;
  if (x.seconds){
    const d = new Date(x.seconds*1000);
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const dd = String(d.getDate()).padStart(2,"0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  }
  return "";
}
exportBtn.addEventListener("click", ()=>{
  const out = {
    tasks: tasks.map(t=>({
      desc:t.desc||"",
      due: parseFSDate(t.due),
      priority:t.priority||"med",
      notes:t.notes||"",
      assignTargets:t.assignTargets||[],
      involvedPeople:t.involvedPeople||[],
      doneBy:t.doneBy||{}
    })),
    links: links.map(l=>({title:l.title||"",url:l.url||"",desc:l.desc||"",order:Number(l.order||0)})),
    notes: notesBox.value || ""
  };
  download(`siliconhall-export-${Date.now()}.json`, JSON.stringify(out,null,2));
});
importFile.addEventListener("change", async ()=>{
  const f = importFile.files?.[0];
  if (!f) return;
  try{
    const obj = JSON.parse(await f.text());
    if (!confirm("Import will replace current tasks/links/notes. Continue?")) return;

    const batch = writeBatch(db);
    for (const t of tasks) batch.delete(doc(db,"tasks", t.id));
    for (const l of links) batch.delete(doc(db,"links", l.id));
    batch.set(notesRef, { text: String(obj.notes||""), updatedAt: serverTimestamp() }, { merge:true });

    (obj.links || []).forEach((l, idx)=>{
      const ref = doc(collection(db,"links"));
      batch.set(ref, {
        title: String(l.title||"Lorem ipsum"),
        url: String(l.url||"#"),
        desc: String(l.desc||"Lorem ipsum"),
        order: Number.isFinite(Number(l.order)) ? Number(l.order) : idx*100,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });

    (obj.tasks || []).forEach((t)=>{
      const ref = doc(collection(db,"tasks"));
      batch.set(ref, {
        desc: String(t.desc||"Lorem ipsum"),
        due: String(t.due||""),
        priority: String(t.priority||"med"),
        notes: String(t.notes||""),
        assignTargets: Array.isArray(t.assignTargets) ? t.assignTargets : [],
        involvedPeople: Array.isArray(t.involvedPeople) ? t.involvedPeople : [],
        doneBy: (t.doneBy && typeof t.doneBy === "object") ? t.doneBy : {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });

    await batch.commit();
  }catch(err){
    console.error(err);
    alert("Import failed. Bad JSON?");
  }finally{
    importFile.value = "";
  }
});

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

    await ensureIdentity();
    // If identity was missing, dialog opens; we’ll still set a default once chosen.
    // If cached, me is already set and we can subscribe now.
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
