'use strict';
/* ============================================================
   PEDIR COTIZACIÓN (Fase 3, Paso 2)
   ------------------------------------------------------------
   - En Por cotizar, cada pedido tiene "📤 Pedir cotización": la ventana
     muestra un bloque por proveedor con sus productos (los sugeridos ya
     marcados). Se saca o se suma un proveedor, o un producto de un
     proveedor, solo para esta vez.
   - Enviar va por la bandeja: si justo no hay señal, sale cuando vuelve.
     El número del envío ("Q…") lo arma la app: un reintento no manda dos
     veces. Si el pedido cambió desde que se abrió la ventana, el
     servidor no lo manda y queda en "Cambios que no se aplicaron".
   - En la tarjeta, el bloque Cotizaciones: a quién se le pidió, qué,
     cuándo, con qué código y en qué estado (lo ven todos).
   - Arriba de Por cotizar, "📤 Pedir cotizaciones": todo lo que falta
     pedir, agrupado por rubro, a los proveedores sugeridos.
   ============================================================ */

const OPS_COTIZAR = { pedirCotizacion: 1, reintentarCotizacion: 1 };
const ESTADO_COT = {
  'Enviando': '⏳ Mandando…', 'En camino': '⏳ En camino', 'Enviado': '✅ Enviado', 'No salió': '⚠️ No se pudo mandar'
};

function colPorCotizar() {
  const c = columnasTb().filter(function (x) { return x.seccion === 'Cotización'; });
  return (c[1] || c[0] || {}).columna || 'Por cotizar';
}
function fechaCorta(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.getDate() + '/' + (d.getMonth() + 1);
}
/** ¿Se le puede pedir cotización desde la app? Un pedido (no una tarjeta de seguimiento), no manual, en Por cotizar. */
function sePuedeCotizar(t) { return !!t && !t.trabajo && !t.manual && t.columna === colPorCotizar(); }

/** La marca de la tarjeta en el tablero, en Por cotizar. */
function htmlMarcaCotizar(t) {
  if (!sePuedeCotizar(t)) return '';
  const espera = bandeja.lista().some(function (m) { return m.fn === 'pedirCotizacion' && m.args[0] === t.ref; });
  let txt;
  if (espera) txt = '⏳ Pidiendo cotización…';
  else if (!t.pedidoA) txt = '📤 Pedir cotización';
  else txt = '⏳ Pedido a ' + t.pedidoA + (t.pedidoA === 1 ? ' proveedor' : ' proveedores') + (t.sinPedir ? ' · 📤 ' + t.sinPedir + ' sin pedir' : '');
  const admin = APP.yo && APP.yo.admin;
  return admin ? '<button type="button" class="marca-cot" data-cotizar="' + esc(t.ref) + '">' + esc(txt) + '</button>'
               : '<div class="marca-cot">' + esc(txt) + '</div>';
}

