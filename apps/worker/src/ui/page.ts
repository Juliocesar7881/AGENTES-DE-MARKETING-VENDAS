/** Local worker control panel (single self-contained page; all dynamic text is set via textContent). */
export function renderPanel(token: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="worker-token" content="${token}">
<title>RevenueOS Worker</title>
<style>
:root{--bg:#0b0c0f;--panel:#121419;--panel2:#171a21;--border:#23262f;--text:#e7e9ee;--muted:#8b91a1;--accent:#7c5cff;--ok:#22c55e;--warn:#f59e0b;--err:#ef4444;--radius:12px}
@media (prefers-color-scheme: light){:root{--bg:#f6f7f9;--panel:#fff;--panel2:#f1f2f5;--border:#e3e5ea;--text:#12141a;--muted:#5d6475}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:980px;margin:0 auto;padding:28px 20px 60px}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:12px}.logo{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--accent),#22d3ee);display:grid;place-items:center;font-weight:800;color:#fff}
h1{font-size:17px;margin:0;font-weight:650;letter-spacing:-.01em}.sub{color:var(--muted);font-size:12.5px}
.pill{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;border:1px solid var(--border);background:var(--panel);font-weight:600;font-size:12.5px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--muted)}.dot.ok{background:var(--ok);box-shadow:0 0 0 4px color-mix(in srgb,var(--ok) 20%,transparent)}.dot.warn{background:var(--warn)}.dot.err{background:var(--err)}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}@media(max-width:720px){.grid{grid-template-columns:repeat(2,1fr)}}
.card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:16px}
.stat .k{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em}.stat .v{font-size:26px;font-weight:700;margin-top:4px;font-variant-numeric:tabular-nums}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
button{font:inherit;border:1px solid var(--border);background:var(--panel2);color:var(--text);padding:8px 14px;border-radius:9px;cursor:pointer;font-weight:550}
button:hover{border-color:var(--accent)}button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button.danger{color:var(--err)}
button:disabled{opacity:.5;cursor:not-allowed}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:720px){.cols{grid-template-columns:1fr}}
h2{font-size:13px;margin:0 0 10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-weight:650}
ul{list-style:none;margin:0;padding:0}li{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--border)}li:last-child{border-bottom:0}
.muted{color:var(--muted)}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}
label{display:block;font-size:12.5px;color:var(--muted);margin:10px 0 4px}input[type=text],input[type=number]{width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit}
.row{display:flex;gap:10px;align-items:center}.row>*{flex:1}
pre{margin:0;max-height:340px;overflow:auto;background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:11.5px;white-space:pre-wrap;word-break:break-word}
.tabs{display:flex;gap:6px;margin:16px 0 10px}.tabs button.active{border-color:var(--accent);color:var(--accent)}
.hidden{display:none}.toast{position:fixed;bottom:18px;right:18px;background:var(--panel);border:1px solid var(--border);padding:10px 14px;border-radius:10px;opacity:0;transition:opacity .2s}.toast.show{opacity:1}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand"><div class="logo">R</div><div><h1 id="name">RevenueOS Worker</h1><div class="sub" id="meta">Connecting…</div></div></div>
    <span class="pill"><span class="dot" id="dot"></span><span id="state">…</span></span>
  </header>
  <div class="grid">
    <div class="card stat"><div class="k">Status</div><div class="v" id="s-online">—</div></div>
    <div class="card stat"><div class="k">Pending</div><div class="v" id="s-pending">—</div></div>
    <div class="card stat"><div class="k">Rendering</div><div class="v" id="s-rendering">—</div></div>
    <div class="card stat"><div class="k">Today</div><div class="v" id="s-today">—</div></div>
  </div>
  <div class="actions">
    <button class="primary" data-act="open-dashboard">Open Dashboard</button>
    <button id="btn-pause" data-act="pause">Pause</button>
    <button id="btn-resume" data-act="resume">Resume</button>
    <button data-act="open-folder">Open Render Folder</button>
    <button data-tab="settings">Settings</button>
    <button data-tab="logs">Logs</button>
  </div>
  <div class="tabs"><button data-tab="overview" class="active">Overview</button><button data-tab="settings">Settings</button><button data-tab="logs">Logs</button></div>

  <section id="tab-overview">
    <div class="cols">
      <div class="card"><h2>Current jobs</h2><ul id="jobs"><li class="muted">Idle</li></ul></div>
      <div class="card"><h2>Health</h2><ul id="health"><li class="muted">Checking…</li></ul></div>
    </div>
  </section>

  <section id="tab-settings" class="hidden">
    <div class="card">
      <h2>Worker settings</h2>
      <label for="f-name">Worker name</label><input id="f-name" type="text">
      <label for="f-dir">Render folder</label><input id="f-dir" type="text">
      <div class="row">
        <div><label for="f-rc">Parallel renders (recommended 1)</label><input id="f-rc" type="number" min="1" max="4"></div>
        <div><label for="f-ac">Parallel AI tasks</label><input id="f-ac" type="number" min="1" max="8"></div>
      </div>
      <label for="f-dash">Dashboard URL</label><input id="f-dash" type="text">
      <label><input id="f-prev" type="checkbox"> Upload preview copies to cloud storage (uses storage quota)</label>
      <div style="margin-top:14px" class="row"><button class="primary" id="save">Save settings</button><span></span></div>
    </div>
    <div class="card" style="margin-top:12px">
      <h2>Start with this computer</h2>
      <p class="muted" id="startup-desc">Optional. Adds a visible, removable startup entry (Task Manager → Startup apps). Off by default.</p>
      <div class="row"><button id="startup-toggle">…</button><span class="mono muted" id="startup-mech"></span></div>
    </div>
    <div class="card" style="margin-top:12px">
      <h2>Stop worker</h2>
      <p class="muted">Queued jobs stay in the queue and resume when the worker starts again.</p>
      <button class="danger" data-act="shutdown">Quit worker</button>
    </div>
  </section>

  <section id="tab-logs" class="hidden">
    <div class="card"><h2>Recent logs (secrets redacted)</h2><pre id="logs">Loading…</pre><div style="margin-top:10px"><button id="refresh-logs">Refresh</button></div></div>
  </section>
