/* ---------- Presupuestos (Fase 4, Paso 3, Parte B1) ----------
   En el chat: "📥 Cargar en una tarjeta" desde el menú del mensaje (en la compu y en el celular), y
   "Seleccionar varios" para un presupuesto escrito en varios mensajes. Una ventanita pide la tarjeta
   (las abiertas de ese chat) y el proveedor; cargarlo asigna esos mensajes a la tarjeta y la IA lo lee
   (leerPresupuesto: tarda hasta un minuto; mientras tanto se sigue usando la app).
   En la tarjeta abierta (solo admins): el bloque "Presupuestos", uno por proveedor, con lo pedido y lo
   cotizado producto por producto, los avisos, "No pedido", totales y condiciones; corregir a mano,
   confirmar, volver a revisar, volver a leer y quitar. Todo necesita señal (va directo, no por la bandeja). */

const PR = { sel: null,        // "Seleccionar varios": los IDs de los mensajes marcados (null: no se está eligiendo)
             abiertos: {} };   // los presupuestos que se desplegaron (vienen cerrados; Feli, 2026-10-05)

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

/** Los proveedores posibles para las tarjetas elegidas: los que tienen en común las que tienen pedido de cotización;
    en las ✋ manuales, el del chat, o cualquiera de los cargados si el chat no es de un proveedor (el número de prueba). */
function opcionesDeProveedor(elegidas, todos) {
  const auto = elegidas.filter(function (t) { return !t.manual; });
  if (auto.length) {
    return auto.slice(1).reduce(function (acc, t) {
      return acc.filter(function (p) { return (t.proveedores || []).some(function (x) { return x.id === p.id; }); });
    }, (auto[0].proveedores || []).slice());
  }
  const delChat = [];
  elegidas.forEach(function (t) { (t.proveedores || []).forEach(function (p) { if (!delChat.some(function (x) { return x.id === p.id; })) delChat.push(p); }); });
  return delChat.length ? delChat : (todos || []);       // el chat es de un proveedor: es él (Feli, 2026-10-06)
}

/** Las tarjetas (de las abiertas del chat; varias si el presupuesto es de dos pedidos) y el proveedor. Devuelve {refs, proveedor} o null. */
function elegirTarjetaYProveedor(tarjetas, todos) {
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  let refs = tarjetas.length === 1 ? [tarjetas[0].ref] : [], prov = '';
  const pintar = function () {
    const elegidas = tarjetas.filter(function (t) { return refs.indexOf(t.ref) !== -1; });
    const provs = elegidas.length ? opcionesDeProveedor(elegidas, todos) : [];
    if (provs.length === 1) prov = provs[0].id;
    if (!provs.some(function (p) { return p.id === prov; })) prov = '';
    const soloManuales = elegidas.length && elegidas.every(function (t) { return t.manual; });
    cuerpo.innerHTML = '<label>¿En qué tarjeta?' + (tarjetas.length > 1 ? ' <small>(si el presupuesto es de varios pedidos, tocá todas)</small>' : '') + '</label>' +
      '<div class="opciones">' + tarjetas.map(function (t) {
        return '<button type="button" class="choice" data-ref="' + esc(t.ref) + '"' + (refs.indexOf(t.ref) !== -1 ? ' aria-current="true"' : '') + '>' +
          (refs.indexOf(t.ref) !== -1 && tarjetas.length > 1 ? '✓ ' : '') + (t.manual ? '✋ ' : '') + '<b>' + esc(t.titulo || t.ref) + '</b> <small>· ' +
          esc([t.codigo, t.columna].filter(String).join(' · ')) + '</small></button>';
      }).join('') + '</div>' +
      (elegidas.length ? '<label>¿De qué proveedor es?</label>' + (!provs.length
        ? '<p class="nota">' + (elegidas.length > 1 ? 'Esas tarjetas no tienen un proveedor en común en este chat.' : 'A esta tarjeta no se le pidió cotización por este chat.') + '</p>'
        : soloManuales && provs.length > 6
          ? '<select id="pr-prov-sel"><option value="">Elegí el proveedor</option>' + provs.map(function (p) {
              return '<option value="' + esc(p.id) + '"' + (p.id === prov ? ' selected' : '') + '>' + esc(p.nombre) + '</option>'; }).join('') + '</select>'
          : '<div class="opciones">' + provs.map(function (p) {
              return '<button type="button" class="choice" data-prov="' + esc(p.id) + '"' + (p.id === prov ? ' aria-current="true"' : '') + '>' + esc(p.nombre) + '</button>';
            }).join('') + '</div>') : '');
    cuerpo.querySelectorAll('[data-ref]').forEach(function (b) {
      b.addEventListener('click', function () {
        const i = refs.indexOf(b.dataset.ref);
        if (i === -1) refs.push(b.dataset.ref); else refs.splice(i, 1);
        pintar();
      });
    });
    cuerpo.querySelectorAll('[data-prov]').forEach(function (b) { b.addEventListener('click', function () { prov = b.dataset.prov; pintar(); }); });
    const sel = cuerpo.querySelector('#pr-prov-sel');
    if (sel) sel.addEventListener('change', function () { prov = sel.value; const ok = $('pr-ok'); if (ok) ok.disabled = !(refs.length && prov); });
    const ok = $('pr-ok');
    if (ok) ok.disabled = !(refs.length && prov);
  };
  pintar();
  return dialogo({ titulo: '📥 Cargar en una tarjeta', texto: 'La IA lo lee y lo une con los productos de la tarjeta. Después lo revisás ahí.', cuerpo: cuerpo,
                   botones: [{ texto: 'Volver', valor: null }, { texto: '📥 Cargar', clase: 'btn', id: 'pr-ok', valor: function () { return refs.length && prov ? { refs: refs.slice(), proveedor: prov } : null; } }],
                   alAbrir: function () { $('pr-ok').disabled = !(refs.length && prov); } });
}

