'use strict';
/* ============================================================
   ADMIN (Fase 2, Paso 6): solo administradores
   ------------------------------------------------------------
   Un menú con cuatro botones (Feli: que no quede todo junto) y una
   pantalla para cada uno:
   - Personas y dispositivos: altas, cambios, bajas y las sesiones de
     cada uno (cerrar una o todas).
   - Proveedores: teléfono, mail, notas, activo y rubros (hasta 4 por
     rubro: avisa, no frena).
   - Ajustes: granjas (renombrar cambia también los pedidos viejos) y
     cada cuántos días avisa la Tanda verde.
   - Pedido masivo: título, descripción y PDF, compartido con los
     encargados que se elijan (Feli sacó la lista pegada). Paso 6: también
     un servicio masivo.
   - Padrón (Paso 6): los productos, sus variantes, cuándo se pidieron y a
     quién se cotizó; agregar, cambiar, desactivar y variantes.
   Todo esto necesita señal: se manda directo, no por la bandeja.
   ============================================================ */

const AD = {
  personas: null, yo: '', sesion: '',
  provs: null,                 // {proveedores, rubros, maximo}
  ajustes: null,
  masivo: { id: '', urgencia: '', archivos: [], compartir: null, tipo: 'pedido' }
};

pantalla('admin', { titulo: 'Administración' });
pantalla('personas', { titulo: 'Personas y dispositivos', tab: 'admin', alMostrar: mostrarPersonas });
pantalla('proveedores', { titulo: 'Proveedores', tab: 'admin', alMostrar: mostrarProveedores });
pantalla('ajustes', { titulo: 'Ajustes', tab: 'admin', alMostrar: mostrarAjustes });
pantalla('masivo', { titulo: 'Pedido masivo', tab: 'admin', alMostrar: mostrarMasivo });
pantalla('padron', { titulo: 'Padrón', tab: 'admin', alMostrar: mostrarPadron });
pantalla('velocidad', { titulo: 'Velocidad y errores', tab: 'admin', alMostrar: mostrarVelocidad });

document.querySelectorAll('#s-admin [data-ir]').forEach(function (b) {
  b.addEventListener('click', function () { abrir(b.dataset.ir); });
});

/** Mensaje para cuando falla una llamada de Admin: tranquilo si es la señal. */
function textoDeError(r) {
  return r.sinConexion ? '📶 Poca señal: esto se hace con señal. Probá de nuevo en un rato.' : (r.error || 'No se pudo. Probá de nuevo en un rato.');
}
function notaAd(id, texto) { const el = $(id); if (el) el.textContent = texto || ''; }     // (no es estado() de base.js: esas notas no se esconden)

/** Un campo de texto del diálogo, con su etiqueta y una nota opcional. */
function campoDlg(id, etiqueta, valor, extra) {
  extra = extra || {};
  return '<div class="campo"><label for="' + id + '">' + esc(etiqueta) + '</label>' +
    (extra.area ? '<textarea id="' + id + '" maxlength="' + (extra.max || 1000) + '">' + esc(valor || '') + '</textarea>'
                : '<input type="' + (extra.tipo || 'text') + '" id="' + id + '" maxlength="' + (extra.max || 80) + '" autocomplete="off"' +
                  (extra.placeholder ? ' placeholder="' + esc(extra.placeholder) + '"' : '') + (extra.inputmode ? ' inputmode="' + extra.inputmode + '"' : '') +
                  ' value="' + esc(valor || '') + '">') +
    (extra.nota ? '<p class="nota">' + extra.nota + '</p>' : '') + '</div>';
}
const NOTA_TELEFONO = 'Con código de país, sin 0 ni 15. Ejemplo: <b>5493525415029</b>. Se comprueba que tenga WhatsApp.';

/* ============================================================
   PERSONAS Y DISPOSITIVOS
   ============================================================ */
const ROL_CORTO = { admin: 'Admin', encargado: 'Encargado', empleado: 'Empleado' };

async function mostrarPersonas() {
  if (!AD.personas) notaAd('pe-estado', 'Cargando…');
  pintarPersonas();
  const r = await api('getPersonas');
  if (r.ok) { AD.personas = r.personas; AD.yo = r.yo; AD.sesion = r.sesion; AD.granjasTransf = r.granjas || []; notaAd('pe-estado', ''); }
  else notaAd('pe-estado', textoDeError(r));
  pintarPersonas();
}

function pintarPersonas() {
  const cont = $('pe-lista');
  const l = AD.personas || [];
  const abiertos = {};
  cont.querySelectorAll('details[open]').forEach(function (d) { abiertos[d.dataset.id] = true; });
  cont.innerHTML = l.map(function (p) {
    const yo = p.id === AD.yo;
    const n = p.dispositivos.length;
    return '<details class="ad-item' + (p.activo ? '' : ' baja') + '" data-id="' + esc(p.id) + '"' + (abiertos[p.id] ? ' open' : '') + '>' +
      '<summary><span class="inicial" aria-hidden="true">' + esc(inicial(p.nombre)) + '</span>' +
        '<span class="ad-nom"><b>' + esc(p.nombre) + (yo ? ' (vos)' : '') + '</b>' +
        '<small>' + (p.activo ? (n ? n + (n === 1 ? ' dispositivo' : ' dispositivos') : 'Sin dispositivos') : 'Dada de baja') + '</small></span>' +
        '<span class="tag' + (p.rol === 'admin' ? ' admin' : '') + '">' + (ROL_CORTO[p.rol] || 'Empleado') + '</span></summary>' +
      '<div class="ad-cuerpo">' +
        '<dl class="ad-datos"><dt>Teléfono</dt><dd>' + esc(p.telefono || '—') + '</dd>' +
        (p.rol === 'encargado' ? '<dt>Granjas</dt><dd>' + esc((p.granjas || []).join(', ') || 'Ninguna todavía') + '</dd>' : '') +
        '<dt>Avisos por WhatsApp</dt><dd>' + (p.avisos ? 'Sí (menciones, recordatorios)' : 'No') + '</dd></dl>' +
        (p.activo ? '<h3>Dispositivos</h3>' + (n ? '<ul class="ad-disp">' + p.dispositivos.map(function (d) {
            const este = d.id === AD.sesion;
            return '<li><span><b>' + esc(d.dispositivo || 'Dispositivo') + (este ? ' · este' : '') + (d.prueba ? ' · 🧪 prueba' : '') + '</b>' +
              '<small>Último uso: ' + esc(d.ultimoUso ? hace(d.ultimoUso) : '—') + ' · entró ' + esc(d.creada ? new Date(d.creada).toLocaleDateString('es-AR') : '') + '</small></span>' +
              '<button type="button" class="btn-chico" data-cerrar="' + esc(d.id) + '">Cerrar sesión</button></li>';
          }).join('') + '</ul>' : '<p class="nota">No tiene la app abierta en ningún dispositivo.</p>') : '') +
        '<div class="ad-acciones">' +
          '<button type="button" class="btn2" data-editar="' + esc(p.id) + '">✏️ Editar</button>' +
          (p.activo && n > 1 ? '<button type="button" class="btn2" data-cerrar-todos="' + esc(p.id) + '">Cerrar en todos</button>' : '') +
          (yo ? '' : p.activo ? '<button type="button" class="btn2 peligro-btn2" data-baja="' + esc(p.id) + '">Dar de baja</button>'
                              : '<button type="button" class="btn2" data-alta="' + esc(p.id) + '">Volver a dar de alta</button>') +
        '</div>' +
      '</div></details>';
  }).join('');
  const buscar = function (id) { return l.filter(function (p) { return p.id === id; })[0]; };
  cont.querySelectorAll('[data-editar]').forEach(function (b) { b.addEventListener('click', function () { editarPersona(buscar(b.dataset.editar)); }); });
  cont.querySelectorAll('[data-cerrar]').forEach(function (b) { b.addEventListener('click', function () { cerrarDisp({ idSesion: b.dataset.cerrar }); }); });
  cont.querySelectorAll('[data-cerrar-todos]').forEach(function (b) { b.addEventListener('click', function () { cerrarDisp({ idUsuario: b.dataset.cerrarTodos }, buscar(b.dataset.cerrarTodos)); }); });
  cont.querySelectorAll('[data-baja]').forEach(function (b) { b.addEventListener('click', function () { activarPersona(buscar(b.dataset.baja), false); }); });
  cont.querySelectorAll('[data-alta]').forEach(function (b) { b.addEventListener('click', function () { activarPersona(buscar(b.dataset.alta), true); }); });
}

