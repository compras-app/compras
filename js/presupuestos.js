/* ---------- Presupuestos (Fase 4, Paso 3, Parte B1) ----------
   En el chat: "📥 Cargar en una tarjeta" desde el menú del mensaje (en la compu y en el celular), y
   "Seleccionar varios" para un presupuesto escrito en varios mensajes. Una ventanita pide la tarjeta
   (las abiertas de ese chat) y el proveedor; cargarlo asigna esos mensajes a la tarjeta y la IA lo lee
   (leerPresupuesto: tarda hasta un minuto; mientras tanto se sigue usando la app).
   En la tarjeta abierta (solo admins): el bloque "Presupuestos", uno por proveedor, con lo pedido y lo
   cotizado producto por producto, los avisos, "No pedido", totales y condiciones; corregir a mano,
   confirmar, volver a revisar, volver a leer y quitar. Todo necesita señal (va directo, no por la bandeja). */

const PR = { sel: null };       // "Seleccionar varios": los IDs de los mensajes marcados (null: no se está eligiendo)

/* ---------- En el chat ---------- */

/** ¿Se puede cargar este mensaje como presupuesto? (un PDF, una foto o un texto) */
function sePuedeCargar(m) {
  if (!m || m.borrado || m.esperando) return false;
  if (m.tipo === 'imageMessage' || (m.tipo === 'documentMessage' && /pdf/i.test((m.mime || '') + ' ' + (m.nombreArchivo || '')))) return true;
  return !!(m.editado || m.texto) && !/audio|sticker|video|reaction/i.test(m.tipo);
}

function empezarSeleccion(id) {
  PR.sel = [];
  if (id && sePuedeCargar(mensajeDelChat(id))) PR.sel.push(id);
  pintarChat();
}

function terminarSeleccion() {
  PR.sel = null;
  pintarChat();
}

/** Marcar o desmarcar un mensaje en "Seleccionar varios". */
function tocarSeleccion(id) {
  const m = mensajeDelChat(id);
  if (!sePuedeCargar(m)) return aviso('Ese mensaje no se puede cargar como presupuesto (solo textos, PDF o fotos).');
  const i = PR.sel.indexOf(id);
  if (i === -1) PR.sel.push(id); else PR.sel.splice(i, 1);
  pintarChat();
}

/** La barra de abajo del chat mientras se eligen mensajes (en lugar del lugar para escribir). */
function pintarSeleccion() {
  const activo = !!PR.sel;
  $('ch-selbar').hidden = !activo;
  $('ch-escribir').hidden = activo;
  if (!activo) return;
  $('ch-sel-n').textContent = PR.sel.length ? PR.sel.length + ' mensaje' + (PR.sel.length === 1 ? '' : 's') + ' elegido' + (PR.sel.length === 1 ? '' : 's') : 'Tocá los mensajes del presupuesto';
  $('ch-sel-cargar').disabled = !PR.sel.length;
  document.querySelectorAll('#ch-msjs .ch-fila').forEach(function (f) { f.classList.toggle('elegido', PR.sel.indexOf(f.dataset.id) !== -1); });
}

$('ch-sel-x').addEventListener('click', terminarSeleccion);
$('ch-sel-cargar').addEventListener('click', function () { if (PR.sel && PR.sel.length) cargarEnTarjeta(PR.sel.slice()); });

