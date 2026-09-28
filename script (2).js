const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const H=36e5;
const fmt=t=>new Date(t).toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
const fmtS=t=>new Date(t).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
function dur(ms){ms=Math.abs(ms);const m=Math.round(ms/6e4);if(m<60)return m+' min';const h=Math.floor(m/60);return h<48?h+' h '+(m%60)+' min':Math.round(h/24)+' days'}
const TYPES=['Laptop','Chromebook','Tablet / iPad','Phone','Camera','Drone','Microphone / Audio','Projector / Display','Robotics controller','Microcontroller / dev board','Lab instrument','Calculator','Charger / Accessory','Other electronic device'];
$('#rType').innerHTML='<option value="" disabled selected>Choose…</option>'+TYPES.map(t=>`<option>${t}</option>`).join('');

/* ---------- state (starts empty) ---------- */
function norm(s){s=s&&typeof s==='object'?s:{};s.assets||=[];s.students||={};s.loans||=[];s.audit||=[];s.users||=[];s.seq||=0;s.settings||={};s.settings.strikeLimit||=3;delete s.pin;return s}
function load(){try{return JSON.parse(localStorage.getItem('tagout-v1'))}catch{return null}}
let S=norm(load());
let dbDoc=null;
let lastList=[];
$('#statsCard').addEventListener('click',e=>{
  if(e.target.id!=='saveStrike'||me()?.role!=='admin')return;
  const v=parseInt($('#strikeLimit').value,10);
  if(!v||v<1){toast('Enter a number of at least 1.');return}
  S.settings.strikeLimit=v;log('Setting changed','','Strike limit → '+v);save();toast('Saved.');
});
function save(){
  try{localStorage.setItem('tagout-v1',JSON.stringify(S))}catch{}
  if(dbDoc)dbDoc.set({json:JSON.stringify(S)}).catch(()=>toast('Saved on this device only. Shared storage refused the write.'));
}
const me=()=>S.users.find(u=>u.id===cur&&u.active)||null;
const byName=()=>me()?.name||'';
function log(action,tag,note){S.audit.push({t:Date.now(),action,tag:tag||'',by:byName(),note:note||''});if(S.audit.length>1000)S.audit.shift()}
const asset=id=>S.assets.find(a=>a.tag===id);
const openLoan=id=>S.loans.find(l=>l.tag===id&&!l.ret);
const userById=id=>S.users.find(u=>u.id===id);
const who=id=>userById(id)?.name||S.students[id]||id;
const name=a=>a?`${a.make} ${a.model}`:'(removed)';
function status(l){if(l.ret)return'in';const d=l.due-Date.now();return d<0?'overdue':d<24*H?'soon':'out'}
const label={in:'Returned',out:'Checked out',soon:'Due soon',overdue:'Overdue'};
function aStatus(a){if(a.status!=='available')return a.status;return openLoan(a.tag)?'out':'available'}
const aLabel={available:'Available',out:'Checked out',repair:'In repair',retired:'Retired'};
const aCls={available:'in',out:'out',repair:'repair',retired:'retired'};
const lateCount=uid=>{const after=userById(uid)?.resetAt||0;return S.loans.filter(l=>l.student===uid&&l.ret&&l.ret>l.due&&l.ret>after).length};
function toast(t){const e=$('#toast');e.textContent=t;e.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>e.style.display='none',4000)}

/* ---------- passwords: salted PBKDF2 ---------- */
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const unhex=h=>new Uint8Array(h.match(/../g).map(x=>parseInt(x,16)));
async function kdf(pw,salt){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(salt),iterations:150000,hash:'SHA-256'},k,256))}
async function makeCred(pw){const salt=hex(crypto.getRandomValues(new Uint8Array(16)));return{salt,hash:await kdf(pw,salt)}}

