/* ---------- El cuadro comparativo (Fase 4, Paso 4; Feli, 2026-10-05) ----------
   "📊 Armar cuadro comparativo", en el bloque Presupuestos de la tarjeta abierta (solo admins). Una columna por
   proveedor (con sus partes) y una fila por producto pedido, en el orden de la tarjeta. Cada casillero: las
   unidades, el producto como lo escribió el proveedor, el precio unitario y el total; abajo, en gris, los avisos.
   El más barato de cada fila se marca con texto y color (en nuestra unidad y en la misma moneda). Abajo de cada
   columna: No pedido, totales, total comparable, condiciones y anotaciones. Se arma cada vez (sin IA), así sale
   rehecho después de cualquier cambio; quedan guardados los tildes de "controlado" y las anotaciones.
   "🖨️ Imprimir" lo imprime o lo guarda como PDF, apaisado y con todas las columnas. Todo necesita señal. */

const CQ = { datos: null };

/** "= $ 655,83 el metro": nuestra unidad, sacada de la cantidad pedida ("3200 mts"). */
function porNuestraUnidad(cantidad) {
  const u = String(cantidad || '').replace(/^\s*[\d.,]+\s*/, '').trim().toLowerCase();
  if (/^(m|mt|mts|metro|metros)\.?$/.test(u)) return 'el metro';
  if (/^(kg|kgs|kilo|kilos)\.?$/.test(u)) return 'el kilo';
  if (/^(l|lt|lts|litro|litros)\.?$/.test(u)) return 'el litro';
  if (/^(m2|mts2|m²)$/.test(u)) return 'el m²';
  if (!u || /^(u|un|und|unid|unidad|unidades)\.?$/.test(u)) return 'la unidad';
  return 'por ' + u;
}

async function abrirCuadro(ref) {
  if (!ref) return;
  const c = $('cuadro');
  if (c.parentNode !== document.body) document.body.appendChild(c);     // así, al imprimir, se imprime solo el cuadro
  CQ.datos = null;
  $('cuadro-titulo').textContent = '📊 Cuadro comparativo';
  $('cuadro-sub').textContent = '';
  $('cuadro-cuerpo').innerHTML = '<p class="nota cq-cargando">Armando el cuadro…</p>';
  c.hidden = false;
  document.body.classList.add('con-cuadro');
  const r = await apiLenta('cuadroComparativo', ref);
  if (c.hidden) return;
  if (!r.ok) {
    $('cuadro-cuerpo').innerHTML = '<p class="nota cq-cargando">' + esc(r.sinConexion ? '📶 Hace falta señal para armar el cuadro. Probá cuando vuelva.' : r.error) + '</p>';
    return;
  }
  CQ.datos = r.cuadro;
  pintarCuadro();
}

function cerrarCuadro() {
  $('cuadro').hidden = true;
  document.body.classList.remove('con-cuadro');
  CQ.datos = null;
}

$('cuadro-x').addEventListener('click', cerrarCuadro);
$('cuadro-imprimir').addEventListener('click', function () { if (CQ.datos) window.print(); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('cuadro').hidden && $('dialogo').hidden) cerrarCuadro(); });

/** El tilde de "controlado" de un casillero (o de los totales de una columna). */
function htmlControl(clave, huella, k) {
  const vigente = k && k.vigente;
  return '<label class="cq-control no-imprimir"><input type="checkbox" data-cq-control="' + esc(clave) + '" data-huella="' + esc(huella) + '"' + (vigente ? ' checked' : '') + '> Controlado</label>' +
    (vigente ? '<div class="cq-controlo">Controlado por ' + esc(k.quien) + ' el ' + esc(fechaHoraCorta(k.cuando)) + '</div>' : '') +
    (k && !vigente ? '<div class="cq-cambio">Cambió después de controlarlo (lo había controlado ' + esc(k.quien) + ')</div>' : '');
}

