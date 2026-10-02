'use strict';
/* ============================================================
   FORMULARIO DE PEDIDOS de la app descargada (antes el <script> de
   Formulario.html en Apps Script). La búsqueda en el padrón, las
   tarjetas de producto y la validación son las mismas.
   Lo nuevo (Paso 2-bis, etapa 3):
   - Los datos (padrón, sitios, urgencias, quién pide) se guardan en el
     teléfono: el formulario abre aunque no haya señal.
   - El borrador guarda también las fotos (en PedidosGuardados).
   - Al enviar, el pedido queda guardado en el teléfono y se manda solo
     cuando hay señal (js/envio-pedidos.js). Nunca se pierde ni se duplica.
   Necesita ../js/base.js y ../js/envio-pedidos.js.
   ============================================================ */
(function(){
const K_DATOS = 'compras_formulario';          // lo que trae datosFormulario, para abrir sin señal
const DRAFT = 'pedido-insumos-borrador-v3';    // el mismo que usaba la página vieja: los borradores siguen
let FAM = [], NAMES = [], SITIOS = [], URG = [], SOLICITANTES = [];
let famKey = [], famWords = [], nameWords = [];

function usarDatos(d){
  const P = typeof d.padron === 'string' ? JSON.parse(d.padron) : d.padron;
  FAM = P.F;               // [familia, canal, pedidos 2 años]
  NAMES = P.N;             // [idxFamilia, clave normalizada]
  SITIOS = d.sitios; URG = d.urgencias; SOLICITANTES = d.solicitantes;
  famKey = FAM.map(f=>norm(f[0]));
  famWords = famKey.map(k=>k.split(' '));
  nameWords = NAMES.map(n=>n[1].split(' '));
}

function norm(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();}

/* ---------- búsqueda en el padrón ---------- */
function lev(a,b){ if(Math.abs(a.length-b.length)>2) return 9;
  const d=[];for(let i=0;i<=a.length;i++){d[i]=[i];}for(let j=1;j<=b.length;j++)d[0][j]=j;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return d[a.length][b.length];}
function buscar(q){
  const nq=norm(q); if(!nq) return [];
  const toks=nq.split(' '); const alpha=toks.filter(t=>/[a-z]/.test(t));
  if(!alpha.length) return [];
  const best=new Map();
  const put=(fi,score,ej)=>{const b=best.get(fi); if(!b||score>b.score) best.set(fi,{fi,score,ej});};
  for(let i=0;i<NAMES.length;i++){
    const w=nameWords[i]; let m=0, alphaOk=false;
    for(const t of toks){ if(w.some(x=>x.startsWith(t))){m++; if(/[a-z]/.test(t)) alphaOk=true;} }
    if(!alphaOk) continue;
    const fi=NAMES[i][0]; const k=NAMES[i][1];
    let s=m*100 + (k.startsWith(alpha[0])?40:0) + (k===nq?300:0) + (famKey[fi]===nq?300:0) - k.length*0.3;
    put(fi,s,k);
  }
  if(best.size<3){ // tolerancia a errores de tipeo sobre el nombre de la familia
    for(let fi=0;fi<FAM.length;fi++){
      for(const t of alpha){ if(t.length<4) continue;
        if(famWords[fi].some(w=>lev(t,w)<=(t.length>=7?2:1))){ put(fi,60,famKey[fi]); break; } }
    }
  }
  return [...best.values()].map(r=>({...r,score:r.score+Math.log(FAM[r.fi][2]+1)*12}))
    .sort((a,b)=>b.score-a.score).slice(0,7);
}
// lo que el encargado escribió de más (ej. "bulon 3/4" -> "3/4") se sugiere como especificación
function resto(q,fi,ej){
  const fw=famWords[fi].concat(String(ej||'').split(' ').slice(0,1)); const stop=new Set(['de','del','la','el','los','las','para','x']);
  const out=[]; let started=false;
  for(const raw of String(q).trim().split(/\s+/)){
    const t=norm(raw); if(!t){continue;}
    // Lo que escribió para buscar el producto no es la medida: "bu" (de bulón) tampoco, aunque sea corto
    const esFam = (/^[a-z]+$/.test(t) && fw.some(w=>w.startsWith(t))) ||
      (/[a-z]/.test(t) && t.length>=3 && fw.some(w=>w.startsWith(t.slice(0,4))||t.startsWith(w.slice(0,4))||(t.length>=4&&lev(t,w)<=(t.length>=7?2:1))));
    if(esFam) continue;
    if(!started && stop.has(t)) continue;
    started=true; out.push(raw);
  }
  return out.join(' ');
}

/* ---------- estado ---------- */
let S = {tipo:'productos',sitio:'',urgencia:'',pide:'',razon:'',prods:[],servicio:'',obs:'',adj:[]};
const ADJ_MAX = 10*1024*1024;    // un PDF del servicio: hasta 10 MB
let nid=1;
function nuevoProd(){return {id:nid++,texto:'',fi:null,libre:false,espec:'',cantidad:'',desc:'',fotos:[]};}

function guardar(){
  try{
    // se guarda el NOMBRE de la familia: si el padrón cambia, los índices se corren.
    // De las fotos, solo la referencia: la foto en sí está en PedidosGuardados.
    const lite={...S,prods:S.prods.map(p=>({...p,fam:p.fi!==null?FAM[p.fi][0]:'',pintarFotos:undefined,
      fotos:p.fotos.map(f=>({id:f.id,nombre:f.nombre,bytes:f.bytes}))})),
      adj:(S.adj||[]).map(f=>({id:f.id,nombre:f.nombre,bytes:f.bytes,tipo:f.tipo}))};
    guardado.guardar(DRAFT,JSON.stringify(lite));
    $('#saved').textContent='Borrador guardado en este teléfono';
  }catch(e){}
}
function cargar(txt){
  try{const d=JSON.parse(txt||'null'); if(d&&d.prods){S=Object.assign({tipo:'productos',servicio:'',obs:'',adj:[]},d); S.adj=(S.adj||[]).filter(f=>f&&f.id); S.prods.forEach(p=>{p.id=nid++;
    // Borradores de la página vieja: sin fotos. Los nuevos: referencias a las fotos guardadas.
    p.fotos=(p.fotos||[]).filter(f=>f&&f.id);
    if(p.fi!==null){ const k=FAM.findIndex(f=>f[0]===p.fam); p.fi=k>=0?k:null; } delete p.fam;}); return true;}}catch(e){}
  return false;
}
/** Muestra las fotos del borrador (las trae de lo guardado en el teléfono). */
async function cargarFotos(){
  for(const p of S.prods){
    const quedan=[];
    for(const f of p.fotos){ const g=await PedidosGuardados.leerFoto(f.id); if(g){ f.url=URL.createObjectURL(g.blob); quedan.push(f); } }
    p.fotos=quedan; if(p.pintarFotos) p.pintarFotos();
  }
  const quedan=[];
  for(const f of S.adj){ const g=await PedidosGuardados.leerFoto(f.id); if(g){ f.url=f.tipo==='pdf'?'':URL.createObjectURL(g.blob); quedan.push(f); } }
  S.adj=quedan; pintarAdj();
}

/* ---------- Servicio (Paso 2-ter): qué servicio, observaciones y adjuntos ---------- */
function pintarTipo(){
  const serv=S.tipo==='servicio';
  document.querySelectorAll('#tipo .choice').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.tipo===S.tipo)));
  $('#blk-prods').hidden=serv; $('#blk-serv').hidden=!serv;
  $('h1').textContent=serv?'Pedido de servicio':'Pedido de insumos';
  $('.lead').textContent=serv?'Para algo que hay que mandar a arreglar o hacer afuera (ej.: llevar a arreglar la motoguadaña). Compras lo maneja a mano.'
                             :'Cargá lo que necesita tu granja. Podés agregar todos los productos que quieras en un mismo pedido.';
  $('#enviar').textContent=serv?'Pedir el servicio':'Enviar pedido';
}
function pintarAdj(){
  const th=$('#adj-thumbs'); if(!th) return;
  th.innerHTML=S.adj.map((f,k)=>`<div class="thumb">${f.tipo==='pdf'?`<div class="pdf">📄<small>${esc(f.nombre)}</small></div>`:`<img src="${f.url||''}" alt="Adjunto ${k+1}">`}<button type="button" aria-label="Quitar" data-k="${k}">×</button><span>${Math.round(f.bytes/1024)} KB</span></div>`).join('');
}

