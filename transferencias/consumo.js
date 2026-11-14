/* Transferencias → Consumo mensual (Fase 6-ter, Paso 1; Feli, 13/11). Solo admins.
   - El consumo de cada producto (promedio de los egresos de los últimos 6 meses cerrados) y las existencias del último
     reporte de Albor, por oficina, vienen del servidor (getConsumoMensual → reportes.consumo_compra).
   - Faltantes y sobrantes: existencia − un mes de consumo (lo justo, 0, va a faltantes: Feli, 13/11).
   - Necesidad: consumo × meses − existencias, para arriba a unidades enteras, nunca menos de 0. LC 50 y CASA se calculan
     juntas: lo que hay que comprar entre las dos no cambia y se reparte para que las dos queden con lo mismo.
   - Lo cambiado a mano (y los meses) se guarda en el servidor (guardarCompraStock): lo ven todos los admins hasta "Borrar".
     En "Todo junto", el cambio va a Oficina JM. */
(function(){
  'use strict';

  var OFICINAS = [
    { id: 'JM', nombre: 'Oficina JM', granjas: 'Candelaria, Candelaria Engorde, El Cebil y El Cebil Engorde' },
    { id: 'LC50', nombre: 'Oficina LC 50', granjas: 'La Colorada (G4)' },
    { id: 'CASA', nombre: 'Oficina CASA', granjas: 'Granja La Colorada' }
  ];
  var GUARDA = 'programa-compras:consumo';      // lo último que llegó del servidor (para abrir sin esperar)
  var VISTA = 'programa-compras:consumo_vista';  // {parte, junto, todos} de esta compu
  var MESES_NOMBRE = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  /* ---------- El cálculo (sin pantalla: se prueba solo) ---------- */

  function n(v){ v = Number(v); return isFinite(v) ? v : 0; }
  function arriba(v){ return v > 0 ? Math.ceil(v - 1e-9) : 0; }

  /** La necesidad calculada de cada oficina de un producto: {JM, LC50, CASA}. of = {JM:{consumo, existencia}, …}. */
  function necesidadCalculada(of, meses){
    var jm = of.JM, l = of.LC50, c = of.CASA, r = {};
    r.JM = arriba(n(jm.consumo) * meses - n(jm.existencia));
    // LC 50 y CASA (Feli, 13/11): lo que falta entre las dos, repartido para que queden con lo mismo
    var el = n(l.existencia), ec = n(c.existencia);
    var total = arriba((n(l.consumo) + n(c.consumo)) * meses - el - ec);
    if(!total){ r.LC50 = 0; r.CASA = 0; return r; }
    var queda = (el + ec + total) / 2, nl = queda - el, nc = queda - ec;
    if(nl <= 0){ r.LC50 = 0; r.CASA = total; }
    else if(nc <= 0){ r.LC50 = total; r.CASA = 0; }
    else { r.LC50 = Math.min(total, Math.round(nl)); r.CASA = total - r.LC50; }
    return r;
  }

  /** productos (del servidor), meses, aMano {"JM|COD": {v}} → [{cod, insumo, unidad, tipo, precio, of: {JM: {consumo, existencia,
      diferencia, calculada, necesidad, aMano}}, total: {consumo, existencia, diferencia, calculada, necesidad, aMano}}]. */
  function calcular(productos, meses, aMano){
    aMano = aMano || {};
    meses = n(meses) > 0 ? n(meses) : 1;
    var por = {}, lista = [];
    (productos || []).forEach(function(p){
      var cod = String(p.codigo || '').toUpperCase();
      if(!cod || OFICINAS.map(function(o){ return o.id; }).indexOf(p.oficina) < 0) return;
      var x = por[cod];
      if(!x){
        x = por[cod] = { cod: cod, insumo: p.insumo || cod, unidad: p.unidad || '', tipo: p.tipo || '', precio: null, of: {} };
        OFICINAS.forEach(function(o){ x.of[o.id] = { consumo: 0, existencia: 0, granjas: {} }; });
        lista.push(x);
      }
      if(p.insumo && x.insumo === cod) x.insumo = p.insumo;
      if(!x.unidad && p.unidad) x.unidad = p.unidad;
      if(x.precio === null && p.precio !== null && p.precio !== undefined) x.precio = n(p.precio);
      var o = x.of[p.oficina];
      o.consumo += n(p.consumo); o.existencia += n(p.existencia);
      Object.keys(p.granjas || {}).forEach(function(g){ o.granjas[g] = n(p.granjas[g]); });
    });
    lista.forEach(function(x){
      var calc = necesidadCalculada(x.of, meses), t = { consumo: 0, existencia: 0, calculada: 0, necesidad: 0, aMano: false };
      OFICINAS.forEach(function(o){
        var y = x.of[o.id], m = aMano[o.id + '|' + x.cod];
        y.consumo = redondo(y.consumo); y.existencia = redondo(y.existencia);
        y.diferencia = redondo(y.existencia - y.consumo);
        y.calculada = calc[o.id];
        y.aMano = !!(m && m.v !== null && m.v !== undefined && isFinite(Number(m.v)));
        y.necesidad = y.aMano ? n(m.v) : y.calculada;
        if(y.aMano){ y.quien = m.quien || ''; y.cuando = m.cuando || ''; }
        t.consumo += y.consumo; t.existencia += y.existencia; t.calculada += y.calculada; t.necesidad += y.necesidad;
        if(y.aMano) t.aMano = true;
      });
      t.consumo = redondo(t.consumo); t.existencia = redondo(t.existencia); t.necesidad = redondo(t.necesidad);
      t.diferencia = redondo(t.existencia - t.consumo);
      x.total = t;
    });
    return lista.sort(function(a, b){ return a.insumo.localeCompare(b.insumo, 'es', { sensitivity: 'base' }); });
  }
  function redondo(v){ return Math.round(n(v) * 1000) / 1000; }

  /** Lo que queda en Oficina JM cuando en "Todo junto" se escribe el total (Feli, 13/11: el cambio va a JM). */
  function jmParaTotal(x, total){
    return Math.max(0, redondo(n(total) - x.of.LC50.necesidad - x.of.CASA.necesidad));
  }

  /* ---------- La pantalla ---------- */

  var S = { r: null, cargando: false, error: '', parte: 'faltantes', junto: true, todos: false, buscar: '', foco: null, guardando: 0,
            cot: null,     // cot: el recuadro de "Pedir cotización" abierto (Paso 2)
            oc: null };    // oc: el de "Realizar órdenes de compra" (Paso 4)
  try { var v0 = JSON.parse(localStorage.getItem(VISTA) || 'null'); if(v0){ S.parte = v0.parte === 'necesidad' ? 'necesidad' : 'faltantes'; S.junto = v0.junto !== false; S.todos = !!v0.todos; } } catch(e){}
  try { S.r = JSON.parse(localStorage.getItem(GUARDA) || 'null'); } catch(e){}

  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(v){ v = n(v); return v.toLocaleString('es-AR', { maximumFractionDigits: 2 }); }
  function plata(v){ return v === null || v === undefined ? '' : '$ ' + n(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function guardarVista(){ try { localStorage.setItem(VISTA, JSON.stringify({ parte: S.parte, junto: S.junto, todos: S.todos })); } catch(e){} }
  function sinTildes(s){ return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  function fechaHora(iso){
    if(!iso) return '';
    var d = new Date(iso); if(isNaN(d)) return String(iso);
    return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' }) + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }
  function nombreMes(ym){ var p = String(ym).split('-'); return MESES_NOMBRE[Number(p[1]) - 1] || ym; }
  function listaY(a){ return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1]; }

  async function cargar(){
    if(S.cargando) return;
    S.cargando = true; S.error = ''; pintar();
    var r = await api('getConsumoMensual');
    S.cargando = false;
    if(r && r.ok !== false && r.datos){
      S.r = { datos: r.datos, meses: r.meses, necesidad: r.necesidad || {}, proveedores: r.proveedores || [], msjCotizacion: r.msjCotizacion || '',
              precios: r.precios || {}, cotizados: r.cotizados || {}, ordenados: r.ordenados || {}, sinMandar: r.sinMandar || [], msjOrden: r.msjOrden || '',
              llego: new Date().toISOString() };
      try { localStorage.setItem(GUARDA, JSON.stringify(S.r)); } catch(e){}
    } else S.error = r && r.sinConexion ? 'Hace falta señal para traer el consumo.' + (S.r ? ' Ves lo último que llegó.' : '') : 'No se pudo traer el consumo: ' + ((r && r.error) || '');
    pintar();
  }

  function filas(){
    if(!S.r) return [];
    var l = calcular(S.r.datos.productos, S.r.meses, S.r.necesidad), b = sinTildes(S.buscar.trim());
    if(b) l = l.filter(function(x){ return sinTildes(x.insumo + ' ' + x.cod).indexOf(b) >= 0; });
    return l;
  }

  function pintar(){
    var host = $('cm'); if(!host) return;
    // El casillero elegido sigue elegido después de volver a pintar (al llegar la respuesta del servidor)
    var act = document.activeElement;
    if(!S.foco && act && act.classList && act.classList.contains('cm-campo') && host.contains(act)) S.foco = act.dataset.k;
    var h = [], d = S.r && S.r.datos;
    $('cmerror').textContent = S.error; $('cmerror').classList.toggle('on', !!S.error);
    // Encabezado: de cuándo son las existencias y qué meses se promedian
    h.push('<div class="paso cm-cab"><div class="fila">');
    if(d){
      var ex = d.existencias, ms = (d.mesesConEgresos || []).map(nombreMes);
      h.push('<span class="contado">Existencias de Albor: <b>' + (ex ? esc(fechaHora(ex.fecha)) : 'no hay') + '</b></span>');
      h.push('<span class="contado">Consumo: promedio de <b>' + (ms.length ? esc(listaY(ms)) : 'ningún mes con egresos') + '</b></span>');
    } else h.push('<span class="contado">' + (S.cargando ? 'Trayendo el consumo…' : 'Todavía no se trajo el consumo.') + '</span>');
    h.push('<span class="sep"></span><button class="linkbtn" id="cmrecargar">' + (S.cargando ? 'trayendo…' : 'actualizar') + '</button></div>');
    if(d) h.push('<p class="nota">El consumo de cada producto es el promedio mensual de los egresos de los últimos 6 meses cerrados (sin este mes). ' +
                 'Cada granja se divide por los meses en que tiene egresos' + mesesPorGranja(d.meses) + '.</p>');
    h.push('</div>');
    if(!d){ host.innerHTML = h.join(''); conectar(); return; }

    h.push('<div class="hbotones" role="tablist">' +
           '<button type="button" class="hb' + (S.parte === 'faltantes' ? ' on' : '') + '" data-cm-parte="faltantes">Faltantes y sobrantes</button>' +
           '<button type="button" class="hb' + (S.parte === 'necesidad' ? ' on' : '') + '" data-cm-parte="necesidad">Necesidad de compra</button></div>');
    h.push('<div class="paso cm-fil"><div class="fila">');
    h.push('<span class="cm-seg" role="group"><button type="button" class="' + (S.junto ? 'on' : '') + '" data-cm-junto="1">Todo junto</button>' +
           '<button type="button" class="' + (S.junto ? '' : 'on') + '" data-cm-junto="0">Por oficina</button></span>');
    h.push('<label class="field">Buscar <input type="text" id="cmbuscar" autocomplete="off" placeholder="producto o código" value="' + esc(S.buscar) + '"></label>');
    if(S.parte === 'necesidad'){
      h.push('<label class="field">Comprar para <input type="text" inputmode="decimal" id="cmmeses" autocomplete="off" value="' + esc(fmt(S.r.meses)) + '"> ' + (n(S.r.meses) === 1 ? 'mes' : 'meses') + '</label>');
      h.push('<label class="check"><input type="checkbox" id="cmtodos"' + (S.todos ? ' checked' : '') + '> Ver también lo que no hace falta comprar</label>');
      var hayAMano = Object.keys(S.r.necesidad || {}).length;
      if(hayAMano) h.push('<button class="linkbtn" id="cmborrar">Borrar lo cambiado a mano (' + hayAMano + ')</button>');
      var hayPrecios = Object.keys(S.r.precios || {}).length;
      if(hayPrecios) h.push('<button class="linkbtn" id="cmborrarp">Borrar precios y proveedores (' + hayPrecios + ')</button>');
      if(S.guardando) h.push('<span class="contado">guardando…</span>');
      if(!S.cot) h.push('<button class="btn" id="cmcotizar">📤 Pedir cotización</button>');
      if(!S.oc && (ordenesParaHacer().length || (S.r.sinMandar || []).length)) h.push('<button class="btn" id="cmordenes">🧾 Realizar órdenes de compra</button>');
    }
    h.push('</div>');
    if(S.parte === 'necesidad') h.push('<p class="nota">Necesidad = consumo por mes × meses − existencias de hoy (para arriba, a unidades enteras). ' +
      'LC 50 y CASA se calculan juntas y se reparte lo que hay que comprar para que las dos queden con lo mismo. ' +
      'La necesidad se cambia a mano (con ↓ o Enter pasás al siguiente)' + (S.junto ? '; en "Todo junto", el cambio va a Oficina JM' : '') +
      '. Lo cambiado a mano queda guardado para todos hasta que lo borres. ' +
      'Precio unitario y Precio total van juntos (total = unitario × necesidad): cargá el que tengas. Los precios y el proveedor de cada producto ' +
      'quedan guardados para todos hasta "Borrar precios".</p>');
    h.push('</div>');

    var l = filas();
    if(S.parte === 'necesidad' && S.cot) h.push(htmlCotizar());
    if(S.parte === 'necesidad' && S.oc) h.push(htmlOrdenes());
    if(S.parte === 'faltantes') h.push(S.junto ? tablaFaltantes(l, null) : OFICINAS.map(function(o){ return tablaFaltantes(l, o); }).join(''));
    else h.push(S.junto ? tablaNecesidad(l, null) : OFICINAS.map(function(o){ return tablaNecesidad(l, o); }).join(''));
    host.innerHTML = h.join('');
    conectar();
  }

  function mesesPorGranja(m){
    var k = Object.keys(m || {});
    if(!k.length) return '';
    return ' (' + k.sort().map(function(g){ return g + ': ' + m[g]; }).join(' · ') + ')';
  }

  function tituloOficina(o){
    return '<h3 class="cm-of">' + esc(o.nombre) + ' <span>' + esc(o.granjas) + '</span></h3>';
  }

  function celdaProducto(x){
    return '<td class="name">' + esc(x.insumo) + ' <span class="cm-cod">' + esc(x.cod) + (x.unidad ? ' · ' + esc(x.unidad) : '') + '</span></td>';
  }

  function tablaFaltantes(l, o){
    var de = function(x){ return o ? x.of[o.id] : x.total; };
    var con = l.filter(function(x){ var y = de(x); return y.consumo || y.existencia; });
    var faltan = con.filter(function(x){ return de(x).diferencia <= 0; }).sort(function(a, b){ return de(a).diferencia - de(b).diferencia; });
    var sobran = con.filter(function(x){ return de(x).diferencia > 0; }).sort(function(a, b){ return de(b).diferencia - de(a).diferencia; });
    var h = ['<div class="cm-bloque">'];
    if(o) h.push(tituloOficina(o));
    h.push('<div class="tablewrap on cm-tabla"><table><thead><tr><th class="name">Producto</th><th>Consumo por mes</th><th>Existencia</th><th>Diferencia</th></tr></thead><tbody>');
    [['Faltantes', faltan, 'falta'], ['Sobrantes', sobran, 'sobra']].forEach(function(g){
      h.push('<tr class="cm-grupo ' + g[2] + '"><td colspan="4">' + g[0] + ' (' + g[1].length + ')</td></tr>');
      if(!g[1].length) h.push('<tr><td colspan="4" class="name cm-vacio">Nada</td></tr>');
      g[1].forEach(function(x){
        var y = de(x);
        h.push('<tr>' + celdaProducto(x) + '<td>' + fmt(y.consumo) + '</td><td>' + fmt(y.existencia) + '</td>' +
               '<td class="' + (y.diferencia < 0 ? 'cm-neg' : y.diferencia > 0 ? 'cm-pos' : 'zero') + '">' + (y.diferencia > 0 ? '+' : '') + fmt(y.diferencia) + '</td></tr>');
      });
    });
    h.push('</tbody></table></div></div>');
    return h.join('');
  }

  /* Paso 3 (Feli, 13/11): al lado de la necesidad, Precio unitario y Precio total (enlazados: total = unitario × necesidad)
     y el proveedor de cada fila. Se guardan en el servidor por producto (el mismo en las tres oficinas) hasta "Borrar precios". */
  function precioDe(cod){ var p = (S.r.precios || {})[cod]; return p && p.precio !== null && p.precio !== undefined ? n(p.precio) : null; }
  function proveedorDe(cod){ var p = (S.r.precios || {})[cod]; return p ? p.proveedor || '' : ''; }
  function nombreProveedor(id){ var p = (S.r.proveedores || []).filter(function(x){ return x.id === id; })[0]; return p ? p.nombre : id; }
  function fmt2(v){ return v === null || v === undefined ? '' : n(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  /** Un número como lo escribe la gente: "1.234,5", "1234,5", "1234.5" o "30.744" (miles). null si está vacío; NaN si no es un número. */
  function numeroEscrito(t){
    t = String(t === null || t === undefined ? '' : t).replace(/\$|\s/g, '');
    if(t === '') return null;
    if(t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');
    else if(/\.\d{3}$/.test(t) || (t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
    return Number(t);
  }

  function selectProveedor(x){
    var elegido = proveedorDe(x.cod), cot = S.r.cotizados || {}, provs = S.r.proveedores || [];
    var arriba = provs.filter(function(p){ return cot[p.id]; }), resto = provs.filter(function(p){ return !cot[p.id]; });
    var op = function(p){ return '<option value="' + esc(p.id) + '"' + (p.id === elegido ? ' selected' : '') + '>' + esc(p.nombre) + '</option>'; };
    return '<select class="cm-prov" data-cod="' + esc(x.cod) + '"><option value="">— elegir —</option>' +
      (arriba.length ? '<optgroup label="Se les pidió cotización">' + arriba.map(op).join('') + '</optgroup><optgroup label="Otros">' + resto.map(op).join('') + '</optgroup>'
                     : resto.map(op).join('')) +
      (elegido && !provs.some(function(p){ return p.id === elegido; }) ? '<option value="' + esc(elegido) + '" selected>' + esc(elegido) + '</option>' : '') + '</select>';
  }

  function tablaNecesidad(l, o){
    var de = function(x){ return o ? x.of[o.id] : x.total; };
    var ver = l.filter(function(x){
      var y = de(x);
      return S.todos ? (y.consumo || y.existencia || y.necesidad || precioDe(x.cod) !== null) : (y.necesidad > 0 || y.aMano || (precioDe(x.cod) !== null && y.necesidad > 0) || (!o && (precioDe(x.cod) !== null || proveedorDe(x.cod))));
    });
    var h = ['<div class="cm-bloque">'];
    if(o) h.push(tituloOficina(o));
    var meses = n(S.r.meses);
    h.push('<div class="tablewrap on cm-tabla"><table><thead><tr><th class="name">Producto</th><th>Consumo en ' + fmt(meses) + (meses === 1 ? ' mes' : ' meses') + '</th><th>Existencia</th>' +
           '<th class="cm-nec">Necesidad</th><th>Precio última compra</th><th class="cm-pr">Precio unitario</th><th class="cm-pr">Precio total</th><th class="cm-pr">Proveedor</th></tr></thead><tbody>');
    if(!ver.length) h.push('<tr><td colspan="8" class="name cm-vacio">' + (S.buscar ? 'Nada con eso.' : 'No hace falta comprar nada para ' + fmt(meses) + (meses === 1 ? ' mes.' : ' meses.')) + '</td></tr>');
    var estimado = 0, conUltimo = 0, cargado = 0, porProv = {};
    ver.forEach(function(x){
      var y = de(x), k = (o ? o.id : 'T') + '|' + x.cod, pu = precioDe(x.cod), prov = proveedorDe(x.cod);
      var pt = pu === null ? null : Math.round(pu * y.necesidad * 100) / 100;
      if(x.precio !== null){ estimado += y.necesidad * x.precio; conUltimo++; }
      if(pt !== null) cargado += pt;
      if(y.necesidad > 0){
        var g = porProv[prov] = porProv[prov] || { n: 0, total: 0, sinPrecio: 0 };
        g.n++; if(pt === null) g.sinPrecio++; else g.total += pt;
      }
      var marca = y.aMano ? '<button type="button" class="cm-amano" data-cm-volver="' + esc(k) + '" title="Cambiado a mano' +
        (o && y.quien ? ' por ' + esc(y.quien) : '') + '. Calculado: ' + fmt(y.calculada) + '. Tocá para volver a lo calculado.">✏️ ↺</button>' : '';
      var ords = (o ? [o] : OFICINAS).map(function(of){ var z = (S.r.ordenados || {})[of.id + '|' + x.cod]; return z ? (o ? '' : of.nombre.replace('Oficina ', '') + ': ') + z.numero : ''; }).filter(String);
      var ordenado = ords.length ? '<div class="cm-ordenado" title="Ya se ordenó (desde el último «Borrar precios»)">✅ ' + esc(ords.join(' · ')) + '</div>' : '';
      h.push('<tr' + (y.aMano ? ' class="cm-mano"' : '') + '>' + celdaProducto(x).replace(/<\/td>$/, ordenado + '</td>') + '<td>' + fmt(redondo(y.consumo * meses)) + '</td><td>' + fmt(y.existencia) + '</td>' +
             '<td class="cm-nec">' + marca + '<input class="ajuste cm-campo cm-in" type="text" inputmode="decimal" autocomplete="off" data-k="' + esc(k) + '" value="' + esc(fmt(y.necesidad)) + '"></td>' +
             '<td' + (x.precio === null ? ' class="zero"' : '') + '>' + (x.precio === null ? '—' : plata(x.precio)) + '</td>' +
             '<td class="cm-pr"><input class="ajuste cm-campo cm-pu" type="text" inputmode="decimal" autocomplete="off" data-k="pu:' + esc(k) + '" value="' + esc(fmt2(pu)) + '" placeholder="$"></td>' +
             '<td class="cm-pr"><input class="ajuste cm-campo cm-pt" type="text" inputmode="decimal" autocomplete="off" data-k="pt:' + esc(k) + '" value="' + esc(fmt2(pt)) + '" placeholder="$"></td>' +
             '<td class="cm-pr">' + selectProveedor(x) + '</td></tr>');
    });
    h.push('</tbody>');
    if(ver.length) h.push('<tfoot><tr><td class="name">' + ver.length + ' productos</td><td></td><td></td><td></td><td>' +
      (conUltimo ? '≈ ' + plata(estimado) : '') + '</td><td></td><td>' + (cargado ? plata(cargado) : '') + '</td><td></td></tr></tfoot>');
    h.push('</table></div>');
    if(ver.length && conUltimo) h.push('<p class="cm-pie">≈ necesidad × precio de la última compra' + (conUltimo < ver.length ? (ver.length - conUltimo === 1 ? ' (sin 1 que no tiene precio)' : ' (sin los ' + (ver.length - conUltimo) + ' que no tienen precio)') : '') + '.</p>');
    var provs = Object.keys(porProv).sort(function(a, b){ return !a ? 1 : !b ? -1 : nombreProveedor(a).localeCompare(nombreProveedor(b), 'es'); });
    if(provs.some(function(p){ return p; })) h.push('<p class="cm-pie cm-porprov"><b>Por proveedor:</b> ' + provs.map(function(p){
      var g = porProv[p];
      return (p ? esc(nombreProveedor(p)) : '<i>sin proveedor</i>') + ': ' + g.n + (g.n === 1 ? ' producto' : ' productos') + (g.total ? ', ' + plata(g.total) : '') +
             (g.sinPrecio && p ? ' (' + g.sinPrecio + ' sin precio)' : '');
    }).join(' · ') + '</p>');
    h.push('</div>');
    return h.join('');
  }

  function conectar(){
    var rec = $('cmrecargar'), bus = $('cmbuscar'), tod = $('cmtodos'), mes = $('cmmeses'), bor = $('cmborrar'), borp = $('cmborrarp');
    if(rec) rec.onclick = cargar;
    [].forEach.call(document.querySelectorAll('[data-cm-parte]'), function(x){
      x.onclick = function(){ S.parte = x.getAttribute('data-cm-parte'); guardarVista(); pintar(); };
    });
    [].forEach.call(document.querySelectorAll('[data-cm-junto]'), function(x){
      x.onclick = function(){ S.junto = x.getAttribute('data-cm-junto') === '1'; guardarVista(); pintar(); };
    });
    if(bus){
      bus.oninput = function(){
        S.buscar = bus.value; var pos = bus.selectionStart; pintar();
        var c = $('cmbuscar'); if(c){ c.focus(); try { c.setSelectionRange(pos, pos); } catch(e){} }
      };
    }
    if(tod) tod.onchange = function(){ S.todos = tod.checked; guardarVista(); pintar(); };
    if(mes){
      mes.onfocus = function(){ mes.select(); };
      mes.onkeydown = function(e){ if(e.key === 'Enter'){ e.preventDefault(); mes.blur(); } };
      mes.onchange = function(){
        var m = numeroEscrito(mes.value);
        if(m === null || !isFinite(m) || m <= 0 || m > 24){ mes.value = fmt(S.r.meses); alert('Los meses tienen que ser entre 0,5 y 24.'); return; }
        m = Math.round(m * 2) / 2 || 0.5;
        if(m === n(S.r.meses)){ mes.value = fmt(m); return; }
        guardar({ meses: m }, function(){ S.r.meses = m; });
      };
    }
    if(bor) bor.onclick = function(){
      var k = Object.keys(S.r.necesidad || {}).length;
      if(!confirm('¿Borrar lo cambiado a mano (' + k + (k === 1 ? ' producto' : ' productos') + ')? Vuelve a lo calculado para todos los admins.')) return;
      guardar(null, function(){ S.r.necesidad = {}; }, 'necesidad');
    };
    if(borp) borp.onclick = function(){
      var k = Object.keys(S.r.precios || {}).length;
      if(!confirm('¿Borrar los precios y proveedores cargados (' + k + (k === 1 ? ' producto' : ' productos') + ')? Se borran para todos los admins y no se pueden recuperar.')) return;
      guardar(null, function(){ S.r.precios = {}; }, 'precios');
    };
    var cot = $('cmcotizar');
    if(cot) cot.onclick = abrirCotizar;
    if(S.cot && $('cmcotmandar')) conectarCotizar();
    var oc = $('cmordenes');
    if(oc) oc.onclick = abrirOrdenes;
    if(S.oc && $('cmocok')) conectarOrdenes();
    [].forEach.call(document.querySelectorAll('[data-cm-volver]'), function(x){
      x.onclick = function(){ cambiarNecesidad(x.getAttribute('data-cm-volver'), null); };
    });
    [].forEach.call(document.querySelectorAll('select.cm-prov'), function(x){
      x.onchange = function(){
        var cod = x.dataset.cod, prod = productoDe('T|' + cod);
        guardar({ precios: [{ codigo: cod, producto: prod ? prod.insumo : '', proveedor: x.value }] }, function(){
          var p = S.r.precios[cod] = S.r.precios[cod] || { precio: null, proveedor: '' };
          p.proveedor = x.value;
        });
      };
    });
    // Cada columna con su ↓ / Enter / ↑ (la necesidad, el unitario y el total)
    ['cm-in', 'cm-pu', 'cm-pt'].forEach(function(cl){
      var ins = [].slice.call(document.querySelectorAll('input.' + cl));
      ins.forEach(function(inp, i){
        inp.addEventListener('focus', function(){ inp.select(); });
        inp.addEventListener('change', function(){ tomar(inp); });
        inp.addEventListener('keydown', function(e){
          var paso = e.key === 'ArrowDown' || e.key === 'Enter' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
          if(!paso) return;
          e.preventDefault();
          var otro = ins[i + paso];
          S.foco = otro ? otro.dataset.k : null;
          if(!tomar(inp)){ var y = otro || inp; S.foco = null; y.focus(); y.select(); y.scrollIntoView({ block: 'nearest' }); }
        });
      });
    });
    if(S.foco){
      var f = [].filter.call(document.querySelectorAll('input.cm-campo'), function(x){ return x.dataset.k === S.foco; })[0];
      S.foco = null;
      if(f){ f.focus(); f.select(); f.scrollIntoView({ block: 'nearest' }); }
    }
  }

  // Lo escrito en un casillero; true si cambió algo (se vuelve a pintar)
  function tomar(inp){
    var k = inp.dataset.k, tipo = /^pu:/.test(k) ? 'pu' : /^pt:/.test(k) ? 'pt' : 'nec';
    if(tipo !== 'nec') k = k.slice(3);
    var v = numeroEscrito(inp.value);
    if(v !== null && (!isFinite(v) || v < 0)){ alert('Tiene que ser un número de 0 para arriba.'); inp.value = ''; return false; }
    var x = productoDe(k);
    if(!x) return false;
    var ofi = k.split('|')[0], nec = ofi === 'T' ? x.total.necesidad : x.of[ofi].necesidad;
    if(tipo === 'nec'){
      if(v === null) v = 0;
      if(redondo(v) === redondo(nec)) return false;
      cambiarNecesidad(k, v);
      return true;
    }
    var antes = precioDe(x.cod), pu;
    if(tipo === 'pu') pu = v;
    else {
      if(v === null) pu = null;
      else if(!(nec > 0)){ alert('Para cargar el precio total, primero tiene que haber necesidad. Cargá el precio unitario.'); inp.value = ''; return false; }
      else pu = Math.round(v / nec * 10000) / 10000;
      if(v !== null && antes !== null && fmt2(Math.round(antes * nec * 100) / 100) === fmt2(v)) return false;
    }
    if(tipo === 'pu' && (pu === null ? antes === null : antes !== null && fmt2(pu) === fmt2(antes))) return false;
    guardar({ precios: [{ codigo: x.cod, producto: x.insumo, precio: pu }] }, function(){
      var p = S.r.precios[x.cod] = S.r.precios[x.cod] || { precio: null, proveedor: '' };
      p.precio = pu;
    });
    return true;
  }

  function productoDe(k){
    var cod = k.split('|').slice(1).join('|');
    return calcular(S.r.datos.productos, S.r.meses, S.r.necesidad).filter(function(x){ return x.cod === cod; })[0];
  }

  /* k = "JM|COD" (una oficina) o "T|COD" (todo junto: va a JM); v null = volver a lo calculado. */
  function cambiarNecesidad(k, v){
    var x = productoDe(k); if(!x) return;
    var ofi = k.split('|')[0], cambios = [];
    if(ofi === 'T'){
      if(v === null) OFICINAS.forEach(function(o){ if(x.of[o.id].aMano) cambios.push({ oficina: o.id, codigo: x.cod, producto: x.insumo, v: null }); });
      else cambios.push({ oficina: 'JM', codigo: x.cod, producto: x.insumo, v: jmParaTotal(x, v) });
    } else cambios.push({ oficina: ofi, codigo: x.cod, producto: x.insumo, v: v });
    if(!cambios.length) return;
    guardar({ necesidad: cambios }, function(){
      cambios.forEach(function(c){
        var kk = c.oficina + '|' + c.codigo;
        if(c.v === null) delete S.r.necesidad[kk]; else S.r.necesidad[kk] = { v: c.v, quien: 'vos', cuando: new Date().toISOString() };
      });
    });
  }

  function copia(o){ return JSON.parse(JSON.stringify(o || {})); }

  /* Manda al servidor; mientras, la pantalla ya muestra el cambio (alGuardar). borrar: 'necesidad' o 'precios'. */
  async function guardar(c, alGuardar, borrar){
    var antes = { meses: S.r.meses, necesidad: copia(S.r.necesidad), precios: copia(S.r.precios) };
    if(!S.r.precios) S.r.precios = {};
    if(alGuardar) alGuardar();
    S.guardando++; pintar();
    var r = borrar ? await api('borrarCompraStock', borrar) : await api('guardarCompraStock', c);
    S.guardando--;
    if(r && r.ok !== false && r.necesidad){
      S.r.necesidad = r.necesidad; S.r.meses = r.meses; if(r.precios) S.r.precios = r.precios; if(r.ordenados) S.r.ordenados = r.ordenados; S.error = '';
      try { localStorage.setItem(GUARDA, JSON.stringify(S.r)); } catch(e){}
    } else {
      S.r.meses = antes.meses; S.r.necesidad = antes.necesidad; S.r.precios = antes.precios;
      S.error = r && r.sinConexion ? 'Hace falta señal para guardar el cambio: no se guardó.' : 'No se guardó el cambio: ' + ((r && r.error) || '');
    }
    pintar();
  }

  /* ---------- Pedir cotización (Paso 2; Feli, 13/11) ----------
     Uno o varios proveedores del padrón (con teléfono), los productos con necesidad (todos tildados), el mensaje (se ve y
     se cambia) y un Excel con código, producto, unidad, cantidad (la necesidad total: la suma de las tres oficinas) y el
     precio vacío. Sale por WhatsApp (pedirCotizacionStock) y queda en el historial. */
  var XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  function nuevoIdCot(){ return 'CQ' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 8).toUpperCase(); }

  /** Los productos que se pueden pedir: los que tienen necesidad (total de las tres oficinas). */
  function paraCotizar(){
    return calcular(S.r.datos.productos, S.r.meses, S.r.necesidad).filter(function(x){ return x.total.necesidad > 0; });
  }

  async function abrirCotizar(){
    if(!S.r.proveedores){ await cargar(); if(!S.r || !S.r.proveedores) return; }   // lo guardado antes del Paso 2 no los trae
    S.cot = { id: nuevoIdCot(), provs: {}, buscarProv: '', fuera: {}, texto: S.r.msjCotizacion || '', guardarTexto: false, mandando: false, resultado: null, error: '' };
    pintar();
    var c = document.querySelector('.cm-cot'); if(c) c.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function provsElegidos(){ return (S.r.proveedores || []).filter(function(p){ return S.cot.provs[p.id]; }); }

  function htmlCotizar(){
    var C = S.cot, prods = paraCotizar(), provs = S.r.proveedores || [];
    var b = sinTildes(C.buscarProv.trim());
    var lista = provs.filter(function(p){ return !b || sinTildes(p.nombre + ' ' + (p.rubros || []).join(' ')).indexOf(b) >= 0 || C.provs[p.id]; });
    var h = ['<div class="paso cm-cot"><h3>📤 Pedir cotización</h3>'];
    // 1. Proveedores
    h.push('<div class="cm-cot-p"><b>1. A quién</b> <span class="contado" id="cmcotnprov"></span>');
    h.push('<label class="field"><input type="text" id="cmcotbuscar" autocomplete="off" placeholder="buscar proveedor o rubro" value="' + esc(C.buscarProv) + '"></label>');
    h.push('<div class="cm-cot-lista" id="cmcotprovs">');
    if(!lista.length) h.push('<p class="nota">Nada con eso.</p>');
    lista.forEach(function(p){
      h.push('<label class="check' + (p.tel ? '' : ' cm-sin') + '"><input type="checkbox" data-cm-prov="' + esc(p.id) + '"' + (C.provs[p.id] ? ' checked' : '') + (p.tel ? '' : ' disabled') + '> ' +
             esc(p.nombre) + (p.rubros && p.rubros.length ? ' <span class="cm-cod-i">' + esc(p.rubros.join(', ')) + '</span>' : '') +
             (p.tel ? '' : ' <span class="cm-cod-i">sin teléfono</span>') + (p.activo ? '' : ' <span class="cm-cod-i">no activo</span>') + '</label>');
    });
    h.push('</div></div>');
    // 2. Productos
    h.push('<div class="cm-cot-p"><b>2. Qué productos</b> <span class="contado" id="cmcotnprod"></span> ' +
           '<button class="linkbtn" id="cmcottodos">todos</button> · <button class="linkbtn" id="cmcotninguno">ninguno</button>');
    h.push('<div class="cm-cot-lista">');
    if(!prods.length) h.push('<p class="nota">No hace falta comprar nada con estos meses.</p>');
    prods.forEach(function(x){
      h.push('<label class="check"><input type="checkbox" data-cm-prod="' + esc(x.cod) + '"' + (C.fuera[x.cod] ? '' : ' checked') + '> ' + esc(x.insumo) +
             ' <span class="cm-cod-i">' + fmt(x.total.necesidad) + (x.unidad ? ' ' + esc(x.unidad) : '') + '</span></label>');
    });
    h.push('</div></div>');
    // 3. Mensaje
    h.push('<div class="cm-cot-p"><b>3. El mensaje</b> <span class="contado">va con la planilla de Excel adjunta</span>');
    h.push('<textarea id="cmcottexto" rows="3">' + esc(C.texto) + '</textarea>');
    h.push('<label class="check"><input type="checkbox" id="cmcotguardar"' + (C.guardarTexto ? ' checked' : '') + '> Usar este texto también las próximas veces</label></div>');
    if(C.error) h.push('<p class="cm-cot-error">' + esc(C.error) + '</p>');
    if(C.resultado) h.push('<ul class="cm-cot-res">' + C.resultado.map(function(e){
      return '<li>' + (e.ok ? '✅ ' : '❌ ') + esc(e.nombre) + (e.ok ? (e.ya ? ': ya se le había mandado' : ': mandado') : ': no salió' + (e.error ? ' (' + esc(e.error) + ')' : '')) + '</li>';
    }).join('') + '</ul>');
    h.push('<div class="fila"><button class="btn" id="cmcotmandar"' + (C.mandando ? ' disabled' : '') + '></button>' +
           '<button class="linkbtn" id="cmcotcerrar">' + (C.resultado && C.resultado.every(function(e){ return e.ok; }) ? 'cerrar' : 'cancelar') + '</button></div>');
    h.push('</div>');
    return h.join('');
  }

  function contarCotizar(){
    var C = S.cot, np = provsElegidos().length, prods = paraCotizar().filter(function(x){ return !C.fuera[x.cod]; }).length, b;
    if((b = $('cmcotnprov'))) b.textContent = np ? '(' + np + (np === 1 ? ' elegido)' : ' elegidos)') : '';
    if((b = $('cmcotnprod'))) b.textContent = '(' + prods + ' de ' + paraCotizar().length + ')';
    if((b = $('cmcotmandar'))) b.textContent = C.mandando ? 'Mandando…' : 'Mandar a ' + np + (np === 1 ? ' proveedor' : ' proveedores');
  }

  function conectarCotizar(){
    var C = S.cot, bus = $('cmcotbuscar'), txt = $('cmcottexto'), gua = $('cmcotguardar');
    contarCotizar();
    if(bus) bus.oninput = function(){
      C.buscarProv = bus.value; var pos = bus.selectionStart, lista = $('cmcotprovs');
      var arriba = lista ? lista.scrollTop : 0;
      pintar();
      var c = $('cmcotbuscar'); if(c){ c.focus(); try { c.setSelectionRange(pos, pos); } catch(e){} }
      if($('cmcotprovs')) $('cmcotprovs').scrollTop = arriba;
    };
    [].forEach.call(document.querySelectorAll('[data-cm-prov]'), function(x){
      x.onchange = function(){ if(x.checked) C.provs[x.dataset.cmProv] = true; else delete C.provs[x.dataset.cmProv]; contarCotizar(); };
    });
    [].forEach.call(document.querySelectorAll('[data-cm-prod]'), function(x){
      x.onchange = function(){ if(x.checked) delete C.fuera[x.dataset.cmProd]; else C.fuera[x.dataset.cmProd] = true; contarCotizar(); };
    });
    $('cmcottodos').onclick = function(){ C.fuera = {}; [].forEach.call(document.querySelectorAll('[data-cm-prod]'), function(x){ x.checked = true; }); contarCotizar(); };
    $('cmcotninguno').onclick = function(){ paraCotizar().forEach(function(x){ C.fuera[x.cod] = true; }); [].forEach.call(document.querySelectorAll('[data-cm-prod]'), function(x){ x.checked = false; }); contarCotizar(); };
    if(txt) txt.oninput = function(){ C.texto = txt.value; };
    if(gua) gua.onchange = function(){ C.guardarTexto = gua.checked; };
    $('cmcotcerrar').onclick = function(){
      if(C.mandando) return;
      S.cot = null; pintar();
    };
    $('cmcotmandar').onclick = mandarCotizacion;
  }

  function cargarXlsx(){
    if(window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise(function(si, no){
      var sc = document.createElement('script');
      sc.src = XLSX_URL; sc.onload = function(){ window.XLSX ? si(window.XLSX) : no(new Error('no cargó')); };
      sc.onerror = function(){ no(new Error('Hace falta señal para armar la planilla.')); };
      document.head.appendChild(sc);
    });
  }

  /** La planilla para el proveedor (base64). Feli (13/11): sin código ni unidad; el precio total sale solo del unitario
      (cantidad × precio unitario). Si el vendedor escribe el total, pisa la fórmula: la app saca el unitario al cargarlo. */
  async function armarExcel(prods){
    var X = await cargarXlsx(), hoy = new Date();
    var fecha = hoy.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    var filas = [['Pedido de cotización · ' + fecha], [], ['Producto', 'Cantidad', 'Precio unitario', 'Precio total']];
    prods.forEach(function(x){ filas.push([x.insumo, x.total.necesidad, null, null]); });
    filas.push(['Total', null, null, null]);
    var hoja = X.utils.aoa_to_sheet(filas), primera = 4, ultima = 3 + prods.length, plata = '#,##0.00';
    // Con un valor de arranque (vacío o 0): sin eso la librería no guarda la fórmula. Excel la recalcula al escribir el unitario.
    for(var r = primera; r <= ultima; r++) hoja['D' + r] = { t: 's', v: '', f: 'IF(C' + r + '="","",B' + r + '*C' + r + ')', z: plata };
    hoja['D' + (ultima + 1)] = { t: 'n', v: 0, f: 'SUM(D' + primera + ':D' + ultima + ')', z: plata };
    hoja['!cols'] = [{ wch: 50 }, { wch: 10 }, { wch: 16 }, { wch: 18 }];
    var libro = X.utils.book_new();
    X.utils.book_append_sheet(libro, hoja, 'Cotización');
    return { nombre: 'Pedido de cotizacion ' + fecha.replace(/\//g, '-') + '.xlsx', base64: X.write(libro, { bookType: 'xlsx', type: 'base64' }) };
  }

  async function mandarCotizacion(){
    var C = S.cot;
    if(C.mandando) return;
    var provs = provsElegidos(), prods = paraCotizar().filter(function(x){ return !C.fuera[x.cod]; });
    C.error = '';
    if(!provs.length) C.error = 'Elegí al menos un proveedor.';
    else if(!prods.length) C.error = 'Elegí al menos un producto.';
    else if(!String(C.texto).trim()) C.error = 'Falta el mensaje.';
    if(C.error){ pintar(); return; }
    if(!confirm('¿Mandar el pedido de cotización de ' + prods.length + (prods.length === 1 ? ' producto' : ' productos') + ' a ' +
                provs.map(function(p){ return p.nombre; }).join(', ') + '?')) return;
    C.mandando = true; C.resultado = null; pintar();
    var archivo;
    try { archivo = await armarExcel(prods); }
    catch(e){ C.mandando = false; C.error = 'No se pudo armar la planilla: ' + (e.message || e); pintar(); return; }
    var r = await apiLenta('pedirCotizacionStock', {
      id: C.id, proveedores: provs.map(function(p){ return p.id; }), texto: C.texto, guardarTexto: C.guardarTexto, archivo: archivo,
      productos: prods.map(function(x){ return { codigo: x.cod, producto: x.insumo, unidad: x.unidad, cantidad: x.total.necesidad }; })
    });
    C.mandando = false;
    if(r && r.ok !== false && r.envios){
      C.resultado = r.envios;
      if(r.msjCotizacion) S.r.msjCotizacion = r.msjCotizacion;
      // Los que salieron se destildan: "Mandar" de nuevo reintenta solo los que no salieron (mismo envío)
      r.envios.forEach(function(e){ if(e.ok) delete C.provs[e.proveedor]; });
      if(r.envios.every(function(e){ return e.ok; })) C.id = nuevoIdCot();
    } else C.error = r && r.sinConexion ? 'Hace falta señal para mandarlo: no salió.' : 'No salió: ' + ((r && r.error) || '');
    pintar();
  }

  /* ---------- Realizar órdenes de compra (Paso 4; Feli, 13/11) ----------
     Una orden por proveedor y por oficina con lo que tiene precio, proveedor y necesidad (y no se ordenó en esta vuelta).
     La carga la extensión en Albor ("Orden de Compra de Insumos"; frena antes de guardar); con el número, la app arma la
     orden para el proveedor (total + IVA = total) y se la manda por WhatsApp, un PDF por orden. Solo en la compu con la
     extensión. "Probar sin guardar": todo igual, pero no guarda en Albor ni le manda nada al proveedor. */
  var IVAS = [21, 10.5, 27, 0];

  function nuevoIdOc(){ return 'CO' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 8).toUpperCase(); }

  /** [{clave: "PROV|OFI", proveedor, nombre, oficina, ofi, items: [{codigo, producto, cantidad, precio}], total}] */
  function ordenesParaHacer(){
    if(!S.r || !S.r.datos) return [];
    var por = {}, lista = [];
    calcular(S.r.datos.productos, S.r.meses, S.r.necesidad).forEach(function(x){
      var pu = precioDe(x.cod), prov = proveedorDe(x.cod);
      if(pu === null || !prov) return;
      OFICINAS.forEach(function(o){
        var nec = x.of[o.id].necesidad;
        if(!(nec > 0) || (S.r.ordenados || {})[o.id + '|' + x.cod]) return;
        var k = prov + '|' + o.id, g = por[k];
        if(!g){ g = por[k] = { clave: k, proveedor: prov, nombre: nombreProveedor(prov), oficina: o.nombre, ofi: o.id, items: [], total: 0 }; lista.push(g); }
        g.items.push({ codigo: x.cod, producto: x.insumo, cantidad: nec, precio: pu });
        g.total += nec * pu;
      });
    });
    lista.forEach(function(g){ g.total = Math.round(g.total * 100) / 100; });
    return lista.sort(function(a, b){ return a.nombre.localeCompare(b.nombre, 'es') || OFICINAS.map(function(o){ return o.id; }).indexOf(a.ofi) - OFICINAS.map(function(o){ return o.id; }).indexOf(b.ofi); });
  }

  function motorOrdenes(){ var m = window.TransfAlbor && window.TransfAlbor.motor(); return m && m.cargar_orden_insumos ? m : null; }

  function abrirOrdenes(){
    S.oc = { lote: nuevoIdOc(), iva: {}, fuera: {}, texto: S.r.msjOrden || '', guardarTexto: false, prueba: false, corriendo: false, error: '' };
    pintar();
    var c = document.querySelector('.cm-oc'); if(c) c.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function htmlOrdenes(){
    var C = S.oc, l = ordenesParaHacer(), provs = [], h = ['<div class="paso cm-cot cm-oc"><h3>🧾 Realizar órdenes de compra</h3>'];
    if(!motorOrdenes()) h.push('<p class="cm-cot-error">Las órdenes se cargan en Albor con la extensión: hace falta la compu con la extensión de Albor (desde el celular no se puede).</p>');
    var sm = S.r.sinMandar || [];
    if(sm.length){
      h.push('<div class="cm-cot-p"><b>Guardadas en Albor, sin mandar al proveedor</b><ul class="cm-cot-res">' + sm.map(function(o){
        return '<li>' + esc(o.numero) + ' · ' + esc(o.nombre) + ' · ' + esc((OFICINAS.filter(function(x){ return x.id === o.oficina; })[0] || {}).nombre || o.oficina) +
               (o.error ? ' <span class="cm-cod-i">(' + esc(o.error) + ')</span>' : '') + ' <button class="linkbtn" data-oc-remandar="' + esc(o.id) + '">mandar de nuevo</button></li>';
      }).join('') + '</ul></div>');
    }
    if(!l.length) h.push('<p class="nota">No hay nada para ordenar: hace falta precio, proveedor y necesidad (y que no se haya ordenado ya).</p>');
    l.forEach(function(g){ if(provs.indexOf(g.proveedor) < 0) provs.push(g.proveedor); });
    provs.forEach(function(p){
      var gs = l.filter(function(g){ return g.proveedor === p; }), iva = C.iva[p] === undefined ? 21 : C.iva[p];
      h.push('<div class="cm-cot-p cm-oc-prov"><b>' + esc(nombreProveedor(p)) + '</b> <label class="field">IVA <select data-oc-iva="' + esc(p) + '">' +
             IVAS.map(function(v){ return '<option value="' + v + '"' + (v === iva ? ' selected' : '') + '>' + String(v).replace('.', ',') + ' %</option>'; }).join('') + '</select></label>');
      gs.forEach(function(g){
        h.push('<label class="check"><input type="checkbox" data-oc-orden="' + esc(g.clave) + '"' + (C.fuera[g.clave] ? '' : ' checked') + '> ' + esc(g.oficina) + ': ' +
               g.items.length + (g.items.length === 1 ? ' producto' : ' productos') + ' · ' + plata(g.total) + ' + IVA' +
               ' <span class="cm-cod-i">' + esc(g.items.map(function(i){ return fmt(i.cantidad) + ' ' + i.producto; }).join(', ')) + '</span></label>');
      });
      h.push('</div>');
    });
    h.push('<div class="cm-cot-p"><b>El mensaje</b> <span class="contado">va con cada orden en PDF; {numero} = el de Albor, {mail} = el de las facturas de esa empresa</span>');
    h.push('<textarea id="cmoctexto" rows="2">' + esc(C.texto) + '</textarea>');
    h.push('<label class="check"><input type="checkbox" id="cmocguardar"' + (C.guardarTexto ? ' checked' : '') + '> Usar este texto también las próximas veces</label>');
    h.push('<label class="check"><input type="checkbox" id="cmocprueba"' + (C.prueba ? ' checked' : '') + '> 🧪 Probar sin guardar: la extensión arma cada orden en Albor y frena; no guarda nada ni le manda nada al proveedor</label></div>');
    if(C.error) h.push('<p class="cm-cot-error">' + esc(C.error) + '</p>');
    h.push('<div class="fila"><button class="btn" id="cmocok"' + (C.corriendo || !motorOrdenes() ? ' disabled' : '') + '></button>' +
           '<button class="linkbtn" id="cmoccerrar">' + (C.corriendo ? '' : 'cancelar') + '</button></div></div>');
    return h.join('');
  }

  function elegidasOrdenes(){ return ordenesParaHacer().filter(function(g){ return !S.oc.fuera[g.clave]; }); }

  function contarOrdenes(){
    var n = elegidasOrdenes().length, b = $('cmocok');
    if(b) b.textContent = S.oc.corriendo ? 'Cargando en Albor…' : (S.oc.prueba ? '🧪 Probar ' : 'Realizar ') + n + (n === 1 ? ' orden' : ' órdenes');
  }

  function conectarOrdenes(){
    var C = S.oc, txt = $('cmoctexto'), gua = $('cmocguardar'), pru = $('cmocprueba');
    contarOrdenes();
    [].forEach.call(document.querySelectorAll('[data-oc-iva]'), function(x){ x.onchange = function(){ C.iva[x.dataset.ocIva] = Number(x.value); }; });
    [].forEach.call(document.querySelectorAll('[data-oc-orden]'), function(x){
      x.onchange = function(){ if(x.checked) delete C.fuera[x.dataset.ocOrden]; else C.fuera[x.dataset.ocOrden] = true; contarOrdenes(); };
    });
    [].forEach.call(document.querySelectorAll('[data-oc-remandar]'), function(x){ x.onclick = function(){ remandarOrden(x.dataset.ocRemandar); }; });
    if(txt) txt.oninput = function(){ C.texto = txt.value; };
    if(gua) gua.onchange = function(){ C.guardarTexto = gua.checked; };
    if(pru) pru.onchange = function(){ C.prueba = pru.checked; contarOrdenes(); };
    $('cmoccerrar').onclick = function(){ if(C.corriendo) return; S.oc = null; pintar(); };
    $('cmocok').onclick = realizarOrdenes;
  }

  async function realizarOrdenes(){
    var C = S.oc, TA = window.TransfAlbor, m = motorOrdenes();
    if(C.corriendo || !m) return;
    if(TA.cargando()){ C.error = 'Ya hay una carga en Albor en curso: esperá a que termine.'; pintar(); return; }
    var l = elegidasOrdenes();
    C.error = '';
    if(!l.length){ C.error = 'Elegí al menos una orden.'; pintar(); return; }
    if(!String(C.texto).trim()){ C.error = 'Falta el mensaje.'; pintar(); return; }
    if(!confirm((C.prueba ? '🧪 Probar (sin guardar) ' : '¿Cargar en Albor y mandar ') + l.length + (l.length === 1 ? ' orden' : ' órdenes') + '?\n\n' +
                l.map(function(g){ return '• ' + g.nombre + ' · ' + g.oficina + ' · ' + plata(g.total) + ' + IVA ' + String(C.iva[g.proveedor] === undefined ? 21 : C.iva[g.proveedor]).replace('.', ',') + ' %'; }).join('\n') +
                (C.prueba ? '' : '\n\nLa extensión frena antes de guardar cada una.'))) return;
    C.corriendo = true; pintar();
    TA.abrir(C.prueba ? '🧪 Órdenes de compra (prueba, sin guardar)' : 'Órdenes de compra de insumos');
    var lineas = [], todoBien = true;
    for(var i = 0; i < l.length; i++){
      var g = l[i], iva = C.iva[g.proveedor] === undefined ? 21 : C.iva[g.proveedor], etiqueta = g.nombre + ' · ' + g.oficina;
      TA.log('— ' + (i + 1) + ' de ' + l.length + ': ' + etiqueta + ' —');
      var p = await conReintentos('prepararOrdenStock', [{ lote: C.lote, proveedor: g.proveedor, oficina: g.ofi, iva: iva, prueba: C.prueba, items: g.items }]);
      if(!p || p.ok === false){ todoBien = false; lineas.push('<li>❌ ' + esc(etiqueta) + ': ' + esc((p && p.error) || 'sin señal') + '</li>'); TA.log('   no se pudo: ' + ((p && p.error) || 'sin señal')); continue; }
      if(p.estado === 'Mandada'){ lineas.push('<li>✅ ' + esc(etiqueta) + ': ya estaba hecha (' + esc(p.numero) + ')</li>'); continue; }
      var numero = p.numero;
      if(p.estado !== 'Guardada'){
        var r = await m.cargar_orden_insumos(Object.assign({}, p.orden, { dejarAbierta: i < l.length - 1 }));
        if(!r || !r.ok){
          todoBien = false;
          lineas.push('<li>❌ ' + esc(etiqueta) + ': ' + esc((r && r.motivo) || 'no se cargó') + '</li>');
          if(r && r.cancelado){ lineas.push('<li>Las que seguían no se cargaron.</li>'); break; }
          continue;
        }
        if(r.prueba){ lineas.push('<li>🧪 ' + esc(etiqueta) + ': armada en Albor, sin guardar</li>'); continue; }
        numero = r.numero;
        if(!numero){ todoBien = false; lineas.push('<li>⚠️ ' + esc(etiqueta) + ': quedó en Albor pero no leí el número. Mandala desde «Guardadas sin mandar».</li>'); continue; }
      }
      var ok = await mandarUna(p.orden.id, numero, etiqueta, lineas);
      if(!ok) todoBien = false;
    }
    TA.terminar({ ok: todoBien, motivo: todoBien ? '' : 'Algunas órdenes no terminaron: mirá el detalle.' }, lineas);
    C.corriendo = false;
    if(!C.prueba) C.lote = nuevoIdOc();
    await cargar();
    if(todoBien && !C.prueba){ S.oc = null; pintar(); }
  }

  /** Feli (13/11): si el servidor no contesta (o pide reintentar), se prueba de nuevo hasta 3 veces antes de darse por
      vencido. Las tres funciones se pueden repetir sin duplicar nada (cada orden tiene su ID). */
  async function conReintentos(fn, args, lenta){
    var r;
    for(var i = 1; i <= 3; i++){
      r = await (lenta ? apiLenta : api).apply(null, [fn].concat(args));
      if(r && r.ok !== false) return r;
      if(!(r && (r.reintentar || r.sinConexion || r.lento))) return r;
      if(window.TransfAlbor) window.TransfAlbor.log('   (el servidor no contestó: pruebo de nuevo, ' + (i + 1) + ' de 3)');
      await new Promise(function(ok){ setTimeout(ok, 2000 * i); });
    }
    return r;
  }

  /** Con la orden guardada en Albor: el PDF para el proveedor y el WhatsApp. true si salió. */
  async function mandarUna(id, numero, etiqueta, lineas){
    var TA = window.TransfAlbor, C = S.oc || { texto: S.r.msjOrden, guardarTexto: false };
    var g = await conReintentos('ordenStockGuardada', [id, numero]);
    if(!g || g.ok === false){
      lineas.push('<li>⚠️ ' + esc(etiqueta) + ': guardada en Albor (' + esc(numero) + '), pero no pude anotarla: ' + esc((g && g.error) || 'sin señal') + '. Avisale a Claude.</li>');
      return false;
    }
    var pdf;
    try { TA.log('   armo la orden para el proveedor…'); pdf = await armarOrdenStockPDF(g.pdf); }
    catch(e){ lineas.push('<li>⚠️ ' + esc(etiqueta) + ' (' + esc(numero) + '): no pude armar el PDF (' + esc(e.message || e) + '). Mandala desde «Guardadas sin mandar».</li>'); return false; }
    TA.log('   se la mando por WhatsApp…');
    var mm = await conReintentos('mandarOrdenStock', [id, { pdf: { nombre: 'Orden de compra ' + numero + '.pdf', base64: pdf }, texto: C.texto, guardarTexto: C.guardarTexto }], true);
    if(!mm || mm.ok === false){
      lineas.push('<li>⚠️ ' + esc(etiqueta) + ' (' + esc(numero) + '): guardada en Albor, pero el WhatsApp no salió: ' + esc((mm && mm.error) || 'sin señal') + '. Mandala desde «Guardadas sin mandar».</li>');
      return false;
    }
    lineas.push('<li>✅ ' + esc(etiqueta) + ': ' + esc(numero) + ', mandada' + (mm.orden && mm.orden.mail === 'pendiente' ? ' (el mail a Consultores queda pendiente)' : '') + '</li>');
    return true;
  }

  async function remandarOrden(id){
    var o = (S.r.sinMandar || []).filter(function(x){ return x.id === id; })[0];
    if(!o || S.oc.corriendo) return;
    S.oc.corriendo = true; pintar();
    var lineas = [];
    window.TransfAlbor.abrir('Mandar la orden ' + o.numero);
    var ok = await mandarUna(id, o.numero, o.nombre, lineas);
    window.TransfAlbor.terminar({ ok: ok, motivo: ok ? '' : 'No salió.' }, lineas);
    S.oc.corriendo = false;
    await cargar();
  }

  /* La orden para el proveedor (base64), como la de las compras del tablero (armarOrdenPDF de Compras). d = datosPdfOrdenStock_. */
  var _logoLQ = null;
  function logoLQ(){
    if(!_logoLQ) _logoLQ = fetch('../img/logo-la-quimera.jpg').then(function(r){ if(!r.ok) throw new Error('sin logo'); return r.blob(); })
      .then(function(b){ return new Promise(function(ok){ var fr = new FileReader(); fr.onload = function(){ ok(fr.result); }; fr.readAsDataURL(b); }); })
      .catch(function(){ _logoLQ = null; return null; });
    return _logoLQ;
  }
  function txtPdf(v){ return String(v == null ? '' : v).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—−]/g, '-').replace(/[^\u0000-ÿ]/g, ''); }
  function numPdf(v, dec){ return v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }

  async function armarOrdenStockPDF(d){
    var jsPDF = await window.TransfAlbor.librosPDF(), logo = d.logo ? await logoLQ() : null;
    var doc = new jsPDF({ unit: 'mm', format: 'a4' }), azul = [27, 36, 64], gris = [110, 110, 110], ancho = 210, m = 15;
    var fecha = new Date(d.fecha || Date.now()).toLocaleDateString('es-AR');
    if(logo) doc.addImage(logo, 'JPEG', m, 8, 32, 32);
    doc.setTextColor.apply(doc, azul); doc.setFont('helvetica', 'bold'); doc.setFontSize(22);
    doc.text('Orden de compra', ancho - m, 22, { align: 'right' });
    doc.setFontSize(13); doc.text(txtPdf('N° ' + d.numero), ancho - m, 30, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor.apply(doc, gris);
    doc.text(txtPdf('Fecha: ' + fecha), ancho - m, 36, { align: 'right' });
    var y = 50;
    function bloque(x, titulo, lineas){
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor.apply(doc, azul); doc.text(titulo, x, y);
      doc.setDrawColor.apply(doc, azul); doc.setLineWidth(0.5); doc.line(x, y + 1.5, x + 85, y + 1.5);
      doc.setTextColor(30, 30, 30);
      var yy = y + 7;
      lineas.filter(Boolean).forEach(function(l, i){ doc.setFont('helvetica', i ? 'normal' : 'bold'); doc.text(txtPdf(l), x, yy, { maxWidth: 85 }); yy += 5.5; });
      return yy;
    }
    var e = d.empresa || {}, p = d.proveedor || {};
    y = Math.max(bloque(m, 'PEDIDO POR', [e.nombre, e.cuit ? 'CUIT ' + e.cuit : '', e.mail]), bloque(110, 'PROVEEDOR', [p.nombre, p.cuit ? 'CUIT ' + p.cuit : '', p.mail])) + 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor.apply(doc, azul);
    doc.text('DETALLE DE LA ORDEN', m, y); doc.line(m, y + 1.5, ancho - m, y + 1.5);
    doc.autoTable({ startY: y + 3, theme: 'plain', margin: { left: m }, tableWidth: 120, styles: { fontSize: 10, cellPadding: 1.4, textColor: [30, 30, 30] },
                    columnStyles: { 0: { textColor: gris, cellWidth: 45 } },
                    body: [['N° de orden', d.numero], ['Fecha', fecha], ['Entregar en', d.oficina], ['Moneda', 'Pesos']].map(function(r){ return [txtPdf(r[0]), txtPdf(r[1])]; }) });
    y = doc.lastAutoTable.finalY + 8;
    doc.setFont('helvetica', 'bold'); doc.setTextColor.apply(doc, azul); doc.text('PRODUCTOS', m, y);
    doc.autoTable({ startY: y + 3, margin: { left: m, right: m }, head: [['Descripción', 'Cantidad', 'Precio unitario', 'Total']],
                    body: (d.renglones || []).map(function(r){ return [txtPdf(r.texto), numPdf(r.cantidad, 0), '$ ' + numPdf(r.precio, 2), '$ ' + numPdf(r.importe, 2)]; }),
                    styles: { fontSize: 10, cellPadding: 2, lineColor: [215, 215, 215], lineWidth: 0.2 }, headStyles: { fillColor: azul, textColor: 255, fontStyle: 'bold' },
                    columnStyles: { 1: { halign: 'right', cellWidth: 25 }, 2: { halign: 'right', cellWidth: 35 }, 3: { halign: 'right', cellWidth: 35, fontStyle: 'bold' } },
                    didParseCell: function(c){ if(c.section === 'head' && c.column.index > 0) c.cell.styles.halign = 'right'; } });
    y = doc.lastAutoTable.finalY + 6;
    [['Subtotal (sin IVA)', d.subtotal], ['IVA ' + String(d.ivaPorc).replace('.', ',') + ' %', d.iva], ['Total', d.total]].forEach(function(t, i){
      var ult = i === 2;
      doc.setFont('helvetica', ult ? 'bold' : 'normal'); doc.setFontSize(ult ? 12 : 10); doc.setTextColor(30, 30, 30);
      doc.text(txtPdf(t[0]), ancho - m - 45, y, { align: 'right' }); doc.text('$ ' + numPdf(t[1], 2), ancho - m, y, { align: 'right' });
      y += ult ? 9 : 6;
    });
    if(y > 255){ doc.addPage(); y = 20; }
    doc.setFillColor(240, 242, 247); doc.setDrawColor.apply(doc, azul); doc.rect(m, y, ancho - 2 * m, 16, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor.apply(doc, azul);
    doc.text(txtPdf('Por favor, indicá en la factura el N° de orden ' + d.numero + (d.mailFacturas ? ' y enviala a ' + d.mailFacturas + '.' : '.')), m + 4, y + 9.5, { maxWidth: ancho - 2 * m - 8 });
    y += 24;
    if(d.autorizo){ doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(30, 30, 30); doc.text(txtPdf('Autorizó: ' + d.autorizo), m, y); }
    return doc.output('datauristring').split(',')[1];
  }

  function abrir(){
    pintar();
    var viejo = !S.r || !S.r.llego || Date.now() - new Date(S.r.llego).getTime() > 60000;
    if(viejo) cargar();
  }

  window.ConsumoMensual = { abrir: abrir, calcular: calcular, necesidadCalculada: necesidadCalculada, jmParaTotal: jmParaTotal, numeroEscrito: numeroEscrito, armarOrdenStockPDF: armarOrdenStockPDF };
})();
