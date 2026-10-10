/* ---------- Recepción (Fase 4, Paso 1-bis): "¿Recibiste este pedido?" ----------
   Al pasar un pedido o una tarjeta de seguimiento a Entregado, a quien lo retiró le llega un WhatsApp con el
   link a la tarjeta. Ahí confirma con "✅ Sí, lo recibí" o "❌ No lo recibí o falta algo" (con un comentario).
   Si no se le pudo avisar, lo confirma un admin con los mismos botones. Todo por la bandeja. */
const RECEP_CONFIRMADA = {};        // ref → {estado, recibio, comentario, fecha} mientras la respuesta espera en la bandeja

/** La marca de la tarjeta en el tablero (columna Entregado): si se recibió o no (Feli, 2026-10-05). */
function htmlMarcaRecepcion(t) {
  const r = t.recepcion ? Object.assign({}, t.recepcion, RECEP_CONFIRMADA[t.ref] || {}) : null;
  if (!r || !r.estado) return '';
  const nombre = function (n) { return esc(String(n || '').split(' ')[0]); };
  if (r.estado === 'Recibido') return '<div class="sobre">✅ Recibido por ' + nombre(r.recibio || r.para) + '</div>';
  if (r.estado === 'No recibió') return '<div class="sobre fuera-padron">⚠️ ' + nombre(r.para) + ' dice que no lo recibió</div>';
  if (r.estado === 'Sin aviso') return '<div class="sobre">✋ Confirmar a mano que llegó</div>';
  return '<div class="sobre">⏳ Esperando que ' + nombre(r.para) + ' confirme</div>';
}

function recepcionVista(ref, p) {
  const r = (p && p.recepcion) ? Object.assign({}, p.recepcion) : null;
  if (RECEP_CONFIRMADA[ref] && r) Object.assign(r, RECEP_CONFIRMADA[ref]);
  return r;
}

function pintarRecepcion() {
  const ref = TB.abierta, d = TB.detalle, b = $('tj-recep-b');
  if (!b) return;
  const p = d && d.pedido, t = buscarEnVista(ref);
  const columna = t ? t.columna : (p && p.columna);
  const r = recepcionVista(ref, p);
  b.hidden = TB.tipo === 'tarea' || !p || p.servicio || !r || columna !== colEntregado();
  if (b.hidden) return;
  const primero = function (n) { return esc(String(n || '').split(' ')[0]); };
  const yo = APP.yo.nombre;
  const esElla = String(r.para || '').trim().toLowerCase() === String(yo || '').trim().toLowerCase();
  const puede = esElla || (APP.yo.admin && r.aMano);
  let html = '';
  if (r.estado === 'Recibido') html = '<div class="cot-fila"><b>✅ Recibido por ' + esc(r.recibio || r.para) + '</b>' + (r.fecha ? ' <small>· ' + esc(fechaCorta(r.fecha)) + '</small>' : '') + '</div>';
  else if (r.estado === 'No recibió') html = '<div class="cot-fila mal"><b>⚠️ ' + esc(r.para) + ' dice que no lo recibió o que falta algo</b>' +
    (r.fecha ? ' <small>· ' + esc(fechaCorta(r.fecha)) + '</small>' : '') + (r.comentario ? '<div class="sub">' + esc(r.comentario) + '</div>' : '') + '</div>';
  else if (r.estado === 'Sin aviso') html = '<div class="cot-fila"><b>✋ No se le pudo avisar a ' + esc(r.para) + '</b>' +
    (r.motivo ? '<div class="sub">' + esc(r.motivo.charAt(0).toUpperCase() + r.motivo.slice(1)) + '. Lo confirma un administrador.</div>' : '') + '</div>';
  else html = '<div class="cot-fila"><b>⏳ Esperando que ' + primero(r.para) + ' confirme que lo recibió</b>' +
    (r.estado === 'Sin confirmar' ? '<div class="sub">Se le mandó un recordatorio' + (r.recordado ? ' el ' + esc(fechaCorta(r.recordado)) : '') + '.</div>' : '') + '</div>';
  (r.whatsapp || []).forEach(function (w) {
    html += '<div class="cot-fila"><div class="sub">💬 ' + primero(r.para) + ' contestó por WhatsApp' + (w.fecha ? ' (' + esc(fechaCorta(w.fecha)) + ')' : '') +
      ': "' + esc(w.texto) + '"</div></div>';
  });
  const espera = bandeja.lista().some(function (m) { return m.fn === 'confirmarRecepcion' && m.args[0] === ref; });
  if (espera) html += '<div class="cot-fila espera">' + (APP.enLinea ? '⏳ Mandando tu respuesta…' : '⏳ Tu respuesta se manda sola cuando vuelva la señal.') + '</div>';
  else if (puede) {
    const ya = r.estado === 'Recibido' || r.estado === 'No recibió';
    html += (ya ? '<p class="nota" style="margin:6px 0 0">¿Te equivocaste? Podés cambiar la respuesta.</p>' : '') +
      '<div class="cambio-b">' + (r.estado !== 'Recibido' ? '<button type="button" class="btn-chico si" id="tj-recep-si">✅ Sí, lo recibí</button>' : '') +
      '<button type="button" class="btn-chico" id="tj-recep-no">❌ No lo recibí o falta algo</button></div>';
  }
  $('tj-recep').innerHTML = html;
  if ($('tj-recep-si')) $('tj-recep-si').addEventListener('click', function () { confirmarRecepcionUI(ref, true); });
  if ($('tj-recep-no')) $('tj-recep-no').addEventListener('click', function () { confirmarRecepcionUI(ref, false); });
}

