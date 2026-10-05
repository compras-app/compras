/* ---------- Chats (Fase 4, Paso 2): todos los chats del WhatsApp, dentro de la app ----------
   Solo admins. La lista (el más reciente arriba, con buscador y filtros), cada chat con sus mensajes
   como en WhatsApp, mandar texto o una foto / un PDF (citando, si se quiere), notas, mensajes
   prediseñados y, arriba, las tarjetas abiertas de ese chat. Ningún mensaje se asigna solo a un pedido
   (Feli): asignados quedan solo los presupuestos, cuando se cargan en la tarjeta (Paso 3).
   Mandar un texto va por la bandeja (anda con poca señal); un archivo necesita señal.
   La app pregunta cada 5 s si hay algo nuevo (versionChats, muy liviana). */
pantalla('chats', { titulo: 'Chats', alMostrar: mostrarChats });

const K_CHATS = 'compras_chats';            // la lista, para abrir al instante
const K_CHAT = 'compras_chat_';             // + chat: los últimos mensajes de cada chat abierto
const CH_MAX_LISTA = 150;                   // cuántos se dibujan (el buscador encuentra todos)
const CH = { lista: null, filtro: 'todos', q: '', abierto: null, datos: null, cita: null,
             version: { lista: '', chat: '' }, listaHora: 0, cargandoLista: false, cargandoChat: false };

function mostrarChats(datos) {
  if (!CH.lista) CH.lista = guardado.leerJSON(K_CHATS, null);
  pintarListaChats();
  cargarListaChats();
  if (datos && datos.chat) abrirChat(datos.chat);
  else if (!CH.abierto) mostrarPanelChat(false);
}

/* ---------- La lista ---------- */
async function cargarListaChats() {
  if (CH.cargandoLista) return;
  CH.cargandoLista = true;
  const r = await api('getChats');
  CH.cargandoLista = false;
  if (!r.ok) { if (!CH.lista) $('ch-items').innerHTML = '<p class="nota" style="padding:12px">' + esc(r.sinConexion ? 'Hay poca señal: los chats se ven cuando vuelva.' : r.error) + '</p>'; return; }
  CH.lista = r.chats;
  CH.version.lista = r.version;
  CH.listaHora = Date.now();
  guardado.guardarJSON(K_CHATS, r.chats);
  pintarListaChats();
}

