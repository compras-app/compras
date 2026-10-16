'use strict';
/* ============================================================
   REPORTES (Fase 5, Paso 4; Feli, 9/10 y 10/10): Admin → Reportes
   ------------------------------------------------------------
   Pestañas: Resumen, Consumo mensual (13/10: los egresos del último mes contra
   la existencia de cada oficina: JM, LC 50 y CASA), Flujo de tarjetas, Gastos,
   Proveedores, Padrón y Egresos (13/10, con el precio de Albor).
   - Se arman con un botón, nunca solos (Feli), y se bajan a Excel (el Resumen no).
   - Los mismos filtros arriba: fechas (desde hace un mes), granja (sitio), rubro
     y comprador; en Flujo, también qué tablero. Lo de prueba no entra nunca.
   - Las cuentas las hace la base (getReporte → reportes.armar). Acá solo se
     dibujan: cada pestaña arma una lista de tablas ({titulo, nota, cab,
     filas}) que sirve para la pantalla y para el Excel.
   - Lo ven todos los admins; el gerente es admin.
   ============================================================ */

const RP = { pestana: 'resumen', datos: {}, filtros: null, armando: false, vista: 'detallado' };
const RP_PESTANAS = [                                     // nombres de Feli (13/10)
  { id: 'resumen', nombre: 'Resumen' }, { id: 'stock', nombre: 'Consumo mensual' }, { id: 'flujo', nombre: 'Flujo de tarjetas' },
  { id: 'plata', nombre: 'Gastos' }, { id: 'proveedores', nombre: 'Proveedores' }, { id: 'padron', nombre: 'Padrón' },
  { id: 'egresos', nombre: 'Egresos' },                   // Feli (13/10): lo egresado de cada granja (Transferencias)
  { id: 'historial', nombre: 'Historial' }                // Feli (13/10): los reportes que se guardan solos el último día de cada mes
];
const MESES_RP = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function nombreMes(m) { const x = String(m).split('-'); return MESES_RP[Number(x[1]) - 1] + ' ' + x[0]; }
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

pantalla('reportes', { titulo: 'Reportes', tab: 'admin', alMostrar: mostrarReportes });

function hoyAr() { return new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10); }
function haceDias(n) { return new Date(Date.now() - 3 * 36e5 - n * 864e5).toISOString().slice(0, 10); }
/** El mismo día del mes pasado (Feli, 13/10: los reportes salen del último mes exacto); el 31 de marzo → el 28 de febrero. */
function haceUnMes() {
  const d = new Date(hoyAr() + 'T12:00:00Z'), dia = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
  d.setUTCDate(Math.min(dia, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
}
function nro(n, dec) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec === undefined ? 1 : dec });
}
function dias(n) { return n === null || n === undefined ? '—' : nro(n, 1) + (Number(n) === 1 ? ' día' : ' días'); }
function plata(t, moneda) { return (moneda === 'USD' ? 'US$ ' : '$ ') + nro(t, 0); }
function fechaCorta(iso) { if (!iso) return '—'; const d = String(iso).slice(0, 10).split('-'); return d[2] + '/' + d[1] + '/' + d[0].slice(2); }

function mostrarReportes() {
  if (!RP.filtros) {
    RP.filtros = { desde: haceUnMes(), hasta: hoyAr(), sitio: '', rubro: '', comprador: '', tablero: 'compras' };
    $('rp-desde').value = RP.filtros.desde;
    $('rp-hasta').value = RP.filtros.hasta;
    $('rp-sitio').innerHTML = '<option value="">Todas</option>' + ((APP.config && APP.config.sitios) || []).map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
    $('rp-comprador').innerHTML = '<option value="">Todos</option>' + ((APP.config && APP.config.admins) || []).map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
  }
  pintarPestanasRp();
  pintarReporte();
}

function pintarPestanasRp() {
  $('rp-pestanas').innerHTML = RP_PESTANAS.map(function (p) {
    return '<button type="button" class="rp-pest' + (p.id === RP.pestana ? ' on' : '') + '" data-p="' + p.id + '">' + esc(p.nombre) + '</button>';
  }).join('');
  $('rp-tablero-l').hidden = RP.pestana !== 'flujo';
  // Egresos: solo fechas y granja (no tiene rubro ni comprador). Consumo mensual: sin filtros (el mes y las oficinas son fijos),
  // con "Ver: Resumen / Detallado". Historial y lo guardado: sin filtros ni "Armar reporte" (en Flujo, qué tablero sí).
  const st = RP.pestana === 'stock', fijo = RP.pestana === 'historial' || !!RP.guardado;
  $('rp-rubro').closest('label').hidden = $('rp-comprador').closest('label').hidden = RP.pestana === 'egresos' || st || fijo;
  ['rp-desde', 'rp-hasta', 'rp-sitio'].forEach(function (id) { $(id).closest('label').hidden = st || fijo; });
  if (RP.pestana === 'historial') $('rp-tablero-l').hidden = true;
  $('rp-vista-l').hidden = !st;
  $('rp-armar').hidden = fijo;
  $('rp-excel').hidden = !RP.datos[RP.pestana] || RP.pestana === 'resumen' || RP.pestana === 'historial';     // el Resumen no se baja (Feli, 13/10)
}
$('rp-pestanas').addEventListener('click', function (e) {
  const b = e.target.closest('[data-p]');
  if (!b) return;
  RP.pestana = b.dataset.p;
  pintarPestanasRp();
  pintarReporte();
});

function leerFiltrosRp() {
  return { desde: $('rp-desde').value || '', hasta: $('rp-hasta').value || '', sitio: $('rp-sitio').value, rubro: $('rp-rubro').value,
           comprador: $('rp-comprador').value, tablero: $('rp-tablero').value };
}