const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- choices ---------- */
function choices(name,opts){
  const box=document.querySelector(`.choices[data-name="${name}"]`);
  box.innerHTML=opts.map((o,i)=>`<button type="button" class="choice" role="radio" id="${name}-${i}" aria-checked="${S[name]===o}" data-v="${esc(o)}"><span class="k">${String.fromCharCode(65+i)}</span><span>${esc(o)}</span></button>`).join('');
  box.onclick=e=>{const b=e.target.closest('.choice'); if(!b) return; S[name]=b.dataset.v;
    box.querySelectorAll('.choice').forEach(x=>x.setAttribute('aria-checked',x===b)); limpiarErr('q-'+name); guardar();};
}

/* ---------- productos ---------- */
function render(){
  const cont=$('#prods'); cont.innerHTML='';
  S.prods.forEach((p,i)=>cont.appendChild(card(p,i)));
  $('#count').textContent=S.prods.length===1?'1 producto':S.prods.length+' productos';
}
function estadoTag(p){
  if(p.fi!==null) return `<span class="tag ok">✓ ${esc(FAM[p.fi][0])}</span>`;
  if(p.libre) return `<span class="tag new">Producto nuevo: lo revisa Compras</span>`;
  return '';
}
function card(p,i){
  const el=document.createElement('div'); el.className='prod'; el.id='prod-'+p.id;
  el.innerHTML=`
    <div class="prod-h"><b>Producto ${i+1}</b>${S.prods.length>1?`<button type="button" class="linkbtn" data-act="del">Quitar</button>`:''}</div>
    <div class="f" data-f="prod">
      <label for="p${p.id}-t">Producto<span class="req">*</span></label>
      <div class="combo">
        <input type="text" id="p${p.id}-t" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="p${p.id}-l" placeholder="Escribí el producto: bulón, mecha, cable…" value="${esc(p.fi!==null&&!p.texto?FAM[p.fi][0]:p.texto)}">
        <div class="list" id="p${p.id}-l" role="listbox" hidden></div>
      </div>
      <div class="st">${estadoTag(p)}</div>
    </div>
    <div class="f" data-f="espec">
      <label for="p${p.id}-e">Medida / especificación<span class="req">*</span></label>
      <input type="text" id="p${p.id}-e" placeholder="Ej: 3/4, 2,5 mm, talle 42, para bomba Czerweny" value="${esc(p.espec)}">
    </div>
    <div class="f" data-f="cant">
      <label for="p${p.id}-c">Cantidad<span class="req">*</span></label>
      <input type="text" id="p${p.id}-c" inputmode="decimal" autocomplete="off" placeholder="Ej: 20 o 1,5" value="${esc(p.cantidad)}" style="max-width:220px">
    </div>
    <div class="f">
      <label for="p${p.id}-d">Descripción <span style="font-weight:400;color:var(--muted)">(opcional)</span></label>
      <textarea id="p${p.id}-d" placeholder="Marca, color, dónde va, cualquier dato que ayude a cotizar">${esc(p.desc)}</textarea>
    </div>
    <div class="f">
      <span style="font-weight:700;font-size:15px">Fotos <span style="font-weight:400;color:var(--muted)">(opcional)</span></span>
      <div class="drop">
        <label class="btn2" for="p${p.id}-f">📷 Subir fotos</label>
        <input class="vh" type="file" id="p${p.id}-f" accept="image/*" multiple>
        <div class="thumbs"></div>
      </div>
    </div>`;
  const inp=el.querySelector(`#p${p.id}-t`), list=el.querySelector('.list'), st=el.querySelector('.st');
  let res=[], act=-1;
  const cerrar=()=>{list.hidden=true; inp.setAttribute('aria-expanded','false');};
  const pintar=()=>{
    const q=inp.value.trim();
    if(!q){cerrar();return;}
    list.innerHTML=res.map((r,j)=>`<div class="opt" role="option" id="p${p.id}-o${j}" aria-selected="${j===act}" data-j="${j}"><b>${esc(FAM[r.fi][0])}</b>${norm(FAM[r.fi][0])!==r.ej?`<small>como “${esc(r.ej)}”</small>`:''}</div>`).join('')
      + `<div class="opt free" role="option" aria-selected="${act===res.length}" data-j="${res.length}"><b>No está en la lista: usar “${esc(q)}”</b><small>Compras lo revisa y lo agrega al padrón</small></div>`;
    list.hidden=false; inp.setAttribute('aria-expanded','true');
  };
  const elegir=j=>{
    const q=inp.value.trim();
    if(j<res.length){ const fi=res[j].fi; p.fi=fi; p.libre=false; p.texto=q;
      if(!p.espec){ p.espec=resto(q,fi,res[j].ej); el.querySelector(`#p${p.id}-e`).value=p.espec; if(p.espec) limpiarErrEl(el.querySelector('[data-f="espec"]')); }
      inp.value=FAM[fi][0];
    } else { p.fi=null; p.libre=true; p.texto=q; }
    st.innerHTML=estadoTag(p); cerrar(); limpiarErrEl(el.querySelector('[data-f="prod"]')); guardar();
    if(j<res.length && !p.espec) el.querySelector(`#p${p.id}-e`).focus();
  };
  let t;
  inp.addEventListener('input',()=>{ p.fi=null; p.libre=false; p.texto=inp.value; st.innerHTML='';
    clearTimeout(t); t=setTimeout(()=>{res=buscar(inp.value); act=res.length?0:-1; pintar();},90); guardar(); });
  inp.addEventListener('keydown',e=>{
    if(list.hidden) return; const n=res.length+1;
    if(e.key==='ArrowDown'){act=(act+1)%n;pintar();e.preventDefault();}
    else if(e.key==='ArrowUp'){act=(act-1+n)%n;pintar();e.preventDefault();}
    else if(e.key==='Enter'){e.preventDefault(); elegir(act<0?res.length:act);}
    else if(e.key==='Escape'){cerrar();}
  });
  list.addEventListener('mousedown',e=>{const o=e.target.closest('.opt'); if(o){e.preventDefault(); elegir(+o.dataset.j);}});
  inp.addEventListener('blur',()=>setTimeout(cerrar,120));

  const bind=(sel,key)=>el.querySelector(sel).addEventListener('input',e=>{p[key]=e.target.value; if(key==='cantidad')limpiarErrEl(el.querySelector('[data-f="cant"]')); if(key==='espec')limpiarErrEl(el.querySelector('[data-f="espec"]')); guardar();});
  bind(`#p${p.id}-e`,'espec'); bind(`#p${p.id}-c`,'cantidad'); bind(`#p${p.id}-d`,'desc');
  const del=el.querySelector('[data-act="del"]'); if(del) del.onclick=()=>{p.fotos.forEach(f=>PedidosGuardados.borrarFoto(f.id)); S.prods=S.prods.filter(x=>x!==p); render(); guardar();};

  // Las fotos se guardan en el teléfono apenas se eligen: si se cierra el formulario, siguen en el borrador
  const th=el.querySelector('.thumbs');
  const pintarFotos=()=>{th.innerHTML=p.fotos.map((f,k)=>`<div class="thumb"><img src="${f.url||''}" alt="Foto ${k+1}"><button type="button" aria-label="Quitar foto" data-k="${k}">×</button><span>${Math.round(f.bytes/1024)} KB</span></div>`).join('');};
  p.pintarFotos=pintarFotos;
  th.onclick=e=>{const b=e.target.closest('button'); if(!b) return; const [f]=p.fotos.splice(+b.dataset.k,1); if(f) PedidosGuardados.borrarFoto(f.id); pintarFotos(); guardar();};
  el.querySelector(`#p${p.id}-f`).addEventListener('change',async e=>{
    for(const file of e.target.files){ try{
      const c=await comprimir(file); const id=nuevoId();
      await PedidosGuardados.guardarFoto(id,c.blob,c.nombre);
      p.fotos.push({id,nombre:c.nombre,bytes:c.bytes,url:c.url});
    }catch(err){} }
    e.target.value=''; pintarFotos(); guardar();
  });
  pintarFotos();
  return el;
}

