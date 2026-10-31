/* ---------- El cuadro comparativo (Fase 4, Paso 4; Feli, 2026-10-05) ----------
   "📊 Cuadro comparativo de compra", en el bloque Presupuestos de la tarjeta abierta (solo admins; Paso 5: también para comprar). Una columna por
   proveedor (con sus partes) y una fila por producto pedido, en el orden de la tarjeta. Cada casillero: las
   unidades, el producto como lo escribió el proveedor, el precio unitario y el total; abajo, en gris, los avisos.
   El más barato de cada fila se marca con texto y color (en nuestra unidad y en la misma moneda). Abajo de cada
   columna: No pedido, totales, total comparable, condiciones y anotaciones. Se arma cada vez (sin IA), así sale
   rehecho después de cualquier cambio; quedan guardados los tildes de "controlado" y las anotaciones.
   "🖨️ Imprimir" lo imprime o lo guarda como PDF, apaisado y con todas las columnas. Todo necesita señal. */

const CQ = { datos: null, buscar: '', modo: 'ver', sel: {}, editar: false };     // Paso 5: modo 'comprar' con lo elegido: {línea: proveedor}. editar: "✏️ Editar" (Feli, 21/10)

/** "= $ 655,83 el metro": nuestra unidad, sacada de la cantidad pedida ("3200 mts"). */
function porNuestraUnidad(cantidad) {
  const u = String(cantidad || '').replace(/^\s*[\d.,]+\s*/, '').trim().toLowerCase();
  if (/^(m|mt|mts|metro|metros)\.?$/.test(u)) return 'el metro';
  if (/^(kg|kgs|kilo|kilos)\.?$/.test(u)) return 'el kilo';
  if (/^(g|gr|grs|gramo|gramos)\.?$/.test(u)) return 'el gramo';
  if (/^(cm|cms|centimetro|centimetros|centímetro|centímetros)\.?$/.test(u)) return 'el centímetro';
  if (/^(par|pares)$/.test(u)) return 'el par';
  if (/^(juego|juegos)$/.test(u)) return 'el juego';
  if (/^(docena|docenas)$/.test(u)) return 'la docena';
  if (/^(pack|packs)$/.test(u)) return 'el pack';
  if (/^(caja|cajas)$/.test(u)) return 'la caja';
  if (/^(bolsa|bolsas)$/.test(u)) return 'la bolsa';
  if (/^(l|lt|lts|litro|litros)\.?$/.test(u)) return 'el litro';
  if (/^(ml|mililitro|mililitros)\.?$/.test(u)) return 'el mililitro';
  if (/^(m2|mts2|m²)$/.test(u)) return 'el m²';
  if (!u || /^(u|un|und|unid|unidad|unidades)\.?$/.test(u)) return 'la unidad';
  return 'por ' + u;
}