$('pe-nuevo').addEventListener('click', function () { editarPersona(null); });

/** Alta (p = null) o cambio. previo: lo que se había escrito, si el servidor no lo aceptó (se vuelve a abrir con eso). */
async function editarPersona(p, previo) {
  const yo = !!p && p.id === AD.yo;
  const v = previo || { nombre: p ? p.nombre : '', telefono: p ? p.telefono : '', rol: p ? p.rol : 'empleado', avisos: p ? p.avisos : true,
                        granjas: p ? (p.granjas || []) : [] };
  let rol = v.rol;
  // Las granjas para elegir (de la lista de envíos de Transferencias), más las que ya tenga y ya no estén
  const granjas = (AD.granjasTransf || []).concat((v.granjas || []).filter(function (g) { return (AD.granjasTransf || []).indexOf(g) === -1; }));
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = campoDlg('pp-nombre', 'Nombre', v.nombre, { max: 60, placeholder: 'Como aparece en la app' }) +
    campoDlg('pp-tel', 'Teléfono (WhatsApp)', v.telefono, { tipo: 'tel', max: 20, inputmode: 'tel', placeholder: '5493525415029', nota: NOTA_TELEFONO + ' Ahí le llega el código para entrar.' }) +
    '<div class="campo"><label>Rol</label><div class="seg" id="pp-rol">' +
      '<button type="button" data-rol="empleado">Empleado</button><button type="button" data-rol="encargado">Encargado</button><button type="button" data-rol="admin">Admin</button></div>' +
      (yo ? '<p class="nota">Tu propio rol lo cambia otro admin.</p>'
          : '<p class="nota">Admin: ve y maneja todo. Encargado: un encargado de granja; arma los pedidos de transferencia de sus granjas. ' +
            'Empleado: el resto. En Compras, encargados y empleados cargan pedidos y ven los suyos.</p>') + '</div>' +
    '<div class="campo" id="pp-granjas-c"><label>Granjas</label><div class="pila" id="pp-granjas">' +
      granjas.map(function (g) {
        return '<label class="check"><input type="checkbox" value="' + esc(g) + '"' + ((v.granjas || []).indexOf(g) !== -1 ? ' checked' : '') + '> ' + esc(g) + '</label>';
      }).join('') + '</div><p class="nota">Las granjas para las que arma pedidos en Transferencias.</p></div>' +
    '<label class="check"><input type="checkbox" id="pp-avisos"> Recibe avisos por WhatsApp (menciones y recordatorios)</label>';
  const datos = await dialogo({
    titulo: p ? 'Editar a ' + p.nombre : 'Agregar persona', cuerpo: cuerpo,
    botones: [{ texto: 'Guardar', clase: 'btn', id: 'dg-ok', valor: function () {
      return { id: p ? p.id : '', nombre: $('pp-nombre').value.trim(), telefono: $('pp-tel').value.trim(), rol: rol, avisos: $('pp-avisos').checked,
               granjas: [].map.call($('pp-granjas').querySelectorAll('input:checked'), function (x) { return x.value; }) };
    } }, { texto: 'Volver', valor: null }],
    alAbrir: function () {
      $('pp-avisos').checked = v.avisos !== false;
      const pintarRol = function () {
        $('pp-rol').querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.rol === rol)); b.disabled = yo; });
        $('pp-granjas-c').hidden = rol !== 'encargado';
      };
      $('pp-rol').querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { rol = b.dataset.rol; pintarRol(); }); });
      pintarRol();
      const revisar = function () { $('dg-ok').disabled = $('pp-nombre').value.trim().length < 2 || $('pp-tel').value.replace(/\D/g, '').length < 10; };
      $('pp-nombre').addEventListener('input', revisar);
      $('pp-tel').addEventListener('input', revisar);
      revisar();
      if (!p) $('pp-nombre').focus();
    }
  });
  if (!datos) return;
  aviso('Guardando…');
  const r = await api('guardarPersona', datos);
  if (!r.ok) { aviso(textoDeError(r), 'bad'); return editarPersona(p, datos); }
  if (r.aviso) aviso(r.aviso, 'bad');                     // Paso 8: se guardó sin poder comprobar el WhatsApp
  else aviso(p ? 'Listo: se guardaron los cambios.' : 'Listo: ' + datos.nombre + ' ya puede entrar con su teléfono.');
  mostrarPersonas();
}

async function cerrarDisp(o, persona) {
  const este = o.idSesion && o.idSesion === AD.sesion;
  const pregunta = este ? 'Es este dispositivo: vas a tener que entrar de nuevo con el código de WhatsApp.'
                 : o.idUsuario ? 'Se cierra la app en todos los dispositivos de ' + persona.nombre + '. Para volver a entrar, pide el código de nuevo.'
                 : 'Se cierra la app en ese dispositivo. Para volver a entrar, pide el código de nuevo.';
  const si = await dialogo({ titulo: '¿Cerrar la sesión?', texto: pregunta,
    botones: [{ texto: 'Sí, cerrar', clase: 'btn peligro-btn', valor: true }, { texto: 'Volver', valor: null }] });
  if (!si) return;
  const r = await api('cerrarDispositivos', o);
  if (!r.ok) return aviso(textoDeError(r), 'bad');
  if (este) return;                                   // la próxima llamada ya pide entrar de nuevo
  aviso(r.cerrados === 1 ? 'Sesión cerrada.' : r.cerrados + ' sesiones cerradas.');
  mostrarPersonas();
}

async function activarPersona(p, activo) {
  if (!activo) {
    const si = await dialogo({ titulo: '¿Dar de baja a ' + p.nombre + '?',
      texto: 'No se borra: sus pedidos quedan como están. Se le cierra la app en todos sus dispositivos y ya no puede entrar. Se puede volver a dar de alta.',
      botones: [{ texto: 'Sí, dar de baja', clase: 'btn peligro-btn', valor: true }, { texto: 'Volver', valor: null }] });
    if (!si) return;
  }
  const r = await api('activarPersona', p.id, activo);
  if (!r.ok) return aviso(textoDeError(r), 'bad');
  aviso(activo ? p.nombre + ' puede volver a entrar.' : p.nombre + ' quedó dada de baja.');
  mostrarPersonas();
}