async function armarReporte() {
  if (RP.armando) return;
  RP.armando = true;
  const cual = RP.pestana, f = leerFiltrosRp();
  notaAd('rp-estado', 'Armando el reporte…');
  const r = await apiLenta('getReporte', cual, f);
  RP.armando = false;
  if (!r.ok) return notaAd('rp-estado', textoDeError(r));
  notaAd('rp-estado', '');
  RP.datos[cual] = { r: r.reporte, f: f };
  // Los rubros para el filtro salen del padrón (vienen con cada reporte)
  if (r.reporte.rubros && $('rp-rubro').options.length <= 1) {
    const elegido = $('rp-rubro').value;
    $('rp-rubro').innerHTML = '<option value="">Todos</option>' + r.reporte.rubros.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('');
    $('rp-rubro').value = elegido;
  }
  pintarPestanasRp();
  pintarReporte();
}
$('rp-armar').addEventListener('click', armarReporte);
$('rp-vista').addEventListener('change', function () { RP.vista = this.value; pintarReporte(); });
$('rp-tablero').addEventListener('change', function () {                   // lo guardado: Flujo de cada tablero
  if (!RP.guardado) return;
  const fl = (RP.guardado.reportes.flujo || {})[this.value];
  if (fl) RP.datos.flujo = { r: fl, f: {} }; else delete RP.datos.flujo;
  pintarPestanasRp(); pintarReporte();
});

/* ---------- Historial (Feli, 13/10): los reportes que se guardan solos el último día de cada mes ----------
   Al abrir un mes, todas las pestañas muestran lo guardado (con un cartel arriba) hasta "Volver a los de ahora".
   Los que se arman a mano no se guardan. */
async function pintarHistorialRp() {
  const cuerpo = $('rp-cuerpo');
  cuerpo.innerHTML = '<p class="nota">Cargando…</p>';
  const r = await api('getReportesGuardados');
  if (RP.pestana !== 'historial') return;
  if (!r.ok) { cuerpo.innerHTML = '<p class="estado warn">' + esc(textoDeError(r)) + '</p>'; return; }
  cuerpo.innerHTML = '<p class="nota">El último día de cada mes, a las 23:00, se arman solos todos los reportes del mes (del 1 al último día) y quedan acá. ' +
    'Los que armás a mano no se guardan.</p>' +
    (r.meses.length ? '<div class="rp-meses">' + r.meses.map(function (m) {
      return '<button type="button" class="rp-caja" data-mes="' + esc(m.mes) + '"><b>' + esc(nombreMes(m.mes)) + '</b><small>armados el ' +
        new Date(m.armado).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) + '</small></button>';
    }).join('') + '</div>' : '<p class="nota rp-vacio">Todavía no hay ninguno: el primero se guarda el último día de este mes.</p>');
}
async function abrirMesGuardado(mes) {
  notaAd('rp-estado', 'Abriendo ' + nombreMes(mes) + '…');
  const r = await apiLenta('getReporteGuardado', mes);
  if (!r.ok) return notaAd('rp-estado', textoDeError(r));
  notaAd('rp-estado', '');
  if (!RP.guardado) RP.vivos = RP.datos;
  RP.guardado = r.guardado;
  RP.datos = {};
  Object.keys(r.guardado.reportes).forEach(function (k) { if (k !== 'flujo') RP.datos[k] = { r: r.guardado.reportes[k], f: {} }; });
  const fl = (r.guardado.reportes.flujo || {})[$('rp-tablero').value || 'compras'];
  if (fl) RP.datos.flujo = { r: fl, f: {} };
  RP.pestana = 'resumen';
  pintarPestanasRp(); pintarReporte();
}
function volverAhoraRp() {
  RP.guardado = null;
  RP.datos = RP.vivos || {};
  RP.vivos = null;
  pintarPestanasRp(); pintarReporte();
}

/* ---------- Cada pestaña: sus tablas ---------- */
function tablasDe(cual, r) {
  if (cual === 'flujo') return tablasFlujo(r);
  if (cual === 'plata') return tablasPlata(r);
  if (cual === 'proveedores') return tablasProveedores(r);
  if (cual === 'padron') return tablasPadron(r);
  if (cual === 'egresos') return tablasEgresos(r);
  if (cual === 'stock') return tablasStock(r, RP.vista);
  return [];
}

/** Las columnas en el orden del tablero (no en el que entró la primera tarjeta). */
function ordenColumnas(lista) {
  // APP.config.columnas viene con Procesando primero: acá va después de Decisión (es cuando el pedido se divide en tarjetas)
  const cfg = (APP.config && APP.config.columnas) || [];
  const proc = cfg.length ? cfg[0].seccion : '';
  const orden = cfg.filter(function (c) { return c.seccion !== proc; }).map(function (c) { return c.columna; });
  const iDec = orden.indexOf('Decisión');
  Array.prototype.splice.apply(orden, [iDec === -1 ? orden.length : iDec + 1, 0].concat(cfg.filter(function (c) { return c.seccion === proc; }).map(function (c) { return c.columna; })));
  const resto = ['Entrantes', 'Por cotizar', 'Decisión', 'En armado/reparación', 'Para retirar', 'Por hacer', 'En proceso', 'Esperando', 'Finalizados'];
  const pos = function (c) { const i = orden.indexOf(c); return i !== -1 ? i : (resto.indexOf(c) !== -1 ? 100 + resto.indexOf(c) : 999); };
  return lista.slice().sort(function (a, b) { return pos(a.columna) - pos(b.columna); });
}

