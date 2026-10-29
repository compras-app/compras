'use strict';
/* ============================================================
   PANTALLAS DE LA APP. Cada paso agrega la suya (tablero, detalle,
   búsqueda, admin) con pantalla(id, {...}) y su <section id="s-id">
   en index.html. Si suma un archivo, va también en ARCHIVOS de sw.js.
   ============================================================ */

// 'tablero' la registra js/tablero.js; 'buscar', js/buscar.js; 'admin' y sus pantallas, js/admin.js
pantalla('cuenta',  { titulo: 'Tu cuenta', tab: '', alMostrar: pantallaCuenta });

/**
 * Después del login (o al abrir con lo guardado): arma la barra y abre el tablero.
 * Apartados (Fase extra): quien no ve Compras va directo a Transferencias (o, si
 * no ve ninguno, a Tu cuenta). Quien ve los dos vuelve al último que abrió. Un
 * link a una tarjeta (#Ref) o a Tu cuenta (#cuenta) se queda acá.
 */
function mostrarApp() {
  const ap = misApartados(APP.yo);
  const transf = ap.indexOf('transferencias') !== -1;
  // Fase 6, Paso 4: Contabilidad (misma página, ?ap=contabilidad). Quien ve solo eso, o la abrió la última vez, va ahí
  const conta = ap.indexOf('contabilidad') !== -1;
  if (conta && !modoContable() && !location.hash && (ap.length === 1 || guardado.leer(K_APARTADO) === 'contabilidad')) {
    return location.replace(APARTADOS.contabilidad.url);
  }
  if (transf && !modoContable() && !location.hash && (ap.indexOf('compras') === -1 || guardado.leer(K_APARTADO) === 'transferencias')) {
    return location.replace(APARTADOS.transferencias.url);
  }
  $('login').hidden = true;
  $('app').hidden = false;
  // En la misma ventana: en el iPhone, otra ventana guardaría el pedido en otro lado
  $('t-nuevo').href = FORMULARIO + '?desde=app';
  pintarBarra();
  pintarSinRed();
  if (modoContable()) ir('contabilidad');
  else if (sinCompras()) ir('cuenta');
  else if (location.hash === '#cuenta') {
    // Viene de "Tu cuenta" en Transferencias: #cuenta no es un pedido (si queda, el tablero lo abría como tarjeta)
    history.replaceState(null, '', location.pathname + location.search);
    ir('tablero'); abrir('cuenta');
  }
  else ir('tablero');
  mostrarNoAplicados();          // los que quedaron de antes (aunque se haya cerrado la app)
}

/** ¿No ve el apartado Compras? Entonces solo tiene Tu cuenta acá. */
function sinCompras() { return misApartados(APP.yo).indexOf('compras') === -1; }

const NOMBRE_ROL = { admin: 'Administrador', encargado: 'Encargado de granja', empleado: 'Empleado', contabilidad: 'Contabilidad' };

/** La barra según quién sos (se vuelve a pintar si inicioApp trae algo nuevo). */
function pintarBarra() {
  $('b-nombre').textContent = APP.yo.nombre;
  $('b-inicial').textContent = APP.yo.nombre.charAt(0).toUpperCase();
  const conta = modoContable();
  pintarApartados($('b-apartados'), APP.yo, conta ? 'contabilidad' : 'compras');
  if (sinCompras() && !conta) $('b-apartados').hidden = true;
  document.querySelector('nav.tabs').hidden = sinCompras() && !conta;
  $('t-admin').hidden = !APP.yo.admin;
  $('t-tareas').hidden = !APP.yo.admin;             // el tablero de tareas es solo de los admins
  document.querySelectorAll('#s-admin [data-f6]').forEach(function (b) { b.hidden = !APP.yo.fase6; });   // Fase 6: solo los de "Ven lo de la Fase 6"
  $('t-chats').hidden = !veChats();                 // Fase 4, Paso 2: los chats, solo los admins de "Ven los chats" (Feli, 2026-10-06)
  $('b-notif').hidden = sinCompras() || conta;      // Paso 2-ter: las notificaciones (notificaciones.js)
  // Fase 6, Paso 4: en Contabilidad, solo sus pestañas (Tablero y Reportes)
  document.querySelectorAll('nav.tabs .tab').forEach(function (t) {
    if (t.hasAttribute('data-conta')) t.hidden = !conta;
    else if (conta) t.hidden = true;
  });
}

function pantallaCuenta() {
  $('c-nombre').textContent = APP.yo.nombre;
  $('c-rol').textContent = (NOMBRE_ROL[APP.yo.rol] || 'Empleado') + (APP.yo.prueba ? ' (prueba en este dispositivo)' : '');
  // Apartados: a quien no ve Compras, desde acá se va a lo suyo
  const ap = misApartados(APP.yo);
  $('c-apartados').hidden = !sinCompras();
  $('c-apartados-txt').textContent = ap.length ? 'Lo tuyo está en:' : 'Por ahora no tenés ningún apartado de la app. Si te falta algo, avisale a un administrador.';
  $('c-apartados-lista').innerHTML = '';
  ap.filter(function (id) { return id !== 'compras'; }).forEach(function (id) {
    const a = document.createElement('a');
    a.className = 'btn';
    a.href = APARTADOS[id].url;
    a.textContent = 'Ir a ' + APARTADOS[id].nombre;
    a.addEventListener('click', function () { guardado.guardar(K_APARTADO, id); });
    $('c-apartados-lista').appendChild(a);
  });
  $('c-disp').textContent = dispositivo();
  $('c-host').textContent = location.host + (instalada() ? ' (app instalada)' : '');
  $('c-version').textContent = VERSION_APP;
  const err = guardado.leerJSON(K.error, null);
  $('c-error-t').hidden = $('c-error').hidden = !err;
  if (err) $('c-error').textContent = new Date(err.cuando).toLocaleString('es-AR', { hour12: false }) + ' · ' + err.fn + ' · ' + err.detalle;
  const desde = guardado.leer(K.desde);
  $('c-desde').textContent = desde ? new Date(desde).toLocaleString('es-AR', { hour12: false }) : '—';
  estado('e-cuenta', '');
  pintarAspecto();
}