/* ---------- La ventana "Pedir cotización" ---------- */
async function abrirPedirCotizacion(ref) {
  if (!APP.yo.admin) return;
  const r = await api('datosCotizar', ref);
  if (!r.ok) return aviso(r.sinConexion ? '📶 Para abrir "Pedir cotización" hace falta señal (tiene que ver a quién ya se le pidió). Probá en un rato.' : r.error, 'bad');
  if (r.manual) return aviso('Es un pedido ✋ manual: se cotiza a mano, por fuera de la app.');
  if (!r.productos.length) return aviso('Este pedido no tiene productos para pedir.');
  const provs = {};
  r.proveedores.forEach(function (p) { provs[p.id] = p; });
  // bloques: {proveedor: {incluido, lineas: {id: true}}}, en el orden en que aparecen
  const orden = [], bloques = {};
  const sumar = function (id, marcados) {
    if (!bloques[id]) { bloques[id] = { incluido: true, lineas: {} }; orden.push(id); }
    marcados.forEach(function (l) { bloques[id].lineas[l] = true; });
  };
  r.productos.forEach(function (x) {
    x.sugeridos.forEach(function (p) { if (provs[p] && !x.ya[p]) sumar(p, [x.id]); });
  });
  const prod = {};
  r.productos.forEach(function (x) { prod[x.id] = x; });
  const sinProveedor = function () {
    return r.productos.filter(function (x) {
      return !Object.keys(x.ya).length && !orden.some(function (p) { return bloques[p].incluido && bloques[p].lineas[x.id]; });
    });
  };
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo cotizar';
  const pintar = function () {
    const sin = sinProveedor();
    const porRubro = {};
    sin.forEach(function (x) { (porRubro[x.rubro || 'Sin rubro'] = porRubro[x.rubro || 'Sin rubro'] || []).push(x); });
    const usados = {};
    orden.forEach(function (p) { usados[p] = true; });
    cuerpo.innerHTML =
      (r.prueba.si ? '<p class="estado warn">🧪 Modo prueba: todos los mensajes le llegan al número de prueba (' + esc(r.prueba.numero) + '), no a los proveedores.</p>' : '') +
      '<p class="nota">' + esc(r.titulo) + ' · ' + esc(r.sitio) + (r.codigo ? ' · Código ' + esc(r.codigo) : '') + '</p>' +
      Object.keys(porRubro).map(function (rb) {
        return '<p class="estado warn">' + (rb === 'Sin rubro' || rb === 'OTROS' ? '✋ ' + esc(rb) + ': elegí a quién pedírselo con "+ Sumar proveedor".'
          : 'No hay proveedores para ' + esc(rb) + '. Sumá uno a mano.') + ' (' + esc(porRubro[rb].map(function (x) { return x.nombre; }).join(', ')) + ')</p>';
      }).join('') +
      orden.map(function (p) {
        const b = bloques[p], pr = provs[p] || { nombre: p };
        const sinTel = !pr.telefono && !r.prueba.si;
        return '<div class="cot-bloque' + (b.incluido && !sinTel ? '' : ' fuera') + '">' +
          '<button type="button" class="choice" data-prov="' + esc(p) + '" aria-checked="' + (b.incluido && !sinTel) + '"' + (sinTel ? ' disabled' : '') + '>' +
            '<span class="marca">' + (b.incluido && !sinTel ? '☑' : '☐') + '</span><span><b>' + esc(pr.nombre) + '</b>' +
            (sinTel ? '<small class="sub">Sin teléfono: cargalo en Admin → Proveedores</small>' : (!pr.telefono ? '<small class="sub">Sin teléfono (en modo prueba sale igual)</small>' : '')) + '</span></button>' +
          r.productos.map(function (x) {
            const ya = x.ya[p];
            const marcado = !ya && b.lineas[x.id];
            return '<button type="button" class="choice sub-choice" data-prov-linea="' + esc(p) + '|' + esc(x.id) + '"' + (ya || !b.incluido || sinTel ? ' disabled' : '') +
              ' aria-checked="' + !!marcado + '"><span class="marca">' + (marcado ? '☑' : '☐') + '</span><span>' + esc(x.cantidad + 'x ' + x.nombre) +
              (x.nota ? ' — ' + esc(x.nota) : '') + (x.fotos.length ? ' 📷' : '') +
              (ya ? '<small class="sub">Ya se le pidió el ' + esc(fechaCorta(ya)) + '</small>' : '') + '</span></button>';
          }).join('') + '</div>';
      }).join('') +
      '<div class="campo"><label for="cz-sumar">+ Sumar proveedor (solo esta vez)</label><select id="cz-sumar"><option value="">Elegí un proveedor…</option>' +
        r.proveedores.filter(function (p) { return !usados[p.id]; }).map(function (p) {
          return '<option value="' + esc(p.id) + '">' + esc(p.nombre) + (p.telefono ? '' : ' (sin teléfono)') + '</option>';
        }).join('') + '</select></div>';
    cuerpo.querySelectorAll('[data-prov]').forEach(function (el) {
      el.addEventListener('click', function () { const b = bloques[el.dataset.prov]; b.incluido = !b.incluido; pintar(); });
    });
    cuerpo.querySelectorAll('[data-prov-linea]').forEach(function (el) {
      el.addEventListener('click', function () {
        const x = el.dataset.provLinea.split('|'), b = bloques[x[0]];
        if (b.lineas[x[1]]) delete b.lineas[x[1]]; else b.lineas[x[1]] = true;
        pintar();
      });
    });
    $('cz-sumar').addEventListener('change', function () {
      const id = this.value;
      if (!id) return;
      // Lo que no tiene a quién pedírselo viene marcado; lo demás se marca a mano
      sumar(id, sinProveedor().map(function (x) { return x.id; }));
      pintar();
    });
    const n = mensajes().length;
    const ok = $('dg-ok');
    if (ok) { ok.disabled = !n; ok.textContent = n ? 'Enviar ' + n + (n === 1 ? ' mensaje' : ' mensajes') : 'Enviar'; }
  };
  const mensajes = function () {
    return orden.filter(function (p) {
      return bloques[p].incluido && (provs[p] && (provs[p].telefono || r.prueba.si));
    }).map(function (p) {
      return { proveedor: p, lineas: Object.keys(bloques[p].lineas).filter(function (l) { return prod[l] && !prod[l].ya[p]; }) };
    }).filter(function (m) { return m.lineas.length; });
  };
  const listo = await dialogo({
    titulo: '📤 Pedir cotización', cuerpo: cuerpo,
    botones: [{ texto: 'Enviar', clase: 'btn', id: 'dg-ok', valor: function () { return mensajes(); } }, { texto: 'Volver', valor: null }],
    alAbrir: pintar
  });
  if (!listo || !listo.length) return;
  const huellas = {};
  r.productos.forEach(function (x) { huellas[x.id] = x.huella; });
  const t = buscarEnVista(ref) || { titulo: r.titulo };
  bandeja.agregar('pedirCotizacion', [ref, { id: 'Q' + nuevoId(), mensajes: listo, huellas: huellas }],
    'pedir cotización de "' + (t.titulo || ref) + '" a ' + listo.length + (listo.length === 1 ? ' proveedor' : ' proveedores'));
  pintarTablero();
  if (TB.abierta === ref) pintarTarjeta();
  aviso(APP.enLinea ? '📤 Mandando el pedido de cotización…' : '📶 Poca señal: el pedido de cotización se manda solo cuando vuelva.');
}