function tablasFlujo(r) {
  const maxMed = Math.max.apply(null, r.columnas.map(function (c) { return Number(c.mediana) || 0; }).concat([0.1]));
  const nombreTablero = { compras: 'Compras', servicios: 'Servicios', seguimiento: 'Tarjetas de seguimiento', tareas: 'Tareas' }[r.tablero] || r.tablero;
  return [
    { titulo: 'Tiempo en cada columna · ' + nombreTablero,
      nota: 'Lo normal: la mitad de las tarjetas tarda menos que eso (cuentan las que ya salieron de la columna). Días corridos; si una tarjeta volvió a una columna, se suman las veces. ' +
            (r.traba ? 'Donde más tiempo pasan: <b>' + esc(r.traba) + '</b>.' : ''),
      cab: ['Columna', 'Lo normal', '', 'Promedio', 'La más lenta', 'Cuál', 'Pasaron', 'Hoy', 'Promedio por día'],
      barra: 2,
      filas: ordenColumnas(r.columnas).map(function (c) {
        return [c.columna, dias(c.mediana), { barra: (Number(c.mediana) || 0) / maxMed }, dias(c.promedio), dias(c.maximo), c.masLenta || '', nro(c.terminadas), nro(c.hoy), nro(c.promedioPorDia)];
      }), vacio: 'Todavía no hay tarjetas que hayan pasado por las columnas en estas fechas.' },
    { titulo: 'Trabadas ahora', nota: 'Llevan en su columna el doble de lo normal o más (y al menos 2 días). Tocá una para abrirla.',
      cab: ['Tarjeta', 'Qué es', 'Columna', 'Lleva', 'Lo normal'], abrir: 0,
      filas: r.trabadas.map(function (t) { return [t.ref, t.titulo || '', t.columna, dias(t.dias), dias(t.normal)]; }), vacio: 'Ninguna trabada. 👌' },
    { titulo: 'De punta a punta, por urgencia', nota: 'Desde que se pidió hasta que llegó a Entregado (solo Compras).',
      cab: ['Urgencia', 'Pedidos', 'Lo normal', 'Promedio'],
      filas: r.puntaApunta.porUrgencia.map(function (u) { return [u.urgencia || '—', nro(u.n), dias(u.mediana), dias(u.promedio)]; }), vacio: 'Ningún pedido llegó a Entregado en estas fechas.' },
    { titulo: 'De punta a punta, por quién lo pidió', nota: 'Separado por urgencia y rubro, para no comparar jeringas con repuestos importados.',
      cab: ['Quién', 'Urgencia', 'Rubro', 'Pedidos', 'Lo normal'],
      filas: r.puntaApunta.porSolicitante.map(function (x) { return [x.quien || '—', x.urgencia || '—', x.rubro, nro(x.n), dias(x.mediana)]; }), vacio: 'Sin datos todavía.' },
    { titulo: 'De punta a punta, por granja', cab: ['Granja', 'Urgencia', 'Rubro', 'Pedidos', 'Lo normal'],
      filas: r.puntaApunta.porGranja.map(function (x) { return [x.quien || '—', x.urgencia || '—', x.rubro, nro(x.n), dias(x.mediana)]; }), vacio: 'Sin datos todavía.' },
    { titulo: 'Urgentes contra normales, columna por columna', nota: 'Lo normal de cada columna (Compras). Por ahora sin un "a tiempo" fijo: con un mes de datos reales se ve si conviene fijarlo.',
      cab: ['Columna', 'Urgentes', 'Cuántas', 'Las demás', 'Cuántas'],
      filas: ordenColumnas(r.urgencia).map(function (u) { return [u.columna, dias(u.urgentes), nro(u.nUrgentes), dias(u.normales), nro(u.nNormales)]; }), vacio: 'Sin datos todavía.' },
    { titulo: 'Cotizaciones por tarjeta',
      nota: 'En total: ' + nro(r.cotizaciones.pedidas) + ' pedidos de cotización, ' + nro(r.cotizaciones.contestaron) + ' contestaron y ' +
            nro(r.cotizaciones.cargadas) + ' presupuestos cargados, en ' + nro(r.cotizaciones.tarjetas) + ' tarjetas.',
      cab: ['Tarjeta', 'Qué es', 'Se pidieron', 'Contestaron', 'Se cargaron'], abrir: 0,
      filas: r.cotizaciones.detalle.map(function (c) { return [c.ref, c.titulo || '', nro(c.pedidas), nro(c.contestaron), nro(c.cargadas)]; }), vacio: 'No se pidieron cotizaciones en estas fechas.' },
    { titulo: 'Uso de la app', nota: 'Cada vez que alguien la abre o vuelve a ella después de 10 minutos o más. ' + nro(r.uso.dias) + ' días en el período.',
      cab: ['Quién', 'Veces', 'Días que la usó', 'Veces por día que la usó', 'Última vez'],
      filas: r.uso.usuarios.map(function (u) { return [u.usuario, nro(u.veces), nro(u.dias) + ' de ' + nro(r.uso.dias), nro(u.veces / Math.max(1, u.dias)), u.ultima ? fechaCorta(u.ultima) + ' ' + u.ultima.slice(11, 13) + ' h' : '—']; }),
      vacio: 'Todavía no hay datos (se anotan desde el 10/10).' },
    { titulo: 'Semana a semana', cab: ['Semana del', 'Pedidos', 'Entregados', 'Punta a punta', 'Cancelados', 'A Stand by'],
      filas: r.semanas.map(function (s) { return [fechaCorta(s.semana), nro(s.pedidos), nro(s.entregados), dias(s.mediana), nro(s.canceladas), nro(s.standby)]; }), vacio: '' }
  ];
}