/* ============================================================
   PROVEEDORES
   ============================================================ */
async function mostrarProveedores() {
  if (!AD.provs) notaAd('pv-estado', 'Cargando…');
  else pintarProveedores();
  const r = await api('getProveedoresAdmin');
  if (r.ok) { AD.provs = r; notaAd('pv-estado', ''); }
  else if (!AD.provs) { notaAd('pv-estado', textoDeError(r)); return; }
  armarRubrosFiltro();
  pintarProveedores();
}

function armarRubrosFiltro() {
  const sel = $('pv-rubro'), actual = sel.value, max = AD.provs.maximo;
  sel.innerHTML = '<option value="">Todos</option>' + AD.provs.rubros.map(function (x) {
    return '<option value="' + esc(x.nombre) + '">' + esc(x.nombre) + ' (' + x.proveedores + ')' + (x.proveedores > max ? ' ⚠️' : '') + '</option>';
  }).join('');
  sel.value = actual;
}

function pintarProveedores() {
  if (!AD.provs) return;
  const q = sinTildes($('pv-q').value.trim()), rubro = $('pv-rubro').value, ver = $('pv-ver').value;
  const l = AD.provs.proveedores.filter(function (p) {
    if (rubro && p.rubros.indexOf(rubro) === -1) return false;
    if (ver === 'sintel' && p.telefono) return false;
    if (ver === 'inactivos' ? p.activo : false) return false;
    if (ver !== 'inactivos' && !p.activo && ver !== '') return false;
    return !q || sinTildes(p.nombre + ' ' + p.telefono + ' ' + p.rubros.join(' ')).indexOf(q) !== -1;
  });
  const sinTel = AD.provs.proveedores.filter(function (p) { return p.activo && !p.telefono; }).length;
  let nota = l.length + (l.length === 1 ? ' proveedor' : ' proveedores') + (sinTel ? ' · ' + sinTel + ' activos sin teléfono (hacen falta para cotizar)' : '');
  if (rubro) {
    const r = AD.provs.rubros.filter(function (x) { return x.nombre === rubro; })[0];
    if (r && r.proveedores > AD.provs.maximo) nota = '⚠️ ' + rubro + ' tiene ' + r.proveedores + ' proveedores activos: lo acordado es hasta ' + AD.provs.maximo + '. ' + nota;
  }
  notaAd('pv-estado', nota);
  $('pv-lista').innerHTML = l.map(function (p) {
    return '<button type="button" class="ad-item ad-fila' + (p.activo ? '' : ' baja') + '" data-id="' + esc(p.id) + '">' +
      '<span class="ad-nom"><b>' + esc(p.nombre) + '</b>' +
      '<small>' + (p.telefono ? esc(p.telefono) : '⚠️ Sin teléfono') + (p.activo ? '' : ' · Desactivado') + '</small>' +
      (p.rubros.length ? '<span class="ad-chips">' + p.rubros.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + '</span>'
                       : '<small>Sin rubros</small>') + '</span><span class="ad-flecha" aria-hidden="true">›</span></button>';
  }).join('') || '<p class="nota">No hay proveedores con eso.</p>';
  $('pv-lista').querySelectorAll('[data-id]').forEach(function (b) {
    b.addEventListener('click', function () { editarProveedor(AD.provs.proveedores.filter(function (p) { return p.id === b.dataset.id; })[0]); });
  });
}
$('pv-q').addEventListener('input', pintarProveedores);
$('pv-rubro').addEventListener('change', pintarProveedores);
$('pv-ver').addEventListener('change', pintarProveedores);
$('pv-nuevo').addEventListener('click', function () { if (AD.provs) editarProveedor(null); });

/** Alta (p = null) o cambio de un proveedor, con sus rubros. */
async function editarProveedor(p, previo) {
  const v = previo || { nombre: p ? p.nombre : '', telefono: p ? p.telefono : '', email: p ? p.email : '', notas: p ? p.notas : '',
                        contacto: p ? (p.contacto || '') : '', activo: p ? p.activo : true, rubros: p ? p.rubros.slice() : [],
                        otros: p ? (p.otros || []).join(', ') : '' };
  const elegidos = {};
  v.rubros.forEach(function (c) { elegidos[c] = true; });
  const max = AD.provs.maximo;
  const cuenta = {};
  AD.provs.rubros.forEach(function (x) { cuenta[x.nombre] = x.proveedores; });
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = campoDlg('pr-nombre', 'Nombre', v.nombre, { max: 80 }) +
    campoDlg('pr-tel', 'Teléfono (WhatsApp)', v.telefono, { tipo: 'tel', max: 20, inputmode: 'tel', placeholder: '5493525415029', nota: NOTA_TELEFONO + ' Ahí le van a llegar los pedidos de cotización.' }) +
    // Paso 7 (Feli, 2026-10-07): otros números del proveedor (para cargar sus presupuestos desde ese chat; no se le piden cotizaciones ahí)
    campoDlg('pr-otros', 'Otros números (opcional)', v.otros, { max: 200, inputmode: 'tel', placeholder: '5493525415029, 5493515551234', nota: 'Separados por coma. Sirven para cargar sus presupuestos desde esos chats; las cotizaciones se piden al de arriba.' }) +
    campoDlg('pr-mail', 'Mail (opcional)', v.email, { tipo: 'email', max: 120 }) +
    campoDlg('pr-notas', 'Notas (opcional)', v.notas, { area: true, max: 1000 }) +
    '<div class="campo"><label>Rubros</label><p class="nota">A qué rubros se le pide cotización. Hasta ' + max + ' proveedores por rubro.</p>' +
      '<div class="pr-rubros" id="pr-rubros"></div></div>' +
    '<label class="check"><input type="checkbox" id="pr-activo"> Activo (si no, no se le piden cotizaciones)</label>';
  const datos = await dialogo({
    titulo: p ? p.nombre : 'Agregar proveedor', cuerpo: cuerpo,
    botones: [{ texto: 'Guardar', clase: 'btn', id: 'dg-ok', valor: function () {
      return { id: p ? p.id : '', nombre: $('pr-nombre').value.trim(), telefono: $('pr-tel').value.trim(), email: $('pr-mail').value.trim(),
               notas: $('pr-notas').value.trim(), contacto: undefined, otros: $('pr-otros').value.trim(), activo: $('pr-activo').checked,
               rubros: Object.keys(elegidos).filter(function (c) { return elegidos[c]; }).sort() };
    } }, { texto: 'Volver', valor: null }],
    alAbrir: function () {
      $('pr-activo').checked = v.activo !== false;
      const pintarRubros = function () {
        $('pr-rubros').innerHTML = AD.provs.rubros.map(function (x) {
          const antes = p && p.rubros.indexOf(x.nombre) !== -1;
          const n = (cuenta[x.nombre] || 0) + (elegidos[x.nombre] && !antes ? 1 : 0) - (!elegidos[x.nombre] && antes ? 1 : 0);
          return '<button type="button" class="chip-sel" data-r="' + esc(x.nombre) + '" aria-pressed="' + !!elegidos[x.nombre] + '">' + esc(x.nombre) +
            ' <small>' + n + '/' + max + (n > max ? ' ⚠️' : '') + '</small></button>';
        }).join('');
        $('pr-rubros').querySelectorAll('[data-r]').forEach(function (b) {
          b.addEventListener('click', function () { elegidos[b.dataset.r] = !elegidos[b.dataset.r]; pintarRubros(); });
        });
      };
      pintarRubros();
      const revisar = function () { $('dg-ok').disabled = $('pr-nombre').value.trim().length < 2; };
      $('pr-nombre').addEventListener('input', revisar);
      revisar();
      if (!p) $('pr-nombre').focus();
    }
  });
  if (!datos) return;
  aviso('Guardando…');
  const r = await api('guardarProveedor', datos);
  if (!r.ok) { aviso(textoDeError(r), 'bad'); return editarProveedor(p, datos); }
  const antes = p ? p.rubros.slice().sort().join('|') : '';
  if (datos.rubros.join('|') !== antes) {
    const r2 = await api('rubrosProveedor', r.id, datos.rubros);
    if (!r2.ok) { aviso('Se guardó el proveedor, pero no los rubros: ' + textoDeError(r2), 'bad'); return mostrarProveedores(); }
  }
  const pasados = datos.rubros.filter(function (c) {
    const eraSuyo = p && p.rubros.indexOf(c) !== -1;
    return !eraSuyo && datos.activo && (cuenta[c] || 0) + 1 > max;
  });
  aviso(pasados.length ? 'Guardado. ⚠️ ' + pasados.join(', ') + ' ya pasa de ' + max + ' proveedores.' : 'Listo: se guardó ' + datos.nombre + '.');
  TB.datosProd = null;                              // que "Editar producto" traiga los proveedores nuevos
  mostrarProveedores();
}