/** La tarjeta (de las abiertas del chat) y el proveedor. Devuelve {ref, proveedor} o null. */
function elegirTarjetaYProveedor(tarjetas) {
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  let ref = tarjetas.length === 1 ? tarjetas[0].ref : '', prov = '';
  const deTarjeta = function () { return (tarjetas.filter(function (t) { return t.ref === ref; })[0] || {}).proveedores || []; };
  const pintar = function () {
    const provs = deTarjeta();
    if (provs.length === 1) prov = provs[0].id;
    if (!provs.some(function (p) { return p.id === prov; })) prov = '';
    cuerpo.innerHTML = '<label>¿En qué tarjeta?</label><div class="opciones">' + tarjetas.map(function (t) {
        return '<button type="button" class="choice" data-ref="' + esc(t.ref) + '"' + (t.ref === ref ? ' aria-current="true"' : '') + '><b>' +
          esc(t.titulo || t.ref) + '</b> <small>· ' + esc([t.codigo, t.columna].filter(String).join(' · ')) + '</small></button>';
      }).join('') + '</div>' +
      (ref ? '<label>¿De qué proveedor es?</label><div class="opciones">' + (provs.length ? provs.map(function (p) {
        return '<button type="button" class="choice" data-prov="' + esc(p.id) + '"' + (p.id === prov ? ' aria-current="true"' : '') + '>' + esc(p.nombre) + '</button>';
      }).join('') : '<p class="nota">A esta tarjeta no se le pidió cotización por este chat.</p>') + '</div>' : '');
    cuerpo.querySelectorAll('[data-ref]').forEach(function (b) { b.addEventListener('click', function () { ref = b.dataset.ref; pintar(); }); });
    cuerpo.querySelectorAll('[data-prov]').forEach(function (b) { b.addEventListener('click', function () { prov = b.dataset.prov; pintar(); }); });
    const ok = $('pr-ok');
    if (ok) ok.disabled = !(ref && prov);
  };
  pintar();
  return dialogo({ titulo: '📥 Cargar en una tarjeta', texto: 'La IA lo lee y lo une con los productos de la tarjeta. Después lo revisás ahí.', cuerpo: cuerpo,
                   botones: [{ texto: 'Volver', valor: null }, { texto: '📥 Cargar', clase: 'btn', id: 'pr-ok', valor: function () { return ref && prov ? { ref: ref, proveedor: prov } : null; } }],
                   alAbrir: function () { $('pr-ok').disabled = !(ref && prov); } });
}

/** Cargar uno o varios mensajes del chat abierto como presupuesto de una tarjeta, y leerlo. */
async function cargarEnTarjeta(ids) {
  const chat = CH.abierto, d = CH.datos;
  if (!chat || !d) return;
  const tarjetas = (d.tarjetas || []).filter(function (t) { return !t.manual; });
  if (!tarjetas.length) {
    return aviso((d.tarjetas || []).length ? 'Cargar presupuestos en una ✋ gestión manual llega en el próximo tramo.'
      : 'Este chat no tiene tarjetas abiertas con pedido de cotización.', 'bad');
  }
  const eleccion = await elegirTarjetaYProveedor(tarjetas);
  if (!eleccion) return;
  const id = 'B' + nuevoId();
  aviso('Cargando el presupuesto…');
  const r = await api('cargarPresupuesto', { id: id, chat: chat, mensajes: ids, ref: eleccion.ref, proveedor: eleccion.proveedor });
  if (!r.ok) return aviso(r.sinConexion ? '📶 Poca señal: no se cargó. Probá de nuevo cuando vuelva.' : r.error, 'bad');
  PR.sel = null;
  (d.mensajes || []).forEach(function (m) { if (ids.indexOf(m.id) !== -1) m.ref = eleccion.ref; });
  pintarChat();
  const nombre = ((tarjetas.filter(function (t) { return t.ref === eleccion.ref; })[0] || {}).proveedores || [])
    .filter(function (p) { return p.id === eleccion.proveedor; }).map(function (p) { return p.nombre; })[0] || 'el proveedor';
  aviso('📥 Cargado. La IA lo está leyendo (hasta un minuto): podés seguir usando la app.');
  const l = await apiLenta('leerPresupuesto', id);
  if (TB.abierta === eleccion.ref) traerTarjeta(eleccion.ref);
  if (l.ok && l.presupuesto && l.presupuesto.estado) {
    aviso(l.presupuesto.estado === 'Revisar' ? 'El presupuesto de ' + nombre + ' quedó en la tarjeta para revisar: las cuentas no dan.'
                                              : 'El presupuesto de ' + nombre + ' está en la tarjeta, para confirmar.');
  } else if (l.ok && l.leyendo) aviso('Se está leyendo: en un rato aparece en la tarjeta.');
  else aviso(l.sinConexion ? '📶 Poca señal: se termina de leer solo y aparece en la tarjeta.' : l.error, l.sinConexion ? '' : 'bad');
}

