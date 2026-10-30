'use strict';
/* ============================================================
   FASE 6, PASO 1 (Feli, 28/10): padrones de las órdenes de compra
   ------------------------------------------------------------
   Solo los de "Ven lo de la Fase 6" (APP.yo.fase6), mientras se prueba.
   - Admin → 📒 Cuentas contables: las 51 cuentas con sus centros de
     costos y el insumo de Albor de cada uno, quién ve cada cuenta
     (además de los admins), activa o no, y el sitio de cada centro.
   - Admin → 🚜 Bienes de uso: vehículos y generadores.
   - Admin → Ajustes: la lista "Ven lo de la Fase 6".
   Como el resto de Admin, todo va directo (con señal), no por la bandeja.
   ============================================================ */

const CU = { datos: null, bienes: null, unidadesArmadas: false };
const NOMBRE_UNIDAD = { GAN: 'Ganadería porcina', AGR: 'Agricultura', MAQ: 'Maquinaria', EST: 'Estructura', ADM: 'Administración', PAB: 'Planta de alimento balanceado' };

pantalla('cuentas', { titulo: 'Cuentas contables', tab: 'admin', alMostrar: mostrarCuentas });
pantalla('bienes', { titulo: 'Bienes de uso', tab: 'admin', alMostrar: mostrarBienes });

/* ============================================================
   CUENTAS CONTABLES
   ============================================================ */
async function mostrarCuentas() {
  if (!CU.datos) notaAd('cu-estado', 'Cargando…');
  else pintarCuentas();
  const r = await api('getCuentasF6');
  if (r.ok) { CU.datos = r; notaAd('cu-estado', ''); pintarCuentas(); }
  else if (!CU.datos) notaAd('cu-estado', textoDeError(r));
}

/** Lo que devuelve el servidor después de cada cambio es la lista entera: se pinta de nuevo. */
function cuentasCambiadas(r, texto) {
  if (!r.ok) { aviso(textoDeError(r), 'bad'); return false; }
  CU.datos = r;
  pintarCuentas();
  aviso(texto);
  return true;
}

