'use strict';
/* ============================================================
   LOGIN: elegir nombre → código por WhatsApp → llave guardada.
   Al abrir: si hay llave y algo guardado, la app se muestra al
   instante (aunque no haya señal) y se actualiza por detrás con
   inicioApp. Sin llave, la lista de nombres sale de lo guardado o
   de datosLogin.
   ============================================================ */
let elegido = null, timerOtro = null, envioEntrar = null;

function mostrarLogin(id) {
  $('app').hidden = true;
  $('login').hidden = false;
  ['p-cargando', 'p-nombre', 'p-codigo', 'p-error'].forEach(function (p) { $(p).hidden = p !== id; });
  window.scrollTo(0, 0);
}

/** Para base.js: no recargar la app por una versión nueva mientras se escribe el código. */
function enMedioDeEntrar() { return !$('login').hidden && !$('p-codigo').hidden; }

function arrancar() {
  const token = guardado.leer(K.token);
  if (!token) return entrarDeCero();
  APP.token = token;
  const inicio = guardado.leerJSON(K.inicio, null);
  if (inicio && inicio.yo) {
    aplicarInicio(inicio);
    mostrarApp();
    refrescarInicio();
  } else {
    iniciar(token);
  }
  bandeja.procesar();
}

/** El color de App_Config, guardado para la próxima vez (se aplica antes de pintar, en index.html). */
function aplicarColor(css) {
  if (typeof css !== 'string') return;
  if (guardado.leer(K.cssMio) === null) $('estiloColor').textContent = css;   // si eligió el suyo, manda el suyo
  guardado.guardar(K.css, css);
}

/**
 * El aspecto que eligió cada uno (Paso 6): su color (css; null = el de la
 * app) y el estilo del tablero. Queda guardado para abrir ya con eso, y el
 * formulario de este dispositivo usa el mismo color.
 */
function aplicarAspecto(cssMio, estilo) {
  if (cssMio === null) { guardado.borrar(K.cssMio); $('estiloColor').textContent = guardado.leer(K.css) || ''; }
  else { guardado.guardar(K.cssMio, cssMio); $('estiloColor').textContent = cssMio; }
  if (estilo) { document.documentElement.dataset.estilo = estilo; guardado.guardar(K.estilo, estilo); }
}

/** Guarda y aplica lo que trae inicioApp. */
function aplicarInicio(r) {
  APP.yo = r.yo;
  APP.config = r.config;
  APP.actualizado = r.actualizado || new Date().toISOString();
  guardado.guardarJSON(K.inicio, { yo: r.yo, config: r.config, actualizado: APP.actualizado });
  // Si hay un cambio de aspecto esperando señal, manda ese (el servidor todavía tiene el anterior)
  if (r.config && r.yo && !bandeja.lista().some(function (m) { return m.fn === 'guardarAspecto'; })) {
    if (r.yo.color) aplicarAspecto(r.config.css, r.yo.estilo);
    else { aplicarAspecto(null, r.yo.estilo); aplicarColor(r.config.css); }
  } else if (r.config && !r.yo) aplicarColor(r.config.css);
}

/** Primera vez en este dispositivo (sin nada guardado): hace falta señal. */
async function iniciar(token) {
  mostrarLogin('p-cargando');
  APP.token = token;
  try {
    const r = await llamar('inicioApp', [token]);
    if (r.ok) { aplicarInicio(r); return mostrarApp(); }
    if (r.sinSesion) return sesionPerdida(r.error);
    errorGeneral(r.error);
  } catch (e) {
    errorGeneral(e.sinRed ? 'Hay poca señal. La primera vez que se abre en este dispositivo hace falta conexión: tocá Reintentar en un rato.'
                          : 'Error del servidor. Probá de nuevo en un rato.');
  }
}