/** En la burbuja: "📥 Cargado en C-0007" (abre la tarjeta). */
function htmlCargado(m) {
  if (!m.ref) return '';
  const t = ((CH.datos && CH.datos.tarjetas) || []).filter(function (x) { return x.ref === m.ref; })[0];
  return '<button type="button" class="ch-cargado" data-abrir-tarjeta="' + esc(m.ref) + '">📥 Cargado en ' + esc((t && (t.codigo || t.titulo)) || m.ref) + '</button>';
}

/* ---------- En la tarjeta abierta ---------- */

function plata(n, moneda) {
  if (n === null || n === undefined || n === '') return '';
  const s = Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  return (/USD|U\$S|DOL/i.test(moneda || '') ? 'US$ ' : '$ ') + s;
}
function cantTexto(n) { return n === null || n === undefined ? '' : Number(n).toLocaleString('es-AR', { maximumFractionDigits: 3 }); }
function capital(t) { t = String(t || '').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); }

const PR_ICONO = { 'Leyendo': '⏳', 'No se pudo leer': '⚠️', 'Revisar': '⚠️', 'Para confirmar': '🔎', 'Confirmado': '✅' };

/** Un renglón cotizado, como lo pidió Feli: unidades, el producto tal cual, precio unitario y total; abajo, en gris, los avisos. */
function htmlRenglonPresup(r, moneda, idPresup, editable) {
  return '<div class="pr-ren' + (r.problema ? ' pr-mal' : '') + '">' + (r.problema ? '⚠️ ' : '') +
    '<span>' + esc([cantTexto(r.cant), r.unidad].filter(String).join(' ')) + '</span> · ' + esc(capital(r.texto)) +
    (r.precio !== null ? ' · ' + esc(plata(r.precio, r.moneda || moneda)) : '') + (r.importe !== null ? ' · <b>' + esc(plata(r.importe, r.moneda || moneda)) + '</b>' : '') +
    (r.contenido && r.contenido !== 1 ? ' <small>(1 ' + esc(r.unidad || 'unidad') + ' = ' + esc(cantTexto(r.contenido)) + ')</small>' : '') +
    (r.problema ? '<div class="pr-problema">' + esc(r.problema) +
      (editable && r.revisable ? ' <button type="button" class="btn-chico" data-pr-bien="' + esc(r.id) + '" data-id="' + esc(idPresup) + '">✓ Está bien</button>' : '') + '</div>' : '') +
    (r.corrigio ? '<div class="pr-nota">' + (r.acomodado ? 'Revisado' : 'Corregido a mano') + ' por ' + esc(r.corrigio) + '</div>' : '') + '</div>';
}

