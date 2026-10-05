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
const FORMULARIO = new URL('../pedido/', document.currentScript.src).href;   // "Nuevo pedido"
// Apartados de la app (Fase extra): Compras (el tablero) y Transferencias (el Programa de Compras)
const APARTADOS = {
  compras: { nombre: 'Compras', url: new URL('../', document.currentScript.src).href },
  transferencias: { nombre: 'Transferencias', url: new URL('../transferencias/', document.currentScript.src).href }
};
const K_APARTADO = 'compras_apartado';     // el último que se abrió en este dispositivo: la app vuelve a ese
const VERSION_APP = '755c4a21bd';            // subir-pagina.sh pone acá la misma huella que en sw.js
const LIMITE_MS = 25000;              // tiempo límite por llamada: nunca queda "cargando" para siempre

// Claves de lo guardado en el dispositivo. compras_token y compras_desde son las
// mismas que usaba la página vieja: quien ya había entrado sigue adentro.
const K = {
  token: 'compras_token', desde: 'compras_desde', inicio: 'compras_inicio',
  usuarios: 'compras_usuarios', css: 'compras_css', bandeja: 'compras_bandeja',
  cssMio: 'compras_css_mio', estilo: 'compras_estilo',   // el color y el estilo de tablero que eligió cada uno (Paso 6)
  error: 'compras_error'   // la última respuesta rara del servidor (se ve en Tu cuenta)
};
const APP = { token: null, yo: null, config: null, actualizado: null, enLinea: true };

const $ = function (id) { return document.getElementById(id); };

/** Los apartados que ve cada uno (inicioApp). Un servidor viejo no los manda: solo Compras, como siempre. */
function misApartados(yo) {
  return yo && Array.isArray(yo.apartados) ? yo.apartados : ['compras'];
}

/** La barrita "Compras | Transferencias": solo si ve más de uno. actual = el apartado de esta página. */
function pintarApartados(cont, yo, actual) {
  if (!cont) return;
  const ap = misApartados(yo);
  cont.hidden = ap.length < 2;
  cont.innerHTML = '';
  ap.forEach(function (id) {
    const a = document.createElement('a');
    a.textContent = APARTADOS[id].nombre;
    a.href = APARTADOS[id].url;
    if (id === actual) a.setAttribute('aria-current', 'page');
    a.addEventListener('click', function () { guardado.guardar(K_APARTADO, id); });
    cont.appendChild(a);
  });
}

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
 * Google a veces contesta con su propia página de error (sobre todo al
 * "despertar"): en ese caso reintenta solo, con el mismo número de envío,
 * así un cambio no se repite (recordarEnvio_ en Api.js).
 */
async function llamar(fn, args, id, opciones) {
  id = id || nuevoId();
  const limite = (opciones && opciones.limiteMs) || LIMITE_MS;
  const esperas = [1500, 4000];
  for (let intento = 0; ; intento++) {
    try {
      return await llamarUnaVez(fn, args, id, limite);
    } catch (e) {
      if (!e.servidor || intento >= esperas.length) throw e;
      await new Promise(function (ok) { setTimeout(ok, esperas[intento]); });
    }
  }
}