/* ---------- "📤 Pedir cotizaciones", arriba de Por cotizar ---------- */
async function pedirCotizacionesColumna() {
  const r = await api('datosCotizarColumna');
  if (!r.ok) return aviso(r.sinConexion ? '📶 Para esto hace falta señal. Probá en un rato.' : r.error, 'bad');
  // Lo que falta pedir (a nadie se le pidió) y tiene proveedores sugeridos, agrupado por rubro
  const grupos = {}, sinProv = [], elegidos = {};
  r.pedidos.forEach(function (d) {
    d.productos.forEach(function (x) {
      if (Object.keys(x.ya).length) return;
      if (!x.sugeridos.length) { sinProv.push(d.titulo + ': ' + x.nombre); return; }
      const g = x.particulares ? '🎯 Proveedores particulares' : x.rubro;
      (grupos[g] = grupos[g] || []).push({ d: d, x: x });
      elegidos[d.ref + '|' + x.id] = true;
    });
  });
  const nombres = Object.keys(grupos).sort();
  if (!nombres.length) return aviso(sinProv.length ? 'Lo que falta pedir no tiene proveedores sugeridos: pedilo desde la tarjeta de cada pedido.' : 'No hay nada para pedir en ' + colPorCotizar() + '.');
  const prueba = r.pedidos[0] && r.pedidos[0].prueba.si ? r.pedidos[0].prueba.numero : '';
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo cotizar';
  const pintar = function () {
    cuerpo.innerHTML = (prueba ? '<p class="estado warn">🧪 Modo prueba: todo le llega al número de prueba (' + esc(prueba) + ').</p>' : '') +
      '<p class="nota">Todo marcado: destildá lo que no va. Cada pedido sale a los proveedores sugeridos de sus productos. Para cambiar a quién, usá la tarjeta del pedido.</p>' +
      (sinProv.length ? '<p class="estado warn">Sin proveedor sugerido (pedilo desde su tarjeta): ' + esc(sinProv.join(' · ')) + '</p>' : '') +
      '<div class="opciones" style="max-height:50vh">' + nombres.map(function (g) {
        return '<h4>' + esc(g) + '</h4>' + grupos[g].map(function (it) {
          const k = it.d.ref + '|' + it.x.id;
          return '<button type="button" class="choice sub-choice" data-k="' + esc(k) + '" aria-checked="' + !!elegidos[k] + '"><span class="marca">' + (elegidos[k] ? '☑' : '☐') +
            '</span><span>' + esc(it.x.cantidad + 'x ' + it.x.nombre) + '<small class="sub">' + esc(it.d.sitio + ' · ' + it.d.titulo) + '</small></span></button>';
        }).join('');
      }).join('') + '</div>';
    cuerpo.querySelectorAll('[data-k]').forEach(function (b) {
      b.addEventListener('click', function () { if (elegidos[b.dataset.k]) delete elegidos[b.dataset.k]; else elegidos[b.dataset.k] = true; pintar(); });
    });
    const n = Object.keys(elegidos).length, ok = $('dg-ok');
    if (ok) { ok.disabled = !n; ok.textContent = n ? 'Pedir (' + n + (n === 1 ? ' producto)' : ' productos)') : 'Pedir'; }
  };
  const si = await dialogo({
    titulo: '📤 Pedir cotizaciones', cuerpo: cuerpo,
    botones: [{ texto: 'Pedir', clase: 'btn', id: 'dg-ok', valor: true }, { texto: 'Volver', valor: null }], alAbrir: pintar
  });
  if (!si) return;
  let n = 0;
  r.pedidos.forEach(function (d) {
    const porProv = {};
    d.productos.forEach(function (x) {
      if (!elegidos[d.ref + '|' + x.id]) return;
      x.sugeridos.forEach(function (p) { if (!x.ya[p]) (porProv[p] = porProv[p] || []).push(x.id); });
    });
    const tels = {};
    d.proveedores.forEach(function (p) { tels[p.id] = p.telefono; });
    const mensajes = Object.keys(porProv).filter(function (p) { return tels[p] || d.prueba.si; })
      .map(function (p) { return { proveedor: p, lineas: porProv[p] }; });
    if (!mensajes.length) return;
    const huellas = {};
    d.productos.forEach(function (x) { huellas[x.id] = x.huella; });
    bandeja.agregar('pedirCotizacion', [d.ref, { id: 'Q' + nuevoId(), mensajes: mensajes, huellas: huellas }],
      'pedir cotización de "' + d.titulo + '" a ' + mensajes.length + (mensajes.length === 1 ? ' proveedor' : ' proveedores'));
    n++;
  });
  pintarTablero();
  aviso(n ? '📤 Pidiendo cotización de ' + n + (n === 1 ? ' pedido' : ' pedidos') + '…' : 'Ningún proveedor sugerido tiene teléfono: cargalos en Admin → Proveedores.');
}