function htmlPresupuesto(b) {
  const porN = {};
  b.renglones.forEach(function (r) { porN[r.n] = r; });
  const est = b.estado;
  const cabeza = '<summary><b>' + esc(b.nombre) + '</b> <span class="pr-estado e-' + esc(est.replace(/\s+/g, '-').toLowerCase()) + '">' + (PR_ICONO[est] || '') + ' ' + esc(est) + '</span>' +
    (b.total !== null ? ' <span class="pr-total">' + esc(plata(b.total, b.moneda)) + '</span>' : '') + '</summary>';
  let h = '';
  if (est === 'Leyendo') h += '<p class="nota">La IA lo está leyendo. Tarda hasta un minuto; si se cortó, lo termina el reloj solo.</p>';
  const editable = est === 'Revisar' || est === 'Para confirmar';
  if (b.problemas.length && est !== 'Confirmado') {
    h += '<div class="pr-problemas"><b>Para revisar:</b><ul>' + b.problemas.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' +
      (b.renglones.some(function (r) { return r.problema; }) ? '<div class="pr-nota">Los renglones a revisar están marcados con ⚠️ más abajo.</div>' : '') + '</div>';
  }
  if (b.renglones.length || b.productos.length) {
    h += '<div class="pr-prods">' + b.productos.map(function (p) {
      return '<div class="pr-prod"><div class="pr-pedido">' + esc(p.cantidad) + ' · ' + esc(p.nombre) + '</div>' +
        p.renglones.map(function (n) { return porN[n] ? htmlRenglonPresup(porN[n], b.moneda, b.id, editable) : ''; }).join('') +
        (p.avisos.length ? '<div class="pr-aviso">' + p.avisos.map(esc).join(' · ') + '</div>' : '') + '</div>';
    }).join('') + '</div>';
    if (b.noPedido.length) h += '<div class="pr-prod"><div class="pr-pedido">No pedido</div>' + b.noPedido.map(function (n) { return porN[n] ? htmlRenglonPresup(porN[n], b.moneda, b.id, editable) : ''; }).join('') + '</div>';
  }
  const iva = b.conIva === 'si' ? '(precios con IVA)' : b.conIva === 'no' ? '(precios sin IVA)' : '(sin dato de IVA)';
  const tot = [['Subtotal', b.subtotal], ['Descuento', b.descuento], ['IVA', b.iva], ['Otros impuestos', b.otros || null], ['Flete y otros cargos', b.cargos || null], ['Total', b.total]]
    .filter(function (x) { return x[1] !== null && x[1] !== undefined; });
  if (tot.length) h += '<div class="pr-totales">' + tot.map(function (x) { return '<div><span>' + x[0] + '</span><b>' + esc(plata(x[1], b.moneda)) + '</b></div>'; }).join('') +
    '<div class="pr-nota">' + iva + (b.suma !== null && b.subtotal === null ? ' · suma de renglones ' + esc(plata(b.suma, b.moneda)) : '') + '</div></div>';
  const cond = [['Validez', b.validez], ['Forma de pago', b.formaPago], ['Plazo de entrega', b.plazo], ['Entrega', b.entrega], ['Flete', b.flete], ['Observaciones', b.observaciones]]
    .filter(function (x) { return x[1]; });
  if (cond.length) h += '<div class="pr-cond">' + cond.map(function (x) { return '<div><span>' + x[0] + ':</span> ' + esc(x[1]) + '</div>'; }).join('') + '</div>';
  // Los mensajes del pedido ("vista por pedido"): lo que se cargó, con el original
  h += '<div class="pr-msjs"><div class="pr-nota">Cargado por ' + esc(b.cargo) + ' el ' + esc(fechaCorta(b.fecha)) + ', desde estos mensajes:</div>' +
    b.mensajes.map(function (m) {
      return '<div class="pr-msj"><span>' + esc(m.texto || 'Mensaje') + '</span>' +
        (m.archivo ? '<button type="button" class="btn-chico" data-ver-archivo="' + esc(m.archivo) + '">Ver el original</button>' : '') + '</div>';
    }).join('') + '<button type="button" class="btn-chico" data-pr-chat="' + esc(b.chat) + '">💬 Ir al chat</button></div>';
  if (b.confirmo) h += '<div class="pr-nota">Confirmado por ' + esc(b.confirmo) + ' el ' + esc(fechaCorta(b.fechaConfirmacion)) + '.</div>';
  // Lo que se puede hacer, según el estado
  const bs = [];
  if (est === 'Revisar' || est === 'Para confirmar') bs.push(['corregir', '✏️ Corregir'], ['confirmar', '✅ Confirmar']);
  if (est === 'No se pudo leer') bs.push(['corregir', '✏️ Cargarlo a mano']);
  if (est === 'Confirmado') bs.push(['reabrir', '↩️ Volver a revisar']);
  if (est !== 'Confirmado') bs.push(['leer', est === 'Leyendo' ? 'Leer ahora' : '🔄 Volver a leer'], ['quitar', 'Quitar']);
  h += '<div class="pr-acciones">' + bs.map(function (x) {
    return '<button type="button" class="btn-chico' + (x[0] === 'confirmar' ? ' si' : '') + '" data-pr="' + x[0] + '" data-id="' + esc(b.id) + '">' + x[1] + '</button>';
  }).join('') + '</div>';
  return '<details class="pr-uno"' + (est !== 'Confirmado' ? ' open' : '') + '>' + cabeza + '<div class="pr-cuerpo">' + h + '</div></details>';
}