// Las fotos se achican en el teléfono antes de subir (máx. 1600 px, JPEG): clave para celulares viejos y poca señal
function comprimir(file){
  return new Promise((ok,bad)=>{
    const img=new Image(); const u=URL.createObjectURL(file);
    img.onload=()=>{ const M=1600; let {width:w,height:h}=img; const r=Math.min(1,M/Math.max(w,h)); w=Math.round(w*r); h=Math.round(h*r);
      const c=document.createElement('canvas'); c.width=w; c.height=h; c.getContext('2d').drawImage(img,0,0,w,h);
      c.toBlob(b=>{ URL.revokeObjectURL(u); if(!b) return bad(); ok({nombre:file.name.replace(/\.[^.]+$/,'')+'.jpg',bytes:b.size,original:file.size,url:URL.createObjectURL(b),blob:b}); },'image/jpeg',0.75); };
    img.onerror=()=>{URL.revokeObjectURL(u);bad();}; img.src=u;
  });
}

/* ---------- validación y envío ---------- */
function marcar(el,msg){ el.classList.add('invalid'); let m=el.querySelector(':scope > .err'); if(!m){m=document.createElement('div');m.className='err';el.appendChild(m);} m.textContent=msg; }
function limpiarErrEl(el){ if(!el) return; el.classList.remove('invalid'); const m=el.querySelector(':scope > .err'); if(m) m.remove(); }
function limpiarErr(id){ limpiarErrEl(document.getElementById(id)); }