/* ---------- serial validation ---------- */
function checkSerial(raw){
  const s=String(raw).trim().toUpperCase().replace(/\s+/g,'');
  if(s.length<6||s.length>32)return{err:'Serial numbers are 6–32 characters. Copy it from the device.'};
  if(!/^[A-Z0-9][A-Z0-9\-_.\/]*$/.test(s))return{err:'Serial may only contain letters, numbers and - _ . /'};
  const f=s.replace(/[^A-Z0-9]/g,'');
  if(new Set(f).size<4||'0123456789'.includes(f)||'9876543210'.includes(f)||'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.includes(f)||/^(NA|NONE|NULL|TEST|TESTING|UNKNOWN|SERIAL|SERIALNUMBER|TBD|FAKE|SAMPLE|DEMO|PLACEHOLDER|ASDF|QWERTY|XXXX)/.test(f))
    return{err:'That looks like a placeholder, not a real serial number.'};
  const dup=S.assets.find(a=>a.serial===s);
  if(dup)return{err:`Serial already registered as ${dup.tag} (${name(dup)}).`};
  return{ok:s};
}

/* ---------- camera helper ---------- */
function makeCam(rid,bid,onCode){
  let c=null;const rd=()=>$('#'+rid),bt=()=>$('#'+bid);
  async function stop(){if(c){try{await c.stop();c.clear()}catch{}c=null}if(rd())rd().hidden=true;if(bt())bt().textContent='Use camera'}
  async function toggle(){
    if(c)return stop();
    if(typeof Html5Qrcode==='undefined'){toast('Camera scanner library did not load. Use the text field.');return}
    rd().hidden=false;c=new Html5Qrcode(rid);let lc='',lt=0;
    try{await c.start({facingMode:'environment'},{fps:10,qrbox:{width:220,height:220}},t=>{const n=Date.now();if(t===lc&&n-lt<2500)return;lc=t;lt=n;onCode(t)});bt().textContent='Stop camera'}
    catch{c=null;rd().hidden=true;toast('Camera unavailable here. Open the page directly in a browser, or use a USB scanner.')}
  }
  return{toggle,stop};
}

/* ---------- session + login ---------- */
let cur=null,ready=false,mode='badge',tab='scan',last=Date.now(),fails=0,lockUntil=0,loginKey='',loginCam=null;
try{cur=sessionStorage.getItem('tagout-sess')}catch{}
['click','keydown','pointerdown'].forEach(ev=>document.addEventListener(ev,()=>last=Date.now(),true));
setInterval(()=>{const u=me();if(u&&Date.now()-last>(u.role==='student'?3:10)*6e4)logout('Signed out after inactivity.')},10000);

function startSession(u){if(loginCam){loginCam.stop();loginCam=null}cur=u.id;try{sessionStorage.setItem('tagout-sess',cur)}catch{}last=Date.now();tab=u.role==='student'?'mine':'scan';F={item:null,hours:null,returning:null,issue:false,msg:null};loginKey='';route();renderAll()}
function logout(msg){cur=null;try{sessionStorage.removeItem('tagout-sess')}catch{}scanCam.stop();loginKey='';route();if(msg)toast(msg)}
const ROLES={admin:['scan','log','admin'],staff:['scan','log'],student:['scan','mine']};
const TABN={scan:'Scan',log:'Log',admin:'Admin',mine:'My gear'};

function route(){
  const u=me();
  $('#login').hidden=!!u||false;$('#app').hidden=!u;
  if(!u){renderLogin();$('#who').innerHTML='';return}
  $('#login').hidden=true;
  const tabs=ROLES[u.role];if(!tabs.includes(tab))tab=tabs[0];
  $('#nav').innerHTML=tabs.map(t=>`<button role="tab" data-t="${t}" aria-selected="${t===tab}">${TABN[t]}</button>`).join('');
  tabs.concat(['scan','log','mine','admin']).forEach(k=>$('#'+k).hidden=k!==tab);
  const bell=(typeof Notification!=='undefined'&&Notification.permission==='default')?`<button class="b bell" id="bell" title="Get a desktop alert when your gear is due">🔔 Alerts</button>`:'';
  $('#who').innerHTML=`${bell}<span class="sub">${esc(u.name)} · ${u.role}</span><button class="b" id="out" style="padding:6px 12px">Sign out</button>`;
  if(tab==='scan')$('#scanIn').focus();
}
$('#who').addEventListener('click',e=>{
  if(e.target.id==='out')logout();
  if(e.target.id==='bell')Notification.requestPermission().then(()=>route());
});
$('#nav').addEventListener('click',e=>{const b=e.target.closest('button');if(b){if(tab==='scan'&&b.dataset.t!=='scan')scanCam.stop();tab=b.dataset.t;route()}});

function renderLogin(){
  const key=`${ready}|${S.users.length}|${mode}`;if(key===loginKey)return;loginKey=key;
  if(loginCam)loginCam.stop();loginCam=null;
  const L=$('#login');
  if(!ready){L.innerHTML='<div class="card sub">Loading…</div>';return}
  if(!S.users.length){
    L.innerHTML=`<form class="card stack" id="setupForm" autocomplete="off"><h2>Create the first admin account</h2><div class="sub">Do this before sharing the link. This account can register devices and add everyone else.</div>
    <label>Full name<input id="sName" required maxlength="60"></label><label>Username<input id="sUser" class="mono" required maxlength="24"></label>
    <label>Password (8+ characters)<input id="sPw" type="password" required minlength="8" autocomplete="new-password"></label><label>Repeat password<input id="sPw2" type="password" required autocomplete="new-password"></label>
    <div class="err" id="lErr"></div><button class="b p">Create admin &amp; sign in</button></form>`;return}
  L.innerHTML=`<div class="card stack"><h2>Sign in</h2>
  <div class="row"><button class="b ${mode==='badge'?'on':''}" data-mode="badge">Scan ID / badge</button><button class="b ${mode==='pw'?'on':''}" data-mode="pw">Username &amp; password</button></div>
  ${mode==='badge'?`<form id="badgeForm" class="row" autocomplete="off"><input id="badgeIn" placeholder="Scan your card" aria-label="Badge"><button class="b p">Sign in</button><button type="button" class="b" id="lcamBtn">Use camera</button></form><div id="lreader" class="reader" hidden></div><div class="sub">Students and staff can sign in by scanning their ID card or QR badge. Admins must use a password.</div>`
  :`<form id="pwForm" class="stack" autocomplete="on"><label>Username<input id="pUser" class="mono" autocomplete="username" required></label><label>Password<input id="pPw" type="password" autocomplete="current-password" required></label><button class="b p">Sign in</button></form>`}
  <div class="err" id="lErr"></div></div>`;
  if(mode==='badge'){loginCam=makeCam('lreader','lcamBtn',badgeLogin);$('#badgeIn').focus()}
}
$('#login').addEventListener('click',e=>{
  const m=e.target.closest('[data-mode]');if(m){mode=m.dataset.mode;renderLogin();return}
  if(e.target.id==='lcamBtn'&&loginCam)loginCam.toggle();
});
function lerr(t){const e=$('#lErr');if(e)e.textContent=t}
function badgeLogin(code){
  if(Date.now()<lockUntil){lerr('Too many attempts. Wait a minute.');return}
  const u=S.users.find(x=>x.active&&x.badge&&x.badge===String(code).trim().toUpperCase());
  if(!u){if(++fails>=5){lockUntil=Date.now()+6e4;fails=0}lerr('That card isn\'t registered or is deactivated. See an admin.');return}
  if(u.role==='admin'){lerr('Admin accounts must sign in with username and password.');return}
  fails=0;cur=u.id;log('Signed in (badge)');save();startSession(u);
}
$('#login').addEventListener('submit',async e=>{
  e.preventDefault();
  if(e.target.id==='badgeForm'){const v=$('#badgeIn').value;$('#badgeIn').value='';badgeLogin(v)}
  else if(e.target.id==='pwForm'){
    if(Date.now()<lockUntil){lerr('Too many attempts. Wait a minute.');return}
    const un=$('#pUser').value.trim().toLowerCase(),pw=$('#pPw').value;
    const u=S.users.find(x=>x.active&&x.username&&x.username===un);
    let ok=false;if(u&&u.hash)ok=(await kdf(pw,u.salt))===u.hash;
    if(!ok){if(++fails>=5){lockUntil=Date.now()+6e4;fails=0}lerr('Wrong username or password.');return}
    fails=0;cur=u.id;log('Signed in (password)');save();startSession(u);
  }else if(e.target.id==='setupForm'){
    if(S.users.length)return;
    const pw=$('#sPw').value,un=$('#sUser').value.trim().toLowerCase();
    if(!/^[a-z0-9._-]{3,24}$/.test(un)){lerr('Username: 3–24 letters, numbers, . _ -');return}
    if(pw.length<8){lerr('Password must be at least 8 characters.');return}
    if(pw!==$('#sPw2').value){lerr('Passwords don\'t match.');return}
    const c=await makeCred(pw);
    const u={id:'U'+Date.now(),name:$('#sName').value.trim(),role:'admin',username:un,badge:'',...c,active:true,created:Date.now()};
    S.users.push(u);cur=u.id;log('Admin account created','',u.name);save();startSession(u);
  }
});

/* ---------- scan flow (staff/admin scan an ID; students check out to themselves) ---------- */
let F={item:null,hours:null,msg:null};
function handle(raw){
  const code=String(raw).trim();if(!code||!me())return;last=Date.now();
  const u=me(),U=code.toUpperCase().replace(/\s+/g,'');
  const a=S.assets.find(x=>x.tag===U||x.serial===U);
  if(a){F={item:a,hours:a.hours,msg:null};renderFlow();return}
  if(!F.item){toast(`"${code.slice(0,30)}" isn't a registered device. Ask an admin to register it.`);return}
  if(u.role==='student')return; // students never scan a second code — they check out to their own signed-in account
  if(F.item.status!=='available'){toast(`This device is ${aLabel[F.item.status].toLowerCase()} and can't be checked out.`);return}
  if(openLoan(F.item.tag)){toast('That device is already out. Use "Return now".');return}
  const su=S.users.find(x=>x.active&&x.badge&&x.badge===U);
  if(!su){toast('That ID card isn\'t registered. Ask an admin to add the person.');return}
  checkout(su);
}
function checkout(u,silent){
  const a=F.item,now=Date.now(),due=now+F.hours*H;
  S.loans.push({id:'L'+now,tag:a.tag,student:u.id,out:now,due,ret:null,by:byName()});
  log('Checked out',a.tag,`to ${u.name}, due ${fmtS(due)}`);save();
  F={item:null,hours:null,returning:null,issue:false,msg:silent?null:`${name(a)} checked out to ${u.name}. Due back ${fmtS(due)}.`};
  renderAll();
  if(silent)toast(`Done — due back ${fmtS(due)}`);
}
function doReturn(tag,issue,note){
  const l=openLoan(tag),u=me();if(!l||!u)return;
  if(u.role==='student'&&l.student!==cur)return; // students can only return their own gear
  l.ret=Date.now();const late=l.ret>l.due;
  if(issue){const a=asset(tag);if(a){a.status='repair';a.notes=(a.notes?a.notes+' · ':'')+`Reported at return by ${who(l.student)}: ${note||'no details given'}`}}
  log('Returned',tag,`by ${who(l.student)}, ${late?dur(l.ret-l.due)+' late':'on time'}${issue?' — flagged for repair':''}`);save();
  F={item:null,hours:null,returning:null,issue:false,msg:`${name(asset(tag))} returned by ${who(l.student)}${late?' ('+dur(l.ret-l.due)+' late)':' on time'}.${issue?' Flagged for repair — an admin will follow up.':''}`};renderAll();
}
function renderFlow(){
  const u=me();if(!u)return;
  let h='';
  if(F.msg)h+=`<div class="ok">${esc(F.msg)}</div>`;
  if(!F.item){
    h+=S.assets.length?`<div class="card"><div class="step"><b>1</b> Scan a device's tag to check it out or return it</div></div>`
      :`<div class="card"><b>No devices registered yet.</b><div class="sub">An admin needs to register equipment (Admin tab) before anything can be scanned.</div></div>`;
  }else{
    const a=F.item,l=openLoan(a.tag);
    h+=`<div class="card"><div class="mono sub">${esc(a.tag)} · ${esc(a.type)} · S/N ${esc(a.serial)}</div><div class="flow-item">${esc(name(a))}</div>`;
    if(l){const s=status(l);
      if(u.role==='student'&&l.student!==cur){
        h+=`<p><span class="pill s-out">Checked out</span> This device isn't available right now.</p><button class="b" data-cancel>Cancel</button>`;
      }else if(F.returning===a.tag){
        if(F.issue){
          h+=`<p>What's wrong with it? This note goes straight to the admin.</p><div class="row"><input id="retNote" placeholder="e.g. cracked screen, won't power on" style="flex:1"><button class="b p" data-confirmret="${esc(a.tag)}|issue">Confirm — needs repair</button><button class="b" data-cancel>Cancel</button></div>`;
        }else{
          h+=`<p>Is everything okay with this item?</p><div class="row"><button class="b p" data-confirmret="${esc(a.tag)}|ok">Yes, all good</button><button class="b" style="color:var(--bad)" data-reportissue="${esc(a.tag)}">Report a problem</button><button class="b" data-cancel>Cancel</button></div>`;
        }
      }else{
        h+=`<p>With <b>${esc(who(l.student))}</b> since ${fmtS(l.out)}. Due ${fmtS(l.due)} <span class="pill s-${s}">${label[s]}</span></p><div class="row"><button class="b p" data-startret="${esc(a.tag)}">Return now</button><button class="b" data-cancel>Cancel</button></div>`;
      }
    }else if(a.status!=='available'){
      h+=`<p><span class="pill s-${aCls[a.status]}">${aLabel[a.status]}</span> This device can't be lent out.</p><button class="b" data-cancel>Cancel</button>`;
    }else if(u.role==='student'){
      const lc=lateCount(cur);
      if(lc>=S.settings.strikeLimit){
        h+=`<p><span class="pill s-overdue">Checkout paused</span> You have ${lc} late returns on record. See a staff member to check this out.</p><button class="b" data-cancel>Cancel</button>`;
      }else{
        const due=Date.now()+a.hours*H;
        h+=`<p>Available now. Standard loan for this item: ${a.hours>=24?(a.hours/24)+' day(s)':a.hours+' hour(s)'} — due back ${fmtS(due)}.</p>
        <div class="row"><button class="b p" data-selfout="${esc(a.tag)}">Check out to me</button><button class="b" data-cancel>Cancel</button></div>`;
      }
    }else{
      const opts=[[1/60,'Test: 1 minute'],[4,'4 hours'],[8,'8 hours'],[24,'1 day'],[72,'3 days'],[168,'1 week']];
      if(!opts.some(o=>o[0]===F.hours))opts.push([F.hours,F.hours+' hours']);
      h+=`<div class="step"><b>2</b> Scan the borrower's ID card</div><div class="row" style="margin-top:10px"><label class="sub" for="dueSel">Return within</label>
      <select id="dueSel">${opts.map(o=>`<option value="${o[0]}"${o[0]===F.hours?' selected':''}>${o[1]}</option>`).join('')}</select><button class="b" data-cancel>Cancel</button></div>`;
    }
    h+='</div>';
  }
  $('#flow').innerHTML=h;
  const rn=$('#retNote');if(rn)rn.focus();else $('#scanIn').focus();
}
$('#flow').addEventListener('click',e=>{
  const sr=e.target.closest('[data-startret]');if(sr){F.returning=sr.dataset.startret;F.issue=false;renderFlow();return}
  const ri=e.target.closest('[data-reportissue]');if(ri){F.issue=true;renderFlow();return}
  const cr=e.target.closest('[data-confirmret]');if(cr){const[tag,kind]=cr.dataset.confirmret.split('|');doReturn(tag,kind==='issue',($('#retNote')?.value||'').trim());return}
  const so=e.target.closest('[data-selfout]');if(so&&me()?.role==='student')checkout(me(),true);
  if(e.target.closest('[data-cancel]')){F={item:null,hours:null,returning:null,issue:false,msg:null};renderFlow()}
});
$('#flow').addEventListener('change',e=>{if(e.target.id==='dueSel')F.hours=parseFloat(e.target.value)});
$('#scanForm').addEventListener('submit',e=>{e.preventDefault();const v=$('#scanIn').value;$('#scanIn').value='';handle(v)});
const scanCam=makeCam('reader','camBtn',handle);
$('#camBtn').onclick=scanCam.toggle;

/* ---------- log, my gear, alerts ---------- */
function renderLog(){
  const q=$('#logQ').value.trim().toUpperCase();
  const rows=[...S.loans].filter(l=>{
    if(!q)return true;
    const a=asset(l.tag);
    return [name(a),l.tag,a?.serial,who(l.student)].join(' ').toUpperCase().includes(q);
  }).sort((a,b)=>b.out-a.out).map(l=>{
    const s=status(l),a=asset(l.tag),u=userById(l.student);
    return `<tr><td>${esc(name(a))}<br><span class="sub mono">${esc(l.tag)} · ${esc(a?.serial)}</span></td><td>${esc(who(l.student))}<br><span class="sub mono">${esc(u?.badge)}</span></td><td>${fmtS(l.out)}</td><td>${fmtS(l.due)}</td>
    <td><span class="pill s-${s}">${label[s]}</span></td><td>${l.ret?fmtS(l.ret):`<button class="b" style="padding:4px 10px" data-ret="${esc(l.tag)}">Return</button>`}</td></tr>`}).join('');
  $('#logList').innerHTML=rows?`<table><thead><tr><th>Device</th><th>Borrower</th><th>Out</th><th>Due</th><th>Status</th><th>Returned</th></tr></thead><tbody>${rows}</tbody></table>`:`<p class="sub">${S.loans.length?'No checkouts match.':'No checkouts yet. Every scan is logged here.'}</p>`;
}
$('#logQ').oninput=renderLog;
$('#logList').addEventListener('click',e=>{const r=e.target.closest('[data-ret]');if(r)doReturn(r.dataset.ret)});
function renderMine(){
  const u=me();if(!u)return;
  const mine=S.loans.filter(l=>l.student===u.id).sort((a,b)=>b.out-a.out),lc=lateCount(u.id);
  $('#mineList').innerHTML=`<h2>Hi ${esc(u.name.split(' ')[0])}. Here's your gear.</h2>${lc?`<p class="sub">You have ${lc} late return${lc>1?'s':''} on record.${lc>=S.settings.strikeLimit?' Self-checkout is paused — see a staff member to borrow more.':''}</p>`:''}`+
    (mine.length?`<table><thead><tr><th>Device</th><th>Out</th><th>Due</th><th>Status</th></tr></thead><tbody>${mine.map(l=>{const s=status(l);return `<tr><td>${esc(name(asset(l.tag)))}<br><span class="sub mono">${esc(l.tag)}</span></td><td>${fmtS(l.out)}</td><td>${fmtS(l.due)}</td><td><span class="pill s-${s}">${label[s]}</span>${l.ret?' <span class="sub">'+fmtS(l.ret)+'</span>':''}</td></tr>`}).join('')}</tbody></table>`:'<p class="sub">You have nothing checked out.</p>');
}
const notified=new Set();
function renderAlerts(){
  const u=me();if(!u)return;
  const open=S.loans.filter(l=>!l.ret&&(u.role!=='student'||l.student===u.id)),od=open.filter(l=>status(l)==='overdue'),so=open.filter(l=>status(l)==='soon');
  const line=l=>`${esc(name(asset(l.tag)))}${u.role==='student'?'':': '+esc(who(l.student))}, ${l.due<Date.now()?dur(Date.now()-l.due)+' overdue':'due in '+dur(l.due-Date.now())}`;
  let h='';
  if(od.length)h+=`<div class="a-bad">${od.length} overdue device${od.length>1?'s':''}<small>${od.map(line).join('<br>')}</small></div>`;
  if(so.length)h+=`<div class="a-soon">${so.length} due within 24 hours<small>${so.map(line).join('<br>')}</small></div>`;
  $('#alerts').innerHTML=h;document.title=(od.length?`(${od.length}) `:'')+'Tag Out';
  if(typeof Notification!=='undefined'&&Notification.permission==='granted'){
    [...od,...so].forEach(l=>{
      const key=l.id+status(l);if(notified.has(key))return;notified.add(key);
      try{new Notification('Tag Out',{body:`${name(asset(l.tag))} ${status(l)==='overdue'?'is overdue':'is due within 24 hours'}${u.role==='student'?'.':' — '+who(l.student)+'.'}`})}catch{}
    });
  }
}

/* ---------- admin: devices ---------- */
$('#regForm').addEventListener('submit',e=>{
  e.preventDefault();if(me()?.role!=='admin')return;
  const r=checkSerial($('#rSerial').value),er=$('#rErr');
  if(r.err){er.textContent=r.err;$('#rSerial').focus();return}
  er.textContent='';
  const tag='TAG-'+String(++S.seq).padStart(5,'0');
  const a={tag,type:$('#rType').value,make:$('#rMake').value.trim(),model:$('#rModel').value.trim(),serial:r.ok,cond:$('#rCond').value,hours:+$('#rHrs').value,status:'available',regAt:Date.now(),regBy:byName(),notes:$('#rNotes').value.trim()};
  S.assets.push(a);log('Registered',tag,`${a.type} ${name(a)} S/N ${a.serial}`);save();
  e.target.reset();toast(`Registered as ${tag}. Print its QR label from the registry.`);renderAll(false);
});
function renderAdmin(){
  if(me()?.role!=='admin')return;
  const total=S.assets.length,avail=S.assets.filter(a=>aStatus(a)==='available').length,out=S.assets.filter(a=>aStatus(a)==='out').length,rep=S.assets.filter(a=>aStatus(a)==='repair').length,ret=S.assets.filter(a=>aStatus(a)==='retired').length;
  const overdue=S.loans.filter(l=>!l.ret&&status(l)==='overdue').length;
  const counts={};S.loans.forEach(l=>counts[l.tag]=(counts[l.tag]||0)+1);
  let topTag='',topN=0;Object.entries(counts).forEach(([t,n])=>{if(n>topN){topN=n;topTag=t}});
  $('#statsCard').innerHTML=`<h2>Overview</h2><div class="stats">
    <div class="stat"><b>${total}</b><span>Devices</span></div><div class="stat"><b>${avail}</b><span>Available</span></div>
    <div class="stat"><b>${out}</b><span>Checked out</span></div><div class="stat"><b>${rep}</b><span>In repair</span></div>
    <div class="stat"><b>${ret}</b><span>Retired</span></div><div class="stat"><b>${overdue}</b><span>Overdue</span></div>
    <div class="stat wide"><span class="sub">Most borrowed:</span><b style="font-size:15px">${topTag?esc(name(asset(topTag)))+' · '+topN+'×':'—'}</b></div>
  </div>
  <div class="row" style="margin-top:10px"><label class="sub" for="strikeLimit">Pause student self-checkout after</label><input id="strikeLimit" type="number" min="1" max="20" style="width:70px" value="${S.settings.strikeLimit}"><span class="sub">late return(s)</span><button class="b" id="saveStrike">Save</button></div>`;
  const q=$('#q').value.trim().toUpperCase(),fs=$('#fSt').value;
  const list=S.assets.filter(a=>(!fs||aStatus(a)===fs)&&(!q||[a.tag,a.serial,a.make,a.model,a.type].join(' ').toUpperCase().includes(q)));
  lastList=list;
  $('#regCount').textContent=`(${list.length} of ${S.assets.length})`;
  $('#regList').innerHTML=list.length?`<table><thead><tr><th>Label</th><th>Tag</th><th>Device</th><th>Serial</th><th>Condition</th><th>Registered</th><th>Status</th><th></th></tr></thead><tbody>${list.map(a=>{const s=aStatus(a);
    return `<tr><td><div class="qr" data-qr="${esc(a.tag)}"></div></td><td class="mono">${esc(a.tag)}</td><td>${esc(name(a))}<br><span class="sub">${esc(a.type)}${a.notes?' · '+esc(a.notes):''}</span></td><td class="mono">${esc(a.serial)}</td><td>${esc(a.cond)}</td>
    <td>${fmt(a.regAt)}<br><span class="sub">by ${esc(a.regBy)}</span></td><td><span class="pill s-${aCls[s]}">${aLabel[s]}</span></td>
    <td>${s==='out'?'':`<select data-st="${esc(a.tag)}" aria-label="Change status"><option value="">Set status…</option>${['available','repair','retired'].filter(x=>x!==a.status).map(x=>`<option value="${x}">${aLabel[x]}</option>`).join('')}</select>`}</td></tr>`}).join('')}</tbody></table>`
    :`<p class="sub">${S.assets.length?'No devices match.':'Nothing registered yet. Use the form above to add the first device.'}</p>`;
  $('#userCount').textContent=`(${S.users.length})`;
  $('#userList').innerHTML=`<table><thead><tr><th>QR</th><th>Name</th><th>Role</th><th>Username</th><th>Badge / ID</th><th>Late returns</th><th>Status</th><th></th></tr></thead><tbody>${S.users.map(u=>{const lc=lateCount(u.id);return `<tr><td>${u.badge?`<div class="qr" data-qr="${esc(u.badge)}"></div>`:''}</td><td>${esc(u.name)}</td><td>${u.role}</td><td class="mono">${esc(u.username)}</td><td class="mono">${esc(u.badge)}</td>
    <td>${lc?`<span class="pill s-${lc>=S.settings.strikeLimit?'overdue':'soon'}">${lc}</span>`:'—'}</td>
    <td><span class="pill s-${u.active?'in':'retired'}">${u.active?'Active':'Deactivated'}</span></td>
    <td><select data-user="${u.id}" aria-label="Person actions"><option value="">Actions…</option>${u.hash?'<option value="reset">Reset password</option>':''}${lc?'<option value="clearstrikes">Clear strikes</option>':''}<option value="toggle">${u.active?'Deactivate':'Reactivate'}</option></select></td></tr>`}).join('')}</tbody></table>`;
  if(typeof QRCode!=='undefined')document.querySelectorAll('#admin [data-qr]').forEach(el=>{try{new QRCode(el,{text:el.dataset.qr,width:120,height:120})}catch{}});
  const au=[...S.audit].reverse().slice(0,60);
  $('#auditList').innerHTML=au.length?`<table><thead><tr><th>When</th><th>Action</th><th>Tag</th><th>By</th><th>Detail</th></tr></thead><tbody>${au.map(x=>`<tr><td>${fmtS(x.t)}</td><td>${esc(x.action)}</td><td class="mono">${esc(x.tag)}</td><td>${esc(x.by)}</td><td>${esc(x.note)}</td></tr>`).join('')}</tbody></table>`:'<p class="sub">No activity yet.</p>';
}
$('#q').oninput=$('#fSt').onchange=renderAdmin;
$('#regList').addEventListener('change',e=>{
  const t=e.target.dataset.st,v=e.target.value;if(!t||!v||me()?.role!=='admin')return;
  const a=asset(t);if(!a||openLoan(t))return;
  log('Status → '+aLabel[v],t,'was '+aLabel[a.status]);a.status=v;save();renderAll(false);
});
$('#csv').onclick=async()=>{
  const cell=v=>{v=String(v??'');if(/^[=+\-@]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"'};
  const rows=[['Tag','Type','Make','Model','Serial','Condition','Status','Registered','Registered by','Notes'],...S.assets.map(a=>[a.tag,a.type,a.make,a.model,a.serial,a.cond,aLabel[aStatus(a)],new Date(a.regAt).toISOString(),a.regBy,a.notes])];
  const csv=rows.map(r=>r.map(cell).join(',')).join('\n');
  try{
    if(typeof claude!=='undefined'){
      const d=await claude.use('downloads');
      if(d){await d.save({filename:'tag-out-registry.csv',data:csv});log('Exported registry');return}
    }
  }catch{}
  const blob=new Blob([csv],{type:'text/csv'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='tag-out-registry.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  log('Exported registry');
};
$('#printLbl').onclick=()=>{
  if(!lastList.length){toast('No devices match the current search/filter.');return}
  const win=window.open('','_blank');
  if(!win){toast('Your browser blocked the print pop-up. Allow pop-ups for this site and try again.');return}
  const cards=lastList.map(a=>`<div class="lbl"><div class="qb" data-t="${esc(a.tag)}"></div><div class="lt"><b>${esc(a.tag)}</b><br>${esc(name(a))}<br><span class="mono">${esc(a.serial)}</span></div></div>`).join('');
  win.document.write(`<!doctype html><html><head><title>Tag Out labels</title><style>
    body{font-family:sans-serif;margin:0;padding:16px}
    .sheet{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
    .lbl{border:1px dashed #999;border-radius:6px;padding:8px;display:flex;gap:8px;align-items:center;break-inside:avoid}
    .qb{width:56px;height:56px;flex:none}
    .lt{font-size:11px;line-height:1.35}
    @media print{.lbl{border-style:solid}}
  </style><script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script></head>
  <body><div class="sheet">${cards}</div>
  <script>window.onload=function(){document.querySelectorAll('.qb').forEach(function(el){new QRCode(el,{text:el.dataset.t,width:56,height:56})});setTimeout(function(){window.print()},350)}<\/script>
  </body></html>`);
  win.document.close();
};

/* ---------- admin: people ---------- */
const BADGE=/^[A-Za-z0-9\-]{4,20}$/,UNAME=/^[a-z0-9._-]{3,24}$/;
function addUser(o){ // returns error string or null
  if(o.name.length<2)return'Enter a full name.';
  if(o.badge){if(!BADGE.test(o.badge))return'ID/badge: 4–20 letters, numbers or dashes.';if(S.users.some(u=>u.badge===o.badge))return`ID ${o.badge} is already assigned to ${S.users.find(u=>u.badge===o.badge).name}.`}
  else if(o.role==='student')return'Students need an ID card number.';
  if(o.role!=='student'&&(!o.username||!o.pw))return'Staff and admins need a username and password.';
  if(o.username){if(!UNAME.test(o.username))return'Username: 3–24 letters, numbers, . _ -';if(S.users.some(u=>u.username===o.username))return'That username is taken.'}
  if(o.pw&&o.pw.length<8)return'Password must be at least 8 characters.';
  if(o.pw&&!o.username)return'Add a username or clear the password.';
  return null;
}
$('#userForm').addEventListener('submit',async e=>{
  e.preventDefault();if(me()?.role!=='admin')return;
  const o={name:$('#uName').value.trim(),role:$('#uRole').value,badge:$('#uBadge').value.trim().toUpperCase(),username:$('#uUser').value.trim().toLowerCase(),pw:$('#uPw').value};
  const er=addUser(o);$('#uErr').textContent=er||'';if(er)return;
  const c=o.pw?await makeCred(o.pw):{};
  S.users.push({id:'U'+Date.now()+Math.floor(Math.random()*1e3),name:o.name,role:o.role,username:o.username,badge:o.badge,...c,active:true,created:Date.now()});
  log('Person added','',`${o.name} (${o.role})`);save();e.target.reset();toast(o.name+' added.');renderAll(false);
});
$('#impBtn').onclick=()=>{
  if(me()?.role!=='admin')return;let ok=0,bad=[];
  $('#imp').value.split('\n').map(l=>l.trim()).filter(Boolean).forEach(l=>{
    const i=l.lastIndexOf(',');const nm=i<0?'':l.slice(0,i).trim(),id=(i<0?'':l.slice(i+1)).trim().toUpperCase();
    const er=addUser({name:nm,role:'student',badge:id,username:'',pw:''});
    if(er)bad.push(l);else{S.users.push({id:'U'+Date.now()+Math.floor(Math.random()*1e6),name:nm,role:'student',username:'',badge:id,active:true,created:Date.now()});ok++}
  });
  if(ok){log('Students imported','',ok+' added');save();renderAll(false)}
  $('#imp').value=bad.join('\n');toast(`${ok} added${bad.length?`, ${bad.length} skipped (left in the box: bad format or duplicate ID)`:''}.`);
};
$('#impDevBtn').onclick=()=>{
  if(me()?.role!=='admin')return;let ok=0,bad=[];
  $('#impDev').value.split('\n').map(l=>l.trim()).filter(Boolean).forEach(l=>{
    const p=l.split(',').map(x=>x.trim()),[type,make,model,serial,cond,hrs]=p;
    if(!type||!make||!model||!serial){bad.push(l+'  — missing type, make, model or serial');return}
    const r=checkSerial(serial||'');
    if(r.err){bad.push(l+'  — '+r.err);return}
    const tag='TAG-'+String(++S.seq).padStart(5,'0');
    S.assets.push({tag,type,make,model,serial:r.ok,cond:cond||'Good',hours:+hrs>0?+hrs:24,status:'available',regAt:Date.now(),regBy:byName(),notes:''});
    log('Registered',tag,`${type} ${make} ${model} S/N ${r.ok} (bulk import)`);ok++;
  });
  if(ok)save();
  $('#impDev').value=bad.join('\n');toast(`${ok} device${ok===1?'':'s'} added${bad.length?`, ${bad.length} skipped (left in box — check format/serial)`:''}.`);
  renderAll(false);
};
let resetFor=null;
$('#userList').addEventListener('change',e=>{
  const id=e.target.dataset.user,v=e.target.value,u=userById(id);if(!u||!v||me()?.role!=='admin')return;
  if(v==='reset'){resetFor=id;$('#resetLbl').textContent='New password for '+u.name;$('#resetForm').hidden=false;$('#resetPw').focus();e.target.value='';return}
  if(v==='clearstrikes'){u.resetAt=Date.now();log('Strikes cleared','',u.name);save();toast('Cleared for '+u.name+'.');renderAll(false);return}
  if(v==='toggle'){
    if(u.id===cur&&u.active){toast('You can\'t deactivate your own account.');e.target.value='';return}
    if(u.active&&u.role==='admin'&&S.users.filter(x=>x.active&&x.role==='admin').length<2){toast('Keep at least one active admin.');e.target.value='';return}
    u.active=!u.active;log(u.active?'Person reactivated':'Person deactivated','',u.name);save();renderAll(false);
  }
});
$('#resetForm').addEventListener('submit',async e=>{
  e.preventDefault();const u=userById(resetFor),pw=$('#resetPw').value;
  if(!u||pw.length<8){toast('Password must be at least 8 characters.');return}
  Object.assign(u,await makeCred(pw));log('Password reset','',u.name);save();$('#resetPw').value='';e.target.hidden=true;toast('Password updated for '+u.name+'.');
});
$('#resetX').onclick=()=>{$('#resetForm').hidden=true;$('#resetPw').value=''};

/* ---------- shell ---------- */
function renderAll(withFlow=true){
  if(cur&&!me()&&ready){logout('You were signed out.');return}
  if(!me()){route();return}
  renderAlerts();renderLog();renderMine();renderAdmin();if(withFlow)renderFlow();
}
function setReady(){if(!ready){ready=true;loginKey='';route();renderAll()}}
route();renderAll();
setInterval(()=>{if(me())renderAll(false)},30000);
setTimeout(setReady,4000);

/* shared storage via Firebase Firestore, so every device sees the same live data */
(async()=>{
  try{
    if(typeof firebase==='undefined'){toast('Firebase didn\'t load — check your internet connection, then refresh.');return setReady()}
    const db=firebase.firestore();
    dbDoc=db.doc('tagout/state');
    dbDoc.onSnapshot(s=>{
      if(s.exists){try{const n=JSON.parse(s.data().json);if(n&&Array.isArray(n.assets)){S=norm(n)}}catch{}}
      else if(S.assets.length||S.users.length)save();
      if(!ready)setReady();else{loginKey='';route();renderAll(false)}
    },err=>{console.error(err);toast('Could not reach shared storage — check the Firestore rules are set up.');setReady()});
  }catch(e){console.error(e);setReady()}
})();