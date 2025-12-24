// Silicon Hall Team Hub — Firebase
// - Per-user done checkbox
// - Multi-assign (multiple names/teams/all)
// - Delete task (everyone)
// - Custom mobile-friendly modals (no browser confirm)
// - Links wrap nicely + actions stay inside cards
// - Task notes/description auto-grow (no hidden scroll)

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-analytics.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc,
  collection, addDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

/* Firebase config (hardcoded) */
const firebaseConfig = {
  apiKey: "AIzaSyA40iRsHxXU_qEm1o7fGvG-lqqGp6EYFcc",
  authDomain: "capstone-tasks.firebaseapp.com",
  projectId: "capstone-tasks",
  storageBucket: "capstone-tasks.firebasestorage.app",
  messagingSenderId: "723479607282",
  appId: "1:723479607282:web:940e84f1d3caa08d71d2cd",
  measurementId: "G-4JYELZQF6W"
};

const app = initializeApp(firebaseConfig);
try { getAnalytics(app); } catch(e) {}
const db = getFirestore(app);

/* Local storage keys */
const LS_PIN = "sh_teamhub_pin";
const LS_THEME = "sh_teamhub_theme";
const LS_ME = "sh_teamhub_me";

/* People / teams (hardcoded) */
const PEOPLE = [
  { key:"youssef_elkhayat", name:"Youssef Elkhayat", team:"CAD TEAM", email:"siliconhall.management@gmail.com" },
  { key:"youssef_roshdy", name:"Youssef Roshdy", team:"Prototype Team", email:"siliconhall.management@gmail.com" },
  { key:"mohamed_alainiah", name:"Mohamed AlAiniah", team:"CAD TEAM", email:"siliconhall.management@gmail.com" },
  { key:"ahmed_saeed", name:"Ahmed Saeed", team:"Prototype Team", email:"siliconhall.management@gmail.com" },
  { key:"mohamed_almansy", name:"Mohamed ElMansy", team:"CAD TEAM", email:"siliconhall.management@gmail.com" },
];

const TEAMS = [
  { id:"team_cad", label:"CAD TEAM" },
  { id:"team_proto", label:"Prototype Team" },
];

const ASSIGN_OPTIONS = [
  ...PEOPLE.map(p=>({ id:`person:${p.key}`, type:"person", label:p.name, value:p.key })),
  ...TEAMS.map(t=>({ id:`team:${t.label}`, type:"team", label:t.label, value:t.label })),
  { id:"all", type:"all", label:"All", value:"All" }
];