function htmlCasillero(col, p) {
  const c = col.casilleros[p.linea];
  if (!c) return '<td></td>';
  let h = '';
  if (!c.renglones.length) {
    h = '<div class="cq-aviso">' + c.avisos.map(esc).join(' · ') + '</div>';
    return '<td class="cq-cas' + (c.noSePidio ? ' cq-nopedido' : '') + '">' + h + '</td>';
  }
  if (c.masBarato) h += '<div class="cq-barato">Más barato</div>';
  h += c.renglones.map(function (r) {
    return '<div class="cq-ren"><span class="cq-cant">' + esc([cantTexto(r.cant), r.unidad].filter(String).join(' ')) + '</span> ' + esc(capital(r.texto)) +
      (r.precio !== null ? '<div class="cq-precios">' + esc(plata(r.precio, r.moneda)) + (r.importe !== null ? ' · <b>' + esc(plata(r.importe, r.moneda)) + '</b>' : '') + '</div>'
        : r.importe !== null ? '<div class="cq-precios"><b>' + esc(plata(r.importe, r.moneda)) + '</b></div>' : '') + '</div>';
  }).join('');
  if (c.renglones.length > 1 && c.total !== null) h += '<div class="cq-precios">Total: <b>' + esc(plata(c.total, c.moneda)) + '</b></div>';
  if (c.otraUnidad && c.precioNuestro !== null) h += '<div class="cq-nuestra">= ' + esc(plata(c.precioNuestro, c.moneda)) + ' ' + esc(porNuestraUnidad(p.cantidad)) + '</div>';
  if (c.avisos.length) h += '<div class="cq-aviso">' + c.avisos.map(esc).join(' · ') + '</div>';
  h += htmlControl(col.proveedor + '|' + p.linea, c.huella, c.control);
  return '<td class="cq-cas' + (c.masBarato ? ' cq-mas-barato' : '') + '">' + h + '</td>';
}

function htmlTotalesColumna(col) {
  const fila = function (t, v, m, fuerte) { return v === null || v === undefined ? '' : '<div class="cq-tot"><span>' + t + '</span>' + (fuerte ? '<b>' : '<span>') + esc(plata(v, m)) + (fuerte ? '</b>' : '</span>') + '</div>'; };
  let h = col.partes.map(function (e) {
    const iva = e.conIva === 'si' ? '(precios con IVA)' : e.conIva === 'no' ? '(precios sin IVA)' : '(sin dato de IVA)';
    return (col.partes.length > 1 ? '<div class="cq-parte">Presupuesto ' + e.n + ' (' + esc(fechaCorta(e.fecha)) + ')</div>' : '') +
      fila('Subtotal', e.subtotal, e.moneda) + fila('Descuento', e.descuento, e.moneda) + fila('IVA', e.iva, e.moneda) + fila('Otros impuestos', e.otros, e.moneda) +
      fila('Flete y otros cargos', e.cargos, e.moneda) + fila('Total', e.total, e.moneda, true) + '<div class="cq-gris">' + iva + '</div>' +
      (e.flete ? '<div class="cq-gris">Flete: ' + esc(e.flete) + '</div>' : '');
  }).join('');
  if (col.suma) {
    const m = col.partes[0].moneda;
    h += '<div class="cq-parte">Suma de los ' + col.partes.length + ' presupuestos</div>' + fila('Subtotal', col.suma.subtotal, m) + fila('IVA', col.suma.iva, m) + fila('Total', col.suma.total, m, true) +
      (col.repite ? '<div class="cq-cambio">Ojo: un presupuesto repite productos de otro, y la suma los cuenta dos veces. Para comparar, mirá el total comparable.</div>' : '');
  }
  return h + htmlControl(col.proveedor + '|_totales', col.huella, col.control);
}

function htmlCondiciones(col) {
  return col.partes.map(function (e) {
    const l = [['Validez', e.validez], ['Forma de pago', e.formaPago], ['Plazo de entrega', e.plazo], ['Entrega', e.entrega], ['Observaciones', e.observaciones]]
      .filter(function (x) { return x[1]; });
    return (col.partes.length > 1 ? '<div class="cq-parte">Presupuesto ' + e.n + '</div>' : '') +
      (l.length ? l.map(function (x) { return '<div><span class="cq-gris">' + x[0] + ':</span> ' + esc(x[1]) + '</div>'; }).join('') : '<div class="cq-gris">No dice.</div>');
  }).join('');
}