function validar(){
  document.querySelectorAll('.invalid').forEach(limpiarErrEl);
  const errs=[];
  if(!S.sitio) errs.push([$('#q-sitio'),'Elegí el sitio.']);
  if(!S.urgencia) errs.push([$('#q-urgencia'),'Elegí la urgencia.']);
  if(!S.pide) errs.push([$('#q-pide'),'Elegí quién hace el pedido.']);
  if(!S.razon.trim()) errs.push([$('#q-razon'),'Contá para qué es el pedido.']);
  if(S.tipo==='servicio' && !S.servicio.trim()) errs.push([$('#q-servicio'),'Escribí qué servicio hace falta.']);
  if(S.tipo!=='servicio') S.prods.forEach(p=>{
    const el=document.getElementById('prod-'+p.id);
    if(p.fi===null && !p.libre) errs.push([el.querySelector('[data-f="prod"]'), p.texto.trim()?'Elegí una opción de la lista o tocá “No está en la lista”.':'Escribí el producto.']);
    if(!p.espec.trim()) errs.push([el.querySelector('[data-f="espec"]'),'Poné la medida o especificación (ej: 3/4, 2,5 mm, talle 42).']);
    if(!(/^\s*\d+([.,]\d+)?\s*$/.test(String(p.cantidad)) && parseFloat(String(p.cantidad).replace(',','.'))>0)) errs.push([el.querySelector('[data-f="cant"]'),'Poné una cantidad mayor a 0, solo el número (ej: 20 o 1,5).']);
  });
  errs.forEach(([el,m])=>marcar(el,m));
  if(errs.length){ errs[0][0].scrollIntoView({behavior:'smooth',block:'center'}); }
  return !errs.length;
}
// Referencia corta y legible (queda como Ref del pedido en la planilla)
function nuevoIdEnvio(){
  const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let r='';
  const b=new Uint8Array(4); crypto.getRandomValues(b); b.forEach(x=>r+=a[x%a.length]);
  return 'F'+Date.now().toString(36).toUpperCase()+'-'+r;
}