function pintarCuentas() {
  const d = CU.datos;
  if (!d) return;
  if (!CU.unidadesArmadas) {
    CU.unidadesArmadas = true;
    const us = [];
    d.cuentas.forEach(function (c) { if (us.indexOf(c.unidad) === -1) us.push(c.unidad); });
    $('cu-unidad').innerHTML = '<option value="">Todas las unidades</option>' +
      us.map(function (u) { return '<option value="' + esc(u) + '">' + esc(u + ' · ' + (NOMBRE_UNIDAD[u] || u)) + '</option>'; }).join('');
  }
  const q = sinTildes($('cu-q').value.trim()), unidad = $('cu-unidad').value;
  const l = d.cuentas.filter(function (c) {
    if (unidad && c.unidad !== unidad) return false;
    return !q || sinTildes(c.codigo + ' ' + c.nombre + ' ' + c.ven.join(' ') + ' ' + c.centros.map(function (x) { return x.centro + ' ' + x.insumo; }).join(' ')).indexOf(q) !== -1;
  });
  const cont = $('cu-lista'), abiertos = {};
  cont.querySelectorAll('details[open]').forEach(function (x) { abiertos[x.dataset.cod] = true; });
  notaAd('cu-estado', l.length + (l.length === 1 ? ' cuenta' : ' cuentas'));
  cont.innerHTML = l.map(function (c) {
    return '<details class="ad-item' + (c.activa ? '' : ' baja') + '" data-cod="' + esc(c.codigo) + '"' + (abiertos[c.codigo] ? ' open' : '') + '>' +
      '<summary><span class="ad-nom"><b>' + esc(c.nombre) + '</b>' +
        '<small>' + esc(c.codigo) + ' · ' + c.centros.length + (c.centros.length === 1 ? ' centro de costos' : ' centros de costos') +
        ' · ' + (c.ven.length ? 'La ven ' + esc(c.ven.join(', ')) : 'Solo admins') + (c.activa ? '' : ' · Desactivada') + '</small></span>' +
        (c.predeterminada ? '<span class="tag admin">Viene elegida</span>' : '') + '</summary>' +
      '<div class="ad-cuerpo">' +
        '<h3>Centros de costos e insumo de Albor</h3>' +
        '<ul class="cu-centros">' + c.centros.map(function (x) {
          return '<li><b>' + esc(x.centro) + '</b> <small>→ ' + esc(x.sitio || 'sin sitio') + '</small><br><small>' + esc(x.insumo) + ' · ' + esc(x.nombreInsumo) + '</small></li>';
        }).join('') + '</ul>' +
        '<h3>Quiénes la ven</h3>' +
        '<p class="nota">Además de los admins, que ven todas.</p>' +
        '<div class="pr-rubros" data-ven="' + esc(c.codigo) + '">' + d.personas.concat(c.ven.filter(function (n) { return d.personas.indexOf(n) === -1; })).map(function (n) {
          return '<button type="button" class="chip-sel" data-n="' + esc(n) + '" aria-pressed="' + (c.ven.indexOf(n) !== -1) + '">' + esc(n) + '</button>';
        }).join('') + '</div>' +
        (c.predeterminada ? '<p class="nota">Es la cuenta que viene elegida para todos los que no tienen una propia.</p>' : '') +
        (c.elegidaPor.length ? '<p class="nota">Le viene elegida a ' + esc(c.elegidaPor.join(', ')) + ' (se cambia en Personas).</p>' : '') +
        '<div class="ad-acciones">' +
          '<button type="button" class="btn2" data-guardar-ven="' + esc(c.codigo) + '" disabled>Guardar quiénes la ven</button>' +
          (c.activa ? (c.predeterminada ? '' : '<button type="button" class="btn2 peligro-btn2" data-activa="' + esc(c.codigo) + '" data-valor="0">Desactivar</button>')
                    : '<button type="button" class="btn2" data-activa="' + esc(c.codigo) + '" data-valor="1">Activar</button>') +
        '</div>' +
      '</div></details>';
  }).join('') || '<p class="nota">No hay cuentas con eso.</p>';

  cont.querySelectorAll('[data-ven]').forEach(function (caja) {
    const boton = cont.querySelector('[data-guardar-ven="' + caja.dataset.ven + '"]');
    caja.querySelectorAll('[data-n]').forEach(function (b) {
      b.addEventListener('click', function () {
        b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
        boton.disabled = false;
      });
    });
    boton.addEventListener('click', async function () {
      const ven = [].map.call(caja.querySelectorAll('[aria-pressed="true"]'), function (x) { return x.dataset.n; });
      boton.disabled = true;
      cuentasCambiadas(await api('guardarCuentaF6', caja.dataset.ven, { ven: ven }), 'Listo: se guardó quiénes la ven.') || (boton.disabled = false);
    });
  });
  cont.querySelectorAll('[data-activa]').forEach(function (b) {
    b.addEventListener('click', async function () {
      const activa = b.dataset.valor === '1';
      if (!activa) {
        const si = await dialogo({ titulo: '¿Desactivar la cuenta?', texto: 'Deja de aparecer en el formulario. Los pedidos que ya la tienen quedan como están. Se puede volver a activar.',
          botones: [{ texto: 'Sí, desactivar', clase: 'btn peligro-btn', valor: true }, { texto: 'Volver', valor: null }] });
        if (!si) return;
      }
      cuentasCambiadas(await api('guardarCuentaF6', b.dataset.activa, { activa: activa }), activa ? 'Listo: la cuenta está activa.' : 'Listo: la cuenta quedó desactivada.');
    });
  });
  pintarSitiosCentros();
}