async function confirmarRecepcionUI(ref, recibido) {
  let comentario = '';
  if (!recibido) {
    const cuerpo = document.createElement('div');
    cuerpo.className = 'cuerpo';
    cuerpo.innerHTML = '<label for="rc-com">¿Qué pasó? ¿Qué no llegó o qué falta?</label><textarea id="rc-com" rows="3"></textarea>';
    comentario = await dialogo({
      titulo: '❌ No lo recibí o falta algo', cuerpo: cuerpo,
      botones: [{ texto: 'Mandar', clase: 'btn', id: 'dg-ok', valor: function () { return $('rc-com').value.trim(); } }, { texto: 'Volver', valor: null }],
      alAbrir: function () {
        const m = $('rc-com'), ok = $('dg-ok');
        const revisar = function () { ok.disabled = m.value.trim().length < 3; };
        m.addEventListener('input', revisar);
        revisar();
        m.focus();
      }
    });
    if (!comentario) return;
  }
  RECEP_CONFIRMADA[ref] = { estado: recibido ? 'Recibido' : 'No recibió', recibio: APP.yo.nombre, comentario: comentario, fecha: new Date().toISOString() };
  bandeja.agregar('confirmarRecepcion', [ref, recibido, comentario], recibido ? 'confirmar que llegó' : 'avisar que no llegó o falta algo');
  pintarRecepcion();
  pintarTablero();
  aviso(recibido ? '✅ ¡Gracias! Quedó anotado que lo recibiste.' : 'Gracias por avisar: les llega a los administradores.');
}

// Cuando sale de la bandeja: la tarjeta queda con lo que dice el servidor
(function () {
  const antes = bandeja.alTerminar;
  bandeja.alTerminar = function (m, r) {
    if (antes) antes(m, r);
    if (m.fn !== 'confirmarRecepcion') return;
    const ref = m.args[0];
    delete RECEP_CONFIRMADA[ref];
    if (r.ok && r.recepcion) {
      const todos = detallesGuardados();
      if (todos[ref] && todos[ref].d.pedido) { todos[ref].d.pedido.recepcion = r.recepcion; guardado.guardarJSON(K_TARJETAS, todos); }
      if (TB.abierta === ref && TB.detalle && TB.detalle.pedido) TB.detalle.pedido.recepcion = r.recepcion;
    }
    cargarTablero();
    if (TB.abierta === ref) { pintarTarjeta(); traerTarjeta(ref); }
  };
})();