function tablasPlata(r) {
  const tot = r.totales.map(function (t) { return plata(t.total, t.moneda) + ' en ' + nro(t.compras) + (t.compras === 1 ? ' compra' : ' compras'); }).join(' · ');
  const ah = r.ahorro.totales.map(function (t) { return plata(t.ahorrado, t.moneda) + ' (' + nro(t.porcentaje, 1) + '%)'; }).join(' · ');
  const grupo = function (titulo, lista) {
    return { titulo: titulo, cab: [titulo.replace('Por ', ''), 'Moneda', 'Total', 'Compras'],
             filas: lista.map(function (g) { return [g.grupo || '—', g.moneda, plata(g.total, g.moneda), nro(g.compras)]; }), vacio: 'Sin compras.' };
  };
  return [
    { titulo: 'Compras', nota: (tot || 'Ninguna compra en estas fechas.') + ' Las confirmadas a mano en el chat no se cuentan.',
      cab: ['Fecha', 'Proveedor', 'Total', 'Productos', 'Pedidos', 'Granjas', 'Compró'],
      filas: r.compras.map(function (c) { return [fechaCorta(c.fecha), c.proveedor, plata(c.total, c.moneda), nro(c.productos), c.pedidos, c.granjas || '', c.quien || '']; }), vacio: '' },
    grupo('Por granja', r.porGranja), grupo('Por rubro', r.porRubro), grupo('Por mes', r.porMes),
    { titulo: 'Ahorro', nota: (ah ? 'Ahorrado: ' + ah + '. ' : '') + 'El precio elegido contra el promedio de los presupuestos, solo cuando hubo 2 o más del mismo producto. Precios sin IVA, por nuestra unidad.',
      cab: ['Pedido', 'Producto', 'Proveedor', 'Elegido', 'Promedio', 'Presupuestos', 'Ahorro'], abrir: 0,
      filas: r.ahorro.detalle.map(function (a) { return [a.ref, a.producto, a.proveedor, plata(a.elegido, a.moneda), plata(a.promedio, a.moneda), nro(a.ofertas), plata(a.ahorrado, a.moneda)]; }),
      vacio: 'Ninguna compra tuvo 2 o más presupuestos del mismo producto.' },
    { titulo: 'Historial de precios', nota: 'Por producto, lo que se pagó por nuestra unidad, sin IVA, en la moneda en que vino y convertido con el dólar oficial del Banco Nación, venta, de ese día.',
      cab: ['Producto', 'Fecha', 'Proveedor', 'Precio', 'Dólar del día', 'En pesos', 'En dólares'],
      filas: r.precios.map(function (p) { return [p.producto, fechaCorta(p.fecha), p.proveedor, plata(p.unitario, p.moneda), p.dolar ? '$ ' + nro(p.dolar, 0) : '—', plata(p.enPesos, 'ARS'), p.enDolares === null ? '—' : 'US$ ' + nro(p.enDolares, 2)]; }),
      vacio: 'Sin precios todavía.' }
  ];
}

function tablasProveedores(r) {
  const gasto = function (g) { return Object.keys(g || {}).map(function (m) { return plata(g[m], m); }).join(' + ') || '—'; };
  return [
    { titulo: 'Cada proveedor', nota: 'Contestó = respondió el pedido de cotización por WhatsApp. Entrega = de la compra a Entregado.',
      cab: ['Proveedor', 'Pedidos de cotización', 'Contestó', 'Tarda en contestar', 'Presupuestos', 'Ganó', 'Gasto', 'Tarda en entregar', '"No recibió"'],
      filas: r.proveedores.map(function (p) {
        return [p.proveedor, nro(p.pedidos), p.pedidos ? nro(p.contestaron) + ' (' + nro(100 * p.contestaron / p.pedidos, 0) + '%)' : '—',
                p.horasRespuesta === null ? '—' : (p.horasRespuesta < 24 ? nro(p.horasRespuesta) + ' h' : dias(p.horasRespuesta / 24)),
                nro(p.presupuestos), nro(p.compras), gasto(p.gasto), dias(p.diasEntrega), nro(p.noRecibio)];
      }), vacio: 'Sin actividad con proveedores en estas fechas.' },
    { titulo: 'Rubros con un solo proveedor', nota: 'Si ese proveedor falla, no hay a quién pedirle.',
      cab: ['Rubro', 'Proveedor'], filas: r.unSoloProveedor.map(function (x) { return [x.rubro, x.proveedor || '(ninguno)']; }), vacio: 'Todos los rubros tienen 2 proveedores o más.' },
    { titulo: 'Proveedores que se llevan casi todo un rubro', nota: '70% o más de lo comprado en el rubro (con 2 compras o más).',
      cab: ['Rubro', 'Proveedor', 'Parte', 'Total'], filas: r.concentrado.map(function (x) { return [x.rubro, x.proveedor, nro(x.porcentaje, 0) + '%', plata(x.total, x.moneda)]; }),
      vacio: 'Ningún rubro depende de un solo proveedor.' }
  ];
}