/* ---------- El bloque Cotizaciones de la tarjeta abierta ---------- */
function pintarCotizaciones() {
  const ref = TB.abierta, d = TB.detalle, b = $('tj-cot-b');
  if (!b) return;
  const t = buscarEnVista(ref);
  const lista = (d && d.solicitudes) || [];
  const esperan = bandeja.lista().filter(function (m) { return OPS_COTIZAR[m.fn] && m.args[0] === ref; });
  const puede = APP.yo.admin && sePuedeCotizar(t);
  b.hidden = TB.tipo === 'tarea' || esTrabajo(ref) || (!lista.length && !esperan.length && !puede);
  if (b.hidden) return;
  $('tj-cotizar').hidden = !puede;
  const reintento = {};
  esperan.forEach(function (m) { if (m.fn === 'reintentarCotizacion') reintento[m.args[1]] = true; });
  $('tj-cot').innerHTML =
    esperan.filter(function (m) { return m.fn === 'pedirCotizacion'; }).map(function () {
      return '<div class="cot-fila espera">' + (APP.enLinea ? '⏳ Mandando el pedido de cotización…' : '⏳ El pedido de cotización se manda solo cuando vuelva la señal.') + '</div>';
    }).join('') +
    (lista.length ? lista.map(function (s) {
      const e = reintento[s.id] ? '⏳ Reintentando…' : (ESTADO_COT[s.estado] || s.estado);
      return '<div class="cot-fila' + (s.estado === 'No salió' ? ' mal' : '') + '"><div><b>' + esc(s.nombre) + '</b> <small>· ' + esc(s.codigo) + ' · ' + esc(fechaCorta(s.fecha)) +
        (s.prueba ? ' · 🧪 prueba' : '') + '</small></div>' +
        '<div class="sub">' + esc(s.productos.join(', ')) + '</div>' +
        '<div class="sub">' + esc(e) + (s.notas ? ' · ' + esc(s.notas) : '') + '</div>' +
        (APP.yo.admin && s.estado === 'No salió' && !reintento[s.id] ? '<button type="button" class="btn-chico" data-reintentar="' + esc(s.id) + '">Reintentar</button>' : '') + '</div>';
    }).join('') : (esperan.length ? '' : '<p class="nota" style="margin:0">Todavía no se pidió cotización.</p>'));
  $('tj-cot').querySelectorAll('[data-reintentar]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const s = lista.filter(function (x) { return x.id === btn.dataset.reintentar; })[0];
      bandeja.agregar('reintentarCotizacion', [ref, s.id], 'volver a mandar el pedido de cotización a ' + s.nombre);
      pintarCotizaciones();
    });
  });
}
$('tj-cotizar').addEventListener('click', function () { if (TB.abierta) abrirPedirCotizacion(TB.abierta); });