function pintarPresupuestos() {
  const b = $('tj-presup-b');
  if (!b) return;
  const d = TB.detalle, l = (d && d.presupuestos) || [];
  b.hidden = !APP.yo.admin || TB.tipo === 'tarea' || !d || !d.pedido || (!l.length && !(d.solicitudes || []).length);
  if (b.hidden) return;
  $('tj-presup').innerHTML = l.length ? l.map(htmlPresupuesto).join('')
    : '<p class="nota" style="margin:0">Cuando llegue un presupuesto, cargalo desde el chat: en el menú del mensaje, "📥 Cargar en una tarjeta".</p>';
  $('tj-presup').querySelectorAll('[data-pr-chat]').forEach(function (x) { x.addEventListener('click', function () { irAlChat(x.dataset.prChat); }); });
  $('tj-presup').querySelectorAll('[data-ver-archivo]').forEach(function (x) { x.addEventListener('click', function () { verArchivo(x.dataset.verArchivo); }); });
  $('tj-presup').querySelectorAll('[data-pr]').forEach(function (x) { x.addEventListener('click', function () { accionPresupuesto(x.dataset.pr, x.dataset.id); }); });
  $('tj-presup').querySelectorAll('[data-pr-bien]').forEach(function (x) { x.addEventListener('click', function () { renglonEstaBien(x.dataset.id, x.dataset.prBien); }); });
}

function presupuestoAbierto(id) { return ((TB.detalle && TB.detalle.presupuestos) || []).filter(function (b) { return b.id === id; })[0]; }

/** Cambia el presupuesto en la tarjeta abierta (lo que devolvió el servidor) y la vuelve a dibujar. */
function ponerPresupuesto(nuevo) {
  const d = TB.detalle;
  if (!d || !nuevo) return;
  d.presupuestos = (d.presupuestos || []).map(function (b) { return b.id === nuevo.id ? nuevo : b; });
  guardarDetalle(TB.abierta, d);
  pintarPresupuestos();
}

async function accionPresupuesto(que, id) {
  const b = presupuestoAbierto(id);
  if (!b) return;
  let r;
  if (que === 'corregir') return corregirPresupuestoUI(b);
  if (que === 'confirmar') {
    let aunAsi = false;
    if (b.estado === 'Revisar') {
      const si = await dialogo({ titulo: 'Las cuentas no dan', texto: 'Este presupuesto tiene cosas para revisar. ¿Lo confirmás igual?',
                                 botones: [{ texto: 'Volver', valor: false }, { texto: 'Confirmar igual', clase: 'btn', valor: true }] });
      if (!si) return;
      aunAsi = true;
    }
    r = await api('confirmarPresupuesto', id, aunAsi);
  } else if (que === 'reabrir') {
    r = await api('reabrirPresupuesto', id);
  } else if (que === 'leer') {
    if (b.renglones.length) {
      const si = await dialogo({ titulo: 'Volver a leer', texto: 'La IA lo lee de nuevo y se pierde lo que se corrigió a mano. ¿Seguimos?',
                                 botones: [{ texto: 'Volver', valor: false }, { texto: '🔄 Volver a leer', clase: 'btn', valor: true }] });
      if (!si) return;
    }
    aviso('La IA lo está leyendo (hasta un minuto)…');
    b.estado = 'Leyendo';
    pintarPresupuestos();
    r = await apiLenta('leerPresupuesto', id);
    if (r.ok && r.leyendo) { aviso('Ya se está leyendo: en un rato aparece.'); return; }
    if (!r.ok) { traerTarjeta(TB.abierta); }
  } else if (que === 'quitar') {
    const si = await dialogo({ titulo: 'Quitar el presupuesto', texto: 'Sale de la tarjeta y sus mensajes dejan de estar cargados. No se borra nada: se puede volver a cargar desde el chat.',
                               botones: [{ texto: 'Volver', valor: false }, { texto: 'Quitar', clase: 'btn', valor: true }] });
    if (!si) return;
    r = await api('quitarPresupuesto', id);
    if (r.ok) {
      TB.detalle.presupuestos = (TB.detalle.presupuestos || []).filter(function (x) { return x.id !== id; });
      guardarDetalle(TB.abierta, TB.detalle);
      pintarPresupuestos();
      return aviso('Listo: se quitó.');
    }
  }
  if (!r) return;
  if (!r.ok) return aviso(r.sinConexion ? '📶 Hace falta señal para esto. Probá cuando vuelva.' : r.error, 'bad');
  ponerPresupuesto(r.presupuesto);
}