/** Una sola llamada. Sin cabeceras propias: así el navegador no pide permiso antes (CORS). */
async function llamarUnaVez(fn, args, id, limite) {
  const ctl = window.AbortController ? new AbortController() : null;
  const vence = setTimeout(function () { if (ctl) ctl.abort(); }, limite);
  let resp;
  try {
    resp = await fetch(API, {
      method: 'POST', cache: 'no-store', signal: ctl ? ctl.signal : undefined,
      body: JSON.stringify({ fn: fn, args: args || [], id: id })
    });
  } catch (e) {
    // Si se cortó por tiempo, hay conexión pero Google está tardando: no es "poca señal"
    const lento = e && e.name === 'AbortError';
    if (!lento) conexion(false);
    const x = new Error(lento ? 'Google tardó demasiado' : 'sin señal'); x.sinRed = true; x.lento = lento; throw x;
  } finally { clearTimeout(vence); }
  conexion(true);
  const texto = await resp.text().catch(function () { return ''; });
  try {
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return JSON.parse(texto);
  } catch (e) {
    // Se guarda para verlo en Tu cuenta (sirve para saber qué contestó Google)
    guardado.guardarJSON(K.error, { cuando: new Date().toISOString(), fn: fn,
                                    detalle: e.message + ' · ' + texto.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) });
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
                      : { ok: false, sinConexion: true, error: 'Hay poca señal y no se pudo. Probá de nuevo en un rato.' };
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
  /** Devuelve la clave del renglón (sirve para sacarlo si todavía no se mandó, ej. "Deshacer"). */
  agregar(fn, args, texto) {
    const l = this.lista();
    const clave = nuevoId();
    l.push({ clave: clave, id: nuevoId(), fn: fn, args: args || [], token: APP.token,
             texto: texto || fn, creado: new Date().toISOString(), intentos: 0 });
    this.guardarLista(l);
    this.procesar();
    return clave;
  },
  /** true si el renglón sigue esperando (no se mandó todavía). */
  pendiente(clave) { return this.lista().some(function (x) { return x.clave === clave; }); },
  quitar(clave) { this.guardarLista(this.lista().filter(function (x) { return x.clave !== clave; })); },
  /**
   * Manda lo pendiente, en orden. Varios juntos en un solo viaje ('lote' en
   * Api.js): cada viaje a Google tarda unos segundos. Sin señal (o si Google
   * tarda demasiado) para y se reintenta después, con los mismos números.
   */
  async procesar() {
    if (this.enviando) return;
    this.enviando = true;
    pintarSinRed();
    try {
      while (true) {
        const tanda = this.lista().slice(0, 20);
        if (!tanda.length) break;
        let respuestas;
        try {
          if (tanda.length === 1) {
            respuestas = [await llamar(tanda[0].fn, [tanda[0].token].concat(tanda[0].args), tanda[0].id, { limiteMs: 60000 })];
          } else {
            const r = await llamar('lote', [tanda.map(function (m) { return { fn: m.fn, args: [m.token].concat(m.args), id: m.id }; })],
                                   null, { limiteMs: 90000 });
            if (!r.ok || !Array.isArray(r.respuestas)) { const x = new Error(r.error || 'lote'); x.servidor = true; throw x; }
            respuestas = r.respuestas;
          }
        } catch (e) {
          if (e.sinRed) break;                          // sin señal o muy lento: se reintenta después, en orden
          // El servidor contestó algo raro: se reintenta, pero no para siempre
          const l = this.lista(), x = l.find(function (y) { return y.clave === tanda[0].clave; });
          if (x && ++x.intentos < 5) { this.guardarLista(l); break; }
          respuestas = tanda.map(function () { return { ok: false, error: 'el servidor no lo aceptó' }; });
        }
        const self = this;
        tanda.forEach(function (m, i) {
          const r = respuestas[i] || { ok: false, error: 'sin respuesta' };
          self.quitar(m.clave);
          if (!r.ok && !r.sinSesion) noAplicado(m.texto, r.error);
          if (r.sinSesion && APP.token === m.token) sesionPerdida(r.error);
          if (self.alTerminar) self.alTerminar(m, r);
        });
      }
    } finally {
      this.enviando = false;
      pintarSinRed();
    }
  }
};

/* ---------- Cambios que no se aplicaron ----------
   Pedido de Feli: si un cambio hecho sin señal no se aplica (ej. otro admin
   movió la tarjeta mientras tanto), el aviso queda guardado aunque se cierre
   la app, y se muestra al abrirla hasta que se toque "Entendido". */
const K_NO_APLICADOS = 'compras_no_aplicados';
function noAplicado(texto, motivo) {
  const l = guardado.leerJSON(K_NO_APLICADOS, []);
  l.push({ texto: texto, motivo: motivo || '', cuando: new Date().toISOString() });
  guardado.guardarJSON(K_NO_APLICADOS, l.slice(-30));
  mostrarNoAplicados();
}
function mostrarNoAplicados() {
  const cont = $('no-aplicados');
  if (!cont) return;
  const l = guardado.leerJSON(K_NO_APLICADOS, []);
  if (!l.length || $('app').hidden) { cont.hidden = true; return; }
  $('na-lista').innerHTML = '';
  l.forEach(function (x) {
    const li = document.createElement('li');
    const b = document.createElement('b'); b.textContent = 'No se pudo ' + x.texto + '.';
    const m = document.createElement('span'); m.textContent = ' ' + x.motivo;
    const c = document.createElement('small');
    c.textContent = new Date(x.cuando).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    li.append(b, m, c);
    $('na-lista').appendChild(li);
  });
  $('na-titulo').textContent = l.length === 1 ? 'Un cambio no se aplicó' : l.length + ' cambios no se aplicaron';
  cont.hidden = false;
}
if ($('na-ok')) $('na-ok').addEventListener('click', function () {
  guardado.borrar(K_NO_APLICADOS);
  $('no-aplicados').hidden = true;
});