/* ============================================================
   AJUSTES: granjas y Tanda verde
   ============================================================ */
async function mostrarAjustes() {
  if (!AD.ajustes) notaAd('aj-estado', 'Cargando…');
  pintarAjustes();
  const r = await api('getAjustes');
  if (r.ok) { AD.ajustes = r; notaAd('aj-estado', ''); }
  else notaAd('aj-estado', textoDeError(r));
  pintarAjustes();
}

function pintarAjustes() {
  const a = AD.ajustes;
  $('aj-granjas').innerHTML = a ? a.sitios.map(function (s) {
    return '<div class="ad-item ad-granja"><span class="ad-nom"><b>' + esc(s) + '</b></span>' +
      '<button type="button" class="btn-chico" data-renombrar="' + esc(s) + '">✏️ Cambiar nombre</button>' +
      (a.sitios.length > 1 ? '<button type="button" class="btn-chico" data-sacar="' + esc(s) + '">Sacar</button>' : '') + '</div>';
  }).join('') : '';
  $('aj-granjas').querySelectorAll('[data-renombrar]').forEach(function (b) { b.addEventListener('click', function () { renombrarGranja(b.dataset.renombrar); }); });
  $('aj-granjas').querySelectorAll('[data-sacar]').forEach(function (b) { b.addEventListener('click', function () { sacarGranja(b.dataset.sacar); }); });
  if (a && document.activeElement !== $('aj-dias')) $('aj-dias').value = a.diasTanda;
  // Si el servidor publicado todavía no tiene la Fase 3, Paso 2, se avisa (en vez de mostrar los textos vacíos)
  if (a && !a.cotizar) notaAd('aj-estado', 'Para los ajustes de "Pedir cotización" falta publicar la versión nueva (Deploy → Manage deployments → ✏️ → New version).');
  $('aj-cot-ok').disabled = !(a && a.cotizar);
  if (a && a.cotizar && !AD.cotizarPintado) {           // Pedir cotización (Fase 3): se llena una vez, para no pisar lo que se escribe
    AD.cotizarPintado = true;
    $('aj-prueba').checked = a.cotizar.prueba;
    $('aj-numero').value = a.cotizar.numeroPrueba || '';
    $('aj-msj-cot').value = a.cotizar.msjCotizacion || '';
    $('aj-msj-conf').value = a.cotizar.msjConfirmar || '';
    $('aj-msj-recprov').value = a.cotizar.msjRecordatorioProv || '';         // Fase 4, Paso 6
    $('aj-msj-recep').value = a.cotizar.msjRecepcion || '';                 // Fase 4, Paso 1-bis
    pintarPredisenados(a.cotizar.predisenados || []);                       // Fase 4, Paso 2
    $('aj-msj-recep2').value = a.cotizar.msjRecepcionRecordatorio || '';
    const ps = a.cotizar.personas || [];
    if (a.cotizar.aprobador && ps.indexOf(a.cotizar.aprobador) === -1) ps.unshift(a.cotizar.aprobador);
    $('aj-aprobador').innerHTML = ps.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('');
    $('aj-aprobador').value = a.cotizar.aprobador || '';
    // Paso 7: con los WhatsApp de cada comprador cargados, cada uno ve el suyo (y ya no hace falta "Ven los chats")
    const lineas = a.cotizar.lineas || [];
    $('aj-lineas-c').hidden = !lineas.length;
    $('aj-chats-ven-c').hidden = !!lineas.length;
    $('aj-lineas').innerHTML = lineas.map(function (l) { return '<div>📱 ' + esc(l.nombre) + (l.principal ? ' <small>(principal)</small>' : '') + '</div>'; }).join('');
    // Quiénes ven los chats (Feli, 2026-10-06)
    const ven = a.cotizar.chatsVen || [], ads = (a.cotizar.admins || []).slice();
    ven.forEach(function (n) { if (ads.indexOf(n) === -1) ads.push(n); });
    $('aj-chats-ven').innerHTML = a.cotizar.admins ? ads.map(function (n) {
      return '<label class="pa-check"><input type="checkbox" value="' + esc(n) + '"' + (ven.indexOf(n) !== -1 ? ' checked' : '') + '> ' + esc(n) + '</label>';
    }).join('') : '';
  }
}

/** Después de cambiar las granjas: los filtros y el pedido masivo usan la lista nueva sin volver a abrir la app. */
function granjasCambiadas(sitios) {
  AD.ajustes.sitios = sitios;
  APP.config.sitios = sitios;
  if (typeof BU !== 'undefined') BU.armado = false;
  const sel = $('tb-sitio'), actual = sel.value;
  if (sel && APP.yo.admin) {
    sel.innerHTML = '<option value="">Ver todos</option>' + sitios.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
    sel.value = sitios.indexOf(actual) !== -1 ? actual : '';
    if (TB.filtros && sel.value !== TB.filtros.sitio) { TB.filtros.sitio = sel.value; }
  }
  AD.masivo.sitiosArmados = false;
  pintarAjustes();
}