/* ---------- envío: queda guardado en el teléfono y se manda solo ---------- */
let mirando=null;   // el Ref del pedido que muestra la pantalla de listo

async function enviar(){
  if(!validar()) return;
  const btn=$('#enviar'); if(btn.disabled) return; btn.disabled=true;
  try{
    if(S.tipo==='servicio'){
      const ref=nuevoIdEnvio(), fotos={};
      S.adj.forEach(f=>{ fotos[f.id]={linea:0,nombre:f.nombre,tipo:f.tipo,envio:nuevoId(),subida:null}; });
      const datos={ tipo:'servicio', sitio:S.sitio, urgencia:S.urgencia, solicitante:S.pide, razon:S.razon.trim(),
                    servicio:S.servicio.trim(), observaciones:S.obs.trim(), productos:[], adjuntos:S.adj.map(f=>f.id) };
      const borrador=guardado.leer(DRAFT);
      await PedidosGuardados.agregar({ ref, datos, fotos, borrador, servicio:true, titulo:'🔧 '+S.servicio.trim(), nProductos:0, nFotos:S.adj.length });
      guardado.borrar(DRAFT);
      mirando=ref;
      $('#form').hidden=true; $('#listo').hidden=false; window.scrollTo(0,0);
      pintarListo();
      return;
    }
    const ref=nuevoIdEnvio(), fotos={};
    const productos=S.prods.map((p,i)=>{
      p.fotos.forEach(f=>{ fotos[f.id]={linea:i+1,nombre:f.nombre,envio:nuevoId(),subida:null}; });
      return { linea:i+1, familia:p.fi!==null?FAM[p.fi][0]:'', textoEscrito:p.texto.trim(), enPadron:p.fi!==null,
               especificacion:p.espec.trim(), cantidad:String(p.cantidad).trim().replace(',','.'),
               descripcion:p.desc.trim(), fotos:p.fotos.map(f=>f.id) };
    });
    const datos={ sitio:S.sitio, urgencia:S.urgencia, solicitante:S.pide, razon:S.razon.trim(), productos };
    // Para mostrarlo en la lista y poder corregirlo si el servidor lo rechaza
    const borrador=guardado.leer(DRAFT);
    await PedidosGuardados.agregar({ ref, datos, fotos, borrador,
      titulo: productos.slice(0,3).map(p=>p.familia||p.textoEscrito).join(', ')+(productos.length>3?' y '+(productos.length-3)+' más':''),
      nProductos: productos.length, nFotos: Object.keys(fotos).length });
    // Las fotos ya son del pedido guardado: el borrador se limpia sin borrarlas
    guardado.borrar(DRAFT);
    mirando=ref;
    $('#form').hidden=true; $('#listo').hidden=false; window.scrollTo(0,0);
    pintarListo();
  }catch(e){
    estado('No se pudo guardar el pedido en este teléfono: '+(e.message||e)+'. Probá de nuevo.','bad');
  }finally{ btn.disabled=false; }
}