/** El sitio de cada centro de costos: un desplegable por centro (cambia en todas las cuentas que lo tienen). */
function pintarSitiosCentros() {
  const d = CU.datos;
  $('cu-centros').innerHTML = d.centros.map(function (c, i) {
    const sitios = d.sitios.indexOf(c.sitio) === -1 && c.sitio ? [c.sitio].concat(d.sitios) : d.sitios;
    return '<div class="ad-item ad-granja"><span class="ad-nom"><b>' + esc(c.unidad + ' · ' + c.centro) + '</b>' +
      '<small>' + c.cuentas + (c.cuentas === 1 ? ' cuenta' : ' cuentas') + '</small></span>' +
      '<select data-centro="' + i + '" aria-label="Sitio de ' + esc(c.centro) + '">' + (c.sitio ? '' : '<option value="">Elegir…</option>') +
        sitios.map(function (s) { return '<option' + (s === c.sitio ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></div>';
  }).join('');
  $('cu-centros').querySelectorAll('[data-centro]').forEach(function (sel) {
    sel.addEventListener('change', async function () {
      const c = d.centros[Number(sel.dataset.centro)];
      sel.disabled = true;
      const r = await api('guardarSitioCentroF6', c.unidad, c.idCentro, sel.value);
      if (!cuentasCambiadas(r, 'Listo: los pedidos de ' + c.centro + ' van a ' + sel.value + '.')) { sel.value = c.sitio; sel.disabled = false; }
    });
  });
}

$('cu-q').addEventListener('input', pintarCuentas);
$('cu-unidad').addEventListener('change', pintarCuentas);

/* ============================================================
   BIENES DE USO
   ============================================================ */
async function mostrarBienes() {
  if (!CU.bienes) notaAd('bi-estado', 'Cargando…');
  else pintarBienes();
  const r = await api('getBienesUso');
  if (r.ok) { CU.bienes = r; notaAd('bi-estado', ''); pintarBienes(); }
  else if (!CU.bienes) notaAd('bi-estado', textoDeError(r));
}

function pintarBienes() {
  const l = CU.bienes.bienes;
  $('bi-lista').innerHTML = l.map(function (b) {
    return '<button type="button" class="ad-item ad-fila' + (b.activo ? '' : ' baja') + '" data-id="' + esc(b.id) + '">' +
      '<span class="ad-nom"><b>' + esc(b.nombre) + '</b>' +
      '<small>' + esc([b.patente, b.sitio].filter(Boolean).join(' · ')) + (b.activo ? '' : ' · Dado de baja') + '</small></span>' +
      '<span class="ad-flecha" aria-hidden="true">›</span></button>';
  }).join('') || '<p class="nota">Todavía no hay ninguno.</p>';
  $('bi-lista').querySelectorAll('[data-id]').forEach(function (x) {
    x.addEventListener('click', function () { editarBien(l.filter(function (b) { return b.id === x.dataset.id; })[0]); });
  });
}
$('bi-nuevo').addEventListener('click', function () { if (CU.bienes) editarBien(null); });

/** Alta (b = null) o cambio. previo: lo escrito, si el servidor no lo aceptó. */
async function editarBien(b, previo) {
  const v = previo || { nombre: b ? b.nombre : '', patente: b ? b.patente : '', sitio: b ? b.sitio : '', activo: b ? b.activo : true };
  const sitios = CU.bienes.sitios;
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = campoDlg('bi-nombre', 'Nombre', v.nombre, { max: 80, placeholder: 'Ej: Camioneta Hilux blanca' }) +
    campoDlg('bi-patente', 'Patente o número de identificación', v.patente, { max: 30, placeholder: 'Ej: AB123CD' }) +
    '<div class="campo"><label for="bi-sitio">Sitio</label><select id="bi-sitio"><option value="">—</option>' +
      sitios.map(function (s) { return '<option' + (s === v.sitio ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></div>' +
    '<label class="check"><input type="checkbox" id="bi-activo"> Activo (si no, no aparece en el formulario)</label>';
  const datos = await dialogo({
    titulo: b ? b.nombre : 'Agregar bien de uso', cuerpo: cuerpo,
    botones: [{ texto: 'Guardar', clase: 'btn', id: 'dg-ok', valor: function () {
      return { id: b ? b.id : '', nombre: $('bi-nombre').value.trim(), patente: $('bi-patente').value.trim(), sitio: $('bi-sitio').value, activo: $('bi-activo').checked };
    } }, { texto: 'Volver', valor: null }],
    alAbrir: function () {
      $('bi-activo').checked = v.activo !== false;
      const revisar = function () { $('dg-ok').disabled = $('bi-nombre').value.trim().length < 2 || !$('bi-patente').value.trim(); };
      $('bi-nombre').addEventListener('input', revisar);
      $('bi-patente').addEventListener('input', revisar);
      revisar();
      if (!b) $('bi-nombre').focus();
    }
  });
  if (!datos) return;
  aviso('Guardando…');
  const r = await api('guardarBienUso', datos);
  if (!r.ok) { aviso(textoDeError(r), 'bad'); return editarBien(b, datos); }
  CU.bienes = r;
  pintarBienes();
  aviso('Listo: se guardó ' + datos.nombre + '.');
}

/* ============================================================
   AJUSTES: "Ven lo de la Fase 6" (la llama pintarAjustes de admin.js)
   ============================================================ */
function pintarAjustesF6() {
  const f = AD.ajustes && AD.ajustes.fase6;
  $('aj-f6').hidden = !f;
  if (!f || CU.f6Pintado) return;                 // se llena una vez, para no pisar lo que se está tildando
  CU.f6Pintado = true;
  const ps = f.personas.slice();
  f.ven.forEach(function (n) { if (ps.indexOf(n) === -1) ps.push(n); });
  $('aj-f6-msj').value = f.msjOrden || '';
  $('aj-f6-mail').value = f.mailFacturas || '';
  $('aj-f6-ven').innerHTML = ps.map(function (n) {
    return '<label class="pa-check"><input type="checkbox" value="' + esc(n) + '"' + (f.ven.indexOf(n) !== -1 ? ' checked' : '') + '> ' + esc(n) + '</label>';
  }).join('');
}
$('aj-f6-ok').addEventListener('click', async function () {
  const l = [].map.call(document.querySelectorAll('#aj-f6-ven input:checked'), function (x) { return x.value; });
  const r = await api('guardarF6Ven', l);
  if (!r.ok) return aviso(textoDeError(r), 'bad');
  AD.ajustes.fase6.ven = r.f6Ven;
  aviso('Listo: lo de la Fase 6 lo ven ' + r.f6Ven.join(', ') + '. A los demás les aparece la próxima vez que abran la app.');
});

/* Paso 5 (Feli, 29/10): el mensaje de la orden, el mail para las facturas y los pedidos de prueba */
$('aj-f6-msj-ok').addEventListener('click', async function () {
  const r = await api('guardarTextoOrden', { msj: $('aj-f6-msj').value.trim(), mail: $('aj-f6-mail').value.trim() });
  if (!r.ok) return aviso(textoDeError(r), 'bad');
  AD.ajustes.fase6.msjOrden = r.msjOrden;
  AD.ajustes.fase6.mailFacturas = r.mailFacturas;
  aviso('Listo: se guardó el mensaje de la orden de compra.');
});
$('aj-f6-pruebas').addEventListener('click', async function () {
  const b = this;
  b.disabled = true;
  aviso('Armando los pedidos de prueba…');
  const r = await apiLenta('crearPruebasF6');
  b.disabled = false;
  if (!r.ok) return aviso(textoDeError(r), 'bad');
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = '<p class="nota">Están en Decisión de Compras, con su presupuesto revisado. Abrí cada uno → "📊 Cuadro comparativo de compra" → "🛒 Realizar la compra".</p><ul>' +
    r.hechos.map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ul>';
  await dialogo({ titulo: 'Listo: pedidos de prueba armados', cuerpo: cuerpo, botones: [{ texto: 'Entendido', clase: 'btn', valor: true }] });
  if (typeof cargarTablero === 'function') cargarTablero();
});
$('aj-f6-borrar').addEventListener('click', async function () {
  const si = await dialogo({ titulo: '¿Borrar todos los pedidos de prueba?', texto: 'Se borran enteros todos los "PRUEBA - N" (pedidos, productos, presupuestos, compras y órdenes de la app). Las órdenes de prueba que estén en Albor se borran a mano allá. No se puede deshacer.',
    botones: [{ texto: 'Volver', valor: null }, { texto: 'Sí, borrarlos', clase: 'btn peligro-btn', valor: true }] });
  if (!si) return;
  aviso('Borrando…');
  const r = await apiLenta('borrarPruebasF6');
  if (!r.ok) return aviso(textoDeError(r), 'bad');
  aviso('Listo: se borraron ' + r.borrados + ' pedidos de prueba.');
  if (typeof cargarTablero === 'function') cargarTablero();
});

/* ============================================================
   La cuenta o el bien de uso en la tarjeta abierta de Compras (Feli, 29/10)
   Se ven y se cambian (mientras se prueba, solo los de "Ven lo de la Fase 6"). En una tarjeta de seguimiento, los de
   cada pedido. Con un bien de uso, el pedido no lleva cuenta; con una cuenta, el sitio sale del centro de costos.
   ============================================================ */
function pintarImputacion() {
  const b = $('tj-cuenta-b');
  if (!b) return;
  const d = TB.detalle, im = d && d.imputacion;
  b.hidden = !im || !im.length || TB.tipo === 'tarea';
  if (b.hidden) return;
  const varios = im.length > 1;
  $('tj-cuenta').innerHTML = im.map(function (x) {
    const c = x.cuenta || {};
    return '<div class="imp-fila">' + (varios ? '<div class="imp-ped">' + esc(x.prueba || x.titulo || x.ref) + '</div>' : '') +
      '<div class="imp-cta' + (c.tipo === 'sin' ? ' sin' : '') + '">' + esc(c.texto || 'Sin cuenta contable') + '</div>' +
      '<button type="button" class="btn-chico" data-imp="' + esc(x.ref) + '">✏️ Cambiar</button></div>';
  }).join('');
  $('tj-cuenta').querySelectorAll('[data-imp]').forEach(function (x) { x.addEventListener('click', function () { cambiarImputacionUI(x.dataset.imp); }); });
}

async function cambiarImputacionUI(ref) {
  const abierta = TB.abierta, x = (TB.detalle.imputacion || []).filter(function (i) { return i.ref === ref; })[0];
  if (!x) return;
  aviso('Un momento…');
  const op = await api('opcionesImputacion');
  if (!op.ok) return aviso(op.sinConexion ? '📶 Hace falta señal para cambiar la cuenta.' : op.error, 'bad');
  const ok = await elegirImputacion(op, { bien: x.bien, cuenta: x.cuenta && x.cuenta.cuenta, centro: x.cuenta && x.cuenta.centro },
                                    'Cambiar la cuenta de ' + (x.prueba || x.titulo || x.ref), 'El sitio queda como está (' + (x.sitio || '—') + ').');
  if (!ok) return;
  aviso('Guardando…');
  const r = await api('cambiarImputacion', ref, ok);
  if (!r.ok) return aviso(r.sinConexion ? '📶 Hace falta señal para cambiar la cuenta.' : r.error, 'bad');
  aviso(r.aviso ? 'Listo. ' + r.aviso : 'Listo: se cambió la cuenta.', r.aviso ? 'bad' : '');
  if (TB.abierta === abierta) traerTarjeta(abierta);
}

/** La ventanita para elegir la cuenta y el centro de costos, o un bien de uso. op = opcionesImputacion; ini = {cuenta, centro, bien}.
 *  Devuelve {cuenta, centro, sitio} o {bienUso}, o null. La usan la tarjeta abierta y el pedido masivo (Fase 6, 30/10). */
function elegirImputacion(op, ini, titulo, notaSitio) {
  ini = ini || {};
  let modo = ini.bien ? 'bien' : 'cuenta', cuenta = ini.cuenta || '', centro = ini.centro || '', bien = ini.bien || '', sitio = '';
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = '<div class="seg-imp"><label><input type="radio" name="imp-modo" value="cuenta"> Cuenta contable</label>' +
    '<label><input type="radio" name="imp-modo" value="bien"> 🚜 Bien de uso</label></div>' +
    '<div id="imp-c"><div class="campo"><label for="imp-cuenta">Cuenta contable</label><select id="imp-cuenta"></select></div>' +
    '<div class="campo"><label for="imp-centro">Centro de costos</label><select id="imp-centro"></select><p class="nota" id="imp-sitio"></p></div></div>' +
    '<div id="imp-b"><div class="campo"><label for="imp-bien">Bien de uso</label><select id="imp-bien"></select>' +
    '<p class="nota">Un pedido para un bien de uso no lleva cuenta ni orden de compra.' + (notaSitio ? ' ' + esc(notaSitio) : '') + '</p></div></div>';
  return dialogo({ titulo: titulo, cuerpo: cuerpo,
    botones: [{ texto: 'Volver', valor: null }, { texto: 'Guardar', clase: 'btn', id: 'dg-ok', valor: function () {
      return modo === 'bien' ? { bienUso: bien } : { cuenta: cuenta, centro: centro, sitio: sitio };
    } }],
    alAbrir: function () {
      const pintar = function () {
        cuerpo.querySelector('input[value="' + modo + '"]').checked = true;
        $('imp-c').hidden = modo !== 'cuenta';
        $('imp-b').hidden = modo !== 'bien';
        $('imp-cuenta').innerHTML = (cuenta ? '' : '<option value="">Elegí la cuenta</option>') +
          op.cuentas.map(function (c) { return '<option value="' + esc(c.codigo) + '">' + esc(c.nombre) + '</option>'; }).join('');
        $('imp-cuenta').value = cuenta;
        const cs = (op.cuentas.filter(function (c) { return c.codigo === cuenta; })[0] || {}).centros || [];
        if (cs.length === 1) centro = cs[0].centro;
        if (!cs.some(function (c) { return c.centro === centro; })) centro = '';
        $('imp-centro').innerHTML = (centro ? '' : '<option value="">Elegí el centro de costos</option>') +
          cs.map(function (c) { return '<option value="' + esc(c.centro) + '">' + esc(c.centro) + '</option>'; }).join('');
        $('imp-centro').value = centro;
        const cc = cs.filter(function (c) { return c.centro === centro; })[0];
        sitio = cc ? cc.sitio : '';
        $('imp-sitio').textContent = cc ? 'El pedido queda en ' + cc.sitio + '.' : '';
        $('imp-bien').innerHTML = (bien ? '' : '<option value="">Elegí el bien de uso</option>') +
          op.bienes.map(function (b) { return '<option value="' + esc(b.id) + '">' + esc(b.nombre + (b.patente ? ' · ' + b.patente : '')) + '</option>'; }).join('');
        $('imp-bien').value = bien;
        $('dg-ok').disabled = modo === 'bien' ? !bien : !(cuenta && centro);
      };
      cuerpo.querySelectorAll('input[name="imp-modo"]').forEach(function (r) { r.addEventListener('change', function () { modo = r.value; pintar(); }); });
      $('imp-cuenta').addEventListener('change', function () { cuenta = this.value; centro = ''; pintar(); });
      $('imp-centro').addEventListener('change', function () { centro = this.value; pintar(); });
      $('imp-bien').addEventListener('change', function () { bien = this.value; pintar(); });
      pintar();
    } });
}