function tablasPadron(r) {
  return [
    { titulo: 'Familias más pedidas', nota: 'Cuántos pedidos y desde qué granjas. Tocá una para ver sus variantes.',
      cab: ['Familia', 'Rubro', 'Pedidos', 'Granjas'], variantes: true,
      filas: r.familias.map(function (f) {
        return [f.familia, f.rubro || '', nro(f.veces), Object.keys(f.granjas || {}).sort(function (a, b) { return f.granjas[b] - f.granjas[a]; })
          .map(function (g) { return g + ' (' + f.granjas[g] + ')'; }).join(', ')];
      }), vacio: 'Ningún pedido en estas fechas.' },
    { titulo: 'Pedidos que se repiten', nota: 'Familia y granja con 3 pedidos o más: cada cuánto se pide y cuándo tocaría el próximo. Sirve para tenerlo en la oficina o adelantarse. Tocá una para ver la línea de tiempo.',
      cab: ['Familia', 'Granja', 'Pedidos', 'Cada', 'Parejo', 'Último', 'Próximo'], linea: true,
      filas: r.repetidos.map(function (x) { return [x.familia, x.granja || '—', nro(x.pedidos), dias(x.cadaDias), x.parejo ? 'Sí' : 'No', fechaCorta(x.ultimo), fechaCorta(x.proximo)]; }),
      vacio: 'Todavía ninguna familia se pidió 3 veces desde la misma granja.' },
    { titulo: 'Fuera del padrón, una y otra vez', nota: 'Candidatos a sumar al padrón.',
      cab: ['Lo que escribieron', 'Pedidos', 'Granjas'], filas: r.fueraDelPadron.map(function (x) { return [x.texto, nro(x.veces), x.granjas || '']; }), vacio: 'Nada repetido fuera del padrón.' },
    { titulo: 'Familias que nunca se pidieron (' + nro(r.nuncaPedidas.cantidad) + ')',
      nota: 'Las del padrón (activas) que no salieron en ningún pedido desde que se usa la app, sin importar las fechas elegidas. Se muestran hasta 500.',
      cab: ['Familia', 'Rubro'], filas: r.nuncaPedidas.lista.map(function (x) { return [x.familia, x.rubro || 'Sin rubro']; }), vacio: 'Todas se pidieron alguna vez.' }
  ];
}

/* Egresos (Feli, 13/10): por la fecha contable del comprobante; lo anulado en el Historial no cuenta. Unidades de Albor. */
function tablasEgresos(r) {
  const mes = function (m) { const x = String(m).split('-'); return x[1] + '/' + x[0]; };
  const t = r.totales || {};
  const pesos = function (n) { return n === null || n === undefined ? 'sin precio' : '$ ' + nro(n, 2); };
  return [
    { titulo: 'Por producto', nota: nro(t.comprobantes) + ' comprobantes, ' + nro(t.productos) + ' productos: <b>$ ' + nro(t.importe, 2) + '</b>. ' +
        'Cantidades en la unidad de Albor; el precio unitario es el de Albor en el último reporte de existencias que tiene el producto' +
        (t.sinPrecio ? ' (' + nro(t.sinPrecio) + ' sin precio: no suman)' : '') + '. ' +
        (r.anulados ? 'Hay ' + nro(r.anulados) + ' anulado' + (r.anulados === 1 ? '' : 's') + ' en el Historial: no se cuentan. ' : '') +
        (r.granjas.some(function (g) { return /COLORADA/i.test(g); }) ? 'La Colorada (G4) se abastece de la Oficina LC 50 y Granja La Colorada de la Oficina Casa.' : ''),
      cab: ['Producto', 'Cuenta', 'Total', 'Precio unitario', 'Precio total'].concat(r.granjas).concat(r.meses.length > 1 ? r.meses.map(mes) : []),
      filas: r.productos.map(function (p) {
        return [p.insumo, String(p.cuenta || '').replace(/^\d+/, ''), nro(p.total), pesos(p.precio), p.precio === null || p.precio === undefined ? '' : pesos(p.importe)]
          .concat(r.granjas.map(function (g) { return p.granjas && p.granjas[g] ? nro(p.granjas[g]) : ''; }))
          .concat(r.meses.length > 1 ? r.meses.map(function (m) { return p.meses && p.meses[m] ? nro(p.meses[m]) : ''; }) : []);
      }), vacio: 'Ningún egreso en estas fechas.' },
    { titulo: 'Por granja y cuenta', cab: ['Granja', 'Cuenta', 'Comprobantes', 'Productos', 'Precio total'],
      filas: r.porGranja.map(function (g) { return [g.granja, g.cuenta, nro(g.comprobantes), nro(g.productos), '$ ' + nro(g.importe || 0, 2)]; }), vacio: '' },
    { titulo: 'Comprobantes', cab: ['Fecha', 'Comprobante', 'Granja', 'Cuenta', 'Renglones', 'Cargó'],
      filas: r.comprobantes.map(function (c) { return [fechaCorta(c.dia), c.comprobante, c.granja, c.cuenta, nro(c.renglones), c.quien || '']; }), vacio: '' }
  ];
}

/* Consumo mensual (antes Stock; Feli, 13/10 y 16/10): lo egresado en el último mes exacto contra la existencia de Albor,
   en tres partes: Faltantes Oficina JM (Candelaria y El Cebil), Faltantes Oficina LC 50 (La Colorada) y Faltantes
   Oficina CASA (Granja La Colorada). Cada parte, en dos presentaciones (vista; el resumen se sacó: Feli, 16/10):
   - 'detallado': Producto, el egreso de cada granja, Egresos totales, Existencia, Diferencia; primero lo negativo, después
     lo justo y lo que sobra (lleva solo el nombre de la parte);
   - 'faltantes': Producto, Faltante, Precio de última compra (el unitario de Albor) y Precio (vacía), solo lo que falta.
   La diferencia va con su signo (sin "faltan" ni "sobran"). Cada tabla trae también `datos` (números de verdad) para el Excel. */