async function pintarListo(){
  if(!mirando) return;
  const e=await PedidosGuardados.traer(mirando); if(!e) return;
  const nf=e.nFotos?' · '+(e.nFotos===1?(e.servicio?'1 adjunto':'1 foto'):e.nFotos+(e.servicio?' adjuntos':' fotos')):'';
  $('#listoRef').textContent=e.ref;
  $('#listoDet').textContent=(e.servicio?'Servicio':(e.nProductos===1?'1 producto':e.nProductos+' productos'))+nf;
  $('#listoPaso').hidden=true; $('#corregir').hidden=true; $('#listoRef').hidden=false;
  $('#listo').classList.remove('espera');
  if(e.estado==='enviado'){
    $('#listoTit').textContent=e.servicio?'✓ Servicio pedido':'✓ Pedido enviado';
    $('#listoTxt').textContent='Compras ya lo recibió. Si te preguntan por este pedido, este es el número:';
    if(e.fotosPerdidas) $('#listoDet').textContent+=' ('+e.fotosPerdidas+' foto(s) no se pudieron subir)';
  } else if(e.estado==='rechazado'){
    $('#listoTit').textContent='No se pudo mandar el pedido';
    $('#listoTxt').textContent=e.error+' Tocá "Corregirlo" para arreglarlo y mandarlo de nuevo.';
    $('#listoRef').hidden=true; $('#corregir').hidden=false;
  } else {
    $('#listo').classList.add('espera');
    $('#listoTit').textContent='✓ Pedido guardado en este teléfono';
    $('#listoTxt').textContent=APP.enLinea
      ? 'Se está mandando. No hace falta que lo cargues de nuevo. Su número es:'
      : 'Hay poca señal: se manda solo cuando vuelva. No hace falta que lo cargues de nuevo; si cerrás el formulario, se manda la próxima vez que lo abras. Su número es:';
    if(e.progreso){ $('#listoPaso').hidden=false; $('#listoPaso').textContent=e.progreso; }
  }
}

