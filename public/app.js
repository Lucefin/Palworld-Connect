const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = { profiles: [], profileId: '', selectedEndpoint: 'info', editingId: '', players: [], mapEnabled: false, mapAutoUpdate: false, mapUpdateTimer: null };

const catalog = {
  info: { label: 'Server info', method: 'GET', path: '/info', description: 'Server identity and version.' },
  players: { label: 'Players', method: 'GET', path: '/players', description: 'Current player roster.' },
  settings: { label: 'Settings', method: 'GET', path: '/settings', description: 'Active server configuration.' },
  metrics: { label: 'Metrics', method: 'GET', path: '/metrics', description: 'Performance and world counters.' },
  gameData: { label: 'World snapshot', method: 'GET', path: '/game-data', description: 'All actors in the world.' },
  announce: { label: 'Announce', method: 'POST', path: '/announce', description: 'Broadcast to all players.', fields: [{ name:'message', label:'Message', required:true }] },
  kick: { label: 'Kick player', method: 'POST', path: '/kick', description: 'Disconnect a player.', fields: [{ name:'userid', label:'User ID', required:true },{ name:'message', label:'Message' }] },
  ban: { label: 'Ban player', method: 'POST', path: '/ban', description: 'Ban and disconnect a player.', fields: [{ name:'userid', label:'User ID', required:true },{ name:'message', label:'Message' }] },
  unban: { label: 'Unban player', method: 'POST', path: '/unban', description: 'Remove a player ban.', fields: [{ name:'userid', label:'User ID', required:true }] },
  save: { label: 'Save world', method: 'POST', path: '/save', description: 'Persist current world state.' },
  shutdown: { label: 'Shutdown', method: 'POST', path: '/shutdown', description: 'Schedule a graceful shutdown.', fields: [{ name:'waittime', label:'Wait time (seconds)', type:'number', required:true },{ name:'message', label:'Message' }] },
  stop: { label: 'Force stop', method: 'POST', path: '/stop', description: 'Immediately stop the server.' }
};

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const text = await response.text();
  const result = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(result?.error || result?.data || `Request failed (${response.status})`);
  return result;
}
function notify(message, success = false) {
  const el = $('#notice'); el.textContent = message; el.className = `notice${success ? ' success' : ''}`;
  clearTimeout(notify.timer); notify.timer = setTimeout(() => el.classList.add('hidden'), 5000);
}
function activeProfile() { return state.profiles.find(p => p.id === state.profileId); }
function requireProfile() { if (!state.profileId) { notify('Select a server profile first.'); return false; } return true; }
function formatUptime(seconds) { const d=Math.floor(seconds/86400),h=Math.floor(seconds%86400/3600),m=Math.floor(seconds%3600/60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; }
function escapeHtml(value='') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

async function loadProfiles(selectId) {
  state.profiles = await api('/api/profiles');
  $('#profileSelect').innerHTML = '<option value="">Select a server</option>' + state.profiles.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  state.profileId = selectId || (state.profiles.some(p => p.id === state.profileId) ? state.profileId : '');
  $('#profileSelect').value = state.profileId;
  renderProfiles();
}
function renderProfiles() {
  $('#savedProfiles').innerHTML = state.profiles.length ? state.profiles.map(p => `<div class="saved-item"><div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.url)}</small></div><button type="button" data-edit="${p.id}">Edit</button><button type="button" data-delete="${p.id}">Delete</button></div>`).join('') : '<div class="muted">No saved profiles yet.</div>';
}
function clearProfileForm() { state.editingId=''; $('#profileName').value=''; $('#profileUrl').value=''; $('#profileUsername').value=''; $('#profilePassword').value=''; }
async function saveProfile() {
  const payload={name:$('#profileName').value,url:$('#profileUrl').value,username:$('#profileUsername').value};
  if ($('#profilePassword').value || !state.editingId) payload.password=$('#profilePassword').value;
  try {
    const saved=await api(state.editingId?`/api/profiles/${state.editingId}`:'/api/profiles',{method:state.editingId?'PUT':'POST',body:JSON.stringify(payload)});
    await loadProfiles(saved.id); clearProfileForm(); notify('Profile saved.',true);
  } catch(e){notify(e.message)}
}

async function call(action, payload={}) {
  if (!requireProfile()) throw new Error('No server selected');
  const endpoint=catalog[action];
  return api(`/api/palworld/${state.profileId}/${action}`,{method:endpoint.method,body:endpoint.method==='POST'?JSON.stringify(payload):undefined});
}
async function connect() {
  if (!requireProfile()) return;
  $('#connectBtn').disabled=true; $('#connectBtn').textContent='Connecting…';
  try {
    const [info,metrics,players]=await Promise.all([call('info'),call('metrics'),call('players')]);
    renderInfo(info.data); renderMetrics(metrics.data); renderPlayers(players.data?.players||[]);
    $('#statusDot').classList.add('connected'); $('#heroStatus').textContent='ONLINE'; $('#heroStatus').classList.add('online');
    $('#connectBtn').textContent='Refresh'; notify(`Connected to ${info.data.servername}.`,true);
  } catch(e){ $('#statusDot').classList.remove('connected'); $('#heroStatus').textContent='OFFLINE'; notify(e.message); $('#connectBtn').textContent='Connect'; }
  finally{$('#connectBtn').disabled=false}
}
function renderInfo(info={}) { $('#serverName').textContent=info.servername||activeProfile()?.name||'Palworld server'; $('#serverDescription').textContent=info.description||`Server version ${info.version||'unknown'}`; $('#worldGuid').textContent=info.worldguid?`WORLD  ${info.worldguid}`:''; }
function renderMetrics(m={}) { $('#metricPlayers').textContent=m.currentplayernum??'—';$('#metricMax').textContent=`of ${m.maxplayernum??'—'} slots`;$('#metricFps').textContent=m.serverfps??'—';$('#metricFrame').textContent=`${m.serverframetime?.toFixed?.(2)??'—'} ms frame time`;$('#metricUptime').textContent=m.uptime!==undefined?formatUptime(m.uptime):'—';$('#metricDays').textContent=`World day ${m.days??'—'}`;$('#metricCamps').textContent=m.basecampnum??'—'; }
function renderPlayers(players) {
  state.players=players;
  $('#playerList').classList.remove('empty');
  $('#playerList').innerHTML=players.length?`<table><thead><tr><th>Player</th><th>Level</th><th>Ping</th><th>Location</th><th>User ID</th><th>Actions</th></tr></thead><tbody>${players.map(p=>`<tr><td><strong>${escapeHtml(p.name)}</strong><br><small class="muted">${escapeHtml(p.accountName||'')}</small></td><td>${p.level??'—'}</td><td>${p.ping?.toFixed?.(0)??'—'} ms</td><td>${p.location_x?.toFixed?.(0)??'—'}, ${p.location_y?.toFixed?.(0)??'—'}</td><td class="mono">${escapeHtml(p.userId||p.playerId||'')}</td><td class="player-actions"><button data-player-action="kick" data-userid="${escapeHtml(p.userId||'')}">Kick</button><button data-player-action="ban" data-userid="${escapeHtml(p.userId||'')}">Ban</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty">No players are currently online.</div>';
  renderPlayerMap();
}
function renderPlayerMap() {
  const map=$('#playerMap');
  const located=state.players.filter(p=>Number.isFinite(p.location_x)&&Number.isFinite(p.location_y));
  if(!located.length){map.innerHTML='<div class="map-grid" aria-hidden="true"></div><div class="map-origin" aria-hidden="true">0, 0</div><div class="map-empty">No player locations are available.</div>';return}
  const limit=550000;
  map.innerHTML=`<div class="map-grid" aria-hidden="true"></div><div class="map-origin" aria-hidden="true">0, 0</div>${located.map(p=>{
    const left=Math.max(2,Math.min(98,(p.location_x+limit)/(limit*2)*100));
    const top=Math.max(2,Math.min(98,(limit-p.location_y)/(limit*2)*100));
    const name=escapeHtml(p.name||'Unknown player');
    return `<div class="player-marker" style="left:${left}%;top:${top}%" title="${name}: ${p.location_x.toFixed(0)}, ${p.location_y.toFixed(0)}"><span></span><strong>${name}</strong></div>`;
  }).join('')}`;
}
function setMapEnabled(enabled) {
  state.mapEnabled=enabled;
  $('#mapToggle').checked=enabled;
  $('#playerMap').classList.toggle('map-enabled',enabled);
}
async function updateMapPlayers() {
  if(!state.profileId)return;
  try {
    const result=await call('players');
    renderPlayers(result.data?.players||[]);
  } catch(e){notify(`Map update failed: ${e.message}`)}
}
function scheduleMapUpdate() {
  clearTimeout(state.mapUpdateTimer);
  state.mapUpdateTimer=null;
  if(!state.mapAutoUpdate)return;
  state.mapUpdateTimer=setTimeout(async()=>{
    await updateMapPlayers();
    scheduleMapUpdate();
  },10000);
}
function setMapAutoUpdate(enabled) {
  state.mapAutoUpdate=enabled;
  $('#mapAutoUpdateToggle').checked=enabled;
  scheduleMapUpdate();
}
function renderSettings(data={}) { $('#settingsGrid').innerHTML=Object.entries(data).map(([key,val])=>`<div class="card setting"><span>${escapeHtml(key)}</span><strong>${typeof val==='boolean'?(val?'Enabled':'Disabled'):escapeHtml(val)}</strong></div>`).join(''); }
function renderWorld(data={}) { const actors=data.ActorData||[];const chars=actors.filter(a=>a.Type==='Character').length;const boxes=actors.filter(a=>a.Type==='PalBox').length;$('#worldSummary').innerHTML=`<article class="card stat"><span>ACTORS</span><strong>${actors.length}</strong></article><article class="card stat"><span>CHARACTERS</span><strong>${chars}</strong></article><article class="card stat"><span>PAL BOXES</span><strong>${boxes}</strong></article><article class="card stat"><span>SNAPSHOT FPS</span><strong>${data.FPS??'—'}</strong></article>`;$('#worldJson').textContent=JSON.stringify(data,null,2); }

async function refresh(action) { try { const result=await call(action); if(action==='players')renderPlayers(result.data?.players||[]);if(action==='settings')renderSettings(result.data);if(action==='gameData')renderWorld(result.data);notify(`${catalog[action].label} loaded.`,true); } catch(e){notify(e.message)} }
function confirmAction(action,preset={}) { const ep=catalog[action];$('#confirmTitle').textContent=ep.label;$('#confirmText').textContent=action==='stop'?'This immediately terminates the server and may lose unsaved progress.':ep.description;$('#confirmFields').innerHTML=(ep.fields||[]).map(f=>`<label>${f.label}<input name="${f.name}" type="${f.type||'text'}" value="${escapeHtml(preset[f.name]??(f.name==='waittime'?30:''))}" ${f.required?'required':''}></label>`).join('');$('#confirmRun').dataset.action=action;$('#confirmDialog').showModal(); }
async function runConfirmed(event) { event.preventDefault();const action=event.currentTarget.dataset.action;const payload=Object.fromEntries(new FormData($('#confirmFields').closest('form')));try{await call(action,payload);$('#confirmDialog').close();notify(`${catalog[action].label} command accepted.`,true);if(action==='kick'||action==='ban')setTimeout(()=>refresh('players'),700);}catch(e){notify(e.message)} }

function renderConsole() { $('#endpointList').innerHTML=Object.entries(catalog).map(([key,e])=>`<button class="endpoint ${key===state.selectedEndpoint?'active':''}" data-endpoint="${key}"><span>${e.label}</span><span class="method">${e.method}</span></button>`).join(''); const e=catalog[state.selectedEndpoint];$('#endpointMeta').innerHTML=`<p class="eyebrow">${e.method} · /v1/api${e.path}</p><h3>${e.label}</h3><p class="muted">${e.description}</p>`;$('#endpointForm').innerHTML=(e.fields||[]).map(f=>`<label>${f.label}<input name="${f.name}" type="${f.type||'text'}" ${f.required?'required':''}></label>`).join('')+`<button class="primary">Send request</button>`; }

$$('.nav').forEach(btn=>btn.addEventListener('click',()=>{$$('.nav,.view').forEach(x=>x.classList.remove('active'));btn.classList.add('active');$(`#${btn.dataset.view}`).classList.add('active');$('#pageTitle').textContent=btn.textContent.trim();$('.sidebar').classList.remove('open')}));
$('#menu').onclick=()=>$('.sidebar').classList.toggle('open');
$('#profileSelect').onchange=e=>{state.profileId=e.target.value;$('#statusDot').classList.remove('connected')};
$('#connectBtn').onclick=connect;$('#profilesBtn').onclick=()=>$('#profilesDialog').showModal();$('#closeProfiles').onclick=()=>$('#profilesDialog').close();$('#newProfile').onclick=clearProfileForm;$('#saveProfile').onclick=saveProfile;
$('#savedProfiles').onclick=async e=>{const edit=e.target.dataset.edit,del=e.target.dataset.delete;if(edit){const p=state.profiles.find(x=>x.id===edit);state.editingId=edit;$('#profileName').value=p.name;$('#profileUrl').value=p.url;$('#profileUsername').value=p.username;$('#profilePassword').value='';}if(del&&confirm('Delete this server profile?')){await api(`/api/profiles/${del}`,{method:'DELETE'});await loadProfiles();clearProfileForm();}};
$('#announceForm').onsubmit=async e=>{e.preventDefault();try{await call('announce',{message:new FormData(e.target).get('message')});e.target.reset();notify('Announcement broadcast.',true)}catch(err){notify(err.message)}};
$$('[data-action]').forEach(b=>b.onclick=()=>confirmAction(b.dataset.action));$$('[data-refresh]').forEach(b=>b.onclick=()=>refresh(b.dataset.refresh));
$('#playerList').onclick=e=>{if(e.target.dataset.playerAction)confirmAction(e.target.dataset.playerAction,{userid:e.target.dataset.userid})};$('#confirmRun').onclick=runConfirmed;
$('#mapToggle').onchange=e=>setMapEnabled(e.target.checked);
$('#mapAutoUpdateToggle').onchange=e=>setMapAutoUpdate(e.target.checked);
$('#endpointList').onclick=e=>{const b=e.target.closest('[data-endpoint]');if(b){state.selectedEndpoint=b.dataset.endpoint;renderConsole()}};
$('#endpointForm').onsubmit=async e=>{e.preventDefault();try{const result=await call(state.selectedEndpoint,Object.fromEntries(new FormData(e.target)));$('#responseOutput').textContent=JSON.stringify(result,null,2)}catch(err){$('#responseOutput').textContent=err.message}};
$('#copyResponse').onclick=()=>navigator.clipboard.writeText($('#responseOutput').textContent);
renderConsole();renderPlayerMap();loadProfiles().catch(e=>notify(e.message));
