'use strict';
/* ============================================================
   BASE DE LA APP DESCARGADA: el servidor, lo guardado en el
   dispositivo, la bandeja de salida, la navegación y los avisos.
   Lo usan login.js y pantallas.js.
   La app abre sin señal (sw.js) con lo último que guardó. Lo que
   cambia datos va a la bandeja de salida y se manda solo cuando hay
   señal; cada envío lleva un número único, así un reintento no se
   procesa dos veces en el servidor (recordarEnvio_ en Api.js).
   ============================================================ */

const API = location.hostname === 'localhost'
  ? location.origin + '/exec'     // servidor de prueba en la compu de Claude: corre el mismo código del Apps Script
  : 'https://script.google.com/macros/s/AKfycbzhD_LiZqCkHeJXVouw_es70R1FUut8w0lCZG3Bglxcnq8OJCIS-zJ2iVEegoaIZkU7/exec';
const FORMULARIO = './pedido/';       // "Nuevo pedido"
const VERSION_APP = '2f88c59f67';            // subir-pagina.sh pone acá la misma huella que en sw.js
const LIMITE_MS = 25000;              // tiempo límite por llamada: nunca queda "cargando" para siempre

// Claves de lo guardado en el dispositivo. compras_token y compras_desde son las
// mismas que usaba la página vieja: quien ya había entrado sigue adentro.
const K = {
  token: 'compras_token', desde: 'compras_desde', inicio: 'compras_inicio',
  usuarios: 'compras_usuarios', css: 'compras_css', bandeja: 'compras_bandeja'
};
const APP = { token: null, yo: null, config: null, actualizado: null, enLinea: true };

const $ = function (id) { return document.getElementById(id); };

/* ---------- Guardado en el dispositivo (con try: puede fallar en modo privado) ---------- */
const guardado = {
  leer(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  guardar(k, v) { try { localStorage.setItem(k, v); return localStorage.getItem(k) === v; } catch (e) { return false; } },
  borrar(k) { try { localStorage.removeItem(k); } catch (e) {} },
  leerJSON(k, def) {
    const v = this.leer(k);
    if (v === null) return def;
    try { return JSON.parse(v); } catch (e) { return def; }
  },
  guardarJSON(k, v) { return this.guardar(k, JSON.stringify(v)); }
};

/** Número único (para los envíos y los renglones de la bandeja). */
function nuevoId() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = '';
  const b = new Uint8Array(10);
  (window.crypto || window.msCrypto).getRandomValues(b);
  b.forEach(function (x) { r += a[x % a.length]; });
  return 'A' + Date.now().toString(36).toUpperCase() + '-' + r;
}

/* ---------- Servidor ---------- */

/**
 * Llama a una función de Api.js (por doPost). Devuelve su respuesta
 * ({ok, ...}). Si no hay señal o no contesta a tiempo, falla con
 * e.sinRed; si contesta algo que no es JSON, con e.servidor.
 * Sin cabeceras propias: así el navegador no pide permiso antes (CORS).
 */
async function llamar(fn, args, id) {
  const ctl = window.AbortController ? new AbortController() : null;
  const vence = setTimeout(function () { if (ctl) ctl.abort(); }, LIMITE_MS);
  let resp;
  try {
    resp = await fetch(API, {
      method: 'POST', cache: 'no-store', signal: ctl ? ctl.signal : undefined,
      body: JSON.stringify({ fn: fn, args: args || [], id: id || nuevoId() })
    });
  } catch (e) {
    conexion(false);
    const x = new Error('sin señal'); x.sinRed = true; throw x;
  } finally { clearTimeout(vence); }
  conexion(true);
  try {
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  } catch (e) {
    const x = new Error('respuesta rara del servidor: ' + e.message); x.servidor = true; throw x;
  }
}

/**
 * Llama a una función de Api.js con la llave como primer parámetro.
 * Si la llave dejó de valer (revocada, usuario inactivo), vuelve sola al
 * login. Nunca falla: sin señal resuelve {ok:false, sinConexion:true}.
 */