/** Cargar uno o varios mensajes del chat abierto como presupuesto de una o varias tarjetas, y leerlo. */
async function cargarEnTarjeta(ids) {
  const chat = CH.abierto, d = CH.datos;
  if (!chat || !d) return;
  const tarjetas = d.tarjetas || [];
  if (!tarjetas.length) return aviso('Este chat no tiene tarjetas abiertas: pedile cotización desde la tarjeta, o sumá el chat a una ✋ gestión manual.', 'bad');
  const eleccion = await elegirTarjetaYProveedor(tarjetas, d.proveedores);
  if (!eleccion) return;
  const datos = { id: 'B' + nuevoId(), chat: chat, mensajes: ids, refs: eleccion.refs, proveedor: eleccion.proveedor };
  aviso('Cargando el presupuesto…');
  let r = await api('cargarPresupuesto', datos);
  // Ese proveedor ya tiene un presupuesto en la tarjeta: ¿una parte más o lo reemplaza? (Feli, 2026-10-05)
  if (r.ok && r.pregunta) {
    const donde = r.existentes.map(function (x) { return x.codigo + ' (del ' + fechaCorta(x.fecha) + ')'; }).join(' y ');
    const modo = await dialogo({ titulo: 'Ya hay un presupuesto de ' + r.proveedor,
      texto: r.proveedor + ' ya tiene un presupuesto en ' + donde + '. ¿Este es una parte más o reemplaza al anterior?\n\n' +
             'Una parte más: se suma (si repite un producto, vale el precio nuevo).\nReemplaza al anterior: el anterior se quita (no se borra) y vale solo este.',
      botones: [{ texto: 'Volver', valor: null }, { texto: 'Reemplaza al anterior', clase: 'btn2', valor: 'reemplazo' }, { texto: 'Una parte más', clase: 'btn', valor: 'parte' }] });
    if (!modo) return;
    datos.modo = modo;
    r = await api('cargarPresupuesto', datos);
  }
  if (!r.ok) return aviso(r.sinConexion ? '📶 Poca señal: no se cargó. Probá de nuevo cuando vuelva.' : r.error, 'bad');
  PR.sel = null;
  (d.mensajes || []).forEach(function (m) {
    if (ids.indexOf(m.id) !== -1) m.ref = refsDe(m.ref).concat(eleccion.refs.filter(function (x) { return refsDe(m.ref).indexOf(x) === -1; })).join(', ');
  });
  pintarChat();
  const nombre = opcionesDeProveedor(tarjetas.filter(function (t) { return eleccion.refs.indexOf(t.ref) !== -1; }), d.proveedores)
    .filter(function (p) { return p.id === eleccion.proveedor; }).map(function (p) { return p.nombre; })[0] || 'el proveedor';
  aviso('📥 Cargado. La IA lo está leyendo (hasta un minuto): podés seguir usando la app.');
  const l = await apiLenta('leerPresupuesto', datos.id);
  if (eleccion.refs.indexOf(TB.abierta) !== -1) traerTarjeta(TB.abierta);
  if (l.ok && l.presupuesto && l.presupuesto.estado) {
    aviso(l.presupuesto.estado === 'Revisar' ? 'El presupuesto de ' + nombre + ' quedó en la tarjeta para revisar: hay cosas que no dan.'
                                              : 'El presupuesto de ' + nombre + ' está en la tarjeta: las cuentas dan.');
  } else if (l.ok && l.leyendo) aviso('Se está leyendo: en un rato aparece en la tarjeta.');
  else aviso(l.sinConexion ? '📶 Poca señal: se termina de leer solo y aparece en la tarjeta.' : l.error, l.sinConexion ? '' : 'bad');
}

/** Las tarjetas en las que está cargado un mensaje ("W0001, W0002"). */
function refsDe(v) { return String(v || '').split(',').map(function (x) { return x.trim(); }).filter(String); }