const STOCK_FIJAS = ['Candelaria', 'El Cebil', 'La Colorada', 'Granja La Colorada'];
const VISTAS_STOCK = { detallado: '', faltantes: 'Faltante y precio' };   // las dos presentaciones (la primera, sin nombre)
function conSigno(n) { return n > 0 ? '+' + nro(n) : n < 0 ? '−' + nro(-n) : '0'; }
function tablasStock(r, vista) {
  const hay = r.conEgresos || [], tablas = [];
  (r.grupos || []).forEach(function (g) {
    const ps = r.productos.filter(function (p) { return p.grupo === g.grupo; });
    const nota = g.grupo === 'JM' ? 'Egresos de Candelaria (y Candelaria Engorde) y El Cebil contra la existencia de la Oficina JM.'
      : g.grupo === 'LC50' ? 'Egresos de La Colorada (G4) contra la existencia de la Oficina LC 50.'
      : 'Egresos de Granja La Colorada contra la existencia de la Oficina Casa.';
    if (vista !== 'faltantes') vista = 'detallado';
    const pres = VISTAS_STOCK[vista];
    if (vista === 'faltantes') {
      // Feli (16/10): Producto, Faltante, Precio de última compra (el de Albor, por unidad) y Precio, vacía (para completar)
      const lista = ps.filter(function (p) { return p.diferencia < 0; });
      const datos = lista.map(function (p) { return [p.insumo, -Number(p.diferencia), p.precio === null || p.precio === undefined ? null : Number(p.precio), null]; });
      tablas.push({ grupo: g.grupo, parte: g.nombre, titulo: g.nombre + ' · ' + pres + ' (' + nro(lista.length) + ')',
        nota: nota + ' Precio de última compra: el precio unitario de Albor. La columna Precio va vacía.',
        cab: ['Producto', 'Faltante', 'Precio de última compra', 'Precio'], datos: datos,
        filas: datos.map(function (f) { return [f[0], nro(f[1]), f[2] === null ? 'sin precio' : '$ ' + nro(f[2], 2), '']; }),
        vacio: 'No falta nada.' });
      return;
    }
    const cols = (g.columnas || []).filter(function (c) { return hay.indexOf(c) !== -1 || STOCK_FIJAS.indexOf(c) !== -1; });
    const cab = ['Producto'].concat(cols.map(function (c) { return 'Egreso ' + c; })).concat(['Egresos totales', 'Existencia ' + g.oficina, 'Diferencia']);
    const datos = function (p) {
      return [p.insumo].concat(cols.map(function (c) { return p.granjas && p.granjas[c] ? Number(p.granjas[c]) : null; }))
        .concat([Number(p.esperado), Number(p.existencia), Number(p.diferencia)]);
    };
    [['negativo', 'En negativo', function (p) { return p.diferencia < 0; }],
     ['justo', 'Justos', function (p) { return p.diferencia === 0; }],
     ['sobra', 'Sobran', function (p) { return p.diferencia > 0; }]].forEach(function (parte, k) {
      const lista = ps.filter(parte[2]), filas = lista.map(datos);
      tablas.push({
        grupo: g.grupo, parte: g.nombre, subparte: parte[1] + ' (' + nro(lista.length) + ')', signo: true,
        titulo: g.nombre + ' · ' + parte[1].toLowerCase() + ' (' + nro(lista.length) + ')',
        nota: k ? '' : nota + ' Diferencia = existencia − egresos.',
        cab: cab, datos: filas,
        filas: filas.map(function (f) {
          return f.map(function (x, i) { return i === 0 ? x : i === f.length - 1 ? conSigno(x) : x === null ? '' : nro(x); });
        }),
        falta: parte[0] === 'negativo' ? lista.map(function () { return true; }) : null,
        vacio: parte[0] === 'negativo' ? 'Ninguno: alcanza para todo.' : 'Ninguno.'
      });
    });
  });
  return tablas;
}