/** Con la app ya abierta: trae quién sos y la configuración de nuevo, por detrás. */
async function refrescarInicio() {
  if (!APP.token) return;
  let r;
  try { r = await llamar('inicioApp', [APP.token]); } catch (e) { return pintarSinRed(); }
  if (r.ok) {
    aplicarInicio(r);
    if (!$('app').hidden) pintarBarra();
    if (typeof rearmarOpcionesFiltros === 'function' && TB.filtros) rearmarOpcionesFiltros();
    pintarSinRed();
  } else if (r.sinSesion) {
    sesionPerdida(r.error);
  }
}

// base.js las llama al volver la señal y al volver a la app
function alVolverLaSenal() { if (!$('app').hidden) refrescarInicio(); }
function alVolverALaApp() { if (!$('app').hidden) refrescarInicio(); }

/** La llave dejó de valer: se borra con lo guardado y se vuelve a pedir el código. */
function sesionPerdida(texto) {
  APP.token = null; APP.yo = null; APP.config = null;
  guardado.borrar(K.token);
  guardado.borrar(K.desde);
  guardado.borrar(K.inicio);
  // Lo del tablero es de quien estaba: que el próximo no lo vea
  guardado.borrar('nueva_tablero');
  guardado.borrar('nueva_tarjetas');
  guardado.borrar(K.cssMio);             // el próximo arranca con el color y el estilo de la app
  guardado.borrar(K.estilo);
  delete document.documentElement.dataset.estilo;
  if (typeof TB !== 'undefined') { TB.datos = null; TB.filtros = null; TB.cancelados = {}; if (TB.abierta) ocultarTarjeta(); }
  entrarDeCero(texto);
}

function errorGeneral(texto) {
  estado('e-general', texto);
  mostrarLogin('p-error');
}

/** Pantalla de nombres: con lo guardado si hay, y se actualiza por detrás. */
async function entrarDeCero(motivo) {
  const guardados = guardado.leerJSON(K.usuarios, null);
  if (guardados && guardados.length) pantallaNombre(guardados, motivo);
  else mostrarLogin('p-cargando');
  try {
    const r = await llamar('datosLogin', []);
    if (!r.ok) throw new Error(r.error);
    aplicarColor(r.css);
    guardado.guardarJSON(K.usuarios, r.usuarios);
    // Si ya estaba eligiendo, no le cambia la pantalla de golpe: solo si no había lista
    if (!(guardados && guardados.length)) pantallaNombre(r.usuarios, motivo);
  } catch (e) {
    if (!(guardados && guardados.length)) {
      errorGeneral(e.sinRed ? 'Hay poca señal. Para entrar hace falta conexión: tocá Reintentar en un rato.'
                            : 'Error del servidor. Probá de nuevo en un rato.');
    }
  }
}

/* ---------- Paso A: nombre ---------- */
function pantallaNombre(usuarios, motivo) {
  const cont = $('usuarios');
  cont.innerHTML = '';
  usuarios.forEach(function (u) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.textContent = u.nombre;
    b.addEventListener('click', function () {
      elegido = u;
      cont.querySelectorAll('.choice').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
      $('b-pedir').disabled = false;
    });
    cont.appendChild(b);
  });
  elegido = null;
  $('b-pedir').disabled = true;
  estado('e-nombre', '');
  estado('e-perdida', motivo || '', 'warn');
  mostrarLogin('p-nombre');
}

async function pedirCodigo(boton, idEstado) {
  if (!elegido) return;
  boton.disabled = true;
  estado(idEstado, 'Mandando el código…', 'run');
  let r;
  try { r = await llamar('pedirCodigo', [elegido.id]); }
  catch (e) {
    boton.disabled = false;
    return estado(idEstado, e.sinRed ? 'Hay poca señal y no se pudo mandar el código. Probá de nuevo en un rato.' : 'Error del servidor. Probá de nuevo en un rato.');
  }
  if (!r.ok) { boton.disabled = false; return estado(idEstado, r.error); }
  $('t-destino').textContent = 'Te lo mandamos por WhatsApp al número terminado en ' + r.destino + '. Vence en ' + r.minutos + ' minutos.';
  $('b-cambiar').textContent = 'No soy ' + elegido.nombre;
  $('codigo').value = '';
  envioEntrar = null;
  estado('e-codigo', '');
  $('b-entrar').disabled = false;
  mostrarLogin('p-codigo');
  esperarOtro(r.espera);
  $('codigo').focus();
}