function htmlNotas(col) {
  return '<div class="cq-notas">' + col.notas.map(function (n) {
    return '<div class="cq-nota">' + esc(n.texto) + '<div class="cq-gris">' + esc(n.quien) + ' · ' + esc(fechaHoraCorta(n.cuando)) +
      (n.quien === APP.yo.nombre ? ' <button type="button" class="cq-quitar no-imprimir" data-cq-quitar="' + esc(n.id) + '" title="Quitar la anotación">✕</button>' : '') + '</div></div>';
  }).join('') + '</div>' +
    '<div class="cq-anotar no-imprimir"><textarea rows="2" placeholder="Escribí una anotación…" data-cq-texto="' + esc(col.proveedor) + '"></textarea>' +
    '<button type="button" class="btn-chico" data-cq-anotar="' + esc(col.proveedor) + '">Anotar</button></div>';
}

function pintarCuadro() {
  const q = CQ.datos;
  if (!q) return;
  $('cuadro-titulo').textContent = '📊 Cuadro comparativo · ' + q.codigo + (q.titulo ? ' · ' + q.titulo : '');
  $('cuadro-sub').textContent = 'Armado por ' + q.armo + ' el ' + fechaHoraCorta(q.fecha);
  if (!q.columnas.length) {
    $('cuadro-cuerpo').innerHTML = '<p class="nota cq-cargando">Todavía no hay presupuestos leídos en esta tarjeta.</p>';
    return;
  }
  const cols = q.columnas;
  const fila = function (titulo, celda, clase) {
    return '<tr class="' + (clase || '') + '"><th class="cq-fija cq-rotulo">' + titulo + '</th>' + cols.map(function (c) { return '<td>' + celda(c) + '</td>'; }).join('') + '</tr>';
  };
  let h = '<table class="cq-tabla"><thead><tr><th class="cq-fija">' + (q.sinProductos ? 'Presupuesto' : 'Pediste') + '</th>' + cols.map(function (c) {
    return '<th><div class="cq-prov">' + esc(c.nombre) + '</div>' + (c.sinConfirmar ? '<div class="cq-sin">Sin confirmar</div>' : '') +
      (c.partes.length > 1 ? '<div class="cq-gris">' + c.partes.map(function (e) { return 'Presupuesto ' + e.n + ' (' + esc(fechaCorta(e.fecha)) + ')'; }).join(' · ') + '</div>' : '') + '</th>';
  }).join('') + '</tr></thead><tbody>';
  q.productos.forEach(function (p) {
    h += '<tr><th class="cq-fija"><span class="cq-cant">' + esc(p.cantidad) + '</span> ' + esc(p.nombre) + (p.nota ? '<div class="cq-gris">' + esc(p.nota) + '</div>' : '') + '</th>' +
      cols.map(function (c) { return htmlCasillero(c, p); }).join('') + '</tr>';
  });
  const renglones = function (l) {
    return l.length ? l.map(function (r) {
      return '<div class="cq-ren">' + (r.parte > 1 || (cols.some(function (c) { return c.partes.length > 1; })) ? '<span class="cq-gris">P' + r.parte + ' · </span>' : '') +
        '<span class="cq-cant">' + esc([cantTexto(r.cant), r.unidad].filter(String).join(' ')) + '</span> ' + esc(capital(r.texto)) +
        '<div class="cq-precios">' + esc([r.precio !== null ? plata(r.precio, r.moneda) : '', r.importe !== null ? plata(r.importe, r.moneda) : ''].filter(String).join(' · ')) + '</div></div>';
    }).join('') : '<span class="cq-gris">—</span>';
  };
  if (q.sinProductos) h += fila('Renglones', function (c) { return renglones(c.renglones || []); });
  else if (cols.some(function (c) { return c.noPedido.length; })) h += fila('No pedido', function (c) { return renglones(c.noPedido); }, 'cq-pie');
  h += fila('Totales', htmlTotalesColumna, 'cq-pie');
  if (!q.sinProductos) {
    const cp = q.comparable;
    h += fila('Total comparable<div class="cq-gris">' + (cp.nota ? esc(cp.nota) : 'Solo lo pedido, en la cantidad pedida, de los productos que cotizaron todos (' + cp.productos + ' de ' + cp.de + ')') + '</div>', function (c) {
      return c.comparable === null ? '<span class="cq-gris">—</span>' : '<b class="cq-comparable">' + esc(plata(c.comparable, cp.moneda)) + '</b>';
    }, 'cq-pie');
  }
  h += fila('Condiciones', htmlCondiciones, 'cq-pie');
  h += fila('Anotaciones', htmlNotas, 'cq-pie');
  h += '</tbody></table>';
  if (q.anterior && q.anterior.quien) h += '<p class="cq-gris cq-al-pie no-imprimir">La vez anterior lo armó ' + esc(q.anterior.quien) + ' el ' + esc(fechaHoraCorta(q.anterior.cuando)) + '.</p>';
  $('cuadro-cuerpo').innerHTML = h;
  const cuerpo = $('cuadro-cuerpo');
  cuerpo.querySelectorAll('[data-cq-control]').forEach(function (x) { x.addEventListener('change', function () { controlarCasillero(x); }); });
  cuerpo.querySelectorAll('[data-cq-anotar]').forEach(function (x) { x.addEventListener('click', function () { anotar(x.dataset.cqAnotar); }); });
  cuerpo.querySelectorAll('[data-cq-quitar]').forEach(function (x) { x.addEventListener('click', function () { quitarNota(x.dataset.cqQuitar); }); });
}

