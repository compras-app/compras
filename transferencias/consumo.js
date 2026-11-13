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

  var S = { r: null, cargando: false, error: '', parte: 'faltantes', junto: true, todos: false, buscar: '', foco: null, guardando: 0 };
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
      S.r = { datos: r.datos, meses: r.meses, necesidad: r.necesidad || {}, llego: new Date().toISOString() };
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
    if(!S.foco && act && act.classList && act.classList.contains('cm-in') && host.contains(act)) S.foco = act.dataset.k;
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
      if(S.guardando) h.push('<span class="contado">guardando…</span>');
    }
    h.push('</div>');
    if(S.parte === 'necesidad') h.push('<p class="nota">Necesidad = consumo por mes × meses − existencias de hoy (para arriba, a unidades enteras). ' +
      'LC 50 y CASA se calculan juntas y se reparte lo que hay que comprar para que las dos queden con lo mismo. ' +
      'La necesidad se cambia a mano (con ↓ o Enter pasás al siguiente)' + (S.junto ? '; en "Todo junto", el cambio va a Oficina JM' : '') +
      '. Lo cambiado a mano queda guardado para todos hasta que lo borres.</p>');
    h.push('</div>');

    var l = filas();
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

  function tablaNecesidad(l, o){
    var de = function(x){ return o ? x.of[o.id] : x.total; };
    var ver = l.filter(function(x){ var y = de(x); return S.todos ? (y.consumo || y.existencia || y.necesidad) : (y.necesidad > 0 || y.aMano); });
    var h = ['<div class="cm-bloque">'];
    if(o) h.push(tituloOficina(o));
    var meses = n(S.r.meses);
    h.push('<div class="tablewrap on cm-tabla"><table><thead><tr><th class="name">Producto</th><th>Consumo en ' + fmt(meses) + (meses === 1 ? ' mes' : ' meses') + '</th><th>Existencia</th>' +
           '<th class="cm-nec">Necesidad</th><th>Precio última compra</th></tr></thead><tbody>');
    if(!ver.length) h.push('<tr><td colspan="5" class="name cm-vacio">' + (S.buscar ? 'Nada con eso.' : 'No hace falta comprar nada para ' + fmt(meses) + (meses === 1 ? ' mes.' : ' meses.')) + '</td></tr>');
    var total = 0, conPrecio = 0;
    ver.forEach(function(x){
      var y = de(x), k = (o ? o.id : 'T') + '|' + x.cod;
      if(x.precio !== null){ total += y.necesidad * x.precio; conPrecio++; }
      var marca = y.aMano ? '<button type="button" class="cm-amano" data-cm-volver="' + esc(k) + '" title="Cambiado a mano' +
        (o && y.quien ? ' por ' + esc(y.quien) : '') + '. Calculado: ' + fmt(y.calculada) + '. Tocá para volver a lo calculado.">✏️ ↺</button>' : '';
      h.push('<tr' + (y.aMano ? ' class="cm-mano"' : '') + '>' + celdaProducto(x) + '<td>' + fmt(redondo(y.consumo * meses)) + '</td><td>' + fmt(y.existencia) + '</td>' +
             '<td class="cm-nec">' + marca + '<input class="ajuste cm-in" type="text" inputmode="decimal" autocomplete="off" data-k="' + esc(k) + '" value="' + esc(fmt(y.necesidad)) + '"></td>' +
             '<td' + (x.precio === null ? ' class="zero"' : '') + '>' + (x.precio === null ? '—' : plata(x.precio)) + '</td></tr>');
    });
    h.push('</tbody>');
    if(ver.length) h.push('<tfoot><tr><td class="name">' + ver.length + ' productos</td><td></td><td></td><td></td><td>' +
      (conPrecio ? '≈ ' + plata(total) : '') + '</td></tr></tfoot>');
    h.push('</table></div>');
    if(ver.length && conPrecio) h.push('<p class="cm-pie">≈ necesidad × precio de la última compra' + (conPrecio < ver.length ? (ver.length - conPrecio === 1 ? ' (sin 1 que no tiene precio)' : ' (sin los ' + (ver.length - conPrecio) + ' que no tienen precio)') : '') + '.</p>');
    h.push('</div>');
    return h.join('');
  }

  function conectar(){
    var rec = $('cmrecargar'), bus = $('cmbuscar'), tod = $('cmtodos'), mes = $('cmmeses'), bor = $('cmborrar');
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
        var m = Number(String(mes.value).trim().replace(',', '.'));
        if(!isFinite(m) || m <= 0 || m > 24){ mes.value = fmt(S.r.meses); alert('Los meses tienen que ser entre 0,5 y 24.'); return; }
        m = Math.round(m * 2) / 2 || 0.5;
        if(m === n(S.r.meses)){ mes.value = fmt(m); return; }
        guardar({ meses: m }, function(){ S.r.meses = m; });
      };
    }
    if(bor) bor.onclick = function(){
      var k = Object.keys(S.r.necesidad || {}).length;
      if(!confirm('¿Borrar lo cambiado a mano (' + k + (k === 1 ? ' producto' : ' productos') + ')? Vuelve a lo calculado para todos los admins.')) return;
      var antes = JSON.parse(JSON.stringify(S.r.necesidad || {}));
      guardar(null, function(){ S.r.necesidad = {}; }, true, antes);
    };
    [].forEach.call(document.querySelectorAll('[data-cm-volver]'), function(x){
      x.onclick = function(){ cambiarNecesidad(x.getAttribute('data-cm-volver'), null); };
    });
    var ins = [].slice.call(document.querySelectorAll('input.cm-in'));
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
    if(S.foco){
      var f = ins.filter(function(x){ return x.dataset.k === S.foco; })[0];
      S.foco = null;
      if(f){ f.focus(); f.select(); f.scrollIntoView({ block: 'nearest' }); }
    }
  }

  // Lo escrito en un casillero; true si cambió algo (se vuelve a pintar)
  function tomar(inp){
    var t = String(inp.value).trim(), v = t === '' ? 0 : Number(t.replace(/\./g, '').replace(',', '.'));
    if(!isFinite(v) || v < 0){ inp.value = ''; alert('La necesidad tiene que ser un número de 0 para arriba.'); return false; }
    var x = productoDe(inp.dataset.k);
    if(!x) return false;
    var ofi = inp.dataset.k.split('|')[0], ahora = ofi === 'T' ? x.total.necesidad : x.of[ofi].necesidad;
    if(redondo(v) === redondo(ahora)) return false;
    cambiarNecesidad(inp.dataset.k, v);
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
    var antes = JSON.parse(JSON.stringify(S.r.necesidad || {}));
    cambios.forEach(function(c){
      var kk = c.oficina + '|' + c.codigo;
      if(c.v === null) delete S.r.necesidad[kk]; else S.r.necesidad[kk] = { v: c.v, quien: 'vos', cuando: new Date().toISOString() };
    });
    guardar({ necesidad: cambios }, null, false, antes);
  }

  /* Manda al servidor; mientras, la pantalla ya muestra el cambio. borrar: "Borrar lo cambiado a mano". */
  async function guardar(c, alGuardar, borrar, antes){
    var antesMeses = S.r.meses;
    if(alGuardar) alGuardar();
    S.guardando++; pintar();
    var r = borrar ? await api('borrarCompraStock') : await api('guardarCompraStock', c);
    S.guardando--;
    if(r && r.ok !== false && r.necesidad){
      S.r.necesidad = r.necesidad; S.r.meses = r.meses; S.error = '';
      try { localStorage.setItem(GUARDA, JSON.stringify(S.r)); } catch(e){}
    } else {
      if(antes) S.r.necesidad = antes;
      S.r.meses = antesMeses;
      S.error = r && r.sinConexion ? 'Hace falta señal para guardar el cambio: no se guardó.' : 'No se guardó el cambio: ' + ((r && r.error) || '');
    }
    pintar();
  }

  function abrir(){
    pintar();
    var viejo = !S.r || !S.r.llego || Date.now() - new Date(S.r.llego).getTime() > 60000;
    if(viejo) cargar();
  }

  window.ConsumoMensual = { abrir: abrir, calcular: calcular, necesidadCalculada: necesidadCalculada, jmParaTotal: jmParaTotal };
})();