async function pintarGuardados(){
  const l=await PedidosGuardados.lista();
  const pend=l.filter(e=>e.estado==='pendiente').length;
  const av=$('#aviso-senal');
  const txt = pend ? (pend===1?'📶 1 pedido guardado en este teléfono: '+(APP.enLinea?'mandándose…':'se manda solo cuando vuelva la señal.')
                             :'📶 '+pend+' pedidos guardados en este teléfono: '+(APP.enLinea?'mandándose…':'se mandan solos cuando vuelva la señal.'))
            : (!APP.enLinea ? '📶 Poca señal. Podés cargar el pedido igual: se manda solo cuando vuelva la señal.' : '');
  av.textContent=txt; av.hidden=!txt;
  $('#guardados').hidden=!l.length;
  const cont=$('#guardados-lista'); cont.innerHTML='';
  l.forEach(e=>{
    const d=document.createElement('div'); d.className='guardado';
    const ic=e.estado==='enviado'?'✅':e.estado==='rechazado'?'⚠️':'⏳';
    const cuando=new Date(e.creado).toLocaleString('es-AR',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
    const que=e.estado==='enviado'?'Enviado · N° '+e.ref
            :e.estado==='rechazado'?'No se pudo mandar: '+e.error
            :(e.progreso||(APP.enLinea?'Mandándose…':'Guardado: se manda solo cuando haya señal'));
    d.innerHTML=`<div class="ic">${ic}</div><div><b>${esc(e.titulo||e.ref)}</b><small>${esc(e.datos.sitio)} · cargado ${cuando}</small><small class="${e.estado==='rechazado'?'bad':''}">${esc(que)}</small></div>`;
    if(e.estado==='rechazado'){
      const a=document.createElement('div'); a.className='acciones';
      a.innerHTML='<button type="button" class="linkbtn">Corregirlo</button>';
      a.querySelector('button').onclick=()=>corregir(e.ref);
      d.lastChild.appendChild(a);
    }
    cont.appendChild(d);
  });
}

/** Un pedido que el servidor rechazó vuelve al formulario para arreglarlo. */
async function corregir(ref){
  const e=await PedidosGuardados.traer(ref); if(!e) return;
  if(S.prods.some(p=>p.texto||p.fi!==null) && !confirm('Tenés otro pedido a medio cargar. ¿Reemplazarlo por el que hay que corregir?')) return;
  cargar(e.borrador); if(!S.prods.length) S.prods.push(nuevoProd());
  await PedidosGuardados.olvidar(ref);   // las fotos quedan: son las del borrador
  mirando=null; $('#listo').hidden=true; $('#form').hidden=false;
  init(); guardar(); cargarFotos(); window.scrollTo(0,0);
}

function estado(msg,tipo){ const e=$('#estado'); if(!msg){e.hidden=true;return;} e.hidden=false; e.className='estado '+(tipo||'run'); e.textContent=msg; }

function empezarDeCero(){
  S.prods.forEach(p=>p.fotos.forEach(f=>PedidosGuardados.borrarFoto(f.id)));
  (S.adj||[]).forEach(f=>PedidosGuardados.borrarFoto(f.id));
  S={tipo:S.tipo||'productos',sitio:'',urgencia:'',pide:'',razon:'',prods:[nuevoProd()],servicio:'',obs:'',adj:[]};
  guardado.borrar(DRAFT);
  $('#saved').textContent=''; estado('');
  mirando=null; $('#form').hidden=false; $('#listo').hidden=true; init();
}

/* ---------- eventos ---------- */
$('#form').addEventListener('submit',e=>{ e.preventDefault(); enviar(); });
$('#otro').onclick=()=>{ mirando=null; empezarDeCero(); window.scrollTo(0,0); };
$('#corregir').onclick=()=>{ if(mirando) corregir(mirando); };
$('#addProd').onclick=()=>{ S.prods.push(nuevoProd()); render(); guardar(); const last=S.prods[S.prods.length-1]; setTimeout(()=>document.getElementById('p'+last.id+'-t').focus(),30); };
$('#pide').addEventListener('change',e=>{S.pide=e.target.value; limpiarErr('q-pide'); guardar();});
$('#razon').addEventListener('input',e=>{S.razon=e.target.value; limpiarErr('q-razon'); guardar();});
$('#tipo').addEventListener('click',e=>{const b=e.target.closest('.choice'); if(!b) return; S.tipo=b.dataset.tipo; pintarTipo(); guardar();});
$('#servicio').addEventListener('input',e=>{S.servicio=e.target.value; limpiarErr('q-servicio'); guardar();});
$('#obs').addEventListener('input',e=>{S.obs=e.target.value; guardar();});
$('#adj-thumbs').addEventListener('click',e=>{const b=e.target.closest('button'); if(!b) return; const [f]=S.adj.splice(+b.dataset.k,1); if(f) PedidosGuardados.borrarFoto(f.id); pintarAdj(); guardar();});
$('#adj-f').addEventListener('change',async e=>{
  for(const file of e.target.files){ try{
    const id=nuevoId();
    if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
      if(file.size>ADJ_MAX){ estado('"'+file.name+'" pesa más de 10 MB: no se puede adjuntar.','bad'); continue; }
      await PedidosGuardados.guardarFoto(id,file,file.name);
      S.adj.push({id,nombre:file.name,bytes:file.size,tipo:'pdf',url:''});
    } else {
      const c=await comprimir(file);
      await PedidosGuardados.guardarFoto(id,c.blob,c.nombre);
      S.adj.push({id,nombre:c.nombre,bytes:c.bytes,tipo:'foto',url:c.url});
    }
  }catch(err){} }
  e.target.value=''; pintarAdj(); guardar();
});
$('#reset').onclick=()=>{ if(confirm('¿Borrar todo lo cargado y empezar de cero?')) empezarDeCero(); };
$('#reintentar').onclick=()=>arrancar();
PedidosGuardados.alCambiar(()=>{ pintarGuardados(); pintarListo(); });
window.addEventListener('online',()=>{ pintarGuardados(); pintarListo(); });
window.addEventListener('offline',()=>{ conexion(false); pintarGuardados(); pintarListo(); });

