'use strict';
/* ============================================================
   PEDIDOS GUARDADOS EN EL TELÉFONO (Paso 2-bis, etapa 3)
   ------------------------------------------------------------
   Lo usan el formulario (pedido/) y la app: cualquiera de los dos
   que se abra con señal manda lo que quedó pendiente.
   Todo va en la base del navegador (IndexedDB), que aguanta fotos:
     fotos:   {id, blob, nombre, bytes}      las del borrador y las de los pedidos por mandar
     envios:  {ref, creado, estado, datos, fotos, ...}
   Un pedido se manda en dos partes: primero cada foto (subirFoto, con su
   propio número de envío) y después el pedido (recibirFormulario, con su
   Ref). Las dos cosas se pueden repetir sin duplicar: el servidor recuerda
   cada foto por su número y el pedido por su Ref. Así, si la señal se
   corta en el medio, se retoma donde quedó.
   estado: 'pendiente' → 'enviado' | 'rechazado' (el servidor dijo que no:
   se muestra el motivo y se puede volver a cargar en el formulario).
   Necesita base.js (llamar, nuevoId).
   ============================================================ */

const PedidosGuardados = (function () {
  const LIMITE_FOTO_MS = 120000;       // una foto con poca señal puede tardar
  const DIAS_ENVIADOS = 7;             // los enviados se muestran una semana
  let db = null, enviando = false;
  const avisar = [];                   // funciones a llamar cuando algo cambia
  const memoria = { fotos: new Map(), envios: new Map() };   // si el navegador no deja usar IndexedDB

  function abrir() {
    if (db) return Promise.resolve(db);
    return new Promise(function (ok) {
      let pedido;
      try { pedido = indexedDB.open('compras', 1); } catch (e) { return ok(null); }
      pedido.onupgradeneeded = function () {
        const d = pedido.result;
        if (!d.objectStoreNames.contains('fotos')) d.createObjectStore('fotos', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('envios')) d.createObjectStore('envios', { keyPath: 'ref' });
      };
      pedido.onsuccess = function () { db = pedido.result; ok(db); };
      pedido.onerror = function () { ok(null); };
      pedido.onblocked = function () { ok(null); };
    });
  }

  function hacer(almacen, modo, fn) {
    return abrir().then(function (d) {
      if (!d) return fn(null, memoria[almacen]);
      return new Promise(function (ok, bad) {
        const tx = d.transaction(almacen, modo);
        const r = fn(tx.objectStore(almacen), null);
        tx.oncomplete = function () { ok(r && 'result' in r ? r.result : r); };
        tx.onerror = function () { bad(tx.error); };
        tx.onabort = function () { bad(tx.error); };
      });
    });
  }
  const poner = function (almacen, obj) {
    return hacer(almacen, 'readwrite', function (s, m) { if (m) { m.set(obj.id || obj.ref, obj); return null; } return s.put(obj); });
  };
  const traer = function (almacen, clave) {
    return hacer(almacen, 'readonly', function (s, m) { return m ? m.get(clave) : s.get(clave); });
  };
  const quitar = function (almacen, clave) {
    return hacer(almacen, 'readwrite', function (s, m) { if (m) { m.delete(clave); return null; } return s.delete(clave); });
  };
  const todos = function (almacen) {
    return hacer(almacen, 'readonly', function (s, m) { return m ? Array.from(m.values()) : s.getAll(); });
  };

  function cambio() { avisar.forEach(function (f) { try { f(); } catch (e) {} }); }

  function aBase64(blob) {
    return new Promise(function (ok, bad) {
      const r = new FileReader();
      r.onload = function () { ok(String(r.result).split(',')[1] || ''); };
      r.onerror = bad;
      r.readAsDataURL(blob);
    });
  }

  /** Sube las fotos que falten y después el pedido. Devuelve false si se cortó la señal. */
  async function mandarUno(e) {
    const ids = Object.keys(e.fotos);
    for (let k = 0; k < ids.length; k++) {
      const f = e.fotos[ids[k]];
      if (f.subida || f.perdida) continue;
      e.progreso = 'Subiendo foto ' + (k + 1) + ' de ' + ids.length + '…';
      await poner('envios', e); cambio();
      const guardada = await traer('fotos', ids[k]);
      if (!guardada) { f.perdida = true; continue; }      // no debería pasar: se manda sin esa foto
      let r;
      try {
        r = await llamar('subirFoto', [{ idEnvio: e.ref, linea: f.linea, nombre: f.nombre, base64: await aBase64(guardada.blob) }],
                         f.envio, { limiteMs: LIMITE_FOTO_MS });
      } catch (x) {
        if (x.sinRed) { e.progreso = ''; await poner('envios', e); return false; }
        r = { ok: false, error: 'el servidor no la aceptó' };
      }
      if (r.ok) f.subida = { id: r.id, nombre: r.nombre };
      else f.perdida = true;                              // foto rechazada (muy grande, etc.): el pedido sale igual
      await poner('envios', e);
    }

    e.progreso = 'Mandando el pedido…';
    await poner('envios', e); cambio();
    const datos = Object.assign({}, e.datos, {
      idEnvio: e.ref,
      productos: e.datos.productos.map(function (p) {
        return Object.assign({}, p, {
          fotos: (p.fotos || []).map(function (id) { return e.fotos[id] && e.fotos[id].subida; }).filter(Boolean)
        });
      })
    });
    let r;
    try { r = await llamar('recibirFormulario', [datos], e.ref); }
    catch (x) {
      if (x.sinRed) { e.progreso = ''; await poner('envios', e); return false; }
      r = { ok: false, error: 'El servidor no lo aceptó. Probá de nuevo en un rato.', reintentar: true };
    }
    e.progreso = '';
    if (r.ok) {
      e.estado = 'enviado';
      e.enviado = new Date().toISOString();
      e.productos = r.productos;
      e.fotosPerdidas = ids.filter(function (id) { return e.fotos[id].perdida; }).length;
      for (const id of ids) await quitar('fotos', id);
    } else if (!r.reintentar) {
      e.estado = 'rechazado';
      e.error = r.error;
    }
    await poner('envios', e); cambio();
    return true;
  }

  return {
    /** Una foto del borrador (o de un pedido): se guarda apenas se elige. */
    guardarFoto: function (id, blob, nombre) { return poner('fotos', { id: id, blob: blob, nombre: nombre, bytes: blob.size }); },
    leerFoto: function (id) { return traer('fotos', id); },
    borrarFoto: function (id) { return quitar('fotos', id); },

    /** Queda guardado en el teléfono y se intenta mandar ya. */
    agregar: async function (e) {
      e.estado = 'pendiente';
      e.creado = new Date().toISOString();
      await poner('envios', e);
      cambio();
      this.procesar();
    },

    /** Los pedidos de este teléfono: pendientes y rechazados siempre; enviados, la última semana. */
    lista: async function () {
      const l = await todos('envios');
      const limite = Date.now() - DIAS_ENVIADOS * 86400000;
      for (const e of l) if (e.estado === 'enviado' && new Date(e.enviado) < limite) await quitar('envios', e.ref);
      return l.filter(function (e) { return !(e.estado === 'enviado' && new Date(e.enviado) < limite); })
              .sort(function (a, b) { return a.creado < b.creado ? 1 : -1; });
    },
    pendientes: async function () {
      return (await todos('envios')).filter(function (e) { return e.estado === 'pendiente'; }).length;
    },
    traer: function (ref) { return traer('envios', ref); },
    olvidar: function (ref) { return quitar('envios', ref).then(cambio); },

    alCambiar: function (fn) { avisar.push(fn); },

    /** Manda los pendientes, del más viejo al más nuevo. Sin señal, para y se reintenta después. */
    procesar: async function () {
      if (enviando) return;
      enviando = true;
      try {
        const l = (await todos('envios')).filter(function (e) { return e.estado === 'pendiente'; })
                                          .sort(function (a, b) { return a.creado < b.creado ? -1 : 1; });
        for (const e of l) { if (!(await mandarUno(e))) break; }
      } catch (x) {
        // Algo raro con la base del navegador: se reintenta en la próxima vuelta
      } finally {
        enviando = false;
        cambio();
      }
    }
  };
})();

// Reintentos: al volver la señal, al volver a la página y cada 20 s si hay pendientes
window.addEventListener('online', function () { PedidosGuardados.procesar(); });
document.addEventListener('visibilitychange', function () { if (!document.hidden) PedidosGuardados.procesar(); });
setInterval(function () {
  if (document.hidden) return;
  PedidosGuardados.pendientes().then(function (n) { if (n) PedidosGuardados.procesar(); });
}, 20000);
