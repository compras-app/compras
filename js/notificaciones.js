'use strict';
/* ============================================================
   NOTIFICACIONES (Fase 3, Paso 2-ter)
   ------------------------------------------------------------
   La 🔔 de arriba, con el número de las que no se leyeron (llega con
   getTablero). Al tocarla, la lista: la más nueva primero. Tocar una la
   marca leída y abre su tarjeta (o Transferencias).
   - Admins: un pedido por pasar a Stand by y el que pasó, un pedido nuevo
     en Transferencias, una mención (@), un pedido de cambio para aprobar
     y un pedido de cotización que no se pudo mandar.
   - Encargados y empleados: solo cuando los etiquetan.
   Marcar leídas va por la bandeja (leerNotificaciones).
   ============================================================ */

const K_NOTIF = 'compras_notificaciones';   // la última lista (para verla sin señal)
const NT = { sinLeer: 0, datos: guardado.leerJSON(K_NOTIF, null) };

/** El número de la 🔔, con lo que espera en la bandeja descontado. */
function notifSinLeer(n) {
  NT.sinLeer = Math.max(0, Number(n) || 0);
  pintarCampana();
}
function pintarCampana() {
  const b = $('b-notif-n');
  if (!b) return;
  const n = NT.sinLeer;
  b.hidden = !n;
  b.textContent = n > 99 ? '99+' : String(n);
  $('b-notif').setAttribute('aria-label', n ? 'Notificaciones: ' + n + ' sin leer' : 'Notificaciones');
}

/** Las leídas que todavía esperan en la bandeja. */
function leidasEnBandeja() {
  const ids = {};
  let todas = false;
  bandeja.lista().forEach(function (m) {
    if (m.fn !== 'leerNotificaciones') return;
    if (m.args[0] === 'todas') todas = true; else (m.args[0] || []).forEach(function (id) { ids[id] = true; });
  });
  return { ids: ids, todas: todas };
}

function fechaNotif(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const hoy = new Date();
  const hora = d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
  return d.toDateString() === hoy.toDateString() ? 'hoy ' + hora : d.getDate() + '/' + (d.getMonth() + 1) + ' ' + hora;
}

async function abrirNotificaciones() {
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo notifs';
  const pintar = function (cargando) {
    const l = (NT.datos && NT.datos.lista) || [];
    const b = leidasEnBandeja();
    const leida = function (x) { return x.leida || b.todas || b.ids[x.id]; };
    const n = l.filter(function (x) { return !leida(x); }).length;
    cuerpo.innerHTML = (cargando && !NT.datos ? '<p class="nota">Buscando las notificaciones…</p>' : '') +
      (!cargando && !NT.datos ? '<p class="nota">📶 Hay poca señal: las notificaciones se ven cuando vuelva.</p>' : '') +
      (NT.datos && !l.length ? '<p class="nota">No tenés notificaciones.</p>' : '') +
      (n ? '<div class="notif-h"><button type="button" class="linkbtn" id="nt-todas">Marcar todas como leídas</button></div>' : '') +
      '<div class="notif-l">' + l.map(function (x) {
        return '<button type="button" class="notif-i' + (leida(x) ? ' leida' : '') + '" data-id="' + esc(x.id) + '">' +
          '<span class="txt">' + esc(x.texto) + '</span><small>' + esc(fechaNotif(x.fecha)) + '</small></button>';
      }).join('') + '</div>';
    const t = $('nt-todas');
    if (t) t.addEventListener('click', function () {
      bandeja.agregar('leerNotificaciones', ['todas'], 'marcar las notificaciones como leídas');
      notifSinLeer(0);
      pintar();
    });
    cuerpo.querySelectorAll('.notif-i').forEach(function (el) {
      el.addEventListener('click', function () {
        const x = l.filter(function (y) { return y.id === el.dataset.id; })[0];
        if (!x) return;
        if (!leida(x)) { bandeja.agregar('leerNotificaciones', [[x.id]], 'marcar una notificación como leída'); notifSinLeer(NT.sinLeer - 1); }
        if (cerrarDialogoActual) cerrarDialogoActual(null);
        irANotificacion(x);
      });
    });
  };
  const espera = dialogo({ titulo: '🔔 Notificaciones', cuerpo: cuerpo, botones: [{ texto: 'Cerrar', valor: null }], alAbrir: function () { pintar(true); } });
  const r = await api('getNotificaciones');
  if (r.ok) {
    NT.datos = { lista: r.lista || [] };
    guardado.guardarJSON(K_NOTIF, NT.datos);
    notifSinLeer(r.sinLeer);
  }
  if (cuerpo.isConnected) pintar(false);
  await espera;
}

/** A dónde lleva una notificación: Transferencias, o la tarjeta (pedido, servicio, tarjeta de seguimiento o tarea). */
function irANotificacion(x) {
  if (x.tipo === 'transferencia') { guardado.guardar(K_APARTADO, 'transferencias'); location.href = APARTADOS.transferencias.url; return; }
  if (!x.ref) return;
  if (/^K/.test(x.ref) && !APP.yo.admin) return;
  abrirTarjeta(x.ref);
}

$('b-notif').addEventListener('click', abrirNotificaciones);
pintarCampana();