function columnaDe(pid) { return (CQ.datos.columnas || []).filter(function (c) { return c.proveedor === pid; })[0]; }

async function controlarCasillero(x) {
  const clave = x.dataset.cqControl, si = x.checked;
  x.disabled = true;
  const r = await api('controlarCuadro', CQ.datos.ref, clave, x.dataset.huella, si);
  if (!CQ.datos) return;
  if (!r.ok) {
    x.checked = !si;
    x.disabled = false;
    return aviso(r.sinConexion ? '📶 Hace falta señal para esto. Probá cuando vuelva.' : r.error, 'bad');
  }
  const partes = clave.split('|'), col = columnaDe(partes[0]);
  if (col) {
    if (partes[1] === '_totales') col.control = r.control;
    else if (col.casilleros[partes[1]]) col.casilleros[partes[1]].control = r.control;
  }
  pintarCuadro();
}

async function anotar(pid) {
  const t = document.querySelector('[data-cq-texto="' + CSS.escape(pid) + '"]');
  const texto = t ? t.value.trim() : '';
  if (!texto) return aviso('Escribí la anotación.');
  const r = await api('anotarCuadro', CQ.datos.ref, { id: 'N' + nuevoId(), proveedor: pid, texto: texto });
  if (!CQ.datos) return;
  if (!r.ok) return aviso(r.sinConexion ? '📶 Hace falta señal para esto. Probá cuando vuelva.' : r.error, 'bad');
  const col = columnaDe(pid);
  if (col) col.notas = r.notas;
  pintarCuadro();
}

async function quitarNota(id) {
  const si = await dialogo({ titulo: 'Quitar la anotación', texto: '¿Quitamos esta anotación del cuadro?',
                             botones: [{ texto: 'Volver', valor: false }, { texto: 'Quitar', clase: 'btn', valor: true }] });
  if (!si) return;
  const r = await api('anotarCuadro', CQ.datos.ref, { quitar: id });
  if (!CQ.datos) return;
  if (!r.ok) return aviso(r.sinConexion ? '📶 Hace falta señal para esto. Probá cuando vuelva.' : r.error, 'bad');
  CQ.datos.columnas.forEach(function (c) { if (c.notas.some(function (n) { return n.id === id; })) c.notas = r.notas; });
  pintarCuadro();
}
