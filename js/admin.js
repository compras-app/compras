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
   - Pedido masivo: pegar una lista (vista previa contra el padrón) o
     un pedido "libre" con título, descripción y PDF.
   Todo esto necesita señal: se manda directo, no por la bandeja.
   ============================================================ */

const AD = {
  personas: null, yo: '', sesion: '',
  provs: null,                 // {proveedores, rubros, maximo}
  ajustes: null,
  masivo: { modo: 'lista', id: '', urgencia: '', lineas: null, archivos: [] }
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
function estado(id, texto) { const el = $(id); if (el) el.textContent = texto || ''; }

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
async function mostrarPersonas() {
  if (!AD.personas) estado('pe-estado', 'Cargando…');
  pintarPersonas();
  const r = await api('getPersonas');
  if (r.ok) { AD.personas = r.personas; AD.yo = r.yo; AD.sesion = r.sesion; estado('pe-estado', ''); }
  else estado('pe-estado', textoDeError(r));
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
        '<span class="tag' + (p.rol === 'admin' ? ' admin' : '') + '">' + (p.rol === 'admin' ? 'Admin' : 'Encargado') + '</span></summary>' +
      '<div class="ad-cuerpo">' +
        '<dl class="ad-datos"><dt>Teléfono</dt><dd>' + esc(p.telefono || '—') + '</dd>' +
        '<dt>Avisos por WhatsApp</dt><dd>' + (p.avisos ? 'Sí (menciones, recordatorios)' : 'No') + '</dd></dl>' +
        (p.activo ? '<h3>Dispositivos</h3>' + (n ? '<ul class="ad-disp">' + p.dispositivos.map(function (d) {
            const este = d.id === AD.sesion;
            return '<li><span><b>' + esc(d.dispositivo || 'Dispositivo') + (este ? ' · este' : '') + (d.prueba ? ' · 🧪 encargado' : '') + '</b>' +
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
  const v = previo || { nombre: p ? p.nombre : '', telefono: p ? p.telefono : '', rol: p ? p.rol : 'usuario', avisos: p ? p.avisos : true };
  let rol = v.rol;
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = campoDlg('pp-nombre', 'Nombre', v.nombre, { max: 60, placeholder: 'Como aparece en la app' }) +
    campoDlg('pp-tel', 'Teléfono (WhatsApp)', v.telefono, { tipo: 'tel', max: 20, inputmode: 'tel', placeholder: '5493525415029', nota: NOTA_TELEFONO + ' Ahí le llega el código para entrar.' }) +
    '<div class="campo"><label>Rol</label><div class="seg" id="pp-rol">' +
      '<button type="button" data-rol="usuario">Encargado</button><button type="button" data-rol="admin">Admin</button></div>' +
      (yo ? '<p class="nota">Tu propio rol lo cambia otro admin.</p>' : '<p class="nota">Admin: ve y maneja todo. Encargado: carga pedidos y ve los suyos.</p>') + '</div>' +
    '<label class="check"><input type="checkbox" id="pp-avisos"> Recibe avisos por WhatsApp (menciones y recordatorios)</label>';
  const datos = await dialogo({
    titulo: p ? 'Editar a ' + p.nombre : 'Agregar persona', cuerpo: cuerpo,
    botones: [{ texto: 'Guardar', clase: 'btn', id: 'dg-ok', valor: function () {
      return { id: p ? p.id : '', nombre: $('pp-nombre').value.trim(), telefono: $('pp-tel').value.trim(), rol: rol, avisos: $('pp-avisos').checked };
    } }, { texto: 'Volver', valor: null }],
    alAbrir: function () {
      $('pp-avisos').checked = v.avisos !== false;
      const pintarRol = function () {
        $('pp-rol').querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.rol === rol)); b.disabled = yo; });
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
  if (!AD.provs) estado('pv-estado', 'Cargando…');
  else pintarProveedores();
  const r = await api('getProveedoresAdmin');
  if (r.ok) { AD.provs = r; estado('pv-estado', ''); }
  else if (!AD.provs) { estado('pv-estado', textoDeError(r)); return; }
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
  estado('pv-estado', nota);
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
  if (!AD.ajustes) estado('aj-estado', 'Cargando…');
  pintarAjustes();
  const r = await api('getAjustes');
  if (r.ok) { AD.ajustes = r; estado('aj-estado', ''); }
  else estado('aj-estado', textoDeError(r));
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

$('aj-dias-ok').addEventListener('click', async function () {
  const n = Number($('aj-dias').value);
  const r = await api('cambiarDiasTanda', n);
  if (!r.ok) return aviso(textoDeError(r), 'bad');
  AD.ajustes.diasTanda = r.dias;
  if (TB.datos && TB.datos.tanda) TB.datos.tanda.cada = r.dias;
  aviso('Listo: la Tanda verde avisa cada ' + r.dias + ' días.');
});

/* ============================================================
   PEDIDO MASIVO
   - Lista: se pega, "Ver cómo queda" la separa contra el padrón
     (analizarMasivo) y se corrige antes de crear.
   - Libre (Feli): título, descripción pegada como venga y el PDF.
   El número del pedido ("M…") lo arma la app al empezar, así un
   reintento no lo duplica; cambia recién cuando se crea.
   ============================================================ */
function nuevoIdMasivo() { return 'M' + Date.now().toString(36).toUpperCase() + nuevoId().slice(-4); }

function mostrarMasivo() {
  const m = AD.masivo;
  if (!m.id) m.id = nuevoIdMasivo();
  if (!m.sitiosArmados) {
    m.sitiosArmados = true;
    const actual = $('ma-sitio').value;
    $('ma-sitio').innerHTML = '<option value="">Elegí la granja</option>' + (APP.config.sitios || []).map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
    $('ma-sitio').value = actual;
  }
  const urg = APP.config.urgencias || [];
  if (!m.urgencia) m.urgencia = urg[urg.length - 1] || '';
  pintarMasivo();
  datosProductos();                                  // para las sugerencias de los que no están en el padrón
}

function pintarMasivo() {
  const m = AD.masivo;
  document.querySelectorAll('#s-masivo [data-modo]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.modo === m.modo)); });
  $('ma-ayuda-modo').textContent = m.modo === 'lista'
    ? 'Pegás los productos y la app los separa y los busca en el padrón. Queda un pedido con sus productos, dividido por rubro.'
    : 'Para cuando la lista viene en un PDF o es difícil de separar: un título, una descripción con lo que haga falta y el PDF adjunto.';
  $('ma-lista-c').hidden = m.modo !== 'lista';
  $('ma-libre-c').hidden = m.modo !== 'libre';
  $('ma-titulo-c').hidden = m.modo !== 'libre';
  $('ma-urg').innerHTML = (APP.config.urgencias || []).map(function (u) {
    return '<button type="button" data-u="' + esc(u) + '" aria-pressed="' + (u === m.urgencia) + '">' + esc(u) + '</button>';
  }).join('');
  $('ma-urg').querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { m.urgencia = b.dataset.u; pintarMasivo(); }); });
  pintarArchivos();
  revisarMasivo();
}

function revisarMasivo() {
  const m = AD.masivo;
  let listo = !!$('ma-sitio').value && !!m.urgencia && !m.creando;
  if (m.modo === 'lista') {
    const vivas = (m.lineas || []).filter(function (l) { return !l.fuera; });
    listo = listo && vivas.length > 0 && vivas.every(function (l) { return l.texto.trim() && l.cantidad > 0; });
    $('ma-crear').textContent = vivas.length ? 'Crear pedido masivo (' + vivas.length + (vivas.length === 1 ? ' producto)' : ' productos)') : 'Crear pedido masivo';
  } else {
    listo = listo && $('ma-titulo').value.trim().length >= 3;
    $('ma-crear').textContent = 'Crear pedido masivo' + (m.archivos.length ? ' (con ' + m.archivos.length + (m.archivos.length === 1 ? ' adjunto)' : ' adjuntos)') : '');
  }
  $('ma-crear').disabled = !listo;
}

document.querySelectorAll('#s-masivo [data-modo]').forEach(function (b) {
  b.addEventListener('click', function () { AD.masivo.modo = b.dataset.modo; pintarMasivo(); });
});
['ma-sitio', 'ma-titulo'].forEach(function (id) { $(id).addEventListener('input', revisarMasivo); $(id).addEventListener('change', revisarMasivo); });
$('ma-texto').addEventListener('input', function () {
  if (AD.masivo.lineas) { $('ma-previa-t').textContent = 'Cambiaste la lista: tocá "Ver cómo queda" otra vez.'; }
});

$('ma-ver').addEventListener('click', async function () {
  const texto = $('ma-texto').value;
  if (!texto.trim()) return aviso('Pegá la lista primero: un producto por línea.', 'bad');
  $('ma-ver').disabled = true;
  estado('ma-estado', 'Separando la lista…');
  const r = await api('analizarMasivo', texto);
  $('ma-ver').disabled = false;
  if (!r.ok) return estado('ma-estado', textoDeError(r));
  estado('ma-estado', '');
  AD.masivo.lineas = r.lineas.map(function (l) {
    return { linea: l.linea, texto: l.familia || l.texto, familia: l.familia, canal: l.canal, especificacion: l.especificacion,
             cantidad: l.cantidad === null ? 1 : l.cantidad, sinCantidad: l.cantidad === null, enPadron: l.enPadron, fuera: false };
  });
  pintarPrevia();
});

/** La vista previa: cada línea con su cantidad, producto (✅ en el padrón / ⚠️ no) y especificación; todo se puede corregir. */
function pintarPrevia() {
  const ls = AD.masivo.lineas || [];
  const vivas = ls.filter(function (l) { return !l.fuera; });
  const fuera = vivas.filter(function (l) { return !l.enPadron; }).length;
  $('ma-previa').hidden = !ls.length;
  $('ma-previa-t').textContent = vivas.length + (vivas.length === 1 ? ' producto' : ' productos') +
    (fuera ? ' · ⚠️ ' + fuera + ' no ' + (fuera === 1 ? 'está' : 'están') + ' en el padrón: elegí el nombre de la lista o dejalo como está' : ' · ✅ todos en el padrón');
  $('ma-filas').innerHTML = ls.map(function (l, i) {
    if (l.fuera) return '<div class="ma-fila quitada"><span>' + esc(l.linea) + '</span><button type="button" class="btn-chico" data-volver="' + i + '">Volver a poner</button></div>';
    return '<div class="ma-fila' + (l.enPadron ? '' : ' fuera') + '" data-i="' + i + '">' +
      '<small class="ma-orig">' + esc(l.linea) + '</small>' +
      '<div class="ma-campos">' +
        '<label class="ma-cant"><span>Cant.</span><input type="number" min="0" step="any" inputmode="decimal" data-cant="' + i + '" value="' + esc(l.cantidad) + '"></label>' +
        '<label class="ma-prod"><span>' + (l.enPadron ? '✅ ' + esc(l.canal) : '⚠️ Fuera del padrón') + '</span>' +
          '<input type="text" data-prod="' + i + '" value="' + esc(l.texto) + '" autocomplete="off"><div class="sugerencias" data-sug="' + i + '" hidden></div></label>' +
        '<label class="ma-esp"><span>Cómo es</span><input type="text" data-esp="' + i + '" value="' + esc(l.especificacion) + '" autocomplete="off" placeholder="medida, talle…"></label>' +
        '<button type="button" class="icono" data-quitar="' + i + '" aria-label="Quitar esta línea">×</button>' +
      '</div>' + (l.sinCantidad ? '<small class="nota">No tenía cantidad: puse 1.</small>' : '') + '</div>';
  }).join('');
  const cont = $('ma-filas');
  cont.querySelectorAll('[data-cant]').forEach(function (x) {
    x.addEventListener('input', function () { const l = ls[x.dataset.cant]; l.cantidad = Number(String(x.value).replace(',', '.')); l.sinCantidad = false; revisarMasivo(); });
  });
  cont.querySelectorAll('[data-esp]').forEach(function (x) {
    x.addEventListener('input', function () { ls[x.dataset.esp].especificacion = x.value; });
  });
  cont.querySelectorAll('[data-prod]').forEach(function (x) {
    const l = ls[x.dataset.prod];
    x.addEventListener('input', function () {
      // Escribir a mano lo saca del padrón, salvo que coincida exacto con un nombre
      l.texto = x.value;
      const fam = familiaExacta(x.value);
      l.familia = fam ? fam[0] : ''; l.canal = fam ? fam[1] : ''; l.enPadron = !!fam;
      revisarMasivo();
    });
    x.addEventListener('blur', function () { setTimeout(pintarPrevia, 150); });
    conSugerencias(x, cont.querySelector('[data-sug="' + x.dataset.prod + '"]'), function (q) {
      const d = TB.datosProd;
      if (!d || !q || q.length < 2) return [];
      return d.familias.filter(function (f) { return coincide(f[0], q); }).slice(0, 8).map(function (f) { return { texto: f[0], sub: f[1], valor: f }; });
    }, function (f) {
      l.texto = f[0]; l.familia = f[0]; l.canal = f[1]; l.enPadron = true;
      pintarPrevia();
    });
  });
  cont.querySelectorAll('[data-quitar]').forEach(function (b) { b.addEventListener('click', function () { ls[b.dataset.quitar].fuera = true; pintarPrevia(); }); });
  cont.querySelectorAll('[data-volver]').forEach(function (b) { b.addEventListener('click', function () { ls[b.dataset.volver].fuera = false; pintarPrevia(); }); });
  revisarMasivo();
}
function familiaExacta(texto) {
  const d = TB.datosProd, q = sinTildes(String(texto || '').trim());
  if (!d || !q) return null;
  return d.familias.filter(function (f) { return sinTildes(f[0]) === q; })[0] || null;
}

/* Adjuntos del pedido libre: quedan acá hasta crear el pedido; después van por la cola de adjuntos de siempre */
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
  const d = { id: m.id, modo: m.modo, sitio: $('ma-sitio').value, urgencia: m.urgencia, razon: $('ma-razon').value.trim() };
  if (m.modo === 'lista') {
    d.lineas = m.lineas.filter(function (l) { return !l.fuera; }).map(function (l) {
      return { texto: l.texto.trim(), familia: l.enPadron ? l.familia : '', especificacion: String(l.especificacion || '').trim(), cantidad: l.cantidad };
    });
  } else {
    d.titulo = $('ma-titulo').value.trim();
    d.descripcion = $('ma-desc').value.trim();
  }
  m.creando = true;
  revisarMasivo();
  estado('ma-estado', 'Creando el pedido…');
  const r = await api('crearMasivo', d);
  m.creando = false;
  if (!r.ok) { estado('ma-estado', textoDeError(r)); return revisarMasivo(); }
  const ref = r.ref || m.id;
  const archivos = m.archivos.slice();
  // Todo de nuevo para el próximo (con otro número)
  AD.masivo = { modo: m.modo, id: nuevoIdMasivo(), urgencia: m.urgencia, lineas: null, archivos: [], sitiosArmados: true };
  ['ma-texto', 'ma-titulo', 'ma-desc', 'ma-razon'].forEach(function (id) { $(id).value = ''; });
  $('ma-previa').hidden = true;
  $('ma-filas').innerHTML = '';
  estado('ma-estado', '');
  pintarMasivo();
  cargarTablero();
  await abrirTarjeta(ref);
  if (archivos.length) adjuntar(archivos, ref);       // se suben solos, como cualquier adjunto
  aviso('Listo: se creó el pedido masivo' + (archivos.length ? '. Los adjuntos se están subiendo.' : '.'));
});