// Cuando sale de la bandeja: el bloque Cotizaciones y la marca del tablero se actualizan (las dos llevan la ref adelante)
(function () {
  const antes = bandeja.alTerminar;
  bandeja.alTerminar = function (m, r) {
    if (antes) antes(m, r);
    if (!OPS_COTIZAR[m.fn]) return;
    const ref = m.args[0];
    if (r.ok && r.solicitudes) {
      const todos = detallesGuardados();
      if (todos[ref]) { todos[ref].d.solicitudes = r.solicitudes; guardado.guardarJSON(K_TARJETAS, todos); }
      if (TB.abierta === ref && TB.detalle) TB.detalle.solicitudes = r.solicitudes;
    }
    if (r.ok && m.fn === 'pedirCotizacion' && !document.hidden) {
      const n = (r.solicitudes || []).filter(function (s) { return s.estado === 'No salió'; }).length;
      aviso(r.repetido ? 'Ese pedido de cotización ya se había mandado.' : n ? '📤 Pedido de cotización ' + r.codigo + ' mandado. ' + n + ' no se ' + (n === 1 ? 'pudo' : 'pudieron') + ' mandar: mirá la tarjeta.' : '📤 Pedido de cotización ' + r.codigo + ' mandado.');
    }
    cargarTablero();
    if (TB.abierta === ref) { pintarTarjeta(); traerTarjeta(ref); }
  };
})();