/** Un nombre (granja), con una nota abajo. Devuelve el texto o null. */
function pedirNombre(titulo, actual, nota) {
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = campoDlg('dg-nombre', 'Nombre', actual, { max: 60, nota: esc(nota) });
  return dialogo({ titulo: titulo, cuerpo: cuerpo,
    botones: [{ texto: 'Guardar', clase: 'btn', id: 'dg-ok', valor: function () { return $('dg-nombre').value.trim(); } }, { texto: 'Volver', valor: null }],
    alAbrir: function () {
      const revisar = function () { $('dg-ok').disabled = $('dg-nombre').value.trim().length < 2; };
      $('dg-nombre').addEventListener('input', revisar);
      revisar();
      $('dg-nombre').focus();
    } });
}

async function granjaOp(op, texto) {
  const r = await api('cambiarGranja', op);
  if (!r.ok) { aviso(textoDeError(r), 'bad'); return false; }
  granjasCambiadas(r.sitios);
  aviso(texto(r));
  if (op.accion === 'renombrar' && r.pedidos) cargarTablero();
  return true;
}

$('aj-granja-nueva').addEventListener('click', async function () {
  if (!AD.ajustes) return;
  const nombre = await pedirNombre('Agregar sitio', '', 'Aparece en el formulario y en los filtros.');
  if (nombre) granjaOp({ accion: 'agregar', nombre: nombre }, function () { return 'Listo: se agregó ' + nombre + '.'; });
});

async function renombrarGranja(viejo) {
  const nuevo = await pedirNombre('Cambiar el nombre de ' + viejo, viejo, 'Cambia también en los pedidos viejos de ' + viejo + '.');
  if (!nuevo || nuevo === viejo) return;
  granjaOp({ accion: 'renombrar', nombre: viejo, nuevo: nuevo }, function (r) {
    return 'Listo: ahora se llama ' + nuevo + '.' + (r.pedidos ? ' También se cambió en ' + r.pedidos + (r.pedidos === 1 ? ' pedido.' : ' pedidos.') : '');
  });
}

async function sacarGranja(nombre) {
  const si = await dialogo({ titulo: '¿Sacar ' + nombre + '?', texto: 'Deja de aparecer en el formulario y en los filtros. Los pedidos viejos quedan como están. Se puede volver a agregar.',
    botones: [{ texto: 'Sí, sacarlo', clase: 'btn peligro-btn', valor: true }, { texto: 'Volver', valor: null }] });
  if (si) granjaOp({ accion: 'sacar', nombre: nombre }, function () { return 'Listo: se sacó ' + nombre + '.'; });
}

/* Fase 4, Paso 2: los mensajes prediseñados del chat (uno por cuadro; se guardan con el Guardar de "Pedir cotización") */
function pintarPredisenados(l) {
  $('aj-predis').innerHTML = '';
  l.forEach(function (t) { sumarPredisenado(t); });
}
function sumarPredisenado(t) {
  const fila = document.createElement('div');
  fila.className = 'aj-predis-f';
  fila.innerHTML = '<textarea rows="2"></textarea><button type="button" class="btn-chico" aria-label="Sacar este mensaje">Sacar</button>';
  fila.querySelector('textarea').value = t || '';
  fila.querySelector('button').addEventListener('click', function () { fila.remove(); });
  $('aj-predis').appendChild(fila);
  return fila;
}
function leerPredisenados() {
  return Array.prototype.map.call($('aj-predis').querySelectorAll('textarea'), function (x) { return x.value.trim(); }).filter(String);
}
$('aj-predis-mas').addEventListener('click', function () { sumarPredisenado('').querySelector('textarea').focus(); });

/** Un texto de Ajustes, o undefined si el servidor publicado todavía no lo tiene (así no se borra nada). */
function a_siHay(id) { return AD.ajustes && AD.ajustes.cotizar && AD.ajustes.cotizar.msjRecepcion !== undefined ? $(id).value : undefined; }
$('aj-cot-ok').addEventListener('click', async function () {
  const r = await api('guardarAjustesCotizar', {
    numeroPrueba: $('aj-numero').value, prueba: $('aj-prueba').checked, msjCotizacion: $('aj-msj-cot').value,
    msjConfirmar: $('aj-msj-conf').value, aprobador: $('aj-aprobador').value || undefined,
    msjRecepcion: a_siHay('aj-msj-recep'), msjRecepcionRecordatorio: a_siHay('aj-msj-recep2'),
    msjRecordatorioProv: AD.ajustes && AD.ajustes.cotizar && AD.ajustes.cotizar.msjRecordatorioProv !== undefined ? $('aj-msj-recprov').value : undefined,
    chatsVen: AD.ajustes && AD.ajustes.cotizar && AD.ajustes.cotizar.admins && !(AD.ajustes.cotizar.lineas || []).length ? Array.prototype.map.call(document.querySelectorAll('#aj-chats-ven input:checked'), function (x) { return x.value; }) : undefined,
    predisenados: AD.ajustes && AD.ajustes.cotizar && AD.ajustes.cotizar.predisenados !== undefined ? leerPredisenados() : undefined
  });
  if (!r.ok) return aviso(textoDeError(r), 'bad');
  AD.ajustes.cotizar = r.cotizar;
  aviso(r.cotizar.prueba ? 'Listo. 🧪 Modo prueba prendido: todo le llega al número de prueba.' : 'Listo. ⚠️ Modo prueba apagado: los pedidos de cotización les llegan a los proveedores.');
});

$('aj-dias-ok').addEventListener('click', async function () {
  const n = Number($('aj-dias').value);
  const r = await api('cambiarDiasTanda', n);
  if (!r.ok) return aviso(textoDeError(r), 'bad');
  AD.ajustes.diasTanda = r.dias;
  if (TB.datos && TB.datos.tanda) TB.datos.tanda.cada = r.dias;
  aviso('Listo: la Tanda verde avisa cada ' + r.dias + ' días.');
});

/* ============================================================
   PEDIDO MASIVO (Feli: solo el "libre")
   Título, granja, urgencia, descripción pegada como venga, con quién
   se comparte (encargados; nadie = solo los admins) y los adjuntos.
   El número del pedido ("M…") lo arma la app al empezar, así un
   reintento no lo duplica; cambia recién cuando se crea.
   ============================================================ */
function nuevoIdMasivo() { return 'M' + Date.now().toString(36).toUpperCase() + nuevoId().slice(-4); }

/** Los encargados activos (los admins ya ven todo). */
function encargados() {
  const admins = APP.config.admins || [];
  return (APP.config.usuarios || []).filter(function (n) { return admins.indexOf(n) === -1; });
}

/** Chips para elegir encargados. elegidos: {nombre: true}, se cambia en el lugar. */
function pintarChipsEncargados(cont, elegidos) {
  const l = encargados();
  cont.innerHTML = l.length ? l.map(function (n) {
    return '<button type="button" class="chip-sel" data-n="' + esc(n) + '" aria-pressed="' + !!elegidos[n] + '">' + esc(n) + '</button>';
  }).join('') : '<p class="nota">Todavía no hay encargados cargados.</p>';
  cont.querySelectorAll('[data-n]').forEach(function (b) {
    b.addEventListener('click', function () { elegidos[b.dataset.n] = !elegidos[b.dataset.n]; b.setAttribute('aria-pressed', String(!!elegidos[b.dataset.n])); });
  });
}
function elegidosLista(elegidos) { return Object.keys(elegidos).filter(function (n) { return elegidos[n]; }); }