async function api(fn) {
  const args = [APP.token].concat(Array.prototype.slice.call(arguments, 1));
  try {
    const r = await llamar(fn, args);
    if (r && r.sinSesion) sesionPerdida(r.error);
    return r;
  } catch (e) {
    return e.servidor ? { ok: false, error: 'Error del servidor. Probá de nuevo en un rato.' }
                      : { ok: false, sinConexion: true, error: 'Sin señal. Probá de nuevo cuando tengas conexión.' };
  }
}

/**
 * Actualización optimista: aplicar() cambia la pantalla ya, sin esperar al
 * servidor. Si el servidor dice que no, revertir() la deja como estaba y
 * aparece un aviso. (Los cambios que tienen que llegar aunque no haya
 * señal van por la bandeja de salida.)
 */
async function optimista(aplicar, revertir, fn) {
  const args = Array.prototype.slice.call(arguments, 2);
  aplicar();
  const r = await api.apply(null, args);
  if (!r.ok) {
    revertir();
    if (!r.sinSesion) aviso(r.error, 'bad');
  }
  return r;
}

/* ---------- Bandeja de salida ----------
   Cada renglón: {clave, id, fn, args, token, texto, creado, intentos}.
   clave identifica el renglón; id es el número de envío que va al servidor
   (en un reintento se repite a propósito, por eso no sirve como clave).
   La llave va en el renglón: un cierre de sesión sin señal se manda igual
   aunque en el dispositivo ya no esté la llave. */
const bandeja = {
  enviando: false,
  alTerminar: null,     // function (renglon, respuesta): la pantalla que la necesite
  lista() { return guardado.leerJSON(K.bandeja, []); },
  pendientes() { return this.lista().length; },
  guardarLista(l) { guardado.guardarJSON(K.bandeja, l); pintarSinRed(); },
  agregar(fn, args, texto) {
    const l = this.lista();
    l.push({ clave: nuevoId(), id: nuevoId(), fn: fn, args: args || [], token: APP.token,
             texto: texto || fn, creado: new Date().toISOString(), intentos: 0 });
    this.guardarLista(l);
    this.procesar();
  },
  quitar(clave) { this.guardarLista(this.lista().filter(function (x) { return x.clave !== clave; })); },
  async procesar() {
    if (this.enviando) return;
    this.enviando = true;
    pintarSinRed();
    try {
      for (const m of this.lista()) {
        let r;
        try {
          r = await llamar(m.fn, [m.token].concat(m.args), m.id);
        } catch (e) {
          if (e.sinRed) break;                          // sin señal: se reintenta después, en orden
          // El servidor contestó algo raro: se reintenta, pero no para siempre
          const l = this.lista(), x = l.find(function (y) { return y.clave === m.clave; });
          if (x && ++x.intentos < 5) { this.guardarLista(l); break; }
          r = { ok: false, error: 'el servidor no lo aceptó' };
        }
        this.quitar(m.clave);
        if (!r.ok && !r.sinSesion) aviso('No se pudo ' + m.texto + ': ' + r.error, 'bad');
        if (this.alTerminar) this.alTerminar(m, r);
      }
    } finally {
      this.enviando = false;
      pintarSinRed();
    }
  }
};

/* ---------- Señal ---------- */
function conexion(hay) {
  if (APP.enLinea === hay) return;
  APP.enLinea = hay;
  pintarSinRed();
}

/** El aviso de debajo de la barra: sin señal, o cambios esperando para mandarse. */
function pintarSinRed() {
  const el = $('sinred');
  if (!el) return;
  const n = bandeja.pendientes();
  const cambios = n === 1 ? '1 cambio' : n + ' cambios';
  let texto = '';
  if (!APP.enLinea) {
    texto = '📴 Sin señal · ' + (n ? cambios + ' esperando para mandarse'
                                     : 'mostrando lo guardado' + (APP.actualizado ? ' (' + hace(APP.actualizado) + ')' : ''));
  } else if (n) {
    texto = '⏳ Mandando ' + cambios + '…';
  }
  el.textContent = texto;
  el.hidden = !texto;
}