/** "✓ Está bien": el código acomodó las columnas y la persona miró el original. Queda quién lo revisó. */
async function renglonEstaBien(idPresup, idRenglon) {
  const b = presupuestoAbierto(idPresup);
  const r = b && b.renglones.filter(function (x) { return x.id === idRenglon; })[0];
  if (!r) return;
  const res = await api('corregirPresupuesto', idPresup, { renglones: [{ id: r.id, linea: r.linea, texto: r.texto, cant: r.cant, unidad: r.unidad,
                                                                        precio: r.precio, importe: r.importe, contenido: r.contenido }] });
  if (!res.ok) return aviso(res.sinConexion ? '📶 Hace falta señal para esto. Probá cuando vuelva.' : res.error, 'bad');
  ponerPresupuesto(res.presupuesto);
  aviso(res.presupuesto.estado === 'Revisar' ? 'Listo. Todavía queda algo para revisar.' : 'Listo: ahora está para confirmar.');
}

/* ---------- Corregir a mano ---------- */

function numEnInput(n) { return n === null || n === undefined ? '' : String(n).replace('.', ','); }

/** La ventana para corregir: cada renglón (a qué producto va, cantidad, precio, importe), agregar renglones, totales y condiciones. */
async function corregirPresupuestoUI(b) {
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo pr-editar';
  const opciones = '<option value="">No pedido</option>' + (b.deLaTarjeta || b.productos).map(function (p) {
    return '<option value="' + esc(p.linea) + '">' + esc(p.cantidad + ' · ' + p.nombre) + '</option>';
  }).join('');
  const fila = function (r) {
    r = r || {};
    return '<div class="pr-ed" data-id="' + esc(r.id || '') + '">' +
      '<div class="pr-ed-n">' + (r.n ? 'Renglón ' + r.n : 'Renglón nuevo') + '<label class="pr-ed-q"><input type="checkbox" data-c="quitar"> Quitar</label></div>' +
      '<label>Producto que pedimos<select data-c="linea">' + opciones + '</select></label>' +
      '<label>Cómo lo escribió<input data-c="texto" value="' + esc(r.texto || '') + '"></label>' +
      '<div class="pr-ed-g"><label>Cantidad<input data-c="cant" inputmode="decimal" value="' + esc(numEnInput(r.cant)) + '"></label>' +
      '<label>Unidad<input data-c="unidad" value="' + esc(r.unidad || '') + '"></label>' +
      '<label title="Cuántas de nuestras unidades trae una (un rollo = 100 m)">Trae<input data-c="contenido" inputmode="decimal" value="' + esc(numEnInput(r.contenido)) + '"></label></div>' +
      '<div class="pr-ed-g"><label>Precio unitario<input data-c="precio" inputmode="decimal" value="' + esc(numEnInput(r.precio)) + '"></label>' +
      '<label>Importe<input data-c="importe" inputmode="decimal" value="' + esc(numEnInput(r.importe)) + '"></label></div></div>';
  };
  const tot = [['subtotal', 'Subtotal', b.subtotal], ['descuento', 'Descuento', b.descuento], ['iva', 'IVA', b.iva], ['cargos', 'Flete y otros cargos', b.cargos || null], ['total', 'Total', b.total]];
  const cond = [['validez', 'Validez', b.validez], ['formaPago', 'Forma de pago', b.formaPago], ['plazo', 'Plazo de entrega', b.plazo], ['entrega', 'Entrega (retira o envío)', b.entrega],
                ['flete', 'Flete', b.flete], ['observaciones', 'Observaciones', b.observaciones]];
  cuerpo.innerHTML = '<p class="nota">Los números como en el presupuesto (1.234,56). Las cuentas las vuelve a hacer la app.</p>' +
    '<div id="pr-ed-filas">' + b.renglones.map(fila).join('') + '</div>' +
    '<button type="button" class="btn-chico" id="pr-ed-mas">＋ Agregar un renglón</button>' +
    '<h4>Totales</h4><div class="pr-ed-g">' + tot.map(function (x) { return '<label>' + x[1] + '<input data-t="' + x[0] + '" inputmode="decimal" value="' + esc(numEnInput(x[2])) + '"></label>'; }).join('') + '</div>' +
    '<label>¿Los precios tienen IVA?<select data-k="conIva"><option value="">Sin dato</option><option value="si">Con IVA</option><option value="no">Sin IVA</option></select></label>' +
    '<h4>Condiciones</h4>' + cond.map(function (x) { return '<label>' + x[1] + '<input data-k="' + x[0] + '" value="' + esc(x[2] || '') + '"></label>'; }).join('');
  // Lo que ya estaba: producto elegido y "con IVA"
  b.renglones.forEach(function (r, i) { cuerpo.querySelectorAll('.pr-ed')[i].querySelector('[data-c="linea"]').value = r.linea || ''; });
  cuerpo.querySelector('[data-k="conIva"]').value = b.conIva === 'si' || b.conIva === 'no' ? b.conIva : '';
  cuerpo.querySelector('#pr-ed-mas').addEventListener('click', function () {
    $('pr-ed-filas').insertAdjacentHTML('beforeend', fila(null));
  });
  const leer = function () {
    const cambios = { renglones: [], totales: {}, condiciones: {} };
    document.querySelectorAll('#pr-ed-filas .pr-ed').forEach(function (el) {
      const v = function (c) { const x = el.querySelector('[data-c="' + c + '"]'); return x.type === 'checkbox' ? x.checked : x.value.trim(); };
      const id = el.dataset.id, ant = b.renglones.filter(function (r) { return r.id === id; })[0];
      const nuevo = { id: id, linea: v('linea'), texto: v('texto'), cant: v('cant'), unidad: v('unidad'), contenido: v('contenido'), precio: v('precio'), importe: v('importe'), quitar: v('quitar') };
      if (!id && !nuevo.quitar && !nuevo.texto && !nuevo.importe && !nuevo.precio) return;   // renglón nuevo vacío
      if (ant && !nuevo.quitar && nuevo.linea === (ant.linea || '') && nuevo.texto === (ant.texto || '') && nuevo.unidad === (ant.unidad || '') &&
          nuevo.cant === numEnInput(ant.cant) && nuevo.precio === numEnInput(ant.precio) && nuevo.importe === numEnInput(ant.importe) &&
          nuevo.contenido === numEnInput(ant.contenido)) return;                              // sin cambios
      cambios.renglones.push(nuevo);
    });
    tot.forEach(function (x) { const v = document.querySelector('[data-t="' + x[0] + '"]').value.trim(); if (v !== numEnInput(x[2])) cambios.totales[x[0]] = v; });
    cond.concat([['conIva', '', b.conIva]]).forEach(function (x) { const v = document.querySelector('[data-k="' + x[0] + '"]').value.trim(); if (v !== (x[2] || '')) cambios.condiciones[x[0]] = v; });
    if (!Object.keys(cambios.totales).length) delete cambios.totales;
    if (!Object.keys(cambios.condiciones).length) delete cambios.condiciones;
    return cambios;
  };
  const cambios = await dialogo({ titulo: '✏️ Corregir · ' + b.nombre, cuerpo: cuerpo,
                                  botones: [{ texto: 'Volver', valor: null }, { texto: 'Guardar', clase: 'btn', valor: leer }] });
  if (!cambios) return;
  if (!cambios.renglones.length && !cambios.totales && !cambios.condiciones) return aviso('No cambiaste nada.');
  aviso('Guardando…');
  const r = await api('corregirPresupuesto', b.id, cambios);
  if (!r.ok) return aviso(r.sinConexion ? '📶 Hace falta señal para guardar. Probá cuando vuelva.' : r.error, 'bad');
  ponerPresupuesto(r.presupuesto);
  aviso(r.presupuesto.estado === 'Revisar' ? 'Guardado. Todavía hay cosas que no dan: mirá "Para revisar".' : 'Guardado: las cuentas dan.');
}
