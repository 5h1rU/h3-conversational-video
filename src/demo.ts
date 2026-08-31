import { selectNextClipId, selectRefreshClipId } from "./player-sequence";

export const demoHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>H3 Conversational Video · Prototype</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui;background:#07101f;color:#edf4ff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 30% 0,#193253,#07101f 50%);min-height:100vh}.shell{max-width:1180px;margin:auto;padding:28px}.eyebrow{color:#f6b85f;letter-spacing:.16em;font-size:12px;font-weight:800}.grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(300px,1fr);gap:20px;margin-top:18px}.stage{aspect-ratio:16/9;border:1px solid #36506f;border-radius:22px;overflow:hidden;background:#10192b;position:relative;box-shadow:0 30px 90px #0008}.stage img,.stage video{width:100%;height:100%;object-fit:cover}.stage video{display:none}.badge{position:absolute;top:18px;left:18px;background:#07101fcc;border:1px solid #54708e;padding:8px 11px;border-radius:999px;font-size:12px}.generated{left:auto;right:18px;color:#f6b85f}.caption{position:absolute;left:24px;right:24px;bottom:24px;background:#07101fe8;padding:16px;border-radius:14px;pointer-events:none}.caption b{display:block;color:#f6b85f;margin-bottom:5px}.panel{background:#0d1929cc;border:1px solid #2a405b;border-radius:22px;padding:20px}.status{display:flex;align-items:center;gap:9px;color:#a9bdd4}.dot{width:9px;height:9px;border-radius:50%;background:#58d68d;box-shadow:0 0 14px #58d68d}.timeline{height:300px;overflow:auto;margin:18px 0;display:grid;gap:8px}.clip{border-left:3px solid #49637e;background:#122139;padding:10px 12px;border-radius:8px;font-size:13px}.clip.branch{border-color:#f6b85f;background:#2b251b}.clip.reentry{border-color:#70b7ff}.clip.active{outline:2px solid #fff}.ask{display:flex;gap:8px}.ask input{flex:1;background:#091320;border:1px solid #3c5774;border-radius:10px;color:white;padding:12px}.ask button{border:0;border-radius:10px;background:#f6b85f;color:#15100a;font-weight:800;padding:0 16px;cursor:pointer}.meta{font-size:12px;color:#8fa6bf;margin-top:12px}@media(max-width:850px){.grid{grid-template-columns:1fr}.shell{padding:16px}}
  </style>