function esperarOtro(segundos) {
  clearInterval(timerOtro);
  const b = $('b-otro');
  let quedan = segundos;
  b.disabled = true;
  b.textContent = 'Pedir otro código (en ' + quedan + ' s)';
  timerOtro = setInterval(function () {
    quedan--;
    if (quedan > 0) { b.textContent = 'Pedir otro código (en ' + quedan + ' s)'; return; }
    clearInterval(timerOtro);
    b.disabled = false;
    b.textContent = 'Pedir otro código';
  }, 1000);
}

/* ---------- Paso B: código ---------- */
async function entrar(ev) {
  if (ev) ev.preventDefault();
  const codigo = $('codigo').value.replace(/\D/g, '');
  if (codigo.length !== 6) return estado('e-codigo', 'El código tiene 6 números.');
  const b = $('b-entrar');
  if (b.disabled) return;
  b.disabled = true;
  estado('e-codigo', 'Entrando…', 'run');
  // Mismo código, mismo número de envío: si la señal se cortó justo después de
  // que el servidor lo aceptó, el reintento recibe la misma llave (recordarEnvio_).
  if (!envioEntrar || envioEntrar.codigo !== codigo) envioEntrar = { codigo: codigo, id: nuevoId() };
  let r;
  try { r = await llamar('validarCodigo', [elegido.id, codigo, dispositivo()], envioEntrar.id); }
  catch (e) {
    b.disabled = false;
    return estado('e-codigo', e.sinRed ? 'Hay poca señal. Tu código sigue sirviendo: tocá Entrar de nuevo en un rato.' : 'Error del servidor. Probá de nuevo en un rato.');
  }
  b.disabled = false;
  if (!r.ok) { $('codigo').select(); return estado('e-codigo', r.error); }
  clearInterval(timerOtro);
  envioEntrar = null;
  $('aviso-guardar').hidden = guardado.guardar(K.token, r.token);
  guardado.guardar(K.desde, new Date().toISOString());
  iniciar(r.token);
}

/* ---------- Cerrar sesión (desde la pantalla Cuenta) ----------
   Se cierra ya en este dispositivo. El aviso al servidor (que la llave
   deje de valer) va por la bandeja de salida: si no hay señal, se manda
   cuando vuelva. */
function salir() {
  bandeja.agregar('cerrarSesion', [], 'cerrar la sesión en el servidor');
  sesionPerdida('');
}

/* ---------- Eventos ---------- */
$('b-pedir').addEventListener('click', function () { pedirCodigo($('b-pedir'), 'e-nombre'); });
$('b-otro').addEventListener('click', function () { pedirCodigo($('b-otro'), 'e-codigo'); });
$('b-cambiar').addEventListener('click', function () {
  clearInterval(timerOtro);
  pantallaNombre(guardado.leerJSON(K.usuarios, []));
});
$('f-codigo').addEventListener('submit', entrar);
$('codigo').addEventListener('input', function () {
  const v = this.value.replace(/\D/g, '').slice(0, 6);
  if (v !== this.value) this.value = v;
  if (v.length === 6) entrar();
});
$('b-reintentar').addEventListener('click', arrancar);

if (!guardado.guardar('nueva_prueba', '1')) $('aviso-guardar').hidden = false;
guardado.borrar('nueva_prueba');

/* Solo en la página de prueba: entrar con un código puesto a mano */
(function () {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn2'; b.textContent = 'Ya tengo un código';
  $('b-pedir').insertAdjacentElement('afterend', b);
  b.addEventListener('click', function () {
    if (!elegido) return estado('e-nombre', 'Elegí tu nombre primero.');
    $('t-destino').textContent = 'Escribí el código que tenés.';
    $('b-cambiar').textContent = 'No soy ' + elegido.nombre;
    $('codigo').value = ''; envioEntrar = null; estado('e-codigo', '');
    $('b-entrar').disabled = false;
    mostrarLogin('p-codigo');
    $('codigo').focus();
  });
})();