</div>
<div class="toast" id="toast"></div>
<script>
const TOKEN = document.querySelector('meta[name="worker-token"]').content;
const $ = (id) => document.getElementById(id);
let last = null;
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2200)}
async function api(path, opts={}){
  const r = await fetch(path,{...opts,headers:{"x-worker-token":TOKEN,"content-type":"application/json",...(opts.headers||{})}});
  if(!r.ok) throw new Error((await r.json().catch(()=>({error:r.statusText}))).error||r.statusText);
  return r.json();
}
function li(k,v,cls){const e=document.createElement("li");const a=document.createElement("span");a.textContent=k;const b=document.createElement("span");b.textContent=v;if(cls)b.className=cls;e.append(a,b);return e}
function render(s){
  last=s;
  $("name").textContent=s.name;
  $("meta").textContent=s.workerId+" · v"+s.version+" · renders → "+s.config.renderDir;
  const state=!s.databaseOk?"Offline":s.paused?"Paused":"Online";
  $("state").textContent=state;$("dot").className="dot "+(!s.databaseOk?"err":s.paused?"warn":"ok");
  $("s-online").textContent=state;$("s-pending").textContent=s.pending;$("s-rendering").textContent=s.rendering;
  $("s-today").textContent=s.renderedToday+(s.failedToday?" ("+s.failedToday+" failed)":"");
  $("btn-pause").disabled=s.paused;$("btn-resume").disabled=!s.paused;
  const jobs=$("jobs");jobs.replaceChildren();
  if(!s.currentJobs.length) jobs.append(li("Idle","",""));
  for(const j of s.currentJobs){const secs=Math.round((Date.now()-new Date(j.startedAt).getTime())/1000);jobs.append(li(j.type.replace(/_/g," ").toLowerCase(),secs+"s","mono muted"))}
  const h=$("health");h.replaceChildren();
  const hv=s.health||{};
  for(const [k,label] of [["database","Database"],["ffmpeg","FFmpeg"],["renderDir","Render folder"],["ai","Claude / AI"],["storage","Storage"],["node","Node.js"]]){
    const c=hv[k];if(!c)continue;h.append(li(label,(c.ok?"✓ ":"⚠ ")+c.detail,c.ok?"muted":""))
  }
  if(s.lastError) h.append(li("Last error",s.lastError,""));
  if(document.activeElement.tagName!=="INPUT"){
    $("f-name").value=s.config.name;$("f-dir").value=s.config.renderDir;$("f-rc").value=s.config.renderConcurrency;$("f-ac").value=s.config.aiConcurrency;$("f-dash").value=s.config.dashboardUrl;$("f-prev").checked=!!s.config.uploadPreviews;
  }
  $("startup-toggle").textContent=s.startup.enabled?"Disable start with computer":"Enable start with computer";
  $("startup-mech").textContent=s.startup.enabled?s.startup.mechanism:"";
}
async function refresh(){try{render(await api("/api/status"))}catch(e){$("state").textContent="Disconnected";$("dot").className="dot err"}}
async function loadLogs(){try{const r=await api("/api/logs?lines=400");$("logs").textContent=r.lines.join("\\n")||"No logs yet.";const p=$("logs");p.scrollTop=p.scrollHeight}catch(e){$("logs").textContent=String(e.message)}}
function showTab(t){for(const n of ["overview","settings","logs"]){$("tab-"+n).classList.toggle("hidden",n!==t)}document.querySelectorAll(".tabs button").forEach(b=>b.classList.toggle("active",b.dataset.tab===t));if(t==="logs")loadLogs()}
document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>showTab(b.dataset.tab)));
document.querySelectorAll("[data-act]").forEach(b=>b.addEventListener("click",async()=>{
  const act=b.dataset.act;
  if(act==="shutdown"&&!confirm("Quit the worker? Queued jobs will wait until it starts again."))return;
  try{await api("/api/"+act,{method:"POST",body:"{}"});toast(act==="shutdown"?"Worker stopping…":"Done");refresh()}catch(e){toast(e.message)}
}));
$("save").addEventListener("click",async()=>{
  try{await api("/api/settings",{method:"POST",body:JSON.stringify({name:$("f-name").value,renderDir:$("f-dir").value,renderConcurrency:Number($("f-rc").value),aiConcurrency:Number($("f-ac").value),dashboardUrl:$("f-dash").value,uploadPreviews:$("f-prev").checked})});toast("Settings saved");refresh()}catch(e){toast(e.message)}
});
$("startup-toggle").addEventListener("click",async()=>{
  if(!last)return;const enable=!last.startup.enabled;
  if(enable&&!confirm("Start the RevenueOS worker automatically when you sign in to this computer? You can turn this off here or in Task Manager → Startup apps."))return;
  try{await api("/api/startup",{method:"POST",body:JSON.stringify({enabled:enable})});toast(enable?"Enabled":"Disabled");refresh()}catch(e){toast(e.message)}
});
$("refresh-logs").addEventListener("click",loadLogs);
refresh();setInterval(refresh,3000);
</script>
</body>
</html>`;
}