/** En la burbuja: "📥 Cargado en C-0007" (abre la tarjeta). */
function htmlCargado(m) {
  return refsDe(m.ref).map(function (ref) {
    const t = ((CH.datos && CH.datos.tarjetas) || []).filter(function (x) { return x.ref === ref; })[0];
    return '<button type="button" class="ch-cargado" data-abrir-tarjeta="' + esc(ref) + '">📥 Cargado en ' + esc((t && (t.codigo || t.titulo)) || ref) + '</button>';
  }).join(' ');
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
/** Paso 5 (Feli, 2026-10-06): "Confirmar" pasó a ser "Revisado". Por dentro los estados siguen igual. */
const PR_NOMBRE = { 'Revisar': 'Para revisar', 'Para confirmar': 'Sin revisar', 'Confirmado': 'Revisado' };
function nombreEstado(e) { return PR_NOMBRE[e] || e; }
function htmlEstado(e) {
  return '<span class="pr-estado e-' + esc(e.replace(/\s+/g, '-').toLowerCase()) + '">' + (PR_ICONO[e] || '') + ' ' + esc(nombreEstado(e)) + '</span>';
}

/** "5/10 14:32" */
function fechaHoraCorta(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.getDate() + '/' + (d.getMonth() + 1) + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
}

/** Un renglón en pocas palabras: unidades · producto · precio · importe. */
function textoRenglon(r, moneda) {
  if (!r) return '';
  return [[cantTexto(r.cant), r.unidad].filter(String).join(' '), capital(r.texto),
          r.precio !== null && r.precio !== undefined ? plata(r.precio, r.moneda || moneda) : '',
          r.importe !== null && r.importe !== undefined ? plata(r.importe, r.moneda || moneda) : ''].filter(String).join(' · ');
}

/** Lo que se le cambió a mano a un renglón, con cómo estaba antes (Feli, 2026-10-05). */
function htmlAntes(r, moneda) {
  return (r.antes || []).map(function (a) {
    const cuando = ' por ' + esc(a.quien) + ' el ' + esc(fechaHoraCorta(a.cuando));
    let t;
    if (a.que === 'agregado') t = 'Agregado a mano' + cuando;
    else if (a.que === 'quitado') t = 'Quitado a mano' + cuando;
    else if (a.que === 'repartido') t = 'Repartido' + cuando + (a.antes ? '. Antes: ' + esc(a.antes) + ' para este pedido' : '');
    else if (a.que === 'ajustado') t = (a.cant ? 'Cambiaste la cantidad a ' + esc(a.cant) : 'Volviste a la cantidad del presupuesto') + cuando + (a.antes ? ' (antes: ' + esc(a.antes) + ')' : '');
    else t = 'Corregido' + cuando + '. Antes: ' + esc(textoRenglon(a.antes, moneda) || '(vacío)') + (a.antes && a.antes.producto ? ' · iba a «' + esc(a.antes.producto) + '»' : '');
    return '<div class="pr-antes">' + t + '</div>';
  }).join('');
}

/** Un renglón cotizado, como lo pidió Feli: unidades, el producto tal cual, precio unitario y total; abajo, en gris, los avisos. */
function htmlRenglonPresup(r, moneda, idPresup, editable) {
  const corregido = (r.antes || []).some(function (a) { return a.que !== 'repartido'; });
  return '<div class="pr-ren' + (r.problema ? ' pr-mal' : '') + '">' + (r.problema ? '⚠️ ' : '') +
    '<span>' + esc([cantTexto(r.cant), r.unidad].filter(String).join(' ')) + '</span> · ' + esc(capital(r.texto)) +
    (r.precio !== null ? ' · ' + esc(plata(r.precio, r.moneda || moneda)) : '') + (r.importe !== null ? ' · <b>' + esc(plata(r.importe, r.moneda || moneda)) + '</b>' : '') +
    (r.contenido && r.contenido !== 1 ? ' <small>(1 ' + esc(r.unidad || 'unidad') + ' = ' + esc(cantTexto(r.contenido)) + ')</small>' : '') +
    (r.cantAca !== r.cant && (r.linea || r.ajustada !== null) ? '<div class="pr-nota pr-este-r">Para este pedido: ' + esc(cantTexto(r.cantAca)) + ' ' + esc(r.unidad || '') +
      (r.importeAca !== null ? ' · ' + esc(plata(r.importeAca, r.moneda || moneda)) : '') +
      (r.ajustada !== null && r.ajustada !== undefined ? ' (cambiaste la cantidad)' : ' (repartido)') +
      (editable && r.repartido !== null && r.ajustada === null ? ' <button type="button" class="btn-chico" data-pr-repartir="' + r.n + '" data-id="' + esc(idPresup) + '">Cambiar el reparto</button>' : '') + '</div>' : '') +
    (r.problema ? '<div class="pr-problema">' + esc(r.problema) +
      (editable && r.revisable ? ' <button type="button" class="btn-chico" data-pr-bien="' + esc(r.id) + '" data-id="' + esc(idPresup) + '">✓ Está bien</button>' : '') +
      (editable && r.repartir ? ' <button type="button" class="btn-chico" data-pr-repartir="' + r.n + '" data-id="' + esc(idPresup) + '">Repartir</button>' : '') + '</div>' : '') +
    htmlAntes(r, moneda) +
    (r.corrigio && !corregido ? '<div class="pr-nota">Revisado por ' + esc(r.corrigio) + '</div>' : '') + '</div>';
}

const PR_CAMPOS = { 'Subtotal': 'Subtotal', 'Descuento': 'Descuento', 'IVA': 'IVA', 'Cargos': 'Flete y otros cargos', 'Total': 'Total', 'Con IVA': '¿Con IVA?',
                    'Flete': 'Flete', 'Validez': 'Validez', 'Forma de pago': 'Forma de pago', 'Plazo de entrega': 'Plazo de entrega', 'Entrega': 'Entrega',
                    'Observaciones': 'Observaciones' };
const PR_NUMEROS = ['Subtotal', 'Descuento', 'IVA', 'Cargos', 'Total'];

/** Los totales y condiciones cambiados a mano, con cómo estaban. */
function htmlAntesEncabezado(b) {
  const l = [];
  Object.keys(b.antes || {}).forEach(function (k) {
    (b.antes[k] || []).forEach(function (a) {
      const v = a.antes === '' || a.antes === null || a.antes === undefined ? '(vacío)' : PR_NUMEROS.indexOf(k) !== -1 ? plata(a.antes, b.moneda) : String(a.antes);
      l.push('<div class="pr-antes">' + esc(PR_CAMPOS[k] || k) + ': corregido por ' + esc(a.quien) + ' el ' + esc(fechaHoraCorta(a.cuando)) + '. Antes: ' + esc(v) + '</div>');
    });
  });
  return l.length ? '<div class="pr-antes-enc">' + l.join('') + '</div>' : '';
}

const PR_ORDINAL = ['', 'Primera', 'Segunda', 'Tercera', 'Cuarta', 'Quinta'];
function nombreParte(n) { return (PR_ORDINAL[n] || 'Parte ' + n) + (PR_ORDINAL[n] ? ' parte' : ''); }

/** "$ 1.234,56 (sin IVA)": el total del título (Feli, 2026-10-06). */
function htmlResumenTotal(t, moneda) {
  if (!t) return '';
  return esc(plata(t.monto, moneda)) + ' <small>(' + esc(t.que) + (t.calculado ? ', calculado' : '') + ')</small>';
}

/** "3 un · Martillo galponero": el encabezado de un renglón no pedido (Feli, 2026-10-07). */
function textoRenglonCorto(r) {
  const t = String(r.texto || '').toLowerCase();
  return [r.cant === null || r.cant === undefined ? '' : String(r.cant).replace('.', ','), t.charAt(0).toUpperCase() + t.slice(1)].filter(String).join(' · ');
}

/** Lo de un presupuesto (o de una de sus partes) adentro del desplegable. */
function htmlCuerpoPresupuesto(b) {
  const porN = {};
  b.renglones.forEach(function (r) { porN[r.n] = r; });
  const est = b.estado;
  let h = '';
  if (est === 'Leyendo') h += '<p class="nota">La IA lo está leyendo. Tarda hasta un minuto; si se cortó, lo termina el reloj solo.</p>';
  if ((b.tambienEn || []).length) h += '<p class="pr-nota">Este presupuesto está cargado también en ' + b.tambienEn.map(function (x) { return esc(x.codigo); }).join(' y ') +
    ' (es el mismo: lo que corrijas acá se corrige allá).</p>';
  if (b.reemplazo) h += '<p class="pr-nota">Reemplazó al presupuesto del ' + esc(fechaCorta(b.reemplazo.fecha)) + '.</p>';
  if (b.sinProductos && est !== 'Leyendo') h += '<p class="pr-nota">Esta tarjeta no tiene productos: el presupuesto queda como vino.</p>';
  const editable = est === 'Revisar' || est === 'Para confirmar';
  if (b.problemas.length && est !== 'Confirmado') {
    h += '<div class="pr-problemas"><b>Para revisar:</b><ul>' + b.problemas.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' +
      (b.renglones.some(function (r) { return r.problema; }) ? '<div class="pr-nota">Los renglones a revisar están marcados con ⚠️ más abajo.</div>' : '') + '</div>';
  }
  if (b.renglones.length || b.productos.length) {
    h += '<div class="pr-prods">' + b.productos.map(function (p) {
      return '<div class="pr-prod"><div class="pr-pedido">' + esc(p.cantidad) + ' · ' + esc(p.nombre) +
        (p.noPedido ? ' <span class="pr-np">No pedido</span>' : '') +
        (p.comprado ? ' <span class="pr-comprado' + (p.comprado.aEste ? ' aca' : '') + '">🛒 Comprado en ' + esc(p.comprado.proveedor) + '</span>' : '') + '</div>' +
        p.renglones.map(function (n) { return porN[n] ? htmlRenglonPresup(porN[n], b.moneda, b.id, editable) : ''; }).join('') +
        (p.avisos.length ? '<div class="pr-aviso">' + p.avisos.map(esc).join(' · ') + '</div>' : '') + '</div>';
    }).join('') + '</div>';
    // Lo no pedido, como un producto más (Feli, 2026-10-07): se compra desde el cuadro
    if (b.noPedido.length && b.sinProductos) h += '<div class="pr-prod"><div class="pr-pedido">Renglones del presupuesto</div>' +
      b.noPedido.map(function (n) { return porN[n] ? htmlRenglonPresup(porN[n], b.moneda, b.id, editable) : ''; }).join('') + '</div>';
    else h += b.noPedido.map(function (n) {
      const r = porN[n];
      return r ? '<div class="pr-prod"><div class="pr-pedido">' + esc(textoRenglonCorto(r)) + ' <span class="pr-np">No pedido</span></div>' +
        htmlRenglonPresup(r, b.moneda, b.id, editable) + '</div>' : '';
    }).join('');
    if (b.delOtro) h += '<div class="pr-nota">Además trae ' + b.delOtro + ' renglón' + (b.delOtro === 1 ? '' : 'es') + ' de ' +
      (b.tambienEn || []).map(function (x) { return esc(x.codigo); }).join(' y ') + ' (se ven en esa tarjeta)' +
      (b.noPedidoEn ? '. Lo que cotizó sin que se lo pidiéramos está en ' + esc(b.noPedidoEn) : '') + '.</div>';
  }
  if ((b.quitados || []).length) {
    h += '<div class="pr-prod"><div class="pr-pedido">Quitados a mano</div>' + b.quitados.map(function (r) {
      return '<div class="pr-ren pr-tachado"><s>' + esc(textoRenglon(r, b.moneda)) + '</s>' + htmlAntes(r, b.moneda) + '</div>';
    }).join('') + '</div>';
  }
  const iva = b.conIva === 'si' ? '(precios con IVA)' : b.conIva === 'no' ? '(precios sin IVA)' : '(sin dato de IVA)';
  const tot = [['Subtotal', b.subtotal], ['Descuento', b.descuento], ['IVA', b.iva], ['Otros impuestos', b.otros || null], ['Flete y otros cargos', b.cargos || null], ['Total', b.total]]
    .filter(function (x) { return x[1] !== null && x[1] !== undefined; });
  if (tot.length) {
    h += '<div class="pr-totales">' + tot.map(function (x) { return '<div><span>' + x[0] + '</span><b>' + esc(plata(x[1], b.moneda)) + '</b></div>'; }).join('') +
      '<div class="pr-nota">' + iva + '</div></div>';
  } else if (b.suma !== null && b.suma !== undefined && est !== 'Leyendo') {
    // Sin totales en el presupuesto: los suma la app (Feli, 2026-10-06)
    h += '<div class="pr-totales"><div><span>Suma de los renglones</span><b>' + esc(plata(b.suma, b.moneda)) + '</b></div>' +
      '<div class="pr-nota">El presupuesto no trae totales: la suma la hizo la app (los precios de los productos son sin IVA).</div></div>';
  }
  // Lo que vale para este pedido, si cambiaste cantidades o se repartió con otro pedido (Feli, 2026-10-06)
  const a = b.paraEste;
  if (a) {
    const fila = function (t, v) { return v === null || v === undefined ? '' : '<div><span>' + t + '</span><span>' + esc(plata(v, b.moneda)) + '</span></div>'; };
    const motivos = [];
    if (b.renglones.some(function (r) { return r.ajustada !== null && r.ajustada !== undefined; })) motivos.push('con las cantidades que cambiaste');
    if ((b.tambienEn || []).length) motivos.push('sin lo de ' + b.tambienEn.map(function (x) { return x.codigo; }).join(' y '));
    h += '<div class="pr-totales pr-este"><div class="pr-este-t">Para este pedido' + (motivos.length ? ' (' + esc(motivos.join(', ')) + ')' : '') + '</div>' +
      fila('Subtotal', a.subtotal) + fila('Descuento', a.descuento) + fila('IVA', a.iva) + fila('Otros impuestos', a.otros) + fila('Flete y otros cargos', a.cargos) +
      '<div><span>Total</span><b>' + esc(plata(a.total, b.moneda)) + '</b></div>' +
      (a.ivaProporcional ? '<div class="pr-nota">El IVA, en la misma proporción que en el presupuesto. Lo calculó la app.</div>' : '') + '</div>';
  }
  const cond = [['Validez', b.validez], ['Forma de pago', b.formaPago], ['Plazo de entrega', b.plazo], ['Entrega', b.entrega], ['Flete', b.flete], ['Observaciones', b.observaciones]]
    .filter(function (x) { return x[1]; });
  if (cond.length) h += '<div class="pr-cond">' + cond.map(function (x) { return '<div><span>' + x[0] + ':</span> ' + esc(x[1]) + '</div>'; }).join('') + '</div>';
  h += htmlAntesEncabezado(b);
  // Los mensajes del pedido ("vista por pedido"): lo que se cargó, con el original
  h += '<div class="pr-msjs"><div class="pr-nota">Cargado por ' + esc(b.cargo) + ' el ' + esc(fechaCorta(b.fecha)) + ', desde estos mensajes:</div>' +
    b.mensajes.map(function (m) {
      return '<div class="pr-msj"><span>' + esc(m.texto || 'Mensaje') + '</span>' +
        (m.archivo ? '<button type="button" class="btn-chico" data-ver-archivo="' + esc(m.archivo) + '">Ver el original</button>' : '') + '</div>';
    }).join('') + (veChats() ? '<button type="button" class="btn-chico" data-pr-chat="' + esc(b.chat) + '">💬 Ir al chat</button>' : '') + '</div>';
  if (b.confirmo) h += '<div class="pr-nota">Revisado por ' + esc(b.confirmo) + ' el ' + esc(fechaCorta(b.fechaConfirmacion)) + '.</div>';
  // Lo que se puede hacer, según el estado
  const bs = [];
  if (est === 'Revisar' || est === 'Para confirmar') bs.push(['corregir', '✏️ Corregir'], ['confirmar', '✅ Revisado']);
  if (est === 'No se pudo leer') bs.push(['corregir', '✏️ Cargarlo a mano']);
  if (est === 'Confirmado') bs.push(['reabrir', '↩️ Volver a revisar']);
  if (est !== 'Confirmado') bs.push(['leer', est === 'Leyendo' ? 'Leer ahora' : '🔄 Volver a leer'], ['quitar', 'Quitar']);
  h += '<div class="pr-acciones">' + bs.map(function (x) {
    return '<button type="button" class="btn-chico' + (x[0] === 'confirmar' ? ' si' : '') + '" data-pr="' + x[0] + '" data-id="' + esc(b.id) + '">' + x[1] + '</button>';
  }).join('') + '</div>';
  return h;
}

/** El estado de un presupuesto en partes: el de la parte más atrasada. */
function estadoDePartes(partes) {
  const orden = ['Leyendo', 'No se pudo leer', 'Revisar', 'Para confirmar', 'Confirmado'];
  return partes.map(function (b) { return b.estado; }).sort(function (a, c) { return orden.indexOf(a) - orden.indexOf(c); })[0];
}

/**
 * Un presupuesto en la tarjeta: un solo desplegable por proveedor, con sus partes adentro, una después de la otra
 * (Feli, 2026-10-06). En el título, el total sin IVA si se sabe (y la marca), y lo que vale para este pedido si cambia.
 */
function htmlPresupuesto(partes) {
  const b = partes[0], est = partes.length > 1 ? estadoDePartes(partes) : b.estado;
  // El total del título: el de cada parte (o lo que vale para este pedido), sumado si tienen la misma marca
  const montos = partes.map(function (x) { return x.paraEste ? { monto: x.paraEste.sinIva, que: x.paraEste.que || 'sin IVA', calculado: true } : x.resumen; });
  let total = '', paraEste = '';
  if (partes.length === 1) {
    total = htmlResumenTotal(b.resumen, b.moneda);
    if (b.paraEste) paraEste = 'para este pedido: ' + esc(plata(b.paraEste.sinIva, b.moneda)) + ' (' + esc(b.paraEste.que || 'sin IVA') + ')';
  } else if (montos.every(function (m) { return m; }) && montos.every(function (m) { return m.que === montos[0].que; })) {
    total = htmlResumenTotal({ monto: Math.round(montos.reduce(function (s, m) { return s + m.monto; }, 0) * 100) / 100, que: montos[0].que,
                               calculado: montos.some(function (m) { return m.calculado; }) }, b.moneda);
    paraEste = 'las ' + partes.length + ' partes juntas';
  }
  const cabeza = '<summary><b>' + esc(b.nombre) + '</b>' + (partes.length > 1 ? ' <span class="pr-parte">' + partes.length + ' partes</span>' : '') +
    ' ' + htmlEstado(est) +
    (total ? ' <span class="pr-total">' + total + (paraEste ? '<small class="pr-total-este">' + paraEste + '</small>' : '') + '</span>' : '') + '</summary>';
  const h = partes.map(function (x, i) {
    if (partes.length === 1) return htmlCuerpoPresupuesto(x);
    return '<div class="pr-parte-b"><div class="pr-parte-t">' + esc(nombreParte(i + 1)) + ' · ' + esc(fechaCorta(x.fecha)) +
      ' ' + htmlEstado(x.estado) +
      (x.resumen ? ' <span class="pr-total">' + htmlResumenTotal(x.resumen, x.moneda) + '</span>' : '') + '</div>' + htmlCuerpoPresupuesto(x) + '</div>';
  }).join('');
  return '<details class="pr-uno" data-pr-uno="' + esc(b.id) + '"' + (PR.abiertos[b.id] ? ' open' : '') + '>' + cabeza + '<div class="pr-cuerpo">' + h + '</div></details>';
}

/** Los presupuestos de la tarjeta, juntando las partes de cada uno (vienen ordenados: el primero y después sus partes). */
function presupuestosEnPartes(l) {
  const grupos = [], de = {};
  l.forEach(function (b) {
    const k = (b.parte && b.parte.principal) || b.id;
    if (!de[k]) { de[k] = []; grupos.push(de[k]); }
    de[k].push(b);
  });
  return grupos;
}

function pintarPresupuestos() {
  const b = $('tj-presup-b');
  if (!b) return;
  const d = TB.detalle, l = (d && d.presupuestos) || [];
  b.hidden = !APP.yo.admin || TB.tipo === 'tarea' || !d || !d.pedido || (!l.length && !(d.solicitudes || []).length);
  if (b.hidden) return;
  const leidos = l.filter(function (x) { return ['Revisar', 'Para confirmar', 'Confirmado'].indexOf(x.estado) !== -1; });
  // Paso 5 (Feli, 2026-10-06): un solo botón para comparar y comprar
  $('tj-presup').innerHTML = (leidos.length ? '<div class="pr-arriba"><button type="button" class="btn-chico si pr-cuadro-b" id="pr-cuadro">📊 Cuadro comparativo de compra</button></div>' : '') +
    (l.length ? presupuestosEnPartes(l).map(htmlPresupuesto).join('')
      : '<p class="nota" style="margin:0">Cuando llegue un presupuesto, cargalo desde el chat: en el menú del mensaje, "📥 Cargar en una tarjeta".</p>');
  if ($('pr-cuadro')) $('pr-cuadro').addEventListener('click', function () { abrirCuadro(TB.abierta); });
  $('tj-presup').querySelectorAll('[data-pr-repartir]').forEach(function (x) { x.addEventListener('click', function () { repartirUI(x.dataset.id, Number(x.dataset.prRepartir)); }); });
  $('tj-presup').querySelectorAll('[data-pr-uno]').forEach(function (x) {
    x.addEventListener('toggle', function () { if (x.open) PR.abiertos[x.dataset.prUno] = true; else delete PR.abiertos[x.dataset.prUno]; });
  });
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
      const si = await dialogo({ titulo: 'Las cuentas no dan', texto: 'Este presupuesto tiene cosas para revisar. ¿Lo marcás como revisado igual?',
                                 botones: [{ texto: 'Volver', valor: false }, { texto: 'Revisado igual', clase: 'btn', valor: true }] });
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
  const res = await api('corregirPresupuesto', idPresup, { renglones: [{ id: r.id, linea: r.linea, texto: r.texto, cant: r.ajustada !== null ? r.ajustada : r.cant, unidad: r.unidad,
                                                                        precio: r.precio, importe: r.importe, contenido: r.contenido }] });
  if (!res.ok) return aviso(res.sinConexion ? '📶 Hace falta señal para esto. Probá cuando vuelva.' : res.error, 'bad');
  ponerPresupuesto(res.presupuesto);
  aviso(res.presupuesto.estado === 'Revisar' ? 'Listo. Todavía queda algo para revisar.' : 'Listo: ya no tiene nada para revisar.');
}

/** Repartir un renglón que vino sumando lo de dos pedidos: cuánto va a cada uno (en la unidad del proveedor). */
async function repartirUI(idPresup, n) {
  const b = presupuestoAbierto(idPresup);
  const r = b && b.renglones.filter(function (x) { return x.n === n; })[0];
  if (!r) return;
  const otras = (b.tambienEn || []).filter(function (x) { return r.otras.indexOf(x.codigo) !== -1; });
  const prod = (b.deLaTarjeta || []).filter(function (p) { return p.linea === r.linea; })[0];
  const pedido = prod ? parseFloat(String(prod.cantidad).replace(/\./g, '').replace(',', '.')) : NaN;
  const sugerido = r.repartido !== null ? r.repartido : !isNaN(pedido) ? Math.round(pedido / (r.contenido || 1) * 1000) / 1000 : '';
  const resto = sugerido !== '' && r.cant !== null && otras.length === 1 ? Math.round((r.cant - sugerido) * 1000) / 1000 : '';
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo pr-editar';
  cuerpo.innerHTML = '<p class="nota">El renglón «' + esc(capital(r.texto)) + '» trae ' + esc(cantTexto(r.cant)) + ' ' + esc(r.unidad || '') +
    '. ¿Cuántas van a cada pedido? (en la unidad del proveedor)</p>' +
    '<label>' + esc(b.codigo) + (prod ? ' <small>(pediste ' + esc(prod.cantidad) + ')</small>' : '') +
    '<input data-rep="' + esc(b.ref) + '" inputmode="decimal" value="' + esc(numEnInput(sugerido === '' ? null : sugerido)) + '"></label>' +
    otras.map(function (x) {
      return '<label>' + esc(x.codigo) + '<input data-rep="' + esc(x.ref) + '" inputmode="decimal" value="' + esc(otras.length === 1 ? numEnInput(resto === '' ? null : resto) : '') + '"></label>';
    }).join('');
  const partes = await dialogo({ titulo: 'Repartir entre los pedidos', cuerpo: cuerpo,
    botones: [{ texto: 'Volver', valor: null }, { texto: 'Repartir', clase: 'btn', valor: function () {
      const o = {};
      cuerpo.querySelectorAll('[data-rep]').forEach(function (x) { o[x.dataset.rep] = x.value.trim(); });
      return o;
    } }] });
  if (!partes) return;
  const res = await api('repartirRenglon', idPresup, n, partes);
  if (!res.ok) return aviso(res.sinConexion ? '📶 Hace falta señal para esto. Probá cuando vuelva.' : res.error, 'bad');
  ponerPresupuesto(res.presupuesto);
  aviso('Listo: repartido. En la otra tarjeta también quedó.');
}

/* ---------- Corregir a mano ---------- */

function numEnInput(n) { return n === null || n === undefined ? '' : String(n).replace('.', ','); }

/** La cantidad que se ve al corregir: la que cambió una persona, o la del presupuesto. */
function cantVista(r) { return r && r.ajustada !== null && r.ajustada !== undefined ? r.ajustada : r && r.cant; }

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
      '<div class="pr-ed-n">' + (r.n ? 'Renglón ' + r.n : 'Renglón nuevo') + (r.otras && r.otras.length && !r.linea ? ' <small>(de ' + esc(r.otras.join(' y ')) + ')</small>' : '') + '<label class="pr-ed-q"><input type="checkbox" data-c="quitar"> Quitar</label></div>' +
      '<label>Producto que pedimos<select data-c="linea">' + opciones + '</select></label>' +
      '<label>Cómo lo escribió<input data-c="texto" value="' + esc(r.texto || '') + '"></label>' +
      '<div class="pr-ed-g"><label>Cantidad<input data-c="cant" inputmode="decimal" value="' + esc(numEnInput(cantVista(r))) + '"></label>' +
      '<label>Unidad<input data-c="unidad" value="' + esc(r.unidad || '') + '"></label>' +
      '<label title="Cuántas de nuestras unidades trae una (un rollo = 100 m)">Trae<input data-c="contenido" inputmode="decimal" value="' + esc(numEnInput(r.contenido)) + '"></label></div>' +
      '<div class="pr-ed-g"><label>Precio unitario<input data-c="precio" inputmode="decimal" value="' + esc(numEnInput(r.precio)) + '"></label>' +
      '<label>Importe<input data-c="importe" inputmode="decimal" value="' + esc(numEnInput(r.importe)) + '"></label></div></div>';
  };
  const tot = [['subtotal', 'Subtotal', b.subtotal], ['descuento', 'Descuento', b.descuento], ['iva', 'IVA', b.iva], ['cargos', 'Flete y otros cargos', b.cargos || null], ['total', 'Total', b.total]];
  const cond = [['validez', 'Validez', b.validez], ['formaPago', 'Forma de pago', b.formaPago], ['plazo', 'Plazo de entrega', b.plazo], ['entrega', 'Entrega (retira o envío)', b.entrega],
                ['flete', 'Flete', b.flete], ['observaciones', 'Observaciones', b.observaciones]];
  cuerpo.innerHTML = '<p class="nota">Los números como en el presupuesto (1.234,56). Las cuentas las vuelve a hacer la app. ' +
    'Si cambiás solo la cantidad (sin tocar el precio ni el importe), queda como un cambio tuyo para este pedido: el presupuesto sigue diciendo lo suyo y la app calcula el importe nuevo.</p>' +
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
          nuevo.cant === numEnInput(cantVista(ant)) && nuevo.precio === numEnInput(ant.precio) && nuevo.importe === numEnInput(ant.importe) &&
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