function mostrarMasivo() {
  const m = AD.masivo;
  if (!m.id) m.id = nuevoIdMasivo();
  if (!m.compartir) m.compartir = {};
  if (!m.sitiosArmados) {
    m.sitiosArmados = true;
    const actual = $('ma-sitio').value;
    $('ma-sitio').innerHTML = '<option value="">Elegí el sitio</option>' + (APP.config.sitios || []).map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
    $('ma-sitio').value = actual;
  }
  const urg = APP.config.urgencias || [];
  if (!m.urgencia) m.urgencia = urg[urg.length - 1] || '';
  pintarChipsEncargados($('ma-compartir'), m.compartir);
  pintarMasivo();
}

function pintarMasivo() {
  const m = AD.masivo;
  $('ma-urg').innerHTML = (APP.config.urgencias || []).map(function (u) {
    return '<button type="button" data-u="' + esc(u) + '" aria-pressed="' + (u === m.urgencia) + '">' + esc(u) + '</button>';
  }).join('');
  $('ma-urg').querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { m.urgencia = b.dataset.u; pintarMasivo(); }); });
  // Paso 6: pedido o servicio masivo
  $('ma-tipo').querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.tipo === (m.tipo || 'pedido'))); });
  pintarArchivos();
  revisarMasivo();
}
$('ma-tipo').querySelectorAll('button').forEach(function (b) {
  b.addEventListener('click', function () { AD.masivo.tipo = b.dataset.tipo; pintarMasivo(); });
});

function revisarMasivo() {
  const m = AD.masivo;
  $('ma-crear').disabled = !$('ma-sitio').value || !m.urgencia || m.creando || $('ma-titulo').value.trim().length < 3;
  $('ma-crear').textContent = (m.tipo === 'servicio' ? 'Crear servicio masivo' : 'Crear pedido masivo') + (m.archivos.length ? ' (con ' + m.archivos.length + (m.archivos.length === 1 ? ' adjunto)' : ' adjuntos)') : '');
}
['ma-sitio', 'ma-titulo'].forEach(function (id) { $(id).addEventListener('input', revisarMasivo); $(id).addEventListener('change', revisarMasivo); });