/* ---------- Señal ---------- */
function conexion(hay) {
  if (APP.enLinea === hay) return;
  APP.enLinea = hay;
  pintarSinRed();
  if (hay && bandeja.pendientes()) setTimeout(function () { bandeja.procesar(); }, 0);   // volvió la señal: sale ya lo que esperaba
  if (window.alCambiarLaSenal) alCambiarLaSenal(hay);
}

/**
 * El aviso de debajo de la barra: poca señal, o cambios esperando para
 * mandarse. Tiene que tranquilizar (pedido de Feli): la app sigue andando
 * y lo que se haga se manda solo; nunca "no anda" ni "sin conexión".
 */
function pintarSinRed() {
  const el = $('sinred');
  if (!el) return;
  const n = bandeja.pendientes(), m = APP.pedidosPendientes || 0, a = APP.adjuntosPendientes || 0;
  const que = [m ? (m === 1 ? '1 pedido' : m + ' pedidos') : '', a ? (a === 1 ? '1 adjunto' : a + ' adjuntos') : '',
               n ? (n === 1 ? '1 cambio' : n + ' cambios') : '']
                .filter(Boolean).join(' y ').replace(/ y (?=.* y )/, ', ');
  const varios = n + m + a > 1;
  let texto = '';
  if (!APP.enLinea) {
    texto = que ? '📶 Poca señal. ' + que + (varios ? ' guardados: se mandan solos' : ' guardado: se manda solo') + ' cuando vuelva la señal.'
                : '📶 Poca señal. Podés seguir usando la app: lo que hagas se manda solo cuando vuelva la señal.';
    // Si lo que se ve es viejo, que se sepa
    if (APP.actualizado && Date.now() - new Date(APP.actualizado) > 5 * 60000) texto += ' Lo que ves es de ' + hace(APP.actualizado) + '.';
  }   // con señal no se muestra nada: los cambios se ven al instante y se mandan por detrás (pedido de Feli)
  el.textContent = texto;
  el.hidden = !texto;
  // El tablero ocupa el alto que queda: necesita saber cuánto mide este aviso
  document.documentElement.style.setProperty('--alto-aviso', el.hidden ? '0px' : el.offsetHeight + 'px');
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
  document.body.dataset.pantalla = id;          // para estilos por pantalla (ej. el tablero usa todo el ancho)
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
const RAIZ_APP = new URL('../', document.currentScript.src).href;   // .../compras/ (base.js está en js/)
if ('serviceWorker' in navigator) {
  const yaHabia = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register(RAIZ_APP + 'sw.js', { scope: RAIZ_APP }).catch(function () {});
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
// Sin señal se prueba cada 5 s (así apenas vuelve, se manda); con señal, cada 15 s
let vueltasReintento = 0;
setInterval(function () {
  vueltasReintento++;
  if (document.hidden) return;
  if (bandeja.pendientes()) { if (!APP.enLinea || vueltasReintento % 3 === 0) bandeja.procesar(); }
  // Con el aviso de poca señal puesto y nada para mandar: se prueba si volvió (así el aviso se va solo)
  else if (!APP.enLinea && vueltasReintento % 2 === 0) llamar('ping', []).catch(function () {});
}, 5000);

/* ---------- Sin zoom con los dedos (pedido de Feli: que no se agrande sin querer) ----------
   El iPhone ignora "user-scalable=no"; esto frena el pellizco en Safari. */
['gesturestart', 'gesturechange'].forEach(function (ev) {
  document.addEventListener(ev, function (e) { e.preventDefault(); }, { passive: false });
});
document.addEventListener('touchmove', function (e) { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