/* ---------- Paso 5: la compra, en su tarjeta de seguimiento ---------- */

/** El bloque "🛒 Compra" de una tarjeta de seguimiento que salió de una compra (del cuadro o confirmada a mano en el chat). */
function pintarCompra() {
  const b = $('tj-compra-b');
  if (!b) return;
  const d = TB.detalle, c = d && d.compra;
  b.hidden = !c || TB.tipo === 'tarea';
  if (b.hidden) return;
  if (!APP.yo.admin) { $('tj-compra').innerHTML = '<p class="nota" style="margin:0">Comprado en ' + esc(c.proveedor) + '.</p>'; return; }
  const cond = [['Entrega', c.condiciones.entrega], ['Flete', c.condiciones.flete], ['Forma de pago', c.condiciones.formaPago], ['Plazo de entrega', c.condiciones.plazo], ['Validez', c.condiciones.validez]]
    .filter(function (x) { return x[1]; });
  const m = c.mensaje;
  $('tj-compra').innerHTML = '<p class="pr-nota" style="margin-top:0">Comprado a <b>' + esc(c.proveedor) + '</b> por ' + esc(c.quien) + ' el ' + esc(fechaCorta(c.fecha)) +
      ', desde <button type="button" class="enlace" data-abrir-ref="' + esc(c.desde) + '">' + esc(c.codigo) + '</button>.</p>' +
    c.productos.map(function (p) {
      return '<div class="pr-prod"><div class="pr-pedido">' + esc(p.cantidad) + ' · ' + esc(p.nombre) + '</div>' +
        p.renglones.map(function (r) { return '<div class="pr-ren">' + esc(textoRenglon(r, r.moneda)) + '</div>'; }).join('') + '</div>';
    }).join('') +
    (c.total !== null ? '<div class="pr-totales"><div><span>Total (sin IVA)</span><b>' + esc(plata(c.total, c.moneda)) + '</b></div></div>' : '') +
    (cond.length ? '<div class="pr-cond">' + cond.map(function (x) { return '<div><span>' + x[0] + ':</span> ' + esc(x[1]) + '</div>'; }).join('') + '</div>' : '') +
    '<div class="pr-msjs">' + (c.manual ? '<div class="pr-nota">✅ Confirmada a mano por el chat (la app no le mandó mensaje).</div>' : '') + (m ? (m.enviado ? '<div class="pr-nota">✅ La confirmación le llegó por WhatsApp.</div>'
                                                : '<div class="pr-problema">El mensaje de confirmación no salió: mandalo desde el chat.</div>') : '') +
    (c.archivo ? '<button type="button" class="btn-chico" data-ver-archivo="' + esc(c.archivo) + '">Ver el presupuesto</button> ' : '') +
    (c.chat && veChats() ? '<button type="button" class="btn-chico" data-pr-chat="' + esc(c.chat) + '">💬 Ir al chat</button>' : '') +
    // Feli (2026-10-06): a la vista, para anularla (es lo mismo que cancelar la tarjeta)
    (columnasFinales().indexOf(d.pedido.columna) === -1 ? ' <button type="button" class="btn-chico" id="tj-anular">Anular la compra</button>' : '') + '</div>';
  $('tj-compra').querySelectorAll('[data-abrir-ref]').forEach(function (x) { x.addEventListener('click', function () { irPorAccesoDirecto(x.dataset.abrirRef); }); });
  $('tj-compra').querySelectorAll('[data-pr-chat]').forEach(function (x) { x.addEventListener('click', function () { irAlChat(x.dataset.prChat); }); });
  $('tj-compra').querySelectorAll('[data-ver-archivo]').forEach(function (x) { x.addEventListener('click', function () { verArchivo(x.dataset.verArchivo); }); });
  if ($('tj-anular')) $('tj-anular').addEventListener('click', function () {
    const t = buscarEnVista(TB.abierta);
    if (t) anularCompraUI(TB.abierta, t);
  });
}