/* ---------- El color y el tablero de cada uno (Paso 6, Feli) ----------
   Feli (2026-10-01): el formato y la letra son siempre los de Transferencias
   (data-aspecto="programa"). Cada uno elige el color (se usa en Compras,
   Transferencias y el formulario) y el estilo del tablero. Se ve al instante
   y va por la bandeja (sin señal, se guarda cuando vuelve). */
const ESTILOS = [
  { id: 'sobrio', nombre: 'Sobrio', nota: 'Como Transferencias' },
  { id: 'profundidad', nombre: 'Profundidad', nota: 'Como Trello' },
  { id: 'liso', nombre: 'Liso oscuro', nota: 'Fondo parejo' },
  { id: 'vidrio', nombre: 'Vidrio', nota: 'Columnas transparentes' },
  { id: 'aurora', nombre: 'Aurora', nota: 'Una luz de tu color' }
];
function pintarAspecto() {
  const estilo = document.documentElement.dataset.estilo || (APP.yo && APP.yo.estilo) || 'sobrio';
  const colores = (APP.config && APP.config.colores) || [];
  const mio = (APP.yo && APP.yo.color) || 'Rosa viejo';     // si no eligió, Rosa viejo (Feli, 2026-10-01)
  $('c-aspecto').hidden = !colores.length;          // una versión vieja del servidor todavía no los manda
  $('c-estilos').innerHTML = ESTILOS.map(function (e) {
    return '<button type="button" class="asp-estilo" data-estilo="' + e.id + '" aria-pressed="' + (e.id === estilo) + '">' +
      '<span class="asp-mini" data-mini="' + e.id + '"><i></i><i></i><i></i></span><b>' + esc(e.nombre) + '</b><small>' + esc(e.nota) + '</small></button>';
  }).join('');
  $('c-estilos').querySelectorAll('[data-estilo]').forEach(function (b) {
    b.addEventListener('click', function () { cambiarAspecto({ estilo: b.dataset.estilo }); });
  });
  $('c-colores').innerHTML = colores.map(function (c) {
      return '<button type="button" class="asp-color" data-color="' + esc(c.nombre) + '" aria-pressed="' + (c.nombre === mio) + '" title="' + esc(c.nombre) + '">' +
        '<i style="background:' + esc(c.hex) + '"></i><span>' + esc(c.nombre) + '</span></button>';
    }).join('');
  $('c-colores').querySelectorAll('[data-color]').forEach(function (b) {
    b.addEventListener('click', function () { cambiarAspecto({ color: b.dataset.color }); });
  });
}
function cambiarAspecto(a) {
  const yo = APP.yo;
  const color = a.color || yo.color || 'Rosa viejo';
  const estilo = a.estilo || document.documentElement.dataset.estilo || yo.estilo || 'sobrio';
  const c = (APP.config.colores || []).filter(function (x) { return x.nombre === color; })[0];
  aplicarAspecto(c ? c.css : null, estilo);
  yo.color = color; yo.estilo = estilo;
  const inicio = guardado.leerJSON(K.inicio, null);
  if (inicio) { inicio.yo = yo; inicio.config.css = c ? c.css : (guardado.leer(K.css) || ''); guardado.guardarJSON(K.inicio, inicio); }
  bandeja.agregar('guardarAspecto', [{ color: color, estilo: estilo }], 'guardar tu color y tu tablero');
  pintarAspecto();
}

document.querySelectorAll('.tabs .tab[data-tab]').forEach(function (t) {
  t.addEventListener('click', function () { ir(t.dataset.tab); });
});
$('b-cuenta').addEventListener('click', function () { abrir('cuenta'); });
$('b-volver').addEventListener('click', volver);
$('b-salir').addEventListener('click', salir);

// Pedidos del formulario que quedaron guardados en este teléfono: la app también los manda
PedidosGuardados.alCambiar(function () {
  PedidosGuardados.pendientes().then(function (n) { APP.pedidosPendientes = n; pintarSinRed(); });
});
PedidosGuardados.procesar();

/** Los chats son del WhatsApp de Feli: los ven solo los admins de "Ven los chats" (Admin → Ajustes; Feli, 2026-10-06). */
function veChats() { return !!(APP.yo && APP.yo.admin && APP.yo.chats !== false); }

/** Paso 7: ¿ese chat es de uno de sus WhatsApp? (un chat de otra línea termina en "#clave"). Sin el dato (servidor viejo), sí. */
function chatEsMio(chat) {
  if (!veChats() || !chat) return false;
  const l = APP.yo.lineas;
  if (!l) return true;
  const i = String(chat).indexOf('#');
  return l.indexOf(i === -1 ? (APP.yo.lineaLegado || '') : String(chat).slice(i + 1)) !== -1;
}