function sinAcentos(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

function horaMinutos(d) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

function horaChat(iso) {
  if (!iso) return '';
  const d = new Date(iso), hoy = new Date();
  if (d.toDateString() === hoy.toDateString()) return horaMinutos(d);
  const ayer = new Date(hoy.getTime() - 86400000);
  if (d.toDateString() === ayer.toDateString()) return 'Ayer';
  return d.getDate() + '/' + (d.getMonth() + 1) + (d.getFullYear() !== hoy.getFullYear() ? '/' + String(d.getFullYear()).slice(2) : '');
}

function pintarListaChats() {
  const cont = $('ch-items');
  if (!cont) return;
  document.querySelectorAll('#ch-filtros button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.f === CH.filtro)); });
  if (!CH.lista) { cont.innerHTML = '<p class="nota" style="padding:12px">Cargando los chats…</p>'; return; }
  const q = sinAcentos(CH.q);
  const l = CH.lista.filter(function (c) {
    if (CH.filtro === 'activos' && !c.pedidos) return false;
    if (CH.filtro === 'noleidos' && !c.noLeidos) return false;
    return !q || sinAcentos(c.nombre + ' ' + c.proveedor + ' ' + c.chat).indexOf(q) !== -1;
  });
  if (!l.length) {
    cont.innerHTML = '<p class="nota" style="padding:12px">' + (q ? 'No hay chats con "' + esc(CH.q) + '".' :
      CH.filtro === 'activos' ? 'Ningún chat tiene cotizaciones activas.' : CH.filtro === 'noleidos' ? 'No hay chats sin leer.' : 'Todavía no hay chats.') + '</p>';
    return;
  }
  cont.innerHTML = l.slice(0, CH_MAX_LISTA).map(function (c) {
    return '<button type="button" class="ch-item' + (c.chat === CH.abierto ? ' abierto' : '') + '" data-chat="' + esc(c.chat) + '">' +
      '<span class="ch-av" aria-hidden="true">' + (c.grupo ? '👥' : esc(inicial(c.nombre) || '#')) + '</span>' +
      '<span class="ch-it"><span class="ch-l1"><b>' + esc(c.nombre) + '</b><small>' + esc(horaChat(c.ultimo)) + '</small></span>' +
      '<span class="ch-l2"><span class="ch-ul">' + (c.proveedor && c.proveedor !== c.nombre ? '🏪 ' + esc(c.proveedor) + ' · ' : '') + esc(c.texto || '') + '</span>' +
      (c.pedidos ? '<span class="ch-ped" title="Tarjetas abiertas">📋 ' + c.pedidos + '</span>' : '') +
      (c.noLeidos ? '<span class="ch-n">' + c.noLeidos + '</span>' : '') + '</span></span></button>';
  }).join('') + (l.length > CH_MAX_LISTA ? '<p class="nota" style="padding:8px 12px">Se ven los ' + CH_MAX_LISTA + ' más recientes de ' + l.length + ': buscá por nombre para encontrar otro.</p>' : '');
  cont.querySelectorAll('.ch-item').forEach(function (b) { b.addEventListener('click', function () { abrirChat(b.dataset.chat); }); });
}

$('ch-buscar').addEventListener('input', function () { CH.q = this.value; pintarListaChats(); });
document.querySelectorAll('#ch-filtros button').forEach(function (b) {
  b.addEventListener('click', function () { CH.filtro = b.dataset.f; pintarListaChats(); });
});

/* ---------- Un chat ---------- */
function mostrarPanelChat(si) {
  $('ch').classList.toggle('con-chat', !!si);
  $('ch-chat').hidden = !si;
  $('ch-vacio').hidden = !!si;
}

async function abrirChat(chat) {
  if (CH.abierto !== chat) { CH.cita = null; CH.datos = null; $('ch-texto').value = ''; $('ch-panel').hidden = true; $('ch-notas-p').hidden = true; }
  CH.abierto = chat;
  mostrarPanelChat(true);
  const guardadoChat = guardado.leerJSON(K_CHAT + chat, null);
  if (!CH.datos && guardadoChat) CH.datos = guardadoChat;
  pintarChat(true);
  pintarListaChats();
  await recargarChat(true);
}

async function recargarChat(alAbrir) {
  const chat = CH.abierto;
  if (!chat || CH.cargandoChat) return;
  CH.cargandoChat = true;
  const r = await api('getChat', chat);
  CH.cargandoChat = false;
  if (CH.abierto !== chat) return;
  if (!r.ok) {
    if (!CH.datos) $('ch-msjs').innerHTML = '<p class="nota" style="padding:12px">' + esc(r.sinConexion ? 'Hay poca señal: el chat se ve cuando vuelva.' : r.error) + '</p>';
    return;
  }
  CH.datos = r;
  CH.version.chat = r.version.chat;
  guardado.guardarJSON(K_CHAT + chat, r);
  pintarChat(alAbrir);
  // Al abrirlo queda leído (para todos los admins)
  const it = (CH.lista || []).filter(function (c) { return c.chat === chat; })[0];
  if (alAbrir && ((it && it.noLeidos) || r.chat.noLeidos)) {
    if (it) it.noLeidos = 0;
    bandeja.agregar('leerChat', [chat], 'marcar como leído el chat con ' + r.chat.nombre);
    pintarListaChats();
  }
}

/** Los textos que esperan en la bandeja para este chat (se ven con ⏳ hasta que salen). */
function mandadosEsperando(chat) {
  return bandeja.lista().filter(function (m) { return m.fn === 'mandarMensaje' && m.args[0] && m.args[0].chat === chat; })
    .map(function (m) { return { id: m.args[0].id, sale: true, desde: 'app', tipo: 'textMessage', texto: m.args[0].texto, cita: m.args[0].cita || '',
                                 citaDe: m.args[0].citaDe || null, fecha: m.creado, esperando: true, reacciones: {} }; });
}

const TICKS = { sent: '✓', delivered: '✓✓', read: '✓✓', played: '✓✓' };

function htmlTextoChat(t) {
  return esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
}

function htmlArchivo(m) {
  const id = m.archivo;
  const etiqueta = { imageMessage: '📷 Foto', stickerMessage: 'Sticker', videoMessage: '🎥 Video', audioMessage: '🎤 Audio', documentMessage: '📄 ' + (m.nombreArchivo || 'Documento') }[m.tipo];
  if (!etiqueta) return '';
  if (!id) return '<div class="ch-arch sin">' + esc(etiqueta) + (m.conLink ? ' <small>(no guardado)</small>' : '') + '</div>';
  if (m.tipo === 'imageMessage' || m.tipo === 'stickerMessage') {
    return '<button type="button" class="ch-foto' + (m.tipo === 'stickerMessage' ? ' sticker' : '') + '" data-foto="' + esc(id) + '" aria-label="Ver foto">' +
      '<img src="https://drive.google.com/thumbnail?id=' + esc(id) + '&sz=w480" alt="📷 Foto · abrir" loading="lazy"></button>';
  }
  if (m.tipo === 'audioMessage') return htmlAudio(m.id);
  return '<a class="ch-arch" href="https://drive.google.com/file/d/' + esc(id) + '/view" target="_blank" rel="noopener">' + esc(etiqueta) +
    ' <small>· abrir</small></a>';
}

/* ---------- Audios: se escuchan adentro del chat (Feli, 2026-10-05) ----------
   El de Drive no andaba en el iPhone (0:00): WhatsApp los graba en OGG Opus,
   que Safari no reproduce. La app lo pide al servidor (audioChat) y, si el
   dispositivo no lo reproduce, lo pasa a WAV ahí mismo con un decodificador
   (ogg-opus-decoder, se baja solo la primera vez). Hay un solo reproductor
   para todos los audios, así no se corta cuando el chat se vuelve a dibujar. */
const CH_AU = { el: null, id: '', urls: {}, cargando: {}, vel: 1 };
// Velocidad, como WhatsApp (Feli, 2026-10-05): 1× → 1,5× → 2× (queda guardada en el dispositivo)
const VELOCIDADES = [1, 1.5, 2];
try { const v = Number(localStorage.getItem('compras_audio_vel')); if (VELOCIDADES.indexOf(v) >= 0) CH_AU.vel = v; } catch (e) { /* sin guardado */ }
function textoVel() { return String(CH_AU.vel).replace('.', ',') + '×'; }
const DECODER_OPUS = 'https://cdn.jsdelivr.net/npm/ogg-opus-decoder@1.7.5/dist/ogg-opus-decoder.min.js';
// Medio segundo de silencio: el iPhone solo deja sonar un audio que arrancó con un toque
const SILENCIO_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

function minSeg(s) {
  s = Math.max(0, Math.floor(s || 0));
  return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
}

function estadoAudio(id) {
  const activo = CH_AU.id === id && CH_AU.el && CH_AU.el.src !== SILENCIO_WAV;
  const el = activo ? CH_AU.el : null, dur = el && isFinite(el.duration) ? el.duration : 0;
  return { boton: CH_AU.cargando[id] ? '⏳' : (el && !el.paused ? '⏸' : '▶'),
           pos: dur ? Math.round(1000 * el.currentTime / dur) : 0, activo: !!el,
           texto: CH_AU.cargando[id] ? 'Abriendo el audio…' : (el && dur ? minSeg(el.currentTime) + ' / ' + minSeg(dur) : '🎤 Audio') };
}

function htmlAudio(id) {
  const e = estadoAudio(id);
  return '<div class="ch-audio" data-audio="' + esc(id) + '">' +
    '<button type="button" class="ch-au-b" data-audio-play="' + esc(id) + '" aria-label="Escuchar el audio">' + e.boton + '</button>' +
    '<input type="range" class="ch-au-r" min="0" max="1000" step="1" value="' + e.pos + '" aria-label="Adelantar o atrasar el audio"' + (e.activo ? '' : ' disabled') + '>' +
    '<span class="ch-au-t">' + esc(e.texto) + '</span>' +
    '<button type="button" class="ch-au-v" data-audio-vel aria-label="Cambiar la velocidad">' + textoVel() + '</button></div>';
}

/** Actualiza el audio en pantalla sin volver a dibujar el chat. */
function pintarAudio(id) {
  const caja = document.querySelector('.ch-audio[data-audio="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
  if (!caja) return;
  const e = estadoAudio(id), r = caja.querySelector('.ch-au-r');
  caja.querySelector('.ch-au-b').textContent = e.boton;
  caja.querySelector('.ch-au-t').textContent = e.texto;
  r.disabled = !e.activo;
  if (!r.dataset.moviendo) r.value = e.pos;
}

function cargarDecoderOpus() {
  if (window['ogg-opus-decoder']) return Promise.resolve();
  return new Promise(function (listo, mal) {
    const sc = document.createElement('script');
    sc.src = DECODER_OPUS;
    sc.onload = function () { listo(); };
    sc.onerror = function () { mal(new Error('Hace falta señal para preparar el audio.')); };
    document.head.appendChild(sc);
  });
}

/** Lo decodificado (canales de muestras entre -1 y 1) → un WAV de 16 bits que reproduce cualquier celular. */
function wavDe(canales, frecuencia) {
  const n = canales[0].length, c = canales.length, buf = new ArrayBuffer(44 + n * c * 2), v = new DataView(buf);
  const txt = function (o, t) { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  txt(0, 'RIFF'); v.setUint32(4, 36 + n * c * 2, true); txt(8, 'WAVE'); txt(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, c, true); v.setUint32(24, frecuencia, true);
  v.setUint32(28, frecuencia * c * 2, true); v.setUint16(32, c * 2, true); v.setUint16(34, 16, true);
  txt(36, 'data'); v.setUint32(40, n * c * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) {
    const x = Math.max(-1, Math.min(1, canales[k][i]));
    v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

async function urlDeAudio(id) {
  const r = await api('audioChat', id);
  if (!r.ok) throw new Error(r.sinConexion ? '📶 Hace falta señal para escuchar el audio.'
    : /desconocida/i.test(r.error || '') ? 'Para escuchar audios falta publicar la versión nueva de la app (Deploy → New version).'
    : (r.error || 'No se pudo abrir el audio.'));
  const bin = atob(r.datos), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const mime = String(r.mime || 'audio/ogg').split(';')[0].trim();
  const prueba = document.createElement('audio');
  const esOgg = /ogg|opus/i.test(mime);
  if (esOgg ? prueba.canPlayType('audio/ogg; codecs=opus') === 'probably' : prueba.canPlayType(mime)) {
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  }
  if (!esOgg) throw new Error('Este dispositivo no puede reproducir ese audio.');
  await cargarDecoderOpus();
  const dec = new window['ogg-opus-decoder'].OggOpusDecoder();
  await dec.ready;
  try {
    const d = await dec.decodeFile(bytes);
    if (!d.samplesDecoded) throw new Error('El audio está vacío.');
    return URL.createObjectURL(wavDe(d.channelData, d.sampleRate));
  } finally { dec.free(); }
}

async function tocarAudio(id) {
  if (CH_AU.cargando[id]) return;
  if (CH_AU.id === id && CH_AU.el && CH_AU.el.src !== SILENCIO_WAV) {
    if (CH_AU.el.paused) CH_AU.el.play().catch(function () {}); else CH_AU.el.pause();
    return;
  }
  const antes = CH_AU.id;
  if (CH_AU.el) CH_AU.el.pause();
  // El reproductor se arranca ya, con el toque, aunque el audio todavía no llegó (iPhone)
  const el = new Audio();
  CH_AU.el = el; CH_AU.id = id;
  if (antes && antes !== id) pintarAudio(antes);
  ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata', 'durationchange'].forEach(function (ev) {
    el.addEventListener(ev, function () { if (CH_AU.el === el) pintarAudio(id); });
  });
  el.addEventListener('ended', function () { el.currentTime = 0; });
  let url = CH_AU.urls[id];
  if (!url) {
    el.src = SILENCIO_WAV;
    el.play().catch(function () {});
    CH_AU.cargando[id] = true; pintarAudio(id);
    try { url = await urlDeAudio(id); CH_AU.urls[id] = url; }
    catch (e) { aviso(e.message, 'bad'); }
    delete CH_AU.cargando[id];
    if (!url || CH_AU.el !== el) { if (CH_AU.el === el) { CH_AU.el = null; CH_AU.id = ''; } pintarAudio(id); return; }
  }
  el.src = url;
  el.playbackRate = CH_AU.vel;
  el.play().catch(function () { pintarAudio(id); });
  pintarAudio(id);
}

function cambiarVelocidad() {
  CH_AU.vel = VELOCIDADES[(VELOCIDADES.indexOf(CH_AU.vel) + 1) % VELOCIDADES.length];
  try { localStorage.setItem('compras_audio_vel', String(CH_AU.vel)); } catch (e) { /* sin guardado */ }
  if (CH_AU.el && CH_AU.el.src !== SILENCIO_WAV) CH_AU.el.playbackRate = CH_AU.vel;
  document.querySelectorAll('.ch-au-v').forEach(function (b) { b.textContent = textoVel(); });
}

function moverAudio(id, valor) {
  const el = CH_AU.id === id ? CH_AU.el : null;
  if (el && isFinite(el.duration)) el.currentTime = el.duration * valor / 1000;
}

function htmlBurbuja(m, grupo) {
  // Una reacción a un mensaje que la app no tiene guardado: una línea, no una burbuja
  if (m.tipo === 'reactionMessage') {
    return '<div class="ch-fila ' + (m.sale ? 'sale' : 'entra') + '" data-id="' + esc(m.id) + '"><div class="ch-suelta">' +
      esc((m.sale ? 'Reaccionamos' : (m.quien || 'Reaccionó')) + ' ' + (m.texto || '') + ' a un mensaje de antes') + ' · ' + esc(horaMinutos(new Date(m.fecha))) + '</div></div>';
  }
  const tipoIcono = { locationMessage: '📍 ', contactMessage: '👤 ', pollMessage: '📊 ', contactsArrayMessage: '👤 ' }[m.tipo] || '';
  const reac = Object.keys(m.reacciones || {}).map(function (k) { return m.reacciones[k]; });
  let cuerpo = '';
  if (m.borrado) {
    cuerpo = '<div class="ch-tx borrado">🚫 Se eliminó este mensaje</div>' + (m.texto ? '<div class="ch-antes">Decía: ' + htmlTextoChat(m.texto) + '</div>' : '');
  } else {
    cuerpo = htmlArchivo(m) +
      (m.editado ? '<div class="ch-tx">' + htmlTextoChat(m.editado) + '</div><div class="ch-antes">Antes decía: ' + htmlTextoChat(m.texto) + '</div>'
                 : (m.texto && !(m.tipo === 'documentMessage' && m.texto === m.nombreArchivo) ? '<div class="ch-tx">' + tipoIcono + htmlTextoChat(m.texto) + '</div>' : ''));
  }
  const cita = m.citaDe ? '<div class="ch-citada"><b>' + esc(m.citaDe.sale ? 'Nosotros' : (m.citaDe.quien || 'Ellos')) + '</b>' + esc(m.citaDe.texto) + '</div>'
             : (m.cita ? '<div class="ch-citada"><b>Mensaje citado</b>(de antes de que la app guardara este chat)</div>' : '');
  return '<div class="ch-fila ' + (m.sale ? 'sale' : 'entra') + '" data-id="' + esc(m.id) + '">' +
    '<div class="ch-bur' + (m.esperando ? ' espera' : '') + '">' +
    (!m.esperando ? '<button type="button" class="ch-menu" data-menu="' + esc(m.id) + '" aria-label="Opciones del mensaje">⌄</button>' : '') +
    (grupo && !m.sale && m.quien ? '<div class="ch-de">' + esc(m.quien) + '</div>' : '') +
    (m.sale && m.desde === 'app' ? '<div class="ch-de">' + (m.quien ? esc(m.quien) + ' · d' : 'D') + 'esde la app</div>' : '') +
    cita + cuerpo +
    '<div class="ch-pie">' + (m.editado ? 'Editado · ' : '') + esc(horaMinutos(new Date(m.fecha))) +
    (m.esperando ? ' ⏳' : m.sale ? ' <span class="ch-tick' + (m.estado === 'read' || m.estado === 'played' ? ' leido' : '') + '">' + (TICKS[m.estado] || '') + '</span>' : '') + '</div>' +
    '</div>' + (reac.length ? '<div class="ch-reac">' + esc(reac.join(' ')) + '</div>' : '') + '</div>';
}

function pintarChat(alFondo) {
  const d = CH.datos, chat = CH.abierto;
  if (!chat) return;
  const info = (d && d.chat) || (CH.lista || []).filter(function (c) { return c.chat === chat; })[0] || { nombre: chat };
  $('ch-nombre').textContent = info.nombre || chat;
  $('ch-sub').textContent = info.proveedor ? '🏪 ' + info.proveedor : (info.grupo || /@g\.us$/.test(chat) ? 'Grupo' : '+' + chat.replace(/@.*/, ''));
  const tarjetas = (d && d.tarjetas) || [];
  $('ch-ver-tarjetas').textContent = '📋 Tarjetas' + (tarjetas.length ? ' (' + tarjetas.length + ')' : '');
  pintarPanelChat();
  if (d && document.activeElement !== $('ch-notas')) $('ch-notas').value = (d.chat && d.chat.notas) || '';
  $('ch-ver-notas').textContent = d && d.chat && d.chat.notas ? '📝 Notas •' : '📝 Notas';
  const caja = $('ch-msjs');
  if (!d) { caja.innerHTML = '<p class="nota" style="padding:12px">Cargando el chat…</p>'; return; }
  const cerca = caja.scrollHeight - caja.scrollTop - caja.clientHeight < 120;
  const ms = (d.mensajes || []).concat(mandadosEsperando(chat).filter(function (x) { return !(d.mensajes || []).some(function (y) { return y.id === x.id; }); }));
  let html = d.chat && !d.chat.historia ? '<p class="ch-aviso">Acá están los mensajes desde que la app empezó a guardar este chat. Los de antes siguen en el celular.</p>' : '';
  let dia = '';
  ms.forEach(function (m) {
    const f = new Date(m.fecha), k = f.toDateString();
    if (k !== dia) { dia = k; html += '<div class="ch-dia"><span>' + esc(f.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })) + '</span></div>'; }
    html += htmlBurbuja(m, info.grupo || /@g\.us$/.test(chat));
  });
  if (!ms.length) html += '<p class="nota" style="padding:12px;text-align:center">Todavía no hay mensajes en este chat.</p>';
  caja.innerHTML = html;
  caja.querySelectorAll('[data-foto]').forEach(function (b) { b.addEventListener('click', function () { verFoto(b.dataset.foto); }); });
  caja.querySelectorAll('[data-audio-play]').forEach(function (b) { b.addEventListener('click', function () { tocarAudio(b.dataset.audioPlay); }); });
  caja.querySelectorAll('[data-audio-vel]').forEach(function (b) { b.addEventListener('click', cambiarVelocidad); });
  caja.querySelectorAll('.ch-audio .ch-au-r').forEach(function (r) {
    const id = r.parentNode.dataset.audio;
    r.addEventListener('input', function () { r.dataset.moviendo = '1'; });
    r.addEventListener('change', function () { delete r.dataset.moviendo; moverAudio(id, Number(r.value)); });
  });
  caja.querySelectorAll('[data-menu]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); menuMensaje(b.dataset.menu); }); });
  // En el celular: mantener apretado un mensaje abre el mismo menú
  caja.querySelectorAll('.ch-bur').forEach(function (el) {
    let t = null;
    el.addEventListener('touchstart', function (e) {
      if (e.target.closest('.ch-audio')) return;   // apretar el audio no abre el menú
      const id = el.parentNode.dataset.id; t = setTimeout(function () { t = null; menuMensaje(id); }, 550);
    }, { passive: true });
    ['touchend', 'touchmove', 'touchcancel'].forEach(function (ev) { el.addEventListener(ev, function () { if (t) { clearTimeout(t); t = null; } }, { passive: true }); });
  });
  if (alFondo || cerca) caja.scrollTop = caja.scrollHeight;
  pintarCita();
}

function mensajeDelChat(id) {
  return ((CH.datos && CH.datos.mensajes) || []).filter(function (m) { return m.id === id; })[0];
}

/** El menú de la flechita (como WhatsApp en la compu): Responder o Copiar. */
async function menuMensaje(id) {
  const m = mensajeDelChat(id);
  if (!m) return;
  const que = await elegir('Mensaje', '', [{ opciones: [{ texto: '↩️ Responder (citando este mensaje)', valor: 'responder' }, { texto: '📋 Copiar el texto', valor: 'copiar' }] }]);
  if (que === 'responder') {
    CH.cita = { id: m.id, quien: m.sale ? 'Nosotros' : (m.quien || $('ch-nombre').textContent), texto: resumenChat(m) };
    pintarCita();
    $('ch-texto').focus();
  } else if (que === 'copiar') {
    const t = m.editado || m.texto || '';
    try { await navigator.clipboard.writeText(t); aviso('Copiado.'); } catch (e) { aviso('No se pudo copiar.', 'bad'); }
  }
}

function resumenChat(m) {
  const ic = { imageMessage: '📷 Foto', videoMessage: '🎥 Video', audioMessage: '🎤 Audio', stickerMessage: 'Sticker', documentMessage: '📄 ' + (m.nombreArchivo || 'Documento') }[m.tipo];
  const t = m.editado || m.texto || '';
  return ic ? ic + (t && t !== m.nombreArchivo ? ': ' + t : '') : t;
}

function pintarCita() {
  const c = CH.cita;
  $('ch-cita').hidden = !c;
  if (!c) return;
  $('ch-cita-quien').textContent = c.quien;
  $('ch-cita-texto').textContent = c.texto.length > 140 ? c.texto.slice(0, 140) + '…' : c.texto;
}
$('ch-cita-x').addEventListener('click', function () { CH.cita = null; pintarCita(); });

/* ---------- Mandar ---------- */
function mandarTexto() {
  const chat = CH.abierto, texto = $('ch-texto').value.trim();
  if (!chat || !texto) return;
  const cita = CH.cita;
  bandeja.agregar('mandarMensaje', [{ id: 'H' + nuevoId(), chat: chat, texto: texto, cita: cita ? cita.id : '',
                                      citaDe: cita ? { quien: cita.quien, sale: cita.quien === 'Nosotros', texto: cita.texto } : null }],
                  'mandar un mensaje a ' + $('ch-nombre').textContent);
  $('ch-texto').value = '';
  ajustarAltoTexto();
  CH.cita = null;
  pintarChat(true);
  if (!APP.enLinea) aviso('📶 Poca señal: el mensaje se manda solo cuando vuelva.');
}
$('ch-mandar').addEventListener('click', mandarTexto);
$('ch-texto').addEventListener('keydown', function (e) {
  // En la compu, Enter manda (Mayúscula + Enter: otro renglón), como en WhatsApp
  if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(hover: none)').matches) { e.preventDefault(); mandarTexto(); }
});
function ajustarAltoTexto() { const t = $('ch-texto'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 140) + 'px'; }
$('ch-texto').addEventListener('input', ajustarAltoTexto);

$('ch-adjuntar').addEventListener('click', function () {
  if (!APP.enLinea) return aviso('📶 Para mandar una foto o un PDF hace falta señal.');
  $('ch-archivo').value = '';
  $('ch-archivo').click();
});
$('ch-archivo').addEventListener('change', async function () {
  const f = this.files && this.files[0], chat = CH.abierto;
  if (!f || !chat) return;
  const esPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  if (!esPdf && !/^image\//.test(f.type)) return aviso('Solo se pueden mandar fotos o PDF.', 'bad');
  if (esPdf && f.size > ADJUNTO_MAX_MB * 1024 * 1024) return aviso('El PDF pesa más de ' + ADJUNTO_MAX_MB + ' MB.', 'bad');
  let blob = f, nombre = f.name;
  if (!esPdf) { try { const c = await comprimirFoto(f); blob = c.blob; nombre = c.nombre; } catch (e) { return aviso('No se pudo leer la foto.', 'bad'); } }
  const texto = $('ch-texto').value.trim(), cita = CH.cita;
  aviso('Mandando ' + (esPdf ? 'el PDF' : 'la foto') + '…');
  const r = await api('mandarArchivoChat', { id: 'H' + nuevoId(), chat: chat, nombre: nombre, tipo: esPdf ? 'pdf' : 'foto',
                                             base64: await blobABase64(blob), texto: texto, cita: cita ? cita.id : '' });
  if (!r.ok) return aviso(r.sinConexion ? '📶 Poca señal: no se pudo mandar. Probá de nuevo cuando vuelva.' : r.error, 'bad');
  if (texto) $('ch-texto').value = '';
  CH.cita = null;
  sumarMandado(chat, r.mensaje);
  aviso('Listo: se mandó.');
});

function sumarMandado(chat, m) {
  if (!m || CH.abierto !== chat || !CH.datos) return;
  if (!CH.datos.mensajes.some(function (x) { return x.id === m.id; })) CH.datos.mensajes.push(m);
  guardado.guardarJSON(K_CHAT + chat, CH.datos);
  pintarChat(true);
}

/* ---------- Mensajes prediseñados ---------- */
$('ch-predis').addEventListener('click', async function () {
  const l = (CH.datos && CH.datos.predisenados) || [];
  if (!l.length) return aviso('Todavía no hay mensajes prediseñados. Se cargan en Admin → Ajustes.');
  const t = await elegir('Mensajes prediseñados', 'Se pega en el cuadro de texto: lo podés cambiar antes de mandarlo.',
                         [{ opciones: l.map(function (x) { return { texto: x, valor: x }; }) }]);
  if (!t) return;
  const caja = $('ch-texto');
  caja.value = caja.value.trim() ? caja.value.trim() + '\n' + t : t;
  ajustarAltoTexto();
  caja.focus();
});

/* ---------- Notas y tarjetas ---------- */
$('ch-ver-notas').addEventListener('click', function () { $('ch-notas-p').hidden = !$('ch-notas-p').hidden; if (!$('ch-notas-p').hidden) $('ch-notas').focus(); });
$('ch-notas-ok').addEventListener('click', function () {
  const chat = CH.abierto;
  if (!chat) return;
  const t = $('ch-notas').value.trim();
  bandeja.agregar('guardarNotaChat', [chat, t], 'guardar la nota del chat');
  if (CH.datos && CH.datos.chat) CH.datos.chat.notas = t;
  $('ch-notas-p').hidden = true;
  pintarChat();
  aviso(APP.enLinea ? 'Nota guardada.' : '📶 Poca señal: la nota se guarda sola cuando vuelva.');
});
$('ch-ver-tarjetas').addEventListener('click', function () { $('ch-panel').hidden = !$('ch-panel').hidden; });

function pintarPanelChat() {
  const d = CH.datos, p = $('ch-panel');
  if (!d) { p.innerHTML = ''; return; }
  const l = d.tarjetas || [];
  p.innerHTML = (l.length ? l.map(function (t) {
    return '<button type="button" class="ch-tj" data-ref="' + esc(t.ref) + '"><b>' + esc(t.titulo || t.ref) + '</b><small>' +
      esc([t.codigo, t.manual ? '✋ Gestión manual' : '', t.columna, t.proveedor ? 'pedido a ' + t.proveedor : ''].filter(String).join(' · ')) + '</small></button>';
  }).join('') : '<p class="nota" style="margin:0">Este chat no tiene tarjetas abiertas.</p>') +
    '<button type="button" class="btn-chico" id="ch-sumar-manual">✋ Ver tarjetas de gestión manual</button>';
  p.querySelectorAll('.ch-tj').forEach(function (b) { b.addEventListener('click', function () { abrirTarjeta(b.dataset.ref); }); });
  $('ch-sumar-manual').addEventListener('click', sumarAManual);
}

/** Desde el chat: sumarlo a una tarjeta ✋ manual ("Proveedores con los que se está hablando"). */
async function sumarAManual() {
  const d = CH.datos, chat = CH.abierto;
  if (!d || !chat) return;
  const ya = {};
  (d.tarjetas || []).forEach(function (t) { if (t.manual) ya[t.ref] = true; });
  const l = (d.manuales || []).filter(function (t) { return !ya[t.ref]; });
  if (!l.length) return aviso('No hay otras tarjetas de gestión manual abiertas.');
  const ref = await elegir('Tarjetas de gestión manual', 'Elegí a cuál sumar este chat: va a aparecer en "Proveedores con los que se está hablando".',
                           [{ opciones: l.map(function (t) { return { texto: (t.servicio ? '🔧 ' : '') + (t.titulo || t.ref) + ' · ' + t.sitio + ' · ' + t.columna, valor: t.ref }; }) }]);
  if (!ref) return;
  bandeja.agregar('vincularChat', [ref, chat, true], 'sumar el chat a la tarjeta');
  const t = l.filter(function (x) { return x.ref === ref; })[0];
  d.tarjetas = (d.tarjetas || []).concat([{ ref: ref, titulo: t.titulo, columna: t.columna, codigo: '', proveedor: '', manual: true }]);
  pintarChat();
  $('ch-panel').hidden = false;
}

$('ch-volver').addEventListener('click', function () { CH.abierto = null; CH.datos = null; mostrarPanelChat(false); pintarListaChats(); });

/** Desde otra pantalla (la tarjeta abierta): ir a un chat. */
function irAlChat(chat) {
  if (!chat) return;
  if (TB.abierta) cerrarTarjeta();
  ir('chats', { chat: chat });
}

/* ---------- En la tarjeta abierta: "Proveedores con los que se está hablando" (✋ manuales) ---------- */
function pintarHablando() {
  const b = $('tj-hablando-b');
  if (!b) return;
  const d = TB.detalle, p = d && d.pedido;
  b.hidden = !APP.yo.admin || TB.tipo === 'tarea' || !p || !p.manual || esTrabajo(TB.abierta);
  if (b.hidden) return;
  const l = p.chats || [];
  $('tj-hablando').innerHTML = l.length ? l.map(function (c) {
    return '<div class="cot-fila"><div><b>' + esc(c.nombre) + '</b></div><div class="cambio-b">' +
      '<button type="button" class="btn-chico" data-ir-chat="' + esc(c.chat) + '">💬 Abrir chat</button>' +
      '<button type="button" class="btn-chico" data-sacar-chat="' + esc(c.chat) + '">Sacar</button></div></div>';
  }).join('') : '<p class="nota" style="margin:0">Todavía no se sumó ningún proveedor.</p>';
  $('tj-hablando').querySelectorAll('[data-ir-chat]').forEach(function (x) { x.addEventListener('click', function () { irAlChat(x.dataset.irChat); }); });
  $('tj-hablando').querySelectorAll('[data-sacar-chat]').forEach(function (x) {
    x.addEventListener('click', function () {
      const ref = TB.abierta;
      bandeja.agregar('vincularChat', [ref, x.dataset.sacarChat, false], 'sacar el proveedor de la tarjeta');
      p.chats = (p.chats || []).filter(function (c) { return c.chat !== x.dataset.sacarChat; });
      pintarHablando();
    });
  });
}

$('tj-hablando-sumar').addEventListener('click', async function () {
  const ref = TB.abierta, p = TB.detalle && TB.detalle.pedido;
  if (!ref || !p) return;
  if (!CH.lista) { await cargarListaChats(); }
  if (!CH.lista) return aviso('📶 Poca señal: la lista de chats se ve cuando vuelva.');
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = '<label for="hb-q">Buscá el proveedor (o el chat)</label><input type="search" id="hb-q" autocomplete="off" placeholder="Nombre o número">' +
    '<div class="opciones" id="hb-l" style="margin-top:8px"></div>';
  let elegido = null;
  const pintar = function () {
    const q = sinAcentos($('hb-q').value), ya = (p.chats || []).map(function (c) { return c.chat; });
    const l = CH.lista.filter(function (c) { return !c.grupo && ya.indexOf(c.chat) === -1 && (!q || sinAcentos(c.nombre + ' ' + c.proveedor + ' ' + c.chat).indexOf(q) !== -1); })
      .sort(function (a, b) { return (b.proveedor ? 1 : 0) - (a.proveedor ? 1 : 0); }).slice(0, 30);
    $('hb-l').innerHTML = l.map(function (c) { return '<button type="button" class="choice" data-c="' + esc(c.chat) + '">' + esc(c.nombre) + (c.proveedor ? ' <small>· 🏪 ' + esc(c.proveedor) + '</small>' : '') + '</button>'; }).join('') ||
      '<p class="nota">No hay chats con ese nombre.</p>';
    $('hb-l').querySelectorAll('[data-c]').forEach(function (x) {
      x.addEventListener('click', function () { elegido = { chat: x.dataset.c, nombre: x.textContent.replace(/ · 🏪.*/, '') }; if (cerrarDialogoActual) cerrarDialogoActual(elegido); });
    });
  };
  const r = await dialogo({ titulo: '＋ Sumar proveedor', cuerpo: cuerpo, botones: [{ texto: 'Volver', valor: null }],
                            alAbrir: function () { $('hb-q').addEventListener('input', pintar); pintar(); $('hb-q').focus(); } });
  if (!r) return;
  bandeja.agregar('vincularChat', [ref, r.chat, true], 'sumar el proveedor a la tarjeta');
  p.chats = (p.chats || []).concat([r]);
  pintarHablando();
});

/* ---------- Cuando sale de la bandeja ---------- */
(function () {
  const antes = bandeja.alTerminar;
  bandeja.alTerminar = function (m, r) {
    if (antes) antes(m, r);
    if (m.fn === 'mandarMensaje') {
      if (r.ok) sumarMandado(m.args[0].chat, r.mensaje);
      else if (CH.abierto === m.args[0].chat) pintarChat();
    } else if (m.fn === 'vincularChat' && r.ok) {
      if (TB.abierta === m.args[0] && TB.detalle && TB.detalle.pedido) { TB.detalle.pedido.chats = r.chats; pintarHablando(); }
    }
  };
})();

/* ---------- ¿Hay algo nuevo? Cada 5 s, con la pantalla de chats a la vista ---------- */
setInterval(async function () {
  if (document.hidden || document.body.dataset.pantalla !== 'chats' || !APP.token || !APP.yo || !APP.yo.admin) return;
  const r = await api('versionChats', CH.abierto || '');
  if (!r.ok) return;
  if (CH.abierto && r.chat && r.chat !== CH.version.chat) recargarChat(false);
  // La lista, como mucho cada 20 s (con el WhatsApp personal cambia muy seguido)
  if (r.lista !== CH.version.lista && Date.now() - CH.listaHora > 20000) cargarListaChats();
}, 5000);
