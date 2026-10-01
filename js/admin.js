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
     encargados que se elijan (Feli sacó la lista pegada).
   Todo esto necesita señal: se manda directo, no por la bandeja.
   ============================================================ */

const AD = {
  personas: null, yo: '', sesion: '',
  provs: null,                 // {proveedores, rubros, maximo}
  ajustes: null,
  masivo: { id: '', urgencia: '', archivos: [], compartir: null }
};

pantalla('admin', { titulo: 'Administración' });
pantalla('personas', { titulo: 'Personas y dispositivos', tab: 'admin', alMostrar: mostrarPersonas });
pantalla('proveedores', { titulo: 'Proveedores', tab: 'admin', alMostrar: mostrarProveedores });
pantalla('ajustes', { titulo: 'Ajustes', tab: 'admin', alMostrar: mostrarAjustes });
pantalla('masivo', { titulo: 'Pedido masivo', tab: 'admin', alMostrar: mostrarMasivo });

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
  aviso(p ? 'Listo: se guardaron los cambios.' : 'Listo: ' + datos.nombre + ' ya puede entrar con su teléfono.');
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
                        activo: p ? p.activo : true, rubros: p ? p.rubros.slice() : [] };
  const elegidos = {};
  v.rubros.forEach(function (c) { elegidos[c] = true; });
  const max = AD.provs.maximo;
  const cuenta = {};
  AD.provs.rubros.forEach(function (x) { cuenta[x.nombre] = x.proveedores; });
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = campoDlg('pr-nombre', 'Nombre', v.nombre, { max: 80 }) +
    campoDlg('pr-tel', 'Teléfono (WhatsApp)', v.telefono, { tipo: 'tel', max: 20, inputmode: 'tel', placeholder: '5493525415029', nota: NOTA_TELEFONO + ' Ahí le van a llegar los pedidos de cotización.' }) +
    campoDlg('pr-mail', 'Mail (opcional)', v.email, { tipo: 'email', max: 120 }) +
    campoDlg('pr-notas', 'Notas (opcional)', v.notas, { area: true, max: 1000 }) +
    '<div class="campo"><label>Rubros</label><p class="nota">A qué rubros se le pide cotización. Hasta ' + max + ' proveedores por rubro.</p>' +
      '<div class="pr-rubros" id="pr-rubros"></div></div>' +
    '<label class="check"><input type="checkbox" id="pr-activo"> Activo (si no, no se le piden cotizaciones)</label>';
  const datos = await dialogo({
    titulo: p ? p.nombre : 'Agregar proveedor', cuerpo: cuerpo,
    botones: [{ texto: 'Guardar', clase: 'btn', id: 'dg-ok', valor: function () {
      return { id: p ? p.id : '', nombre: $('pr-nombre').value.trim(), telefono: $('pr-tel').value.trim(), email: $('pr-mail').value.trim(),
               notas: $('pr-notas').value.trim(), activo: $('pr-activo').checked,
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
  if (a && a.cotizar && !AD.cotizarPintado) {           // Pedir cotización (Fase 3): se llena una vez, para no pisar lo que se escribe
    AD.cotizarPintado = true;
    $('aj-prueba').checked = a.cotizar.prueba;
    $('aj-numero').value = a.cotizar.numeroPrueba || '';
    $('aj-msj-cot').value = a.cotizar.msjCotizacion || '';
    $('aj-msj-conf').value = a.cotizar.msjConfirmar || '';
    $('aj-msj-gracias').value = a.cotizar.msjGracias || '';
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
  const nombre = await pedirNombre('Agregar granja', '', 'Aparece en el formulario y en los filtros.');
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
    botones: [{ texto: 'Sí, sacarla', clase: 'btn peligro-btn', valor: true }, { texto: 'Volver', valor: null }] });
  if (si) granjaOp({ accion: 'sacar', nombre: nombre }, function () { return 'Listo: se sacó ' + nombre + '.'; });
}

$('aj-cot-ok').addEventListener('click', async function () {
  const r = await api('guardarAjustesCotizar', {
    numeroPrueba: $('aj-numero').value, prueba: $('aj-prueba').checked, msjCotizacion: $('aj-msj-cot').value,
    msjConfirmar: $('aj-msj-conf').value, msjGracias: $('aj-msj-gracias').value
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
    $('ma-sitio').innerHTML = '<option value="">Elegí la granja</option>' + (APP.config.sitios || []).map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
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
  pintarArchivos();
  revisarMasivo();
}

function revisarMasivo() {
  const m = AD.masivo;
  $('ma-crear').disabled = !$('ma-sitio').value || !m.urgencia || m.creando || $('ma-titulo').value.trim().length < 3;
  $('ma-crear').textContent = 'Crear pedido masivo' + (m.archivos.length ? ' (con ' + m.archivos.length + (m.archivos.length === 1 ? ' adjunto)' : ' adjuntos)') : '');
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
              titulo: $('ma-titulo').value.trim(), descripcion: $('ma-desc').value.trim(), compartido: elegidosLista(m.compartir) };
  m.creando = true;
  revisarMasivo();
  notaAd('ma-estado', 'Creando el pedido…');
  const r = await api('crearMasivo', d);
  m.creando = false;
  if (!r.ok) { notaAd('ma-estado', textoDeError(r)); return revisarMasivo(); }
  const ref = r.ref || m.id;
  const archivos = m.archivos.slice();
  // Todo de nuevo para el próximo (con otro número)
  AD.masivo = { id: nuevoIdMasivo(), urgencia: m.urgencia, archivos: [], compartir: {}, sitiosArmados: true };
  ['ma-titulo', 'ma-desc', 'ma-razon'].forEach(function (id) { $(id).value = ''; });
  notaAd('ma-estado', '');
  pintarChipsEncargados($('ma-compartir'), AD.masivo.compartir);
  pintarMasivo();
  cargarTablero();
  await abrirTarjeta(ref);
  if (archivos.length) adjuntar(archivos, ref);       // se suben solos, como cualquier adjunto
  aviso('Listo: se creó el pedido masivo' + (d.compartido.length ? ', compartido con ' + d.compartido.join(', ') : '') + (archivos.length ? '. Los adjuntos se están subiendo.' : '.'));
});
