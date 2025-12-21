/* Team Hub — single-page app (no framework)
   - Persistent storage via Netlify Functions + Netlify Blobs
   - Local cache fallback (localStorage) if offline
*/
const API_BASE = "/.netlify/functions/api";
const LS_KEY = "teamhub_state_v1";
const LS_THEME = "teamhub_theme_v1";
const LS_NAME = "teamhub_workspace_v1";
const LS_TOKEN = "teamhub_token_v1";

const $ = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => [...el.querySelectorAll(q)];

const toastEl = $("#toast");
let toastTimer = null;
function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add("is-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>toastEl.classList.remove("is-show"), 2200);
}

const nowIso = () => new Date().toISOString();
function safeJsonParse(s, fallback){ try{ return JSON.parse(s); } catch { return fallback; } }
function clampStr(s, max=4000){ s = String(s ?? ""); return s.length > max ? s.slice(0,max) : s; }
function uid(){ return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16); }
function normalizeUrl(url){ let u=String(url||"").trim(); if(!u) return ""; if(!/^https?:\/\//i.test(u)) u="https://"+u; return u; }
function fmtDate(d){ if(!d) return ""; try{ const dt=new Date(d); if(Number.isNaN(dt.getTime())) return ""; return dt.toISOString().slice(0,10);}catch{return "";} }
function prioRank(p){ if(p==="High") return 3; if(p==="Medium") return 2; return 1; }
function escapeHtml(str){ return String(str ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }

let state = { version:1, workspaceName:"Team Hub", notes:"Lorem ipsum...", links:[], tasks:[] };
let autosync = true;
let isDirty = false;
let searchQuery = "";

const yearEl = $("#year"); yearEl.textContent = new Date().getFullYear();
const footerName = $("#footerName");
const footerMeta = $("#footerMeta");
const lastSavedEl = $("#lastSaved");
const syncPill = $("#syncPill");

const globalSearch = $("#globalSearch");
const clearSearch = $("#clearSearch");
const themeToggle = $("#themeToggle");
const syncNowBtn = $("#syncNow");
const exportBtn = $("#exportBtn");
const importBtn = $("#importBtn");
const importFile = $("#importFile");
const logoutBtn = $("#logoutBtn");

const navButtons = $$(".nav__item");
const views = $$(".view");

const dashboardList = $("#dashboardList");
const dashboardLinks = $("#dashboardLinks");
const sharedNotes = $("#sharedNotes");
const sharedNotes2 = $("#sharedNotes2");
const saveNotesBtn = $("#saveNotesBtn");
const notesSaveBtn = $("#notesSaveBtn");

const kpiPending = $("#kpiPending");
const kpiProgress = $("#kpiProgress");
const kpiDone = $("#kpiDone");

const addTaskQuick = $("#addTaskQuick");
const addLinkQuick = $("#addLinkQuick");

const linkForm = $("#linkForm");
const newLinkBtn = $("#newLinkBtn");
const cancelLink = $("#cancelLink");
const linkName = $("#linkName");
const linkUrl = $("#linkUrl");
const linkGroup = $("#linkGroup");
const linksContainer = $("#linksContainer");
const linkCount = $("#linkCount");
const linkFilter = $("#linkFilter");

const taskForm = $("#taskForm");
const newTaskBtn = $("#newTaskBtn");
const cancelTask = $("#cancelTask");
const taskDescription = $("#taskDescription");
const taskAssignedTo = $("#taskAssignedTo");
const taskStatus = $("#taskStatus");
const taskPriority = $("#taskPriority");
const taskDue = $("#taskDue");
const taskNotes = $("#taskNotes");
const tasksTableBody = $("#tasksTableBody");
const tasksEmpty = $("#tasksEmpty");
const taskCount = $("#taskCount");
const statusFilter = $("#statusFilter");
const priorityFilter = $("#priorityFilter");
const sortTasks = $("#sortTasks");

const autosyncToggle = $("#autosyncToggle");
const workspaceNameInput = $("#workspaceName");
const changePinHint = $("#changePinHint");
const clearAllBtn = $("#clearAll");

// Login modal
const loginModal = $("#loginModal");
const loginForm = $("#loginForm");
const pinInput = $("#pinInput");
const loginErr = $("#loginErr");

function setTheme(mode){
  if(mode !== "dark" && mode !== "light") mode = "dark";
  document.documentElement.setAttribute("data-theme", mode);
  localStorage.setItem(LS_THEME, mode);
}
function initTheme(){
  const saved = localStorage.getItem(LS_THEME);
  if(saved){ setTheme(saved); return; }
  const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  setTheme(prefersLight ? "light" : "dark");
}
themeToggle.addEventListener("click", ()=>{
  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  setTheme(cur === "dark" ? "light" : "dark");
});

function getToken(){ return localStorage.getItem(LS_TOKEN) || ""; }
function setToken(t){ if(t) localStorage.setItem(LS_TOKEN, t); else localStorage.removeItem(LS_TOKEN); }
function openLogin(){ loginErr.textContent=""; pinInput.value=""; loginModal.classList.add("is-open"); loginModal.setAttribute("aria-hidden","false"); setTimeout(()=>pinInput.focus(),50); }
function closeLogin(){ loginModal.classList.remove("is-open"); loginModal.setAttribute("aria-hidden","true"); }
$$("[data-close='login']").forEach(el=>el.addEventListener("click", closeLogin));

async function api(path, {method="GET", body=null, token=null}={}){
  const headers = { "Content-Type":"application/json" };
  const t = token ?? getToken();
  if(t) headers["Authorization"] = "Bearer " + t;
  const res = await fetch(API_BASE + path, { method, headers, body: body ? JSON.stringify(body) : null });
  const text = await res.text();
  const data = text ? safeJsonParse(text, { raw:text }) : null;
  if(!res.ok){
    const msg = (data && (data.error || data.message)) ? (data.error || data.message) : `HTTP ${res.status}`;
    const err = new Error(msg); err.status=res.status; err.data=data; throw err;
  }
  return data;
}

loginForm.addEventListener("submit", async (e)=>{
  e.preventDefault();
  loginErr.textContent = "";
  const pin = String(pinInput.value || "").trim();
  if(pin.length < 4){ loginErr.textContent="PIN must be at least 4 digits."; return; }
  try{
    const out = await api("/login", {method:"POST", body:{ pin }, token:""});
    setToken(out.token);
    closeLogin();
    toast("Unlocked");
    await syncFromServer();
  }catch(err){
    loginErr.textContent = err.message || "Login failed.";
    setToken("");
  }
});
logoutBtn.addEventListener("click", ()=>{ setToken(""); toast("Logged out"); openLogin(); });

function saveLocal(){
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  localStorage.setItem(LS_NAME, state.workspaceName || "Team Hub");
}
function loadLocal(){
  const saved = safeJsonParse(localStorage.getItem(LS_KEY), null);
  if(saved && typeof saved === "object") state = { ...state, ...saved };
  const ws = localStorage.getItem(LS_NAME);
  if(ws) state.workspaceName = ws;
}
let syncTimer=null;
function scheduleSync(){ clearTimeout(syncTimer); syncTimer=setTimeout(()=>syncToServer().catch(()=>{}),650); }

function setSyncPill(mode,text){ syncPill.innerHTML = `<span class="dot dot--${mode}"></span> ${escapeHtml(text)}`; }

function markDirty(reason=""){
  isDirty = true;
  lastSavedEl.textContent = "Unsaved changes" + (reason ? ` • ${reason}` : "");
  saveLocal();
  if(autosync) scheduleSync();
}

async function syncFromServer(){
  if(!getToken()){ openLogin(); return; }
  try{
    const data = await api("/state",{method:"GET"});
    if(data && data.state){
      state = { ...state, ...data.state };
      isDirty=false;
      saveLocal();
      setSyncPill("ok","Synced");
      lastSavedEl.textContent = "Synced just now";
      renderAll();
    }
  }catch(err){
    if(err.status===401){ setToken(""); openLogin(); return; }
    setSyncPill("warn","Using local cache");
    lastSavedEl.textContent = "Offline/local mode";
  }
}

async function syncToServer(){
  if(!autosync || !isDirty || !getToken()) return;
  try{
    setSyncPill("warn","Syncing...");
    const out = await api("/state",{method:"POST", body:{ state }});
    isDirty=false;
    setSyncPill("ok","Synced");
    lastSavedEl.textContent = "Saved " + new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
    if(out && out.state){
      state = { ...state, ...out.state };
      saveLocal();
      renderAll();
    }
  }catch(err){
    if(err.status===401){ setToken(""); openLogin(); return; }
    setSyncPill("warn","Sync failed (local)");
    lastSavedEl.textContent = "Saved locally";
  }
}

syncNowBtn.addEventListener("click", async ()=>{
  if(!getToken()){ openLogin(); return; }
  try{ await syncToServer(); await syncFromServer(); toast("Synced"); } catch{ toast("Sync failed (local)"); }
});

function setView(view){
  navButtons.forEach(b=>b.classList.toggle("is-active", b.dataset.view===view));
  views.forEach(v=>v.classList.toggle("is-active", v.id===`view-${view}`));
  renderAll();
}
navButtons.forEach(btn=>btn.addEventListener("click", ()=>setView(btn.dataset.view)));

globalSearch.addEventListener("input", ()=>{ searchQuery = globalSearch.value.trim().toLowerCase(); renderAll(); });
clearSearch.addEventListener("click", ()=>{ globalSearch.value=""; searchQuery=""; renderAll(); });

newLinkBtn.addEventListener("click", ()=>{ linkForm.classList.toggle("is-hidden"); if(!linkForm.classList.contains("is-hidden")) linkName.focus(); });
addLinkQuick.addEventListener("click", ()=>{ setView("links"); linkForm.classList.remove("is-hidden"); linkName.focus(); });
cancelLink.addEventListener("click", ()=>{ linkForm.classList.add("is-hidden"); });

linkForm.addEventListener("submit", (e)=>{
  e.preventDefault();
  const name = clampStr(linkName.value.trim(),80);
  const url = normalizeUrl(linkUrl.value.trim());
  const group = clampStr(linkGroup.value.trim(),40);
  if(!name || !url) return;
  state.links.push({ id:uid(), name, url, group, createdAt:nowIso(), updatedAt:nowIso() });
  linkName.value=""; linkUrl.value=""; linkGroup.value="";
  linkForm.classList.add("is-hidden");
  markDirty("link added");
  renderLinks(); renderDashboard();
});

function setLinkFilterOptions(){
  const groups=[...new Set(state.links.map(l=>l.group).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const cur = linkFilter.value || "";
  linkFilter.innerHTML = `<option value="">All groups</option>` + groups.map(g=>`<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
  if(groups.includes(cur)) linkFilter.value = cur;
}
linkFilter.addEventListener("change", renderLinks);

function deleteLink(id){ state.links = state.links.filter(l=>l.id!==id); markDirty("link deleted"); renderLinks(); renderDashboard(); }
function editLink(id){
  const l = state.links.find(x=>x.id===id); if(!l) return;
  const name = prompt("Edit link name:", l.name); if(name===null) return;
  const url = prompt("Edit URL:", l.url); if(url===null) return;
  const group = prompt("Edit group (optional):", l.group || ""); if(group===null) return;
  l.name = clampStr(name.trim(),80) || l.name;
  l.url = normalizeUrl(url.trim()) || l.url;
  l.group = clampStr(group.trim(),40);
  l.updatedAt = nowIso();
  markDirty("link updated");
  renderLinks(); renderDashboard();
}

function setupLinkDnD(container){
  const isFiltered = !!searchQuery || !!(linkFilter.value || "");
  $$(".drag", container).forEach(card=>{
    card.addEventListener("dragstart", (e)=>{ if(isFiltered){e.preventDefault(); return;} card.classList.add("is-drag"); e.dataTransfer.effectAllowed="move"; e.dataTransfer.setData("text/plain", card.dataset.linkId); });
    card.addEventListener("dragover", (e)=>{ if(isFiltered) return; e.preventDefault(); e.dataTransfer.dropEffect="move"; });
    card.addEventListener("drop", (e)=>{
      if(isFiltered) return;
      e.preventDefault();
      const fromId = e.dataTransfer.getData("text/plain");
      const toId = card.dataset.linkId;
      if(!fromId || !toId || fromId===toId) return;
      const from = state.links.findIndex(l=>l.id===fromId);
      const to = state.links.findIndex(l=>l.id===toId);
      if(from<0 || to<0) return;
      const [m] = state.links.splice(from,1);
      state.links.splice(to,0,m);
      markDirty("links reordered");
      renderLinks(); renderDashboard();
    });
    card.addEventListener("dragend", ()=>card.classList.remove("is-drag"));
  });
}

function renderLinks(){
  setLinkFilterOptions();
  const filter = (linkFilter.value || "").toLowerCase();
  let links=[...state.links];
  if(filter) links = links.filter(l=>(l.group||"").toLowerCase()===filter);
  if(searchQuery) links = links.filter(l => (l.name||"").toLowerCase().includes(searchQuery) || (l.url||"").toLowerCase().includes(searchQuery) || (l.group||"").toLowerCase().includes(searchQuery));
  linkCount.textContent = `${links.length} link${links.length===1?"":"s"}`;
  linksContainer.innerHTML = links.map(l=>`
    <div class="link drag" draggable="true" data-link-id="${escapeHtml(l.id)}">
      <div class="link__top">
        <div>
          <div class="link__name">${escapeHtml(l.name)}</div>
          <div class="link__group">${escapeHtml(l.group || "Lorem ipsum")}</div>
        </div>
        <div class="link__btns">
          <button class="iconbtn" type="button" title="Edit" data-act="edit" data-id="${escapeHtml(l.id)}">✎</button>
          <button class="iconbtn" type="button" title="Delete" data-act="del" data-id="${escapeHtml(l.id)}">🗑</button>
        </div>
      </div>
      <a class="link__open" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">Open ↗</a>
    </div>
  `).join("");
  $$("[data-act='del']", linksContainer).forEach(btn=>btn.addEventListener("click", ()=>deleteLink(btn.dataset.id)));
  $$("[data-act='edit']", linksContainer).forEach(btn=>btn.addEventListener("click", ()=>editLink(btn.dataset.id)));
  setupLinkDnD(linksContainer);
}

newTaskBtn.addEventListener("click", ()=>{ taskForm.classList.toggle("is-hidden"); if(!taskForm.classList.contains("is-hidden")) taskDescription.focus(); });
addTaskQuick.addEventListener("click", ()=>{ setView("tasks"); taskForm.classList.remove("is-hidden"); taskDescription.focus(); });
cancelTask.addEventListener("click", ()=>{ taskForm.classList.add("is-hidden"); });

taskForm.addEventListener("submit", (e)=>{
  e.preventDefault();
  const desc = clampStr(taskDescription.value.trim(),200);
  const who = clampStr(taskAssignedTo.value.trim(),80);
  const st = taskStatus.value;
  const pr = taskPriority.value;
  const due = taskDue.value ? taskDue.value : "";
  const notes = clampStr(taskNotes.value.trim(),2000);
  if(!desc || !who) return;
  state.tasks.unshift({ id:uid(), description:desc, assignedTo:who, status:st, priority:pr, dueDate:due, notes, createdAt:nowIso(), updatedAt:nowIso() });
  taskDescription.value=""; taskAssignedTo.value=""; taskStatus.value="Pending"; taskPriority.value="Medium"; taskDue.value=""; taskNotes.value="";
  taskForm.classList.add("is-hidden");
  markDirty("task added");
  renderTasks(); renderDashboard();
});

statusFilter.addEventListener("change", renderTasks);
priorityFilter.addEventListener("change", renderTasks);
sortTasks.addEventListener("change", renderTasks);

function updateTask(id, patch){ const t = state.tasks.find(x=>x.id===id); if(!t) return; Object.assign(t, patch); t.updatedAt = nowIso(); markDirty("task updated"); }
function deleteTask(id){ if(!confirm("Delete this task?")) return; state.tasks = state.tasks.filter(t=>t.id!==id); markDirty("task deleted"); renderTasks(); renderDashboard(); }

function renderDashboardKpis(){
  kpiPending.textContent = state.tasks.filter(t=>t.status==="Pending").length;
  kpiProgress.textContent = state.tasks.filter(t=>t.status==="In Progress").length;
  kpiDone.textContent = state.tasks.filter(t=>t.status==="Completed").length;
}

function renderTasks(){
  const sf = statusFilter.value || "";
  const pf = priorityFilter.value || "";
  const sort = sortTasks.value || "updated_desc";
  let items=[...state.tasks];
  if(sf) items = items.filter(t=>t.status===sf);
  if(pf) items = items.filter(t=>t.priority===pf);
  if(searchQuery) items = items.filter(t => (t.description||"").toLowerCase().includes(searchQuery) || (t.assignedTo||"").toLowerCase().includes(searchQuery) || (t.notes||"").toLowerCase().includes(searchQuery));
  items.sort((a,b)=>{
    if(sort==="due_asc"){ const ad=a.dueDate||"9999-12-31"; const bd=b.dueDate||"9999-12-31"; return ad.localeCompare(bd); }
    if(sort==="priority_desc"){ return prioRank(b.priority)-prioRank(a.priority); }
    if(sort==="assignee_asc"){ return (a.assignedTo||"").localeCompare(b.assignedTo||""); }
    return (b.updatedAt||"").localeCompare(a.updatedAt||"");
  });
  taskCount.textContent = `${items.length} task${items.length===1?"":"s"}`;
  if(items.length===0){ tasksTableBody.innerHTML=""; tasksEmpty.classList.remove("is-hidden"); renderDashboardKpis(); return; }
  tasksEmpty.classList.add("is-hidden");
  tasksTableBody.innerHTML = items.map(t=>`
    <div class="row" data-id="${escapeHtml(t.id)}">
      <div><input class="cell-input" data-f="description" value="${escapeHtml(t.description)}"/></div>
      <div><input class="cell-input" data-f="assignedTo" value="${escapeHtml(t.assignedTo)}"/></div>
      <div>
        <select class="cell-input" data-f="status">
          <option ${t.status==="Pending"?"selected":""}>Pending</option>
          <option ${t.status==="In Progress"?"selected":""}>In Progress</option>
          <option ${t.status==="Completed"?"selected":""}>Completed</option>
        </select>
      </div>
      <div>
        <select class="cell-input" data-f="priority">
          <option value="Low" ${t.priority==="Low"?"selected":""}>Low</option>
          <option value="Medium" ${t.priority==="Medium"?"selected":""}>Medium</option>
          <option value="High" ${t.priority==="High"?"selected":""}>High</option>
        </select>
      </div>
      <div><input class="cell-input" data-f="dueDate" type="date" value="${escapeHtml(fmtDate(t.dueDate))}"/></div>
      <div><input class="cell-input" data-f="notes" value="${escapeHtml(t.notes || "")}" placeholder="Lorem ipsum..."/></div>
      <div><button class="btntrash" type="button" title="Delete">🗑</button></div>
    </div>
  `).join("");
  $$(".row", tasksTableBody).forEach(row=>{
    const id=row.dataset.id;
    row.querySelector(".btntrash").addEventListener("click", ()=>deleteTask(id));
    row.querySelectorAll("[data-f]").forEach(inp=>{
      inp.addEventListener("change", ()=>{
        const f = inp.dataset.f;
        let v = inp.value;
        if(f==="dueDate") v = v || "";
        updateTask(id, {[f]: clampStr(v, f==="notes"?2000:200)});
        renderDashboardKpis();
      });
    });
  });
  renderDashboardKpis();
}

function renderDashboard(){
  renderDashboardKpis();
  const latest=[...state.tasks].sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||"")).slice(0,6);
  dashboardList.innerHTML = latest.length ? latest.map(t=>`
    <div class="item">
      <div>
        <div class="item__title">${escapeHtml(t.description)}</div>
        <div class="item__meta">${escapeHtml(t.assignedTo)} • ${t.dueDate?`Due ${escapeHtml(t.dueDate)}`:"No due date"}</div>
      </div>
      <div class="badge">${escapeHtml(t.status)}</div>
    </div>
  `).join("") : `<div class="empty">No tasks yet. Click “+ Task” to create one.</div>`;
  const topLinks=state.links.slice(0,10);
  dashboardLinks.innerHTML = topLinks.length ? topLinks.map(l=>`<a class="link__open" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.name)} ↗</a>`).join("") : `<div class="empty">No links yet. Click “+ Link”.</div>`;
}

function syncNotesFields(){ sharedNotes.value = state.notes || ""; sharedNotes2.value = state.notes || ""; }
function pullNotesFromUI(){
  const v = sharedNotes2.value && sharedNotes2.value !== (state.notes||"") ? sharedNotes2.value : sharedNotes.value;
  state.notes = clampStr(v,20000) || "Lorem ipsum...";
  syncNotesFields();
  markDirty("notes saved");
}
saveNotesBtn.addEventListener("click", pullNotesFromUI);
notesSaveBtn.addEventListener("click", pullNotesFromUI);
sharedNotes.addEventListener("input", ()=>{ state.notes = sharedNotes.value; markDirty("notes"); });
sharedNotes2.addEventListener("input", ()=>{ state.notes = sharedNotes2.value; markDirty("notes"); });

exportBtn.addEventListener("click", ()=>{
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download="teamhub-export.json"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast("Exported");
});
importBtn.addEventListener("click", ()=>importFile.click());
importFile.addEventListener("change", async (e)=>{
  const file=e.target.files && e.target.files[0]; if(!file) return;
  try{
    const text=await file.text();
    const obj=safeJsonParse(text,null);
    if(!obj || typeof obj!=="object") throw new Error("Invalid JSON");
    state={...state,...obj};
    state.workspaceName=clampStr(state.workspaceName||"Team Hub",50);
    saveLocal(); markDirty("imported"); renderAll(); toast("Imported");
  }catch{ toast("Import failed"); } finally { importFile.value=""; }
});

autosyncToggle.addEventListener("change", ()=>{ autosync=!!autosyncToggle.checked; toast(autosync?"Autosync on":"Autosync off"); if(autosync) scheduleSync(); });
workspaceNameInput.addEventListener("change", ()=>{ state.workspaceName=clampStr(workspaceNameInput.value.trim(),50)||"Team Hub"; footerName.textContent=state.workspaceName; document.querySelector(".brand__title").textContent=state.workspaceName; markDirty("workspace name"); });
changePinHint.addEventListener("click", ()=>alert("In Netlify: Site settings → Environment variables\nSet ADMIN_PIN (e.g., 1234)\nSet AUTH_SECRET (random long string)\nRedeploy."));
clearAllBtn.addEventListener("click", async ()=>{
  if(!confirm("Clear all data (local + server)?")) return;
  state.links=[]; state.tasks=[]; state.notes="Lorem ipsum...";
  saveLocal(); markDirty("cleared"); renderAll();
  try{ await api("/clear",{method:"POST"}); toast("Cleared (server)"); }catch{ toast("Cleared (local)"); }
});

function renderAll(){
  footerName.textContent = state.workspaceName || "Team Hub";
  document.querySelector(".brand__title").textContent = state.workspaceName || "Team Hub";
  workspaceNameInput.value = state.workspaceName || "Team Hub";
  syncNotesFields();
  renderDashboard();
  renderLinks();
  renderTasks();
  footerMeta.textContent = `© ${new Date().getFullYear()} • ${state.workspaceName || "Team Hub"}`;
}

function boot(){
  initTheme();
  loadLocal();
  autosync=true; autosyncToggle.checked=true;

  if(!Array.isArray(state.links)) state.links=[];
  if(!Array.isArray(state.tasks)) state.tasks=[];
  if(!state.notes) state.notes="Lorem ipsum...";
  if(!state.workspaceName) state.workspaceName="Team Hub";

  renderAll();

  if(!getToken()){ openLogin(); setSyncPill("warn","Locked"); }
  else syncFromServer().catch(()=>{});

  window.addEventListener("online", ()=>{ toast("Back online"); if(getToken()) syncFromServer().catch(()=>{}); });
  window.addEventListener("offline", ()=>{ toast("Offline (local cache)"); setSyncPill("warn","Offline (local)"); });
}
boot();