async function abrirCuadro(ref, modo) {
  if (!ref) return;
  if (CQ.ref !== ref) { CQ.sel = {}; CQ.editar = false; }
  CQ.modo = modo === 'comprar' ? 'comprar' : 'ver';     // Feli (2026-10-06): primero se mira; "Realizar la compra" muestra lo de comprar
  const c = $('cuadro');
  if (c.parentNode !== document.body) document.body.appendChild(c);     // así, al imprimir, se imprime solo el cuadro
  CQ.datos = null;
  if (CQ.ref !== ref) CQ.buscar = '';
  CQ.ref = ref;
  $('cuadro-titulo').textContent = '📊 Cuadro comparativo';
  $('cuadro-sub').textContent = '';
  if ($('cuadro-herr')) $('cuadro-herr').innerHTML = '';
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
  if (CQ.comprando) return aviso('Esperá a que termine la compra.');
  $('cuadro').hidden = true;
  $('cuadro-compra').hidden = true;
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
    // Feli (21/10): también los que no cotizó llevan nota (no en las filas "No pedido" de otro proveedor)
    if (!/^NP\|/.test(p.linea)) {
      if (c.notaCasillero) h += '<div class="cq-aviso cq-nota-mano">📝 ' + esc(c.notaCasillero.texto) + (c.notaCasillero.quien ? ' (' + esc(c.notaCasillero.quien) + ')' : '') + '</div>';
      h += '<button type="button" class="cq-agregar-nota no-imprimir" data-cq-nota-cas="' + esc(p.linea) + '" data-prov="' + esc(col.proveedor) + '">' +
        (c.notaCasillero ? 'Cambiar la nota' : 'Agregar nota') + '</button>';
    }
    return '<td class="cq-cas' + (c.noSePidio ? ' cq-nopedido' : '') + '" data-cq-destino="' + esc(p.linea) + '" data-prov="' + esc(col.proveedor) + '">' + h + '</td>';
  }
  // Paso 5: lo comprado (en cualquier modo) y, al comprar, "Elegir"
  const elegido = CQ.modo === 'comprar' && CQ.sel[p.linea] === col.proveedor;
  if (c.comprado && c.comprado.aEste) h += '<div class="cq-comprado">🛒 Comprado acá</div>';
  else if (c.comprado) h += '<div class="cq-gris">Se compró en ' + esc(c.comprado.proveedor) + '</div>';
  else if (CQ.modo === 'comprar') {
    h += '<button type="button" class="cq-elegir no-imprimir" aria-pressed="' + elegido + '" data-cq-elegir="' + esc(p.linea) + '" data-prov="' + esc(col.proveedor) + '">' +
      (elegido ? '✓ Elegido' : 'Elegir') + '</button>';
  }
  if (c.masBarato) h += '<div class="cq-barato">Más barato</div>';
  if (c.parte > 1) h += '<div class="cq-parte-b">' + esc(nombreParte(c.parte)) + (c.fechaParte ? ' · ' + esc(fechaCorta(c.fechaParte)) : '') + '</div>';
  const editar = CQ.editar && CQ.modo !== 'comprar';
  h += c.renglones.map(function (r) {
    const mover = editar && r.id && !(c.comprado);
    return '<div class="cq-ren' + (mover ? ' cq-movible' : '') + '"' + (mover ? ' draggable="true" data-cq-ren="' + esc(r.id) + '" data-prov="' + esc(col.proveedor) + '"' : '') + '>' +
      (mover ? '<span class="cq-asa no-imprimir" title="Arrastralo a otro producto">⠿</span>' : '') +
      '<span class="cq-cant">' + esc([cantTexto(r.cant), r.unidad].filter(String).join(' ')) + '</span> ' +
      (mover ? '<button type="button" class="cq-nombre no-imprimir" data-cq-renombrar="' + esc(r.id) + '" title="Cambiar el nombre">' + esc(capital(r.texto)) + ' ✏️</button><span class="solo-imprimir">' + esc(capital(r.texto)) + '</span>'
             : esc(capital(r.texto))) +
      (r.cantDoc !== null && r.cantDoc !== undefined && !c.avisos.some(function (x) { return /^Cambiaste/.test(x); })
        ? '<div class="cq-gris">El presupuesto dice ' + esc(cantTexto(r.cantDoc)) + ' (repartido con otro pedido)</div>' : '') +
      (r.precio !== null ? '<div class="cq-precios">' + esc(plata(r.precio, r.moneda)) + (r.importe !== null ? ' · <b>' + esc(plata(r.importe, r.moneda)) + '</b>' : '') + '</div>'
        : r.importe !== null ? '<div class="cq-precios"><b>' + esc(plata(r.importe, r.moneda)) + '</b></div>' : '') +
      (r.nota ? '<div class="cq-aviso cq-nota-mano">📝 ' + esc(r.nota) + (r.notaDe ? ' (' + esc(r.notaDe) + ')' : '') + '</div>' : '') +
      (r.id ? '<button type="button" class="cq-agregar-nota no-imprimir" data-cq-nota="' + esc(r.id) + '">' + (r.nota ? 'Cambiar la nota' : 'Agregar nota') + '</button>' : '') +
      (mover ? ' <button type="button" class="cq-agregar-nota no-imprimir" data-cq-mover="' + esc(r.id) + '" data-prov="' + esc(col.proveedor) + '">Mover a…</button>' : '') + '</div>';
  }).join('');
  if (c.renglones.length > 1 && c.total !== null) h += '<div class="cq-precios">Total: <b>' + esc(plata(c.total, c.moneda)) + '</b></div>';
  if (c.otraUnidad && c.precioNuestro !== null) h += '<div class="cq-nuestra">= ' + esc(plata(c.precioNuestro, c.moneda)) + ' ' + esc(porNuestraUnidad(p.cantidad)) + '</div>';
  if (c.avisos.length) h += '<div class="cq-aviso">' + c.avisos.map(esc).join(' · ') + '</div>';
  h += htmlControl(col.proveedor + '|' + p.linea, c.huella, c.control);
  return '<td class="cq-cas' + (c.masBarato ? ' cq-mas-barato' : '') + (elegido ? ' cq-elegido' : '') + (c.comprado && c.comprado.aEste ? ' cq-comprado-aca' : '') + '"' +
    ' data-cq-destino="' + esc(p.linea) + '" data-prov="' + esc(col.proveedor) + '">' + h + '</td>';
}

function htmlTotalesColumna(col) {
  const fila = function (t, v, m, fuerte) { return v === null || v === undefined ? '' : '<div class="cq-tot"><span>' + t + '</span>' + (fuerte ? '<b>' : '<span>') + esc(plata(v, m)) + (fuerte ? '</b>' : '</span>') + '</div>'; };
  let h = col.partes.map(function (e) {
    const iva = e.conIva === 'si' ? '(precios con IVA)' : e.conIva === 'no' ? '(precios sin IVA)' : '(sin dato de IVA)';
    const tiene = [e.subtotal, e.iva, e.total].some(function (v) { return v !== null && v !== undefined; });
    const a = e.paraEste;
    return (col.partes.length > 1 ? '<div class="cq-parte">' + esc(nombreParte(e.n)) + ' (' + esc(fechaCorta(e.fecha)) + ')</div>' : '') +
      (tiene ? fila('Subtotal', e.subtotal, e.moneda) + fila('Descuento', e.descuento, e.moneda) + fila('IVA', e.iva, e.moneda) + fila('Otros impuestos', e.otros, e.moneda) +
               fila('Flete y otros cargos', e.cargos, e.moneda) + fila('Total', e.total, e.moneda, true) + '<div class="cq-gris">' + iva + '</div>'
             : e.sumaRenglones !== null && e.sumaRenglones !== undefined ? fila('Suma de los renglones', e.sumaRenglones, e.moneda, true) +
               '<div class="cq-gris">No trae totales: la suma la hizo la app (sin IVA)</div>' : '<div class="cq-gris">Sin totales</div>') +
      (a ? '<div class="cq-este">' + '<div class="cq-gris">Para este pedido (con tus cambios o sin lo de otro pedido):</div>' + fila('Subtotal', a.subtotal, e.moneda) +
           fila('IVA', a.iva, e.moneda) + fila('Total', a.total, e.moneda, true) + '</div>' : '') +
      (e.flete ? '<div class="cq-gris">Flete: ' + esc(e.flete) + '</div>' : '');
  }).join('');
  if (col.partes.length > 1) {
    h += col.suma ? '<div class="cq-parte">Las ' + col.partes.length + ' partes juntas</div>' + fila('Total (' + col.suma.que + ')', col.suma.monto, col.partes[0].moneda, true) +
      (col.repite ? '<div class="cq-cambio">Ojo: una parte repite productos de otra, y la suma los cuenta dos veces. Para comparar, mirá el total comparable.</div>' : '')
      : '<div class="cq-gris">Las partes no se pueden sumar: no dicen lo mismo del IVA.</div>';
  }
  return h + htmlControl(col.proveedor + '|_totales', col.huella, col.control);
}