/* ---------- Dibujar ---------- */
function htmlTabla(t, i) {
  let h = '<div class="ve-bloque"><h3>' + esc(t.titulo) + '</h3>' + (t.nota ? '<p class="nota">' + t.nota + '</p>' : '');
  if (!t.filas.length) return h + (t.vacio ? '<p class="nota">' + esc(t.vacio) + '</p>' : '') + '</div>';
  h += '<div class="ve-tabla"><table><thead><tr>' + t.cab.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
    t.filas.map(function (f, j) {
      const clic = t.abrir !== undefined || t.variantes || t.linea;
      const cls = (clic ? 'rp-clic' : '') + (t.falta && t.falta[j] ? ' rp-falta' : '');
      return '<tr' + (cls ? ' class="' + cls.trim() + '"' : '') + (clic ? ' data-t="' + i + '" data-f="' + j + '"' : '') + '>' + f.map(function (c) {
        if (c && typeof c === 'object' && c.barra !== undefined) return '<td class="rp-barra">' + (c.barra > 0 ? '<span style="width:' + Math.round(Math.min(1, c.barra) * 100) + '%"></span>' : '') + '</td>';
        return '<td>' + esc(c) + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody></table></div></div>';
  return h;
}

function pintarCuerpoRp() {
  const cual = RP.pestana, cuerpo = $('rp-cuerpo');
  if (cual === 'historial') return pintarHistorialRp();
  const d = RP.datos[cual];
  if (!d) {
    cuerpo.innerHTML = '<p class="nota rp-vacio">' + (cual === 'stock' ? 'Compara lo que se egresó de las granjas en el último mes con la existencia de Albor de cada oficina, en tres partes: Oficina JM (Candelaria y El Cebil), Oficina LC 50 (La Colorada) y Oficina CASA (Granja La Colorada). Tocá <b>Armar reporte</b>.'
                                                                      : 'Elegí las fechas y los filtros y tocá <b>Armar reporte</b>.') + '</p>';
    return;
  }
  const r = d.r;
  if (cual === 'stock') {
    RP.tablas = tablasStock(r, RP.vista);
    const sinLc50 = r.existencias && !r.productos.some(function (p) { return p.grupo === 'LC50' && p.existencia; });
    cuerpo.innerHTML = (r.existencias ? '' : '<p class="estado warn">Todavía no hay ningún reporte de existencias de Albor guardado: bajalo en Transferencias (Conteo de stock) y armá este reporte de nuevo.</p>') +
      (sinLc50 ? '<p class="estado warn">El último reporte de existencias no trae la Oficina LC 50: en Albor, al bajarlo, tiene que estar tildada la empresa que la tiene.</p>' : '') +
      '<p class="nota rp-de">' + subtituloStock(r) + '</p>' + RP.tablas.map(htmlTabla).join('');
    return;
  }
  const cab = '<p class="nota rp-de">Del ' + fechaCorta(r.desde) + ' al ' + fechaCorta(r.hasta) +
              ' · armado ' + new Date(r.armado).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) + '</p>';
  if (cual === 'resumen') { cuerpo.innerHTML = cab + htmlResumen(r); return; }
  RP.tablas = tablasDe(cual, r);
  cuerpo.innerHTML = cab + RP.tablas.map(htmlTabla).join('');
}

/** Consumo mensual: de qué mes son los egresos y de cuándo la existencia. */
function subtituloStock(r) {
  const p = r.periodo || {};
  return 'Egresos del ' + fechaCorta(p.desde) + ' al ' + fechaCorta(p.hasta) +
    (r.existencias ? ' · existencias de Albor del ' + new Date(r.existencias.fecha).toLocaleDateString('es-AR') : '') +
    ' · armado ' + new Date(r.armado).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

function htmlResumen(r) {
  const comp = (r.compras || []).map(function (t) { return plata(t.total, t.moneda); }).join(' + ') || '$ 0';
  const nComp = (r.compras || []).reduce(function (n, t) { return n + t.compras; }, 0);
  const ah = (r.ahorro || []).map(function (t) { return plata(t.ahorrado, t.moneda); }).join(' + ') || '—';
  const eg = r.egresos || {};
  const pap = r.puntaApunta || {}, urg = r.urgentesPuntaApunta || {};
  const caja = function (ir, num, que, sub) {
    return '<button type="button" class="rp-caja" data-ir="' + ir + '"><b>' + esc(num) + '</b><span>' + esc(que) + '</span>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</button>';
  };
  return '<div class="rp-cajas">' +
    caja('flujo', nro(r.pedidos), 'pedidos', nro(r.urgentes) + ' urgentes' + (r.servicios ? ' · ' + nro(r.servicios) + ' servicios' : '')) +
    caja('plata', comp, 'Compras', nro(nComp) + (nComp === 1 ? ' compra' : ' compras')) +
    caja('egresos', plata(eg.importe || 0), 'Gastos en egresos', nro(eg.productos || 0) + ' productos egresados de las granjas' +
         (eg.sinPrecio ? ' (' + nro(eg.sinPrecio) + ' sin precio)' : '')) +
    caja('plata', ah, 'ahorrado', 'contra el promedio de los presupuestos') +
    caja('flujo', dias(pap.mediana), 'de punta a punta', 'lo normal, ' + nro(pap.n || 0) + ' entregados') +
    caja('flujo', dias(urg.mediana), 'las urgentes', 'de punta a punta') +
    caja('flujo', nro(r.trabadas), 'trabadas ahora', r.traba ? 'donde más tardan: ' + r.traba : '') +
    caja('stock', '—', 'qué falta en las oficinas', 'en Consumo mensual') +
    '</div>';
}

/** Con un mes guardado abierto, el cartel arriba de cada pestaña. */
function pintarReporte() {
  pintarCuerpoRp();
  if (!RP.guardado || RP.pestana === 'historial') return;
  const g = RP.guardado;
  $('rp-cuerpo').insertAdjacentHTML('afterbegin', '<div class="estado warn rp-guardado">📁 Estás viendo los reportes guardados de <b>' + esc(nombreMes(g.mes)) +
    '</b> (armados el ' + new Date(g.armado).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) + '). ' +
    '<button type="button" class="linkbtn" data-rp-ahora>Volver a los de ahora</button></div>');
}

$('rp-cuerpo').addEventListener('click', function (e) {
  if (e.target.closest('[data-rp-ahora]')) return volverAhoraRp();
  const mes = e.target.closest('[data-mes]');
  if (mes) return abrirMesGuardado(mes.dataset.mes);
  const caja = e.target.closest('.rp-caja');
  if (caja) { RP.pestana = caja.dataset.ir; pintarPestanasRp(); pintarReporte(); return; }
  const tr = e.target.closest('tr.rp-clic');
  if (!tr) return;
  const t = RP.tablas[Number(tr.dataset.t)], j = Number(tr.dataset.f);
  if (t.abrir !== undefined) return abrirTarjeta(t.filas[j][t.abrir]);
  const sig = tr.nextElementSibling;
  if (sig && sig.classList.contains('rp-detalle')) { sig.remove(); return; }
  const r = RP.datos[RP.pestana].r;
  let html = '';
  if (t.variantes) {
    const f = r.familias[j];
    html = (f.variantes || []).map(function (v) { return esc(v.variante) + ' <b>' + nro(v.veces) + '</b>'; }).join(' · ') || 'Sin variantes en el padrón.';
  } else if (t.linea) html = svgLinea(r.repetidos[j]);
  tr.insertAdjacentHTML('afterend', '<tr class="rp-detalle"><td colspan="' + t.cab.length + '">' + html + '</td></tr>');
});

/** Pedidos que se repiten: un punto por pedido y el próximo esperado, en una línea de tiempo. */
function svgLinea(x) {
  const fechas = (x.fechas || []).map(function (d) { return new Date(d + 'T12:00:00Z').getTime(); });
  const prox = new Date(x.proximo + 'T12:00:00Z').getTime();
  const a = Math.min.apply(null, fechas), b = Math.max(prox, Math.max.apply(null, fechas)), w = 560, m = 20;
  const px = function (t) { return m + (b === a ? 0 : (t - a) / (b - a)) * (w - 2 * m); };
  return '<svg class="rp-linea" viewBox="0 0 ' + w + ' 56" role="img" aria-label="Línea de tiempo de los pedidos">' +
    '<line x1="' + m + '" y1="24" x2="' + (w - m) + '" y2="24" />' +
    fechas.map(function (t, i) { return '<circle cx="' + px(t) + '" cy="24" r="5"><title>' + fechaCorta(x.fechas[i]) + '</title></circle>'; }).join('') +
    '<circle class="prox" cx="' + px(prox) + '" cy="24" r="6"><title>Próximo: ' + fechaCorta(x.proximo) + '</title></circle>' +
    '<text x="' + m + '" y="50">' + fechaCorta(x.fechas[0]) + '</text><text x="' + (w - m) + '" y="50" text-anchor="end">Próximo: ' + fechaCorta(x.proximo) + '</text></svg>';
}

/* ---------- Excel ---------- */
function cargarXlsx() {
  if (window.XLSX) return Promise.resolve();
  return new Promise(function (listo, mal) {
    const sc = document.createElement('script');
    sc.src = XLSX_URL;
    sc.onload = function () { listo(); };
    sc.onerror = function () { mal(new Error('Hace falta señal para armar el Excel.')); };
    document.head.appendChild(sc);
  });
}
$('rp-excel').addEventListener('click', async function () {
  const d = RP.datos[RP.pestana];
  if (!d) return;
  try { await cargarXlsx(); } catch (e) { return notaAd('rp-estado', e.message); }
  const libro = XLSX.utils.book_new();
  const r = d.r, nombrePest = RP_PESTANAS.filter(function (p) { return p.id === RP.pestana; })[0].nombre;
  if (RP.pestana === 'stock') return excelStock(libro, r);
  const tablas = tablasDe(RP.pestana, r);
  const usados = {};
  tablas.forEach(function (t) {
    const cab = t.cab.filter(function (c, i) { return !(t.barra === i); });
    const filas = t.filas.map(function (f) { return f.filter(function (c, i) { return !(t.barra === i); }); });
    const sub = 'Del ' + fechaCorta(r.desde) + ' al ' + fechaCorta(r.hasta);
    const hoja = XLSX.utils.aoa_to_sheet([[t.titulo], [sub], []].concat([cab]).concat(filas));
    let nombre = t.titulo.replace(/[\\/?*[\]:]/g, '').slice(0, 28) || 'Hoja';
    while (usados[nombre]) nombre = nombre.slice(0, 26) + ' ' + (Object.keys(usados).length + 1);
    usados[nombre] = 1;
    XLSX.utils.book_append_sheet(libro, hoja, nombre);
  });
  XLSX.writeFile(libro, 'Reporte ' + nombrePest + ' ' + r.desde + ' a ' + r.hasta + '.xlsx');
});

/* Consumo mensual en Excel (Feli, 16/10): por cada parte (Oficina JM, Oficina LC 50, Oficina CASA), dos hojas: la de
   egresos y existencia ("JM") y la de faltante y precio ("JM Faltante y precio"). Cada hoja empieza con el título de la
   parte. En la primera, primero lo negativo, después lo justo y al final lo que sobra, separados. Los números, como números. */
function excelStock(libro, r) {
  const sub = subtituloStock(r);
  (r.grupos || []).forEach(function (g) {
    Object.keys(VISTAS_STOCK).forEach(function (vista) {
      const partes = tablasStock(r, vista).filter(function (t) { return t.grupo === g.grupo; });
      const filas = [[g.nombre + (VISTAS_STOCK[vista] ? ' · ' + VISTAS_STOCK[vista] : '')], [sub], [String(partes[0].nota || '').replace(/<[^>]*>/g, '')], []];
      const conSignoF = [], conPesos = [];
      partes.forEach(function (t) {
        if (t.subparte) filas.push([t.subparte]);
        filas.push(t.cab);
        t.datos.forEach(function (f) { (t.signo ? conSignoF : conPesos).push(filas.length); filas.push(f); });
        if (!t.datos.length) filas.push([t.vacio]);
        filas.push([]);
      });
      const hoja = XLSX.utils.aoa_to_sheet(filas);
      const col = partes[0].cab.length - 1;
      conSignoF.forEach(function (fila) {               // la diferencia, con su signo
        const c = hoja[XLSX.utils.encode_cell({ r: fila, c: col })];
        if (c && typeof c.v === 'number') c.z = Number.isInteger(c.v) ? '+#,##0;-#,##0;0' : '+#,##0.0#;-#,##0.0#;0';
      });
      conPesos.forEach(function (fila) {                // el precio de última compra, en pesos
        const c = hoja[XLSX.utils.encode_cell({ r: fila, c: 2 })];
        if (c && typeof c.v === 'number') c.z = '"$ "#,##0.00';
      });
      hoja['!cols'] = [{ wch: 44 }].concat(partes[0].cab.slice(1).map(function (x) { return { wch: Math.max(12, x.length + 2) }; }));
      XLSX.utils.book_append_sheet(libro, hoja, (g.oficina.replace('Oficina ', '') + (VISTAS_STOCK[vista] ? ' ' + VISTAS_STOCK[vista] : '')).slice(0, 31));
    });
  });
  XLSX.writeFile(libro, 'Consumo mensual ' + hoyAr() + '.xlsx');
}