function init(){
  if(S.pide&&SOLICITANTES.indexOf(S.pide)<0) S.pide='';
  if(S.sitio&&SITIOS.indexOf(S.sitio)<0) S.sitio='';
  if(S.urgencia&&URG.indexOf(S.urgencia)<0) S.urgencia='';
  $('#pide').innerHTML='<option value="">Elegí tu nombre</option>'+SOLICITANTES.map(n=>`<option>${esc(n)}</option>`).join('');
  choices('sitio',SITIOS); choices('urgencia',URG); $('#razon').value=S.razon; $('#pide').value=S.pide||''; render();
  $('#servicio').value=S.servicio||''; $('#obs').value=S.obs||''; pintarTipo(); pintarAdj();
}

let listo=false;
function mostrarFormulario(){
  if(listo) return; listo=true;
  cargar(guardado.leer(DRAFT));
  if(!S.prods.length) S.prods.push(nuevoProd());
  // Desde "＋ Pedir un servicio" (el tablero de Servicios): arranca en Servicio
  if(/[?&]servicio=1\b/.test(location.search)) S.tipo='servicio';
  $('#cargando').hidden=true; $('#sin-datos').hidden=true; $('#form').hidden=false;
  init(); cargarFotos();
}

/** Abre con lo guardado (aunque no haya señal) y trae los datos nuevos por detrás. */
async function arrancar(){
  const guardados=guardado.leerJSON(K_DATOS,null);
  if(guardados){ usarDatos(guardados); mostrarFormulario(); }
  else { $('#cargando').hidden=false; $('#sin-datos').hidden=true; }
  try{
    const r=await llamar('datosFormulario',[]);
    if(!r.ok) throw new Error(r.error);
    if(typeof aplicarColor==='function') aplicarColor(r.css); else { if(guardado.leer('compras_css_mio')===null) $('#estiloColor').textContent=r.css; guardado.guardar(K.css,r.css); }
    guardado.guardarJSON(K_DATOS,{padron:r.padron,sitios:r.sitios,urgencias:r.urgencias,solicitantes:r.solicitantes,actualizado:new Date().toISOString()});
    // La primera vez arranca con lo que llegó; si ya estaba abierto, lo nuevo se usa la próxima vez
    if(!guardados){ usarDatos(r); mostrarFormulario(); }
  }catch(e){
    if(!guardados){
      $('#cargando').hidden=true; $('#sin-datos').hidden=false;
      $('#sin-datos-txt').textContent = e.sinRed
        ? 'Hay poca señal. La primera vez que se abre el formulario en este teléfono hace falta conexión para bajar la lista de productos: tocá Reintentar en un rato.'
        : 'El servidor no contestó bien. Tocá Reintentar en un rato.';
    }
  }
  pintarGuardados();
  PedidosGuardados.procesar();
}

// Abierto desde la app: se ve el link para volver
if(/[?&]desde=app\b/.test(location.search)) $('#volver').hidden=false;
arrancar();
})();

// Para base.js: el formulario no se recarga solo por una versión nueva (se usa la próxima vez que se abra)
function enMedioDeEntrar(){ return true; }