</head>
<body><main class="shell"><div class="eyebrow">H3 CONVERSATIONAL VIDEO · WORKING VERTICAL SLICE</div><h1>The Signal Room</h1><div class="grid"><section><div class="stage"><img id="visual" alt="Current program clip"/><video id="generated-video" controls muted playsinline aria-label="Generated private branch"></video><div class="badge">LIVE · 20s BUFFER</div><div class="badge generated" id="generated">SHARED PROGRAM</div><div class="caption"><b id="speaker">Mara Vale</b><span id="title">Starting the canonical program…</span></div></div></section><aside class="panel"><div class="status"><span class="dot"></span><span id="status">Creating private session…</span></div><div class="timeline" id="timeline"></div><form class="ask" id="ask"><input id="question" maxlength="500" placeholder="Ask the panel a question" required/><button>Ask</button></form><div class="meta" id="meta"></div></aside></div></main>
<script>
${selectRefreshClipId.toString()}
${selectNextClipId.toString()}
let sessionId,playlist={revision:1,entries:[]},currentClipId=null,playbackTimer=null,refreshPromise=null;
const completedBranchIds=new Set();
const q=s=>document.querySelector(s);const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,options){const r=await fetch(path,options);const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'Request failed');return j}
function currentIndex(){return Math.max(0,playlist.entries.findIndex(entry=>entry.id===currentClipId))}
function renderList(){const index=currentIndex();q('#timeline').innerHTML=playlist.entries.slice(Math.max(0,index-2),index+10).map(c=>'<div class="clip '+c.source+' '+(c.id===currentClipId?'active':'')+'"><b>'+escapeHtml(c.source.toUpperCase())+'</b> · '+escapeHtml(c.title)+'</div>').join('');q('#meta').textContent='Session '+sessionId.slice(0,8)+' · playlist r'+playlist.revision+' · '+playlist.entries.length+' committed clips'}
function transitionTo(clipId){if(!clipId||clipId===currentClipId){renderList();return}const clip=playlist.entries.find(entry=>entry.id===clipId);if(!clip)return;if(playbackTimer!==null){clearTimeout(playbackTimer);playbackTimer=null}const image=q('#visual'),video=q('#generated-video');currentClipId=clip.id;if(clip.source==='branch'){image.style.display='none';video.style.display='block';if(video.getAttribute('src')!==clip.mediaUrl){video.src=clip.mediaUrl;video.currentTime=0}video.play().catch(()=>{q('#status').textContent='Generated branch ready — press play'})}else{video.pause();video.style.display='none';image.style.display='block';image.src=clip.mediaUrl;playbackTimer=setTimeout(advance,clip.durationMs)}q('#speaker').textContent=clip.speaker;q('#title').textContent=clip.title;q('#generated').textContent=clip.source==='branch'?'PRIVATE GENERATED BRANCH':clip.source==='reentry'?'AUTOMATIC RE-ENTRY':'SHARED PROGRAM';renderList()}
function advance(){const clip=playlist.entries.find(entry=>entry.id===currentClipId);if(!clip)return;if(clip.source==='branch')completedBranchIds.add(clip.id);transitionTo(selectNextClipId(playlist.entries,clip.id))}
function refresh(){if(refreshPromise)return refreshPromise;refreshPromise=api('/v1/sessions/'+sessionId+'/playlist').then(next=>{playlist=next;const selected=selectRefreshClipId(playlist.entries,currentClipId,completedBranchIds);if(selected!==currentClipId)transitionTo(selected);else renderList()}).finally(()=>{refreshPromise=null});return refreshPromise}
async function boot(){const parts=location.pathname.split('/');const restored=parts.length===3&&parts[1]==='s'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parts[2])?parts[2]:null;if(restored){sessionId=restored;const state=await api('/v1/sessions/'+sessionId+'/state');await refresh();q('#status').textContent=state.branchPhase==='ready'?'Generated branch ready to play':'Branch: '+state.branchPhase}else{const created=await api('/v1/sessions',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});sessionId=created.sessionId;q('#status').textContent='Canonical playback is continuous';await refresh()}setInterval(()=>{refresh().catch(error=>{q('#status').textContent=error.message})},2000);try{const protocol=location.protocol==='https:'?'wss:':'ws:';const ws=new WebSocket(protocol+'//'+location.host+'/v1/sessions/'+sessionId+'/ws');ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='playlist.revised')refresh().catch(error=>{q('#status').textContent=error.message});q('#status').textContent='Branch: '+m.state.branchPhase}}catch{}}
q('#generated-video').addEventListener('ended',()=>{const clip=playlist.entries.find(entry=>entry.id===currentClipId);if(clip?.source==='branch')advance()});
q('#ask').addEventListener('submit',async e=>{e.preventDefault();const input=q('#question');q('#status').textContent='Planning private response…';try{const result=await api('/v1/sessions/'+sessionId+'/events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({eventId:crypto.randomUUID(),text:input.value,playbackPositionMs:currentIndex()*5000,playlistRevision:playlist.revision})});q('#status').textContent='Branch: '+result.state.branchPhase;input.value=''}catch(error){q('#status').textContent=error.message}});boot().catch(e=>q('#status').textContent=e.message);
</script></body></html>`;

export function fixtureSvg(name: string): string {
  const palette = [
    "#13243d",
    "#172e4b",
    "#1c3551",
    "#12293d",
    "#20314c",
    "#17283e",
    "#1b3047",
    "#10253b",
  ];
  const index = Number.parseInt(name, 10);
  const background =
    palette[Number.isFinite(index) ? index % palette.length : 0] ?? palette[0];
  const reentry = name === "reentry";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="${background}"/><circle cx="320" cy="310" r="120" fill="#f6b85f" opacity=".22"/><circle cx="930" cy="310" r="120" fill="#70b7ff" opacity=".2"/><rect x="190" y="430" width="900" height="18" rx="9" fill="#56708c"/><text x="64" y="90" fill="#f6b85f" font-family="system-ui" font-size="26">THE SIGNAL ROOM · ${reentry ? "SEMANTIC RE-ENTRY" : "CANONICAL SHOW"}</text><text x="64" y="650" fill="#a9bdd4" font-family="system-ui" font-size="22">Local deterministic media-packaging simulator</text></svg>`;
}