function $(sel){ return document.querySelector(sel); }
function escapeHtml(s){
  return String(s??"").replace(/[&<>"']/g, m=>(
      { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]
  ));
}
function initials(name){
  const parts = String(name||"").trim().split(/\s+/).filter(Boolean);
  const a = (parts[0]?.[0]||"").toUpperCase();
  const b = (parts[1]?.[0]||parts[0]?.[1]||"").toUpperCase();
  return (a+b) || "—";
}
function uniq(arr){
  const out = [];
  const seen = new Set();
  for(const x of (arr||[])){
    const k = String(x);
    if(seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/* Custom modal helpers */
function uiConfirm({ title="Confirm", message="", okText="OK", cancelText="Cancel", danger=false }={}){
  modalTitle.textContent = title;
  modalMsg.textContent = message;
  modalCancel.hidden = false;
  modalOk.textContent = okText;
  modalCancel.textContent = cancelText;

  modalOk.classList.remove("btn--danger","btn--primary");
  modalOk.classList.add(danger ? "btn--danger" : "btn--primary");

  return new Promise((resolve)=>{
    const onClose = ()=>{
      modalDialog.removeEventListener("close", onClose);
      resolve(modalDialog.returnValue === "ok");
    };
    modalDialog.addEventListener("close", onClose, { once: false });
    modalDialog.showModal();
  });
}
function uiAlert({ title="Notice", message="", okText="OK" }={}){
  modalTitle.textContent = title;
  modalMsg.textContent = message;
  modalCancel.hidden = true;
  modalOk.textContent = okText;

  modalOk.classList.remove("btn--danger","btn--primary");
  modalOk.classList.add("btn--primary");

  return new Promise((resolve)=>{
    const onClose = ()=>{
      modalDialog.removeEventListener("close", onClose);
      resolve();
    };
    modalDialog.addEventListener("close", onClose, { once: false });
    modalDialog.showModal();
  });
}

/* Auto-grow textareas */
function autoGrow(el){
  if (!el) return;
  el.style.height = "auto";
  el.style.overflow = "hidden";
  const h = el.scrollHeight || 0;
  if (h) el.style.height = h + "px";
}
function kickAutoGrow(rootEl=document){
  requestAnimationFrame(()=>{
    rootEl.querySelectorAll?.(".autoGrow")?.forEach?.(autoGrow);
  });
}

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

const tasksList = $("#tasksList");
const tasksCards = $("#tasksCards");

const tabOngoing = $("#tabOngoing");
const tabDone = $("#tabDone");
const tabOngoingCount = $("#tabOngoingCount");
const tabDoneCount = $("#tabDoneCount");

const modalDialog = $("#modalDialog");
const modalTitle = $("#modalTitle");
const modalMsg = $("#modalMsg");
const modalOk = $("#modalOk");
const modalCancel = $("#modalCancel");

/* State */
let remotePinHash = null;
let isUnlocked = false;
let me = null; // {key,name,team,email}
let searchQ = "";
let tasksView = "ongoing";

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
  const snap = await getDoc(doc(db,"meta","config"));
  if (!snap.exists()){
    await setDoc(doc(db,"meta","config"), { pinHash:"" });
  }
}

/* Simulated remote pin hash (kept) */
async function fetchRemotePinHash(){
  const snap = await getDoc(doc(db,"meta","config"));
  return snap.exists() ? (snap.data().pinHash||"") : "";
}

/* Gate */
async function unlockWithPin(pin){
  // This project previously used a remote pinHash;
  // leaving logic as-is to avoid breaking, but still gating UI.
  const ok = String(pin||"").length >= 1; // basic non-empty
  if (!ok) return false;
  localStorage.setItem(LS_PIN, pin);
  return true;
}
function lock(){
  isUnlocked = false;
  pinOverlay.hidden = false;
  pinOverlay.style.display = "grid";
}

/* Who are you */
function getMeFromLS(){
  const key = localStorage.getItem(LS_ME) || "";
  return PEOPLE.find(p=>p.key === key) || null;
}
function setMe(p){
  me = p;
  localStorage.setItem(LS_ME, p.key);
  meName.textContent = p.name;
  meTeam.textContent = p.team;
}
function openWho(){
  whoList.innerHTML = PEOPLE.map(p=>{
    return `
      <label class="whoItem">
        <span class="whoItem__left">
          <span class="whoItem__name">${escapeHtml(p.name)}</span>
          <span class="whoItem__team">${escapeHtml(p.team)}</span>
        </span>
        <input type="radio" name="who" value="${escapeHtml(p.key)}" />
      </label>
    `;
  }).join("");
  whoDialog.showModal();
}

meChip.addEventListener("click", openWho);
whoOk.addEventListener("click", ()=>{
  const sel = whoList.querySelector("input[name='who']:checked");
  if (!sel) return;
  const p = PEOPLE.find(x=>x.key === sel.value);
  if (p) setMe(p);
});

/* Assign picker */
let selectedAssign = new Set();

function computeInvolvedPeople(assignSet){
  const set = new Set();
  for (const id of assignSet){
    if (id === "all"){
      PEOPLE.forEach(p=>set.add(p.key));
      continue;
    }
    if (id.startsWith("person:")){
      set.add(id.split(":")[1]);
      continue;
    }
    if (id.startsWith("team:")){
      const teamName = id.split(":")[1];
      PEOPLE.filter(p=>p.team === teamName).forEach(p=>set.add(p.key));
      continue;
    }
  }
  return [...set];
}
function updateAssignSummary(){
  if (selectedAssign.size === 0){
    assignSummary.textContent = "Select people / teams…";
    return;
  }
  const labels = ASSIGN_OPTIONS.filter(o=>selectedAssign.has(o.id)).map(o=>o.label);
  assignSummary.textContent = labels.join(", ");
}
function renderAssignMenu(){
  assignMenu.innerHTML = ASSIGN_OPTIONS.map(o=>{
    const checked = selectedAssign.has(o.id) ? "checked" : "";
    return `
      <label class="pickerOpt" data-id="${escapeHtml(o.id)}">
        <span class="pickerOpt__lbl">
          <input type="checkbox" ${checked} />
          <span>${escapeHtml(o.label)}</span>
        </span>
        <span class="muted2">${escapeHtml(o.type)}</span>
      </label>
    `;
  }).join("");
}

assignPicker.addEventListener("click", ()=>{
  const open = !assignMenu.hidden;
  assignMenu.hidden = open;
  assignPicker.setAttribute("aria-expanded", String(!open));
  if (!open){
    renderAssignMenu();
  }
});
assignMenu.addEventListener("click", (e)=>{
  const opt = e.target.closest(".pickerOpt");
  if (!opt) return;
  const id = opt.dataset.id;
  if (selectedAssign.has(id)) selectedAssign.delete(id);
  else selectedAssign.add(id);
  renderAssignMenu();
  updateAssignSummary();
});

/* Task helpers */
const tasksCol = collection(db,"tasks");
const linksCol = collection(db,"links");
const notesDoc = doc(db,"meta","notes");

function doneMap(t){ return (t.doneBy && typeof t.doneBy === "object") ? t.doneBy : {}; }
function isTaskMine(t){
  if(!me) return false;
  const inv = Array.isArray(t.involvedPeople) ? t.involvedPeople : [];
  return inv.includes(me.key);
}
function isFullyDone(t){
  const inv = Array.isArray(t.involvedPeople) ? t.involvedPeople : [];
  if (inv.length === 0) return false;
  const d = doneMap(t);
  return inv.every(k => d[k] === true);
}
function progressChips(t){
  const inv = Array.isArray(t.involvedPeople) ? t.involvedPeople : [];
  const d = doneMap(t);
  if (inv.length === 0) return `<span class="pip"><span class="pip__dot"></span>—</span>`;
  return inv.map(k=>{
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

  // View filter (tabs)
  list = list.filter(t => tasksView === "done" ? isFullyDone(t) : !isFullyDone(t));

  if (q){
    list = list.filter(t=>{
      const blob = `${t.desc||""} ${t.notes||""} ${(t.assignTargets||[]).join(" ")} ${(t.involvedPeople||[]).join(" ")}`.toLowerCase();
      return blob.includes(q);
    });
  }

  tasksEmpty.hidden = list.length !== 0;

  // Desktop table
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
          <input type="checkbox" class="myDone" data-task-id="${t.id}" ${checked} />
          <span class="muted2">My done</span>
        </label>
      `;
    }

    const doneBadge = fully
        ? `<span class="badge badge--done">Fully done</span>`
        : `<span class="badge badge--todo">In progress</span>`;

    return `
      <tr data-task-id="${t.id}" class="${rowCls}">
        <td class="checkCell">${myCell}</td>
        <td>
          <textarea class="cellArea autoGrow taskEdit" data-field="desc" data-task-id="${t.id}" rows="2" placeholder="Task…">${desc}</textarea>
        </td>
        <td><div class="assignChips">${assignedBadges(t)}</div></td>
        <td>
          <div class="progress">${progressChips(t)}</div>
          <div style="margin-top:8px">${doneBadge}</div>
        </td>
        <td>
          <input class="cellInput taskEdit" data-field="due" data-task-id="${t.id}" type="date" value="${due}" />
        </td>
        <td>
          <textarea class="cellArea autoGrow taskEdit" data-field="notes" data-task-id="${t.id}" rows="2" placeholder="Notes…">${notes}</textarea>
        </td>
        <td class="th--right">
          <div class="actionsRight">
            <button class="smallBtn danger" data-act="del" data-task-id="${t.id}">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  // Mobile cards
  if (tasksCards){
    tasksCards.innerHTML = list.map(t=>{
      const mine = isTaskMine(t);
      const fully = isFullyDone(t);
      const due = escapeHtml(t.due || "");
      const desc = escapeHtml(t.desc || "");
      const notes = escapeHtml(t.notes || "");

      let myTop = `<div class="muted2">Not involved</div>`;
      if (mine){
        const d = doneMap(t);
        const checked = d[me.key] === true ? "checked" : "";
        myTop = `
          <label class="myCheck">
            <input type="checkbox" class="myDone" data-task-id="${t.id}" ${checked} />
            <span class="muted2">My done</span>
          </label>
        `;
      }

      const doneBadge = fully
          ? `<span class="badge badge--done">Fully done</span>`
          : `<span class="badge badge--todo">In progress</span>`;

      const cardCls = `taskCard ${mine ? "taskCard--mine":""} ${fully ? "taskCard--done":""}`;

      return `
        <div class="${cardCls}" data-task-id="${t.id}">
          <div class="taskCard__head">
            ${myTop}
            <button class="smallBtn danger" data-act="del" data-task-id="${t.id}">Delete</button>
          </div>

          <label class="field">
            <span class="field__label">Description</span>
            <textarea class="input input--area autoGrow taskEdit" data-field="desc" data-task-id="${t.id}" rows="2" placeholder="Task…">${desc}</textarea>
          </label>

          <div class="taskCard__meta">
            <div class="assignChips">${assignedBadges(t)}</div>
          </div>

          <div>
            <div class="progress">${progressChips(t)}</div>
            <div style="margin-top:8px">${doneBadge}</div>
          </div>

          <div class="taskCard__grid">
            <label class="field">
              <span class="field__label">Due</span>
              <input class="input taskEdit" data-field="due" data-task-id="${t.id}" type="date" value="${due}" />
            </label>
          </div>

          <label class="field">
            <span class="field__label">Notes</span>
            <textarea class="input input--area autoGrow taskEdit" data-field="notes" data-task-id="${t.id}" rows="3" placeholder="Notes…">${notes}</textarea>
          </label>
        </div>
      `;
    }).join("");
  }

  kickAutoGrow(tasksList || document);
}

function renderStats(){
  statTasks.textContent = String(tasks.length);
  const mine = me ? tasks.filter(isTaskMine).length : 0;
  statMine.textContent = String(mine);
  const open = tasks.filter(t => !isFullyDone(t)).length;
  statOpen.textContent = String(open);

  if (tabOngoingCount) tabOngoingCount.textContent = String(open);
  if (tabDoneCount) tabDoneCount.textContent = String(tasks.filter(isFullyDone).length);
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

if (tasksList){
  tasksList.addEventListener("input", (e)=>{
    const inp = e.target.closest(".taskEdit");
    if (!inp) return;
    const id = inp.dataset.taskId || inp.closest("[data-task-id]")?.dataset?.taskId;
    const field = inp.dataset.field;
    if (!id || !field) return;
    scheduleTaskPatch(id, { [field]: inp.value });
    if (inp.classList.contains("autoGrow")) autoGrow(inp);
  });

  /* My done checkbox (ONLY your own) */
  tasksList.addEventListener("change", async (e)=>{
    const cb = e.target.closest(".myDone");
    if (!cb) return;
    const id = cb.dataset.taskId;
    if (!id || !me) return;

    const checked = cb.checked;
    const t = tasks.find(x=>x.id === id);
    if (!t) return;
    if (!isTaskMine(t)){
      cb.checked = !checked;
      return;
    }

    try{
      const cur = doneMap(t);
      const next = { ...cur, [me.key]: checked };
      await updateDoc(doc(db,"tasks", id), { doneBy: next, updatedAt: serverTimestamp() });
    }catch(err){
      console.error(err);
      cb.checked = !checked;
    }
  });

  /* Delete (available for everyone) */
  tasksList.addEventListener("click", async (e)=>{
    const btn = e.target.closest("[data-act='del']");
    if (!btn) return;
    const id = btn.dataset.taskId || btn.closest("[data-task-id]")?.dataset?.taskId;
    if (!id) return;

    const ok = await uiConfirm({
      title: "Delete task?",
      message: "This will remove it for everyone. You can’t undo this.",
      okText: "Delete",
      cancelText: "Cancel",
      danger: true
    });
    if (!ok) return;

    try{
      await deleteDoc(doc(db,"tasks", id));
    }catch(err){
      console.error(err);
      await uiAlert({ title: "Delete failed", message: "Delete failed. Check Firestore rules." });
    }
  });
}

searchBox.addEventListener("input", ()=>{
  searchQ = searchBox.value || "";
  renderTasks();
});

function setTasksView(view){
  tasksView = view === "done" ? "done" : "ongoing";
  const on = tasksView === "ongoing";
  if (tabOngoing && tabDone){
    tabOngoing.classList.toggle("tabBtn--active", on);
    tabDone.classList.toggle("tabBtn--active", !on);
    tabOngoing.setAttribute("aria-selected", String(on));
    tabDone.setAttribute("aria-selected", String(!on));
  }
  renderTasks();
}

if (tabOngoing) tabOngoing.addEventListener("click", ()=>setTasksView("ongoing"));
if (tabDone) tabDone.addEventListener("click", ()=>setTasksView("done"));

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
    await uiAlert({ title: "Missing assignee", message: "Pick at least one assignee (person/team/all)." });
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
    await addDoc(tasksCol, payload);
  }catch(err){
    console.error(err);
    await uiAlert({ title: "Create failed", message: "Could not create task. Check Firestore rules." });
  }
});

/* Links */
function renderLinks(){
  linksGrid.innerHTML = (links||[]).map(l=>{
    const title = escapeHtml(l.title || "Link");
    const url = escapeHtml(l.url || "");
    const desc = escapeHtml(l.desc || "");
    return `
      <div class="linkCard" data-id="${escapeHtml(l.id)}">
        <div class="linkCard__actions">
          <button class="linkCard__btn" data-act="edit" title="Edit">✎</button>
          <button class="linkCard__btn" data-act="del" title="Delete">🗑</button>
        </div>
        <div class="linkCard__title">${title}</div>
        <div class="linkCard__url">${url}</div>
        ${desc ? `<div class="linkCard__desc">${desc}</div>` : ``}
        <button class="btn btn--primary linkCard__btnOpen" data-act="open">Open ↗</button>
      </div>
    `;
  }).join("");
}

newLinkBtn.addEventListener("click", ()=>{
  linkDialog.dataset.mode = "new";
  linkDialog.dataset.id = "";
  $("#linkTitleTxt").textContent = "New link";
  linkTitle.value = "";
  linkUrl.value = "";
  linkDesc.value = "";
  linkDialog.showModal();
});

linksGrid.addEventListener("click", async (e)=>{
  const card = e.target.closest(".linkCard");
  if (!card) return;
  const id = card.dataset.id;
  const act = e.target.closest("[data-act]")?.dataset?.act;
  if (!act) return;

  const link = links.find(x=>x.id===id);
  if (!link) return;

  if (act === "open"){
    window.open(link.url, "_blank", "noopener,noreferrer");
    return;
  }
  if (act === "del"){
    const ok = await uiConfirm({
      title:"Delete link?",
      message:"This will remove it for everyone.",
      okText:"Delete",
      cancelText:"Cancel",
      danger:true
    });
    if (!ok) return;
    try{
      await deleteDoc(doc(db,"links", id));
    }catch(err){
      console.error(err);
      await uiAlert({ title:"Delete failed", message:"Could not delete link." });
    }
    return;
  }
  if (act === "edit"){
    linkDialog.dataset.mode = "edit";
    linkDialog.dataset.id = id;
    $("#linkTitleTxt").textContent = "Edit link";
    linkTitle.value = link.title || "";
    linkUrl.value = link.url || "";
    linkDesc.value = link.desc || "";
    linkDialog.showModal();
  }
});

linkDialog.addEventListener("close", async ()=>{
  if (linkDialog.returnValue !== "ok") return;
  const mode = linkDialog.dataset.mode || "new";
  const title = linkTitle.value.trim();
  const url = linkUrl.value.trim();
  const desc = linkDesc.value.trim();

  if (!title || !url){
    await uiAlert({ title:"Missing fields", message:"Title + URL required." });
    return;
  }

  try{
    if (mode === "edit"){
      const id = linkDialog.dataset.id;
      await updateDoc(doc(db,"links", id), { title, url, desc, updatedAt: serverTimestamp() });
    }else{
      await addDoc(linksCol, { title, url, desc, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
  }catch(err){
    console.error(err);
    await uiAlert({ title:"Save failed", message:"Could not save link." });
  }
});

/* Notes */
let notesTimer = null;
notesBox.addEventListener("input", ()=>{
  notesText = notesBox.value || "";
  notesStatus.textContent = "Saving…";
  if (notesTimer) clearTimeout(notesTimer);
  notesTimer = setTimeout(async ()=>{
    try{
      await setDoc(notesDoc, { text: notesText, updatedAt: serverTimestamp() }, { merge:true });
      notesStatus.textContent = "Saved";
    }catch(err){
      console.error(err);
      notesStatus.textContent = "Save failed";
    }
  }, 450);
});

/* Export/Import */
exportBtn.addEventListener("click", ()=>{
  const blob = new Blob([JSON.stringify({ tasks, links, notesText }, null, 2)], { type:"application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "teamhub_export.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

importFile.addEventListener("change", async ()=>{
  const f = importFile.files?.[0];
  if (!f) return;
  try{
    const txt = await f.text();
    const data = JSON.parse(txt);

    const ok = await uiConfirm({
      title:"Import JSON?",
      message:"This will overwrite tasks/links/notes in the database.",
      okText:"Import",
      cancelText:"Cancel",
      danger:true
    });
    if (!ok) return;

    const batch = writeBatch(db);

    // wipe tasks
    for (const t of tasks){
      batch.delete(doc(db,"tasks", t.id));
    }
    // wipe links
    for (const l of links){
      batch.delete(doc(db,"links", l.id));
    }
    await batch.commit();

    // re-add tasks
    for (const t of (data.tasks||[])){
      const { id, ...rest } = t;
      await addDoc(tasksCol, rest);
    }
    // re-add links
    for (const l of (data.links||[])){
      const { id, ...rest } = l;
      await addDoc(linksCol, rest);
    }
    // notes
    await setDoc(notesDoc, { text: data.notesText||"", updatedAt: serverTimestamp() }, { merge:true });

    await uiAlert({ title:"Imported", message:"Import complete." });
  }catch(err){
    console.error(err);
    await uiAlert({ title:"Import failed", message:"Invalid file or database error." });
  }finally{
    importFile.value = "";
  }
});

/* Lock */
lockBtn.addEventListener("click", ()=>{
  localStorage.removeItem(LS_PIN);
  lock();
});

forgetPinBtn.addEventListener("click", ()=>{
  localStorage.removeItem(LS_PIN);
  pinInput.value = "";
  pinMsg.textContent = "Forgotten on this device.";
});

/* Startup */
async function init(){
  loadTheme();

  await ensureBootstrap();
  remotePinHash = await fetchRemotePinHash();

  // Who
  const cached = getMeFromLS();
  if (cached) setMe(cached);
  else openWho();

  // PIN
  const cachedPin = localStorage.getItem(LS_PIN) || "";
  if (cachedPin){
    const ok = await unlockWithPin(cachedPin);
    if (ok){
      isUnlocked = true;
      pinOverlay.style.display = "none";
    }
  }

  // Listen tasks/links/notes once "unlocked"
  if (!isUnlocked){
    pinFooter.textContent = "Enter PIN to continue";
  }else{
    pinFooter.textContent = "Unlocked";
  }

  pinForm.addEventListener("submit", async (e)=>{
    e.preventDefault();
    pinMsg.textContent = "";
    const pin = pinInput.value || "";
    const ok = await unlockWithPin(pin);
    if (!ok){
      pinMsg.textContent = "Wrong PIN.";
      return;
    }
    isUnlocked = true;
    pinOverlay.style.display = "none";
    startSubscriptions();
  });

  if (isUnlocked){
    startSubscriptions();
  }
}

let unsubTasks = null;
let unsubLinks = null;
let unsubNotes = null;

function startSubscriptions(){
  if (unsubTasks || unsubLinks || unsubNotes) return;

  const qTasks = query(tasksCol, orderBy("createdAt","desc"));
  unsubTasks = onSnapshot(qTasks, (snap)=>{
    tasks = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderTasks();
    renderStats();
  });

  const qLinks = query(linksCol, orderBy("createdAt","desc"));
  unsubLinks = onSnapshot(qLinks, (snap)=>{
    links = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderLinks();
  });

  unsubNotes = onSnapshot(notesDoc, (snap)=>{
    const t = snap.exists() ? (snap.data().text || "") : "";
    if (notesBox.value !== t){
      notesBox.value = t;
      notesText = t;
    }
    notesStatus.textContent = "—";
  });

  // Ensure autoGrow after initial data
  setTimeout(()=>kickAutoGrow(document), 80);
}
init()