function htmlCondiciones(col) {
  return col.partes.map(function (e) {
    const l = [['Validez', e.validez], ['Forma de pago', e.formaPago], ['Plazo de entrega', e.plazo], ['Entrega', e.entrega], ['Observaciones', e.observaciones]]
      .filter(function (x) { return x[1]; });
    return (col.partes.length > 1 ? '<div class="cq-parte">' + esc(nombreParte(e.n)) + '</div>' : '') +
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
  // Feli (2026-10-06): comparar y comprar son el mismo cuadro; los seleccionadores, al tocar "Realizar la compra" (en Cotización)
  if (!q.puedeComprar) CQ.modo = 'ver';
  $('cuadro-titulo').textContent = '📊 Cuadro comparativo · ' + q.codigo + (q.titulo ? ' · ' + q.titulo : '');
  $('cuadro-sub').textContent = 'Armado por ' + q.armo + ' el ' + fechaHoraCorta(q.fecha);
  if (!q.columnas.length) {
    if ($('cuadro-herr')) $('cuadro-herr').innerHTML = '';
    $('cuadro-cuerpo').innerHTML = '<p class="nota cq-cargando">Todavía no hay presupuestos leídos en esta tarjeta.</p>';
    return;
  }
  const cols = q.columnas;
  const fila = function (titulo, celda, clase) {
    return '<tr class="' + (clase || '') + '"><th class="cq-fija cq-rotulo">' + titulo + '</th>' + cols.map(function (c) { return '<td>' + celda(c) + '</td>'; }).join('') + '</tr>';
  };
  let h = '<table class="cq-tabla"><thead><tr><th class="cq-fija">' + (q.sinProductos ? 'Presupuesto' : 'Pediste') + '</th>' + cols.map(function (c) {
    return '<th><div class="cq-prov">' + esc(c.nombre) + '</div>' + (c.sinConfirmar ? '<div class="cq-sin">Sin revisar</div>' : '') +
      (CQ.modo === 'comprar' && !q.sinProductos ? '<button type="button" class="btn-chico cq-todo no-imprimir" data-cq-todo="' + esc(c.proveedor) + '">Elegir todo de ' + esc(c.nombre) + '</button>' : '') +
      (c.partes.length > 1 ? '<div class="cq-gris">En ' + c.partes.length + ' partes: ' + c.partes.map(function (e) { return esc(fechaCorta(e.fecha)); }).join(' y ') + '</div>' : '') + '</th>';
  }).join('') + '</tr></thead><tbody>';
  q.productos.forEach(function (p) {
    // Para el buscador: lo pedido y lo que escribió cada proveedor
    const texto = [p.cantidad, p.nombre, p.nota].concat([].concat.apply([], cols.map(function (c) {
      return ((c.casilleros[p.linea] || {}).renglones || []).map(function (r) { return r.texto; });
    }))).join(' ');
    h += '<tr class="cq-fila" data-cq-buscar="' + esc(sinTildes(texto)) + '"><th class="cq-fija"><span class="cq-cant">' + esc(p.cantidad) + '</span> ' + esc(p.nombre) + (p.nota ? '<div class="cq-gris">' + esc(p.nota) + '</div>' : '') +
      (p.noPedido ? '<div class="cq-np">' + (q.masivo ? 'Del presupuesto de ' : 'No pedido · lo cotizó ') + esc(p.noPedido) + '</div>' : '') +          // Feli (2026-10-07); un masivo, 30/10
      (p.duda ? '<div class="cq-np">🤖 ¿Es «' + esc(p.duda) + '»? Contestalo en el presupuesto</div>' : '') +     // Paso 8
      (p.comprado ? '<div class="cq-comprado">🛒 Comprado en ' + esc(p.comprado) + '</div>' : '') + '</th>' +
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
  // Arriba: el buscador y, para comprar, "Elegir el más barato en cada fila" (o pasar de mirar a comprar)
  const herramientas = q.sinProductos ? '' : CQ.modo === 'comprar'
    ? '<button type="button" class="btn-chico" id="cq-baratos">Elegir el más barato en cada fila</button><button type="button" class="btn-chico" id="cq-limpiar">Sacar lo elegido</button>' +
      '<button type="button" class="btn-chico" id="cq-a-mirar">Dejar de comprar</button>'
    : (q.puedeComprar ? '<button type="button" class="btn-chico si" id="cq-a-comprar">🛒 Realizar la compra</button>' : '') +
      '<button type="button" class="btn-chico" id="cq-editar" aria-pressed="' + CQ.editar + '">' + (CQ.editar ? '✓ Listo' : '✏️ Editar') + '</button>' +
      (CQ.editar ? '<span class="cq-gris">Arrastrá un producto cotizado (⠿) a la fila que corresponde, o tocá su nombre para cambiarlo.</span>' : '');
  const barra = q.sinProductos ? '' : '<div class="cq-buscar no-imprimir"><input type="search" id="cq-buscar" placeholder="🔍 Buscar un producto (por ejemplo, jabalina)" value="' +
    esc(CQ.buscar) + '"><span class="cq-gris" id="cq-buscar-n"></span>' + herramientas + '</div>';
  // Feli (23/10): la barra va fija arriba, fuera de lo que se desplaza (si la página es de antes y no tiene el lugar, va como antes)
  if ($('cuadro-herr')) { $('cuadro-herr').innerHTML = barra; $('cuadro-cuerpo').innerHTML = h; }
  else $('cuadro-cuerpo').innerHTML = barra + h;
  const cuerpo = $('cuadro-cuerpo');
  if ($('cq-buscar')) {
    $('cq-buscar').addEventListener('input', function () { CQ.buscar = this.value; filtrarCuadro(); });
    filtrarCuadro();
  }
  cuerpo.querySelectorAll('[data-cq-control]').forEach(function (x) { x.addEventListener('change', function () { controlarCasillero(x); }); });
  cuerpo.querySelectorAll('[data-cq-elegir]').forEach(function (x) { x.addEventListener('click', function () { elegirCasillero(x.dataset.cqElegir, x.dataset.prov); }); });
  cuerpo.querySelectorAll('[data-cq-todo]').forEach(function (x) { x.addEventListener('click', function () { elegirTodo(x.dataset.cqTodo); }); });
  if ($('cq-baratos')) $('cq-baratos').addEventListener('click', elegirBaratos);
  if ($('cq-limpiar')) $('cq-limpiar').addEventListener('click', function () { CQ.sel = {}; pintarCuadro(); });
  if ($('cq-a-comprar')) $('cq-a-comprar').addEventListener('click', function () { CQ.modo = 'comprar'; pintarCuadro(); });
  if ($('cq-a-mirar')) $('cq-a-mirar').addEventListener('click', function () { CQ.modo = 'ver'; pintarCuadro(); });
  if ($('cq-a-comprar')) $('cq-a-comprar').addEventListener('click', function () { CQ.editar = false; });
  if ($('cq-editar')) $('cq-editar').addEventListener('click', function () { CQ.editar = !CQ.editar; pintarCuadro(); });
  cuerpo.querySelectorAll('[data-cq-nota]').forEach(function (x) { x.addEventListener('click', function () { notaDeRenglon(x.dataset.cqNota); }); });
  cuerpo.querySelectorAll('[data-cq-nota-cas]').forEach(function (x) { x.addEventListener('click', function () { notaDeCasillero(x.dataset.cqNotaCas, x.dataset.prov); }); });
  cuerpo.querySelectorAll('[data-cq-renombrar]').forEach(function (x) { x.addEventListener('click', function () { renombrarRenglon(x.dataset.cqRenombrar); }); });
  cuerpo.querySelectorAll('[data-cq-mover]').forEach(function (x) { x.addEventListener('click', function () { moverRenglonA(x.dataset.cqMover, x.dataset.prov); }); });
  armarArrastreCuadro(cuerpo);
  pintarBarraCompra();
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

/** Sin tildes ni mayúsculas, para buscar. */
function sinTildes(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

/** El buscador del cuadro (Feli, 2026-10-06): deja solo los productos que tienen lo que se escribió (en lo pedido o en lo que escribió algún proveedor). */
function filtrarCuadro() {
  const palabras = sinTildes(CQ.buscar).split(/\s+/).filter(String);
  let n = 0, total = 0;
  document.querySelectorAll('#cuadro-cuerpo .cq-fila').forEach(function (tr) {
    total++;
    const si = palabras.every(function (w) { return tr.dataset.cqBuscar.indexOf(w) !== -1; });
    tr.hidden = !si;
    if (si) n++;
  });
  const t = $('cq-buscar-n');
  if (t) t.textContent = palabras.length ? n + ' de ' + total + ' productos' : '';
}

/* ---------- Paso 5: comprar desde el cuadro (Feli, 2026-10-06: "Cuadro comparativo de compra") ----------
   El mismo cuadro, con seleccionadores (si la tarjeta está en Cotización): "Elegir todo de {proveedor}" arriba de cada columna, "Elegir" en cada casillero
   y "Elegir el más barato en cada fila". Cada producto, a un solo proveedor. Abajo, una barra con lo elegido y
   "Confirmar compra": el mensaje de cada proveedor, uno después del otro; cada uno, al confirmarlo, ya quedó comprado. */

/** ¿Se puede elegir ese casillero? (lo cotizó y todavía no se compró) */
function sePuedeElegir(col, linea) {
  const c = col.casilleros[linea];
  return !!(c && c.renglones.length && !c.comprado);
}

function elegirCasillero(linea, pid) {
  if (CQ.sel[linea] === pid) delete CQ.sel[linea]; else CQ.sel[linea] = pid;
  pintarCuadro();
}

function elegirTodo(pid) {
  const col = columnaDe(pid);
  let n = 0;
  // Solo lo que pedimos (Feli, 13/10): lo "No pedido" se elige a mano. Tampoco lo que la IA preguntó y nadie contestó (Paso 8)
  let np = 0;
  CQ.datos.productos.forEach(function (p) {
    if (p.duda || !sePuedeElegir(col, p.linea)) return;
    if (p.noPedido && !CQ.datos.masivo) { np++; return; }          // un masivo: sus renglones son todo lo que hay (30/10)
    CQ.sel[p.linea] = pid; n++;
  });
  pintarCuadro();
  aviso((n ? 'Elegidos ' + n + ' producto' + (n === 1 ? '' : 's') + ' de ' + col.nombre + '.' : col.nombre + ' no tiene productos pedidos para elegir.') +
        (np ? ' Lo no pedido (' + np + ') se elige a mano.' : ''));
}

/** El marcado como más barato; si lo cotizó uno solo, ese; con monedas distintas, ninguno (y lo avisa). */
function elegirBaratos() {
  let sinElegir = 0;
  CQ.datos.productos.forEach(function (p) {
    const cs = CQ.datos.columnas.filter(function (col) { return sePuedeElegir(col, p.linea); });
    if (!cs.length || p.comprado || p.duda || p.noPedido) return;       // lo no pedido se elige a mano (Feli, 13/10); lo preguntado por la IA, tampoco
    const barato = cs.filter(function (col) { return col.casilleros[p.linea].masBarato; })[0];
    if (barato) CQ.sel[p.linea] = barato.proveedor;
    else if (cs.length === 1) CQ.sel[p.linea] = cs[0].proveedor;
    else sinElegir++;
  });
  pintarCuadro();
  if (sinElegir) aviso(sinElegir + ' producto' + (sinElegir === 1 ? '' : 's') + ' sin elegir: tienen precios en monedas distintas o sin precio. Elegilos a mano.');
}

/** Lo elegido, por proveedor (en el orden de las columnas): [{col, lineas, total, moneda}]. */
function compraElegida() {
  const q = CQ.datos;
  return q.columnas.map(function (col) {
    const lineas = q.productos.filter(function (p) { return CQ.sel[p.linea] === col.proveedor && sePuedeElegir(col, p.linea); }).map(function (p) { return p.linea; });
    const cs = lineas.map(function (l) { return col.casilleros[l]; });
    const monedas = cs.map(function (c) { return c.moneda; }).filter(function (m, i, a) { return a.indexOf(m) === i; });
    const total = cs.every(function (c) { return c.total !== null; }) && monedas.length === 1 ? cs.reduce(function (s, c) { return s + c.total; }, 0) : null;
    return { col: col, lineas: lineas, total: total, moneda: monedas[0] || '' };
  }).filter(function (g) { return g.lineas.length; });
}

/** La barra de abajo: lo elegido y "Confirmar compra". */
function pintarBarraCompra() {
  const b = $('cuadro-compra');
  if (CQ.modo !== 'comprar' || !CQ.datos) { b.hidden = true; return; }
  const g = compraElegida();
  b.hidden = false;
  b.innerHTML = '<div class="cq-resumen">' + (g.length ? g.map(function (x) {
      return '<span><b>' + esc(x.col.nombre) + ':</b> ' + x.lineas.length + ' producto' + (x.lineas.length === 1 ? '' : 's') +
        (x.total !== null ? ', ' + esc(plata(Math.round(x.total * 100) / 100, x.moneda)) : '') + '</span>';
    }).join('') + '<small class="cq-gris">Precios sin IVA, con las cantidades para este pedido</small>' : '<span class="cq-gris">Elegí qué le comprás a cada proveedor.</span>') + '</div>' +
    '<button type="button" class="btn si" id="cq-confirmar"' + (g.length ? '' : ' disabled') + '>Confirmar compra</button>';
  $('cq-confirmar').addEventListener('click', confirmarCompra);
}

/** El mensaje de confirmación para un proveedor: el texto de Ajustes con sus productos (como los escribió él, con lo corregido). */
function mensajeCompra(g) {
  const q = CQ.datos, c = g.col.contacto;
  // Feli (21/10): "112 · {el producto tal cual lo escribió el proveedor} · $ 2.289,79 c/u" (antes iba nuestro nombre); la cantidad,
  // la unidad y el precio también son los de su presupuesto. Si un producto vino en varios renglones, va uno por renglón.
  const productos = g.lineas.map(function (l) {
    const rs = g.col.casilleros[l].renglones;
    return rs.map(function (r) {
      return '- ' + [cantTexto(r.cant), r.unidad && !/^(u|un|und|unid|unidad|unidades)\.?$/i.test(r.unidad) ? r.unidad : ''].filter(String).join(' ') + ' · ' +
        capital(r.texto) + (r.precio !== null ? ' · ' + plata(Math.round(r.precio * 100) / 100, r.moneda) + ' c/u' : '');
    }).join('\n');
  }).join('\n');
  return q.msjCompra.replace(/[ \t]*\{contacto\}/g, c ? ' ' + c : '').split('{codigo}').join(q.codigo).split('{productos}').join(productos);
}

/** El mensaje de la orden (Ajustes), con el mail ya puesto; {numero} queda para cuando Albor lo da. */
function mensajeOrden(oq) {
  return String(oq.msjOrden || '').split('{mail}').join(oq.mail || '(falta el mail)');
}

/** Fase 6, Paso 5: qué pasa con la orden de compra de esta compra (solo en las de la Fase 6). */
function htmlOrdenEnCompra(oq) {
  if (!oq) return '';
  return '<div class="cq-orden' + (oq.orden ? '' : ' mal') + '"><b>' + (oq.orden ? '📄 Lleva orden de compra' : 'Va sin orden de compra: ' + esc(oq.motivo)) + '</b>' +
    (oq.prueba ? '<div class="nota">🧪 Es una prueba: no se le manda nada al proveedor.</div>' : '') + '</div>';
}

/** El CUIT de un proveedor que no lo tiene, para comprarle con orden (con el dígito verificador, como en el chat). */
async function pedirCuitCompra(nombre) {
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = '<p class="cq-orden mal" style="margin-top:0"><b>' + esc(nombre) + ' no tiene su CUIT cargado</b></p>' +
    '<label for="cq-cuit">CUIT (11 números, con o sin guiones)</label><input type="text" id="cq-cuit" inputmode="numeric" maxlength="13" autocomplete="off">' +
    '<p class="nota" id="cq-cuit-n"></p>';
  return dialogo({ titulo: 'Falta el CUIT', cuerpo: cuerpo,
    botones: [{ texto: 'Volver', valor: null }, { texto: 'Guardar y seguir', clase: 'btn', id: 'dg-ok', valor: function () { return $('cq-cuit').value.replace(/\D/g, ''); } }],
    alAbrir: function () {
      const revisar = function () {
        const d = $('cq-cuit').value.replace(/\D/g, '');
        const bien = d.length === 11 && digitoCuitBien(d);
        $('dg-ok').disabled = !bien;
        $('cq-cuit-n').textContent = d.length === 11 && !bien ? 'El último número no coincide: revisalo.' : '';
      };
      $('cq-cuit').addEventListener('input', revisar);
      revisar();
      $('cq-cuit').focus();
    } });
}

async function confirmarCompra() {
  const grupos = compraElegida();
  if (!grupos.length || CQ.comprando) return;
  const ref = CQ.datos.ref;
  let compradas = 0;
  CQ.comprando = true;
  try {
    for (let i = 0; i < grupos.length; i++) {
      const g = grupos[i];
      // Solo si tiene algún cartel amarillo pregunta antes (Feli, 2026-10-06)
      if (g.col.paraRevisar) {
        const si = await dialogo({ titulo: 'Tiene cosas para revisar', texto: 'El presupuesto de ' + g.col.nombre + ' tiene cosas para revisar. ¿Comprar igual?',
                                   botones: [{ texto: 'Volver', valor: false }, { texto: 'Comprar igual', clase: 'btn', valor: true }] });
        if (!si) break;
      }
      // Fase 6, Paso 5: sin CUIT no se compra con orden; se carga acá mismo (Feli, 29/10)
      const oq = CQ.datos.orden, op = oq && oq.proveedores[g.col.proveedor];
      if (oq && oq.orden && op && !op.cuit) {
        const cuit = await pedirCuitCompra(op.nombre || g.col.nombre);
        if (!cuit) break;
        const rc = await api('cuitProveedor', g.col.proveedor, cuit);
        if (!rc.ok) { aviso(rc.sinConexion ? '📶 Hace falta señal para cargar el CUIT.' : rc.error, 'bad'); break; }
        op.cuit = cuit;
      }
      // Parte B (Feli, 29/10): la orden se carga en Albor en el mismo momento de la compra, desde la compu con la extensión
      const conOrden = !!(oq && oq.orden);
      const ext = conOrden && await hayExtensionAlbor();
      if (conOrden && !ext) {
        const igual = await dialogo({ titulo: 'Esta compra lleva orden de compra',
          texto: 'La orden se carga en Albor en el mismo momento de la compra, así que se compra desde la compu con la extensión de Albor (la de Transferencias). ' +
                 'Si comprás igual, la orden queda pendiente y la cargás a mano.',
          botones: [{ texto: 'Volver', valor: null }, { texto: 'Comprar igual', clase: 'btn', valor: true }] });
        if (!igual) break;
      }
      // Lo no pedido de una tarjeta de la tanda (varios pedidos): a cuál va
      const pedidos = CQ.datos.pedidos || [];
      const conNP = g.lineas.some(function (l) { return /^NP\|/.test(l); }) && pedidos.length > 1;
      const cuerpo = document.createElement('div');
      cuerpo.className = 'cuerpo';
      cuerpo.innerHTML = (conNP ? '<div class="campo"><label for="cq-pedido-np">Lo que no se pidió va al pedido</label><select id="cq-pedido-np">' +
        pedidos.map(function (p) { return '<option value="' + esc(p.ref) + '">' + esc([p.sitio, p.titulo || p.ref].filter(String).join(' · ')) + '</option>'; }).join('') + '</select></div>' : '') +
        htmlOrdenEnCompra(oq) +
        '<p class="nota">' + g.lineas.length + ' producto' + (g.lineas.length === 1 ? '' : 's') + (g.total !== null ? ', ' + esc(plata(Math.round(g.total * 100) / 100, g.moneda)) + ' sin IVA' : '') +
        (conOrden ? '. Al tocar "Comprar", queda comprado y ' + (ext ? 'se carga la orden en Albor' : 'te pido el número y el PDF de la orden') +
                    '. Con el número, al proveedor le llega el PDF de la orden con este mensaje ({numero} se completa solo). Lo podés cambiar.</p>'
                  : '. Al tocar "Comprar y mandar", ya queda comprado: sale la tarjeta de seguimiento y le llega este mensaje por WhatsApp. Lo podés cambiar.</p>') +
        '<textarea id="cq-msj" rows="' + (conOrden ? 6 : 10) + '">' + esc(conOrden ? mensajeOrden(oq) : mensajeCompra(g)) + '</textarea>' +
        // Feli (29/10): observaciones del presupuesto que van en la orden de compra (se dejan las que sirvan)
        (conOrden ? '<label for="cq-obs" style="margin-top:10px;display:block">Observaciones en la orden de compra <small class="nota">(opcional; vienen las del presupuesto: dejá las que sirvan)</small></label>' +
                    '<textarea id="cq-obs" rows="4" maxlength="1500">' + esc((op && op.observaciones) || '') + '</textarea>' : '');
      const texto = await dialogo({ titulo: 'Comprarle a ' + g.col.nombre + (grupos.length > 1 ? ' (' + (i + 1) + ' de ' + grupos.length + ')' : ''), cuerpo: cuerpo,
        botones: [{ texto: 'Volver', valor: null }, { texto: oq && (oq.orden || oq.prueba) ? '🛒 Comprar' : '🛒 Comprar y mandar', clase: 'btn', valor: function () {
          if ($('cq-pedido-np')) g.pedidoNP = $('cq-pedido-np').value;
          if ($('cq-obs')) g.obsOrden = $('cq-obs').value.trim();
          return $('cq-msj').value.trim();
        } }] });
      if (!texto) break;
      aviso('Comprando a ' + g.col.nombre + '…');
      const r = await apiLenta('comprar', { id: 'Z' + nuevoId(), ref: ref, proveedor: g.col.proveedor, lineas: g.lineas, texto: texto, pedidoNP: g.pedidoNP || '',
                                            textoSinOrden: conOrden ? mensajeCompra(g) : '', obsOrden: g.obsOrden || '' });
      if (!r.ok) { aviso(r.sinConexion ? '📶 Poca señal: no se pudo comprar a ' + g.col.nombre + '. Probá cuando vuelva.' : r.error, 'bad'); break; }
      compradas++;
      g.lineas.forEach(function (l) { delete CQ.sel[l]; });
      if (r.orden) {
        // En el mismo momento: la orden en Albor (o, sin la extensión, a mano)
        if (ext) await cargarOrdenEnAlbor(r.tarjeta);
        else await cargarOrdenAManoUI(r.tarjeta, !!oq.prueba);
        continue;
      }
      aviso(r.orden ? 'Listo: comprado a ' + g.col.nombre + '. La orden de compra quedó pendiente: cargala desde la tarjeta de seguimiento.'
            : r.prueba ? 'Listo: comprado a ' + g.col.nombre + ' (es una prueba: no se le mandó nada).'
            : r.enviado ? 'Listo: comprado a ' + g.col.nombre + ' y le llegó la confirmación.' : 'Comprado a ' + g.col.nombre + ', pero el mensaje no salió: mandalo desde el chat.',
            r.enviado || r.orden || r.prueba ? '' : 'bad');
    }
  } finally {
    CQ.comprando = false;
  }
  if (!compradas) return;
  if (TB.abierta === ref) traerTarjeta(ref);
  cargarTablero();
  abrirCuadro(ref, 'comprar');
}


/* ---------- "✏️ Editar" y "Agregar nota" (Feli, 21/10) ----------
   Editar: cada producto cotizado se arrastra (⠿) a la fila del producto pedido que corresponde (en la columna de su proveedor;
   a una fila "No pedido", vuelve a no pedido), o se le cambia el nombre. "Mover a…" hace lo mismo sin arrastrar (celular).
   Es una corrección del presupuesto: se ve también en el bloque Presupuestos; si estaba revisado, vuelve a "Sin revisar".
   "Agregar nota": como las de la IA, abajo del producto cotizado; no cambia si está revisado. Todo necesita señal. */
function renglonDelCuadro(id) {
  let out = null;
  (CQ.datos.columnas || []).forEach(function (col) {
    Object.keys(col.casilleros).forEach(function (k) {
      (col.casilleros[k].renglones || []).forEach(function (r) { if (r.id === id) out = { r: r, col: col, linea: k }; });
    });
  });
  return out;
}

async function cambiarRenglon(id, cambios, que) {
  const ref = CQ.datos.ref;
  aviso('Guardando…');
  const r = await api('editarRenglonCuadro', ref, id, cambios);
  if (!r.ok) return aviso(r.sinConexion ? '📶 Hace falta señal para esto. Probá cuando vuelva.' : r.error, 'bad');
  aviso(que + (r.reabierto ? ' El presupuesto estaba revisado: volvió a "Sin revisar" para que lo revises de nuevo.' : ''));
  if (TB.abierta === ref) traerTarjeta(ref);
  abrirCuadro(ref, CQ.modo);
}

async function renombrarRenglon(id) {
  const x = renglonDelCuadro(id);
  if (!x) return;
  const cuerpo = document.createElement('div');
  cuerpo.innerHTML = '<label for="cq-nuevo-nombre">Cómo lo cotizó ' + esc(x.col.nombre) + '</label><input type="text" id="cq-nuevo-nombre" maxlength="500" autocomplete="off">';
  const nombre = await dialogo({ titulo: 'Cambiar el nombre', cuerpo: cuerpo,
    botones: [{ texto: 'Volver', valor: null }, { texto: 'Guardar', clase: 'btn', valor: function () { return $('cq-nuevo-nombre').value.trim(); } }],
    alAbrir: function () { const i = $('cq-nuevo-nombre'); i.value = x.r.texto || ''; i.focus(); i.select(); } });
  if (!nombre || nombre === x.r.texto) return;
  cambiarRenglon(id, { texto: nombre }, '✏️ Nombre cambiado.');
}

/** A qué producto va: los pedidos de la tarjeta, o "No pedido". */
async function moverRenglonA(id, pid) {
  const x = renglonDelCuadro(id);
  if (!x) return;
  const pedidos = CQ.datos.productos.filter(function (p) { return !/^NP\|/.test(p.linea); });
  const cuerpo = document.createElement('div');
  cuerpo.innerHTML = '<div class="opciones">' + pedidos.map(function (p) {
    return '<button type="button" class="choice" data-a="' + esc(p.linea) + '"' + (p.linea === x.linea ? ' aria-current="true"' : '') + '>' +
      esc([p.cantidad, p.nombre].filter(String).join(' × ')) + '</button>';
  }).join('') + '<button type="button" class="choice" data-a="">No pedido (no es ninguno de estos)</button></div>';
  let destino = null;
  const ok = await dialogo({ titulo: 'Mover «' + capital(x.r.texto) + '»', texto: '¿A qué producto pedido corresponde?', cuerpo: cuerpo,
    botones: [{ texto: 'Volver', valor: null }],
    alAbrir: function () {
      cuerpo.querySelectorAll('[data-a]').forEach(function (b) { b.addEventListener('click', function () { destino = b.dataset.a; cerrarDialogoActual(true); }); });
    } });
  if (!ok || destino === null) return;
  moverRenglon(id, destino);
}

function moverRenglon(id, destino) {
  const x = renglonDelCuadro(id);
  if (!x) return;
  const linea = /^NP\|/.test(destino || '') ? '' : (destino || '');
  if (linea === (/^NP\|/.test(x.linea) ? '' : x.linea)) return;
  const p = CQ.datos.productos.filter(function (q) { return q.linea === linea; })[0];
  cambiarRenglon(id, { linea: linea }, linea ? '↪️ Pasado a «' + (p ? p.nombre : 'ese producto') + '».' : '↪️ Pasado a No pedido.');
}

/* Mientras se arrastra, cerca del borde de arriba o de abajo del cuadro, el cuadro se desplaza solo (Feli, 21/10: para llegar a
   un producto que no se ve). Cuanto más cerca del borde, más rápido. Arriba cuenta desde debajo de los nombres de los proveedores. */
const CQ_DESPLAZAR = { y: null, activo: false, cuadro: null, reloj: null };
function desplazarAlArrastrar() {
  const c = CQ_DESPLAZAR.cuadro, y = CQ_DESPLAZAR.y;
  if (c && y !== null) {
    const r = c.getBoundingClientRect(), cab = c.querySelector('.cq-tabla thead');
    const arriba = r.top + (cab ? cab.getBoundingClientRect().height : 0), zona = 90;
    let paso = 0;
    if (y < arriba + zona) paso = -Math.ceil(24 * Math.min(1, (arriba + zona - y) / zona));
    else if (y > r.bottom - zona) paso = Math.ceil(24 * Math.min(1, (y - (r.bottom - zona)) / zona));
    if (paso) c.scrollTop += paso;
  }
}
function empezarADesplazar(cuerpo) {
  CQ_DESPLAZAR.cuadro = cuerpo; CQ_DESPLAZAR.y = null;
  CQ_DESPLAZAR.activo = true;
  if (!CQ_DESPLAZAR.reloj) CQ_DESPLAZAR.reloj = setInterval(desplazarAlArrastrar, 16);
  if (!cuerpo.dataset.cqDesplazar) {                        // una sola vez por cuadro (se repinta seguido)
    cuerpo.dataset.cqDesplazar = '1';
    cuerpo.addEventListener('dragover', function (e) { if (CQ_DESPLAZAR.activo) CQ_DESPLAZAR.y = e.clientY; });
    document.addEventListener('dragover', function (e) { if (CQ_DESPLAZAR.activo) CQ_DESPLAZAR.y = e.clientY; });
  }
}
function dejarDeDesplazar() {
  CQ_DESPLAZAR.activo = false; CQ_DESPLAZAR.y = null;
  if (CQ_DESPLAZAR.reloj) { clearInterval(CQ_DESPLAZAR.reloj); CQ_DESPLAZAR.reloj = null; }
}

/** Arrastrar (en la compu): de un casillero a otro de la misma columna (el mismo proveedor). */
function armarArrastreCuadro(cuerpo) {
  let arrastrando = null;
  cuerpo.querySelectorAll('[data-cq-ren]').forEach(function (el) {
    el.addEventListener('dragstart', function (e) {
      arrastrando = { id: el.dataset.cqRen, prov: el.dataset.prov };
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', arrastrando.id); } catch (x) {}
      el.classList.add('cq-arrastrando');
      empezarADesplazar(cuerpo);
    });
    // Dónde está el mouse, también desde lo que se arrastra (algunos navegadores no avisan "dragover" en todos lados)
    el.addEventListener('drag', function (e) { if (CQ_DESPLAZAR.activo && e.clientY > 0) CQ_DESPLAZAR.y = e.clientY; });
    el.addEventListener('dragend', function () {
      dejarDeDesplazar();
      el.classList.remove('cq-arrastrando');
      cuerpo.querySelectorAll('.cq-soltar').forEach(function (t) { t.classList.remove('cq-soltar'); });
      arrastrando = null;
    });
  });
  cuerpo.querySelectorAll('td[data-cq-destino]').forEach(function (td) {
    td.addEventListener('dragover', function (e) {
      if (!arrastrando || td.dataset.prov !== arrastrando.prov) return;
      e.preventDefault();
      td.classList.add('cq-soltar');
    });
    td.addEventListener('dragleave', function () { td.classList.remove('cq-soltar'); });
    td.addEventListener('drop', function (e) {
      dejarDeDesplazar();
      if (!arrastrando || td.dataset.prov !== arrastrando.prov) return;
      e.preventDefault();
      td.classList.remove('cq-soltar');
      const id = arrastrando.id;
      arrastrando = null;
      moverRenglon(id, td.dataset.cqDestino);
    });
  });
}

async function notaDeRenglon(id) {
  const x = renglonDelCuadro(id);
  if (!x) return;
  const cuerpo = document.createElement('div');
  cuerpo.innerHTML = '<label for="cq-nota-texto">Nota para «' + esc(capital(x.r.texto)) + '» (' + esc(x.col.nombre) + ')</label>' +
    '<textarea id="cq-nota-texto" rows="3" maxlength="300" placeholder="Por ejemplo: es de otra marca, viene en caja de 10…"></textarea>' +
    (x.r.nota ? '<p class="nota">Para sacarla, borrá el texto y guardá.</p>' : '');
  const texto = await dialogo({ titulo: x.r.nota ? 'Cambiar la nota' : 'Agregar nota', cuerpo: cuerpo,
    botones: [{ texto: 'Volver', valor: null }, { texto: 'Guardar', clase: 'btn', valor: function () { return { t: $('cq-nota-texto').value.trim() }; } }],
    alAbrir: function () { const t = $('cq-nota-texto'); t.value = x.r.nota || ''; t.focus(); } });
  if (!texto || texto.t === (x.r.nota || '')) return;
  const ref = CQ.datos.ref;
  const r = await api('notaRenglon', ref, id, texto.t);
  if (!r.ok) return aviso(r.sinConexion ? '📶 Hace falta señal para esto. Probá cuando vuelva.' : r.error, 'bad');
  x.r.nota = r.nota; x.r.notaDe = r.notaDe;
  pintarCuadro();
  aviso(r.nota ? '📝 Nota guardada.' : 'Nota quitada.');
  if (TB.abierta === ref) traerTarjeta(ref);
}

/** "Agregar nota" en un casillero que no cotizó (Feli, 21/10): queda en el cuadro, para ese proveedor y ese producto. */
async function notaDeCasillero(linea, pid) {
  const col = columnaDe(pid), c = col && col.casilleros[linea];
  const p = CQ.datos.productos.filter(function (x) { return x.linea === linea; })[0];
  if (!c || !p) return;
  const actual = c.notaCasillero ? c.notaCasillero.texto : '';
  const cuerpo = document.createElement('div');
  cuerpo.innerHTML = '<label for="cq-nota-texto">Nota de ' + esc(col.nombre) + ' para «' + esc(p.nombre) + '»</label>' +
    '<textarea id="cq-nota-texto" rows="3" maxlength="300" placeholder="Por ejemplo: no lo trabaja, lo consigue la semana que viene…"></textarea>' +
    (actual ? '<p class="nota">Para sacarla, borrá el texto y guardá.</p>' : '');
  const texto = await dialogo({ titulo: actual ? 'Cambiar la nota' : 'Agregar nota', cuerpo: cuerpo,
    botones: [{ texto: 'Volver', valor: null }, { texto: 'Guardar', clase: 'btn', valor: function () { return { t: $('cq-nota-texto').value.trim() }; } }],
    alAbrir: function () { const t = $('cq-nota-texto'); t.value = actual; t.focus(); } });
  if (!texto || texto.t === actual) return;
  const r = await api('notaCasillero', CQ.datos.ref, pid, linea, texto.t);
  if (!r.ok) return aviso(r.sinConexion ? '📶 Hace falta señal para esto. Probá cuando vuelva.' : r.error, 'bad');
  c.notaCasillero = r.nota ? { texto: r.nota, quien: r.notaDe } : null;
  pintarCuadro();
  aviso(r.nota ? '📝 Nota guardada.' : 'Nota quitada.');
}