/* Adjuntos: quedan acá hasta crear el pedido; después van por la cola de adjuntos de siempre */
$('ma-adj-b').addEventListener('click', function () { $('ma-adj').click(); });
$('ma-adj').addEventListener('change', function () {
  const files = Array.prototype.slice.call(this.files || []);
  this.value = '';
  files.forEach(function (f) {
    const esPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    if (!esPdf && !/^image\//.test(f.type)) return aviso('"' + f.name + '": solo fotos o PDF.', 'bad');
    if (esPdf && f.size > ADJUNTO_MAX_MB * 1024 * 1024) return aviso('"' + f.name + '" pesa más de ' + ADJUNTO_MAX_MB + ' MB.', 'bad');
    AD.masivo.archivos.push(f);
  });
  pintarArchivos();
  revisarMasivo();
});
function pintarArchivos() {
  const l = AD.masivo.archivos;
  $('ma-archivos').innerHTML = l.map(function (f, i) {
    return '<li><span>' + (/pdf$/i.test(f.name) || f.type === 'application/pdf' ? '📄 ' : '🖼️ ') + esc(f.name) + '</span>' +
      '<button type="button" class="icono" data-sacar-adj="' + i + '" aria-label="Sacar ' + esc(f.name) + '">×</button></li>';
  }).join('');
  $('ma-archivos').querySelectorAll('[data-sacar-adj]').forEach(function (b) {
    b.addEventListener('click', function () { l.splice(Number(b.dataset.sacarAdj), 1); pintarArchivos(); revisarMasivo(); });
  });
}

$('ma-crear').addEventListener('click', async function () {
  const m = AD.masivo;
  const d = { id: m.id, sitio: $('ma-sitio').value, urgencia: m.urgencia, razon: $('ma-razon').value.trim(),
              titulo: $('ma-titulo').value.trim(), descripcion: $('ma-desc').value.trim(), compartido: elegidosLista(m.compartir), tipo: m.tipo || 'pedido' };
  m.creando = true;
  revisarMasivo();
  notaAd('ma-estado', 'Creando el pedido…');
  const r = await api('crearMasivo', d);
  m.creando = false;
  if (!r.ok) { notaAd('ma-estado', textoDeError(r)); return revisarMasivo(); }
  const ref = r.ref || m.id;
  const archivos = m.archivos.slice();
  // Todo de nuevo para el próximo (con otro número)
  AD.masivo = { id: nuevoIdMasivo(), urgencia: m.urgencia, archivos: [], compartir: {}, sitiosArmados: true, tipo: m.tipo };
  ['ma-titulo', 'ma-desc', 'ma-razon'].forEach(function (id) { $(id).value = ''; });
  notaAd('ma-estado', '');
  pintarChipsEncargados($('ma-compartir'), AD.masivo.compartir);
  pintarMasivo();
  cargarTablero();
  if (d.tipo === 'servicio' && typeof cargarServicios === 'function') cargarServicios();
  await abrirTarjeta(ref);
  if (archivos.length) adjuntar(archivos, ref);       // se suben solos, como cualquier adjunto
  aviso((d.tipo === 'servicio' ? 'Listo: se creó el servicio (está en la pestaña Servicios)' : 'Listo: se creó el pedido masivo') + (d.compartido.length ? ', compartido con ' + d.compartido.join(', ') : '') + (archivos.length ? '. Los adjuntos se están subiendo.' : '.'));
});

/* ============================================================
   PADRÓN (Fase 3, Paso 6)
   Los productos del padrón con lo más importante de cada uno. Tocar uno
   abre el ✏️: nombre, rubro, proveedores particulares y variantes.
   "Desactivar" no lo borra: deja de aparecer y se puede volver a activar.
   ============================================================ */
const PA = { datos: null, mostrar: 50 };

async function mostrarPadron() {
  if (!PA.datos) notaAd('pa-estado', 'Cargando el padrón…');
  pintarPadron();
  const r = await api('getPadronAdmin');
  if (!r.ok) { notaAd('pa-estado', textoDeError(r)); return; }
  PA.datos = r;
  notaAd('pa-estado', '');
  const sel = $('pa-rubro'), actual = sel.value;
  sel.innerHTML = '<option value="">Todos los rubros</option><option value="__sin">Sin rubro</option>' +
    r.canales.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  sel.value = actual;
  pintarPadron();
}

function padronFiltrado() {
  const q = sinTildes($('pa-q').value.trim()), rubro = $('pa-rubro').value, inactivos = $('pa-inactivos').checked;
  return ((PA.datos && PA.datos.familias) || []).filter(function (f) {
    if (!inactivos && !f.activa) return false;
    if (rubro === '__sin' ? (f.canal || f.proveedores.length) : (rubro && f.canal !== rubro)) return false;
    if (!q) return true;
    return sinTildes(f.familia).indexOf(q) !== -1 || f.variantes.some(function (v) { return sinTildes(v).indexOf(q) !== -1; });
  });
}

function pintarPadron() {
  const l = padronFiltrado();
  const fecha = function (iso) { const d = new Date(iso); return isNaN(d) ? '' : d.getDate() + '/' + (d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2); };
  $('pa-lista').innerHTML = !PA.datos ? '' : !l.length ? '<p class="nota">No hay productos con ese filtro.</p>' :
    '<p class="nota" style="margin:0 0 6px">' + l.length + (l.length === 1 ? ' producto' : ' productos') + '</p>' +
    l.slice(0, PA.mostrar).map(function (f) {
      const donde = f.proveedores.length ? '🎯 ' + f.proveedores.map(function (x) { return x.nombre; }).join(', ') : (f.canal || 'Sin rubro');
      return '<button type="button" class="pa-item' + (f.activa ? '' : ' inactivo') + '" data-fam="' + esc(f.familia) + '">' +
        '<b>' + esc(f.familia) + (f.activa ? '' : ' <small>(desactivado)</small>') + '</b><small class="sub">' + esc(donde) + '</small>' +
        (f.variantes.length ? '<small class="sub">Variantes: ' + esc(f.variantes.join(', ')) + '</small>' : '') +
        '<small class="sub">' + (f.ultimo ? 'Último pedido: ' + esc(fecha(f.ultimo.fecha)) + ' · ' + esc(f.ultimo.sitio) + (f.veces > 1 ? ' (' + f.veces + ' veces)' : '') : 'Todavía no se pidió en la app') +
        (f.cotizado ? ' · Cotización: ' + esc(f.cotizado.proveedores.join(', ')) : '') + '</small>' +
        (f.comprado ? '<small class="sub">🛒 Comprado en ' + esc(f.comprado.proveedor) + ' el ' + esc(fecha(f.comprado.fecha)) +
          (f.comprado.precio !== null ? ' a ' + esc(plata(f.comprado.precio, f.comprado.moneda)) + (f.comprado.unidad ? ' (' + esc(f.comprado.unidad) + ')' : '') : '') + '</small>' : '') + '</button>';
    }).join('');
  $('pa-mas').hidden = l.length <= PA.mostrar;
  $('pa-lista').querySelectorAll('[data-fam]').forEach(function (b) { b.addEventListener('click', function () { editarFamiliaUI(b.dataset.fam); }); });
}
['pa-q', 'pa-rubro', 'pa-inactivos'].forEach(function (id) {
  $(id).addEventListener(id === 'pa-q' ? 'input' : 'change', function () { PA.mostrar = 50; pintarPadron(); });
});
$('pa-mas').addEventListener('click', function () { PA.mostrar += 100; pintarPadron(); });
$('pa-nuevo').addEventListener('click', function () { editarFamiliaUI(''); });

/** Después de cambiar el padrón: lo que la app tenía guardado (nombres para el ✏️) se vuelve a pedir. */
function padronCambiado() {
  if (typeof TB !== 'undefined') TB.datosProd = null;
  mostrarPadron();
}

async function editarFamiliaUI(nombre) {
  const f = nombre ? (PA.datos.familias.filter(function (x) { return x.familia === nombre; })[0]) : null;
  if (nombre && !f) return;
  const datos = await datosProductos();
  const provs = f ? f.proveedores.map(function (x) { return { id: x.id, nombre: x.nombre }; }) : [];
  const canales = (PA.datos.canales || []).slice();
  if (f && f.canal && canales.indexOf(f.canal) === -1) canales.push(f.canal);
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML =
    campoDlg('pf-nombre', 'Nombre', f ? f.familia : '', { max: 120, placeholder: 'Ej: Guantes de nitrilo', nota: 'Sin paréntesis: la medida o el tamaño van en la especificación de cada pedido.' + (f ? ' Si lo cambiás, el nombre de ahora queda como variante y los pedidos en curso pasan al nuevo.' : '') }) +
    '<div class="campo"><label for="pf-rubro">Rubro</label><select id="pf-rubro"></select><p class="nota" id="pf-rubro-nota" hidden>Con proveedores particulares va sin rubro.</p></div>' +
    '<div class="campo"><label for="sp-q">Proveedores particulares (opcional)</label>' + htmlSelectorProv() + '</div>' +
    // Variantes: en uno nuevo se guardan junto con el producto (Feli, 2026-10-04); en uno que ya está, al momento
    '<div class="campo"><label for="pf-var">Variantes (cómo lo escriben)</label><div class="pila" id="pf-vars" style="gap:6px"></div>' +
    '<div class="fila2"><input type="text" id="pf-var" maxlength="120" autocomplete="off" placeholder="Ej: guante de nitrilo"><button type="button" class="btn2" id="pf-var-ok" style="width:auto">Agregar</button></div></div>' +
    (f ? (f.ultimo ? '<p class="nota">Último pedido: ' + esc(new Date(f.ultimo.fecha).toLocaleDateString('es-AR')) + ' · ' + esc(f.ultimo.sitio) + ' (' + esc(f.ultimo.ref) + ')</p>' : '') +
         (f.cotizado ? '<p class="nota">Última cotización pedida a: ' + esc(f.cotizado.proveedores.join(', ')) + '</p>' : '') +
         (f.comprado ? '<p class="nota">Dónde se compró la última vez: ' + esc(f.comprado.proveedor) + ', el ' + esc(new Date(f.comprado.fecha).toLocaleDateString('es-AR')) +
           (f.comprado.precio !== null ? ', a ' + esc(plata(f.comprado.precio, f.comprado.moneda)) + (f.comprado.unidad ? ' (' + esc(f.comprado.unidad) + ')' : '') : '') + ' (' + esc(f.comprado.ref) + ')</p>'
           : '<p class="nota">Todavía no se compró en la app.</p>') : '');
  const variantes = f ? f.variantes.slice() : [];
  const pintarVars = function () {
    const el = $('pf-vars');
    if (!el) return;
    el.innerHTML = variantes.length ? '' : '<p class="nota" style="margin:0">Todavía no tiene variantes.</p>';
    variantes.forEach(function (v) {
      const d = document.createElement('div');
      d.className = 'elegido';
      d.innerHTML = '<span>' + esc(v) + '</span><button type="button" aria-label="Quitar la variante ' + esc(v) + '">×</button>';
      d.querySelector('button').addEventListener('click', async function () {
        if (!f) { variantes.splice(variantes.indexOf(v), 1); return pintarVars(); }
        const r = await api('varianteFamilia', f.familia, v, false);
        if (!r.ok) return aviso(textoDeError(r), 'bad');
        variantes.splice(variantes.indexOf(v), 1);
        f.variantes = variantes.slice();
        pintarVars();
        aviso('Listo: se quitó la variante "' + v + '".');
      });
      el.appendChild(d);
    });
  };
  const botones = [{ texto: f ? 'Guardar' : 'Agregar al padrón', clase: 'btn', id: 'dg-ok', valor: function () { return { guardar: true, nombre: $('pf-nombre').value.trim(), canal: $('pf-rubro').value }; } }];
  if (f) botones.push({ texto: f.activa ? 'Desactivar (borrar)' : 'Volver a activar', clase: 'btn2', valor: { activar: !f.activa } });
  botones.push({ texto: 'Volver', valor: null });
  const res = await dialogo({
    titulo: f ? 'Editar producto del padrón' : 'Agregar producto al padrón', cuerpo: cuerpo, botones: botones,
    alAbrir: function () {
      const sel = $('pf-rubro');
      sel.innerHTML = '<option value="">Sin rubro</option>' + canales.map(function (k) { return '<option>' + esc(k) + '</option>'; }).join('');
      sel.value = f ? f.canal : '';
      const revisar = function () {
        sel.hidden = provs.length > 0;
        $('pf-rubro-nota').hidden = !provs.length;
        $('dg-ok').disabled = $('pf-nombre').value.trim().length < 2;
      };
      $('pf-nombre').addEventListener('input', revisar);
      armarSelectorProv({ provs: provs, proveedores: datos ? datos.proveedores.slice() : [], datos: datos, rubro: function () { return sel.value; }, alCambiar: revisar });
      pintarVars();
      const sumarVariante = async function () {
        const t = $('pf-var').value.trim().replace(/\s+/g, ' ');
        if (t.length < 2) return;
        if (!f) {
          const k = sinTildes(t), nom = sinTildes($('pf-nombre').value.trim());
          if (k === nom) return aviso('Esa variante es el nombre mismo del producto.', 'bad');
          if (!variantes.some(function (x) { return sinTildes(x) === k; })) variantes.push(t);
          $('pf-var').value = '';
          return pintarVars();
        }
        const r = await api('varianteFamilia', f.familia, t, true);
        if (!r.ok) return aviso(textoDeError(r), 'bad');
        variantes.push(t);
        f.variantes = variantes.slice();
        $('pf-var').value = '';
        pintarVars();
        aviso(r.aviso || 'Listo: "' + t + '" ahora se reconoce como "' + f.familia + '".');
      };
      $('pf-var-ok').addEventListener('click', sumarVariante);
      $('pf-var').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); sumarVariante(); } });
      revisar();
    }
  });
  if (!res) { if (f) pintarPadron(); return; }
  if (res.activar !== undefined) {
    if (!res.activar) {
      const si = await dialogo({ titulo: '¿Desactivar "' + f.familia + '"?', texto: 'Deja de aparecer en el formulario y en la app. Los pedidos viejos lo siguen mostrando bien, y se puede volver a activar.',
        botones: [{ texto: 'Sí, desactivar', clase: 'btn', valor: true }, { texto: 'Volver', valor: null }] });
      if (!si) return;
    }
    const r = await api('activarFamilia', f.familia, res.activar);
    if (!r.ok) return aviso(textoDeError(r), 'bad');
    aviso(res.activar ? 'Listo: "' + f.familia + '" volvió al padrón.' : 'Listo: "' + f.familia + '" quedó desactivado.');
    return padronCambiado();
  }
  const d = { original: f ? f.familia : '', nombre: res.nombre, canal: provs.length ? '' : res.canal, proveedores: provs.map(function (x) { return x.id; }) };
  if (!f) d.variantes = variantes.slice();
  const r = await api('guardarFamilia', d);
  if (!r.ok) return aviso(textoDeError(r), 'bad');
  aviso('Listo' + (r.hechos && r.hechos.length ? ': ' + r.hechos.join('. ') : '') + '.');
  padronCambiado();
}