/** Las columnas de los terminados (Entregado y Cancelado). */
function columnasFinales() { return [colEntregado(), colCancelado()]; }

/**
 * Cancelar una tarjeta de seguimiento de una compra: se anula la compra (los productos vuelven a Decisión).
 * Va directo (con señal), y después ofrece avisarle al proveedor con un mensaje propuesto.
 */
async function anularCompraUI(ref, t) {
  const c = TB.detalle.compra;
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = '<label for="dg-motivo">¿Por qué se cancela?</label><textarea id="dg-motivo" placeholder="Ej: no tenía stock, se consiguió más barato…"></textarea>';
  const motivo = await dialogo({
    titulo: '¿Cancelar esta compra?',
    texto: 'Se anula la compra a ' + c.proveedor + ': sus productos vuelven a ' + c.codigo + ', en Decisión, para elegir de nuevo. No se borra nada.',
    cuerpo: cuerpo,
    botones: [{ texto: 'Sí, cancelar la compra', clase: 'btn peligro-btn', id: 'dg-ok', valor: function () { return $('dg-motivo').value.trim(); } },
              { texto: 'No, volver', valor: null }],
    alAbrir: function () {
      const ok = $('dg-ok'), m = $('dg-motivo');
      const revisar = function () { ok.disabled = m.value.trim().length < 3; };
      m.addEventListener('input', revisar);
      revisar();
      m.focus();
    }
  });
  if (!motivo) return;
  aviso('Cancelando la compra…');
  const r = await api('cancelarPedido', ref, motivo, t.columna);
  if (!r.ok) return aviso(r.sinConexion ? '📶 Hace falta señal para cancelar una compra. Probá cuando vuelva.' : r.error, 'bad');
  cerrarTarjeta();
  cargarTablero();
  aviso('Compra cancelada: los productos volvieron a ' + c.codigo + '.');
  const a = r.aviso;
  if (!a || !a.chat) return;
  await new Promise(function (ok) { setTimeout(ok, 500); });     // que termine de cerrarse la tarjeta (el "atrás" cierra los diálogos)
  const cuerpo2 = document.createElement('div');
  cuerpo2.className = 'cuerpo';
  const propuesto = 'Hola' + (a.contacto ? ' ' + a.contacto : '') + ', cancelamos la compra de:\n' + a.productos.map(function (x) { return '- ' + x; }).join('\n') + '\n\n¡Gracias por entender!';
  cuerpo2.innerHTML = '<textarea id="dg-aviso" rows="7">' + esc(propuesto) + '</textarea>';
  const texto = await dialogo({ titulo: '¿Le querés avisar a ' + a.proveedor + ' que no se lo vas a comprar?', cuerpo: cuerpo2,
    botones: [{ texto: 'No avisar', valor: null }, { texto: 'Mandar el mensaje', clase: 'btn', valor: function () { return $('dg-aviso').value.trim(); } }] });
  if (!texto) return;
  const m = await api('mandarMensaje', { id: 'H' + nuevoId(), chat: a.chat, texto: texto });
  aviso(m.ok ? 'Listo: se le avisó a ' + a.proveedor + '.' : (m.sinConexion ? '📶 Poca señal: no salió. Mandalo desde el chat.' : m.error), m.ok ? '' : 'bad');
}