function hace(iso) {
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return 'hace ' + min + ' min';
  const h = Math.round(min / 60);
  if (h < 24) return 'hace ' + h + (h === 1 ? ' hora' : ' horas');
  const d = Math.round(h / 24);
  return 'hace ' + d + (d === 1 ? ' día' : ' días');
}

/* ---------- Avisos ---------- */
let timerAviso = null;
function aviso(texto, tipo) {
  const el = $('toast');
  el.textContent = texto;
  el.className = 'toast' + (tipo ? ' ' + tipo : '');
  el.hidden = false;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(function () { el.hidden = true; }, tipo === 'bad' ? 6000 : 3000);
}

/** Estado dentro de un formulario (login y otras pantallas). */
function estado(id, texto, tipo) {
  const el = $(id);
  el.hidden = !texto;
  el.textContent = texto || '';
  el.className = 'estado ' + (tipo || 'bad');
}

/* ---------- Navegación ----------
   Cada pantalla se registra con pantalla(id, {titulo, tab, alMostrar}).
   ir(id, datos) cambia de pestaña; abrir(id, datos) apila una pantalla
   (ej. el detalle de un pedido) y muestra el botón Volver. */
const PANTALLAS = {};
const pila = [];

function pantalla(id, def) { PANTALLAS[id] = def; }

function mostrarPantalla(id, datos) {
  const def = PANTALLAS[id];
  if (!def) return;
  Object.keys(PANTALLAS).forEach(function (p) { $('s-' + p).hidden = p !== id; });
  $('b-titulo').textContent = def.titulo;
  $('b-volver').hidden = pila.length < 2;
  document.querySelectorAll('.tabs .tab[data-tab]').forEach(function (t) {
    if (t.dataset.tab === (def.tab === undefined ? id : def.tab)) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  if (def.alMostrar) def.alMostrar(datos || {});
}

function ir(id, datos) {
  pila.length = 0;
  pila.push({ id: id, datos: datos });
  mostrarPantalla(id, datos);
}

function abrir(id, datos) {
  pila.push({ id: id, datos: datos });
  mostrarPantalla(id, datos);
}

function volver() {
  if (pila.length < 2) return;
  pila.pop();
  const anterior = pila[pila.length - 1];
  mostrarPantalla(anterior.id, anterior.datos);
}

/* ---------- Dispositivo (para App_Sesiones) ---------- */
function dispositivo() {
  const ua = navigator.userAgent;
  const so = /iPhone|iPad|iPod/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android'
           : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : 'Otro';
  const nav = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /EdgA?\//.test(ua) ? 'Edge'
            : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox'
            : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return so + ' · ' + nav + (instalada() ? ' (app instalada)' : '');
}

function instalada() {
  try { return !!navigator.standalone || matchMedia('(display-mode: standalone)').matches; } catch (e) { return false; }
}

/* ---------- Guardar la app en el dispositivo (sw.js) y actualizarla ----------
   Cuando hay una versión nueva, sw.js la guarda por detrás. Se recarga
   sola la próxima vez que se vuelve a la app, salvo en medio de entrar. */
let hayVersionNueva = false;
if ('serviceWorker' in navigator) {
  const yaHabia = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(function () {});
  navigator.serviceWorker.addEventListener('controllerchange', function () { if (yaHabia) hayVersionNueva = true; });
}

/* ---------- Reintentos: al volver la señal, al volver a la app y cada 15 s si hay pendientes ---------- */
window.addEventListener('online', function () { bandeja.procesar(); if (window.alVolverLaSenal) alVolverLaSenal(); });
window.addEventListener('offline', function () { conexion(false); });
document.addEventListener('visibilitychange', function () {
  if (document.hidden) return;
  if (hayVersionNueva && !(window.enMedioDeEntrar && enMedioDeEntrar()) && !bandeja.enviando) return location.reload();
  bandeja.procesar();
  if (window.alVolverALaApp) alVolverALaApp();
});
setInterval(function () { if (!document.hidden && bandeja.pendientes()) bandeja.procesar(); }, 15000);