/* ============================================================
   VELOCIDAD Y ERRORES (Fase 4, Paso 8; Feli, 2026-10-09)
   Por día: cuántas veces se usó la app, cuánto tardó y qué falló, separado
   en Google, "muchos cambios a la vez" (la llave), la app y lo que les pasó
   a los teléfonos (sin señal, Google tardó). Lo más lento, por función, y
   quién tuvo más problemas de señal.
   ============================================================ */
async function mostrarVelocidad() {
  notaAd('ve-estado', 'Cargando…');
  const r = await api('getVelocidad', Number($('ve-dias').value) || 7);
  if (!r.ok) return notaAd('ve-estado', textoDeError(r));
  notaAd('ve-estado', '');
  const seg = function (n) { return n ? String(n).replace('.', ',') + ' s' : '—'; };
  const num = function (n) { return n ? String(n) : '—'; };
  const tabla = function (cab, filas, vacio) {
    if (!filas.length) return '<p class="nota">' + esc(vacio) + '</p>';
    return '<div class="ve-tabla"><table><thead><tr>' + cab.map(function (c, i) { return '<th' + (i ? ' class="n"' : '') + '>' + esc(c) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + filas.map(function (f) {
        return '<tr>' + f.map(function (c, i) { return '<td' + (i ? ' class="n"' : '') + '>' + esc(c) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  };
  const diaLindo = function (d) { const p = d.split('-'); return p[2] + '/' + p[1]; };
  $('ve-cuerpo').innerHTML =
    '<div class="ve-bloque"><h3>Por día</h3>' +
    '<p class="nota">Del servidor: <b>Google</b> = Google (u OpenAI / WhatsApp) no anduvo; <b>Muchos cambios</b> = había muchos cambios a la vez y uno no llegó a entrar; ' +
    '<b>App</b> = una falla de programación (estas te llegan por mail). De los teléfonos: <b>Sin señal</b> (el teléfono no tenía internet), ' +
    '<b>Google no contestó</b> (había internet), <b>Google tardó</b> (más de 25 s). <b>En el teléfono</b> = lo que espera la persona, con Google despertando y su costo fijo; ' +
    '<b>En Google</b> = solo nuestro código.</p>' +
    tabla(['Día', 'Llamadas', 'En el teléfono', 'En Google', 'Más lenta (teléfono)', 'Google', 'Muchos cambios', 'App', 'Sin señal', 'Google no contestó', 'Google tardó'],
      r.dias.map(function (d) { return [diaLindo(d.dia), num(d.llamadas), seg(d.telefono), seg(d.promedio), seg(d.telefonoMax), num(d.google), num(d.espera), num(d.app), num(d.senal), num(d.nocontesto), num(d.lento)]; }),
      'Todavía no hay datos: se empiezan a anotar desde que se publicó esta versión.') + '</div>' +
    '<div class="ve-bloque"><h3>Lo más lento</h3>' +
    '<p class="nota"><b>Esperó la llave</b>: cuánto esperó a que otro terminara de cambiar datos. <b>Tuvo la llave</b>: cuánto hizo esperar a los demás.</p>' +
    tabla(['Qué', 'Veces', 'En el teléfono', 'Máx. teléfono', 'En Google', 'Máx. Google', 'Esperó la llave (máx.)', 'Tuvo la llave (máx.)', 'Fallas'],
      r.lentas.map(function (f) { return [f.fn, num(f.llamadas), seg(f.telefono), seg(f.telefonoMax), seg(f.promedio), seg(f.maximo), seg(f.esperaMax), seg(f.tenidaMax), num(f.fallas)]; }),
      'Todavía no hay datos.') + '</div>' +
    '<div class="ve-bloque"><h3>Teléfonos</h3>' +
    tabla(['Persona', 'Sin señal', 'Google no contestó', 'Google tardó', 'Respuesta rara'],
      r.personas.map(function (p) { return [p.persona, num(p.senal), num(p.nocontesto), num(p.lento), num(p.raro)]; }),
      'Ningún teléfono avisó problemas.') + '</div>';
}
$('ve-dias').addEventListener('change', mostrarVelocidad);
$('ve-actualizar').addEventListener('click', mostrarVelocidad);

