/*
  Albor desde la app (Fase extra, Paso T2-bis): "la cabeza".

  Antes lo hacía el Programa de Compras de Python (albor.py, cargas.py y
  motor.py en compras-app/programa-compras). Ahora lo hace esta página con
  la extensión de Chrome "Programa de Compras · Albor", que son "las manos":
  abre la pestaña de Albor, hace clic, escribe y agarra el reporte. Los
  pasos, las esperas, los reintentos y las pausas viven acá, así cada cambio
  les llega a todos sin tocar las computadoras.

  Lo de abajo es albor.py y cargas.py pasados tal cual: los mismos pasos,
  los mismos tiempos y los mismos textos. Lo que Playwright hacía solo
  (esperar a que un botón esté a la vista, quieto, habilitado y sin nada
  encima antes de tocarlo) está en Localizador.

  Todas las esperas las cuenta la extensión (dormir): si esta pestaña queda
  tapada, Chrome atrasa sus relojes, pero los de la extensión no.

  Para la pantalla es lo mismo que antes era motor(): window.AlborExt.api
  tiene bajar_existencias, cargar_transferencia, cargar_egresos,
  responder_carga, cerrar_albor y abrir_carpeta. El avance va a
  window.__progreso / window.__alborLog y las pausas a window.__alborPausa.
*/
(function(){
'use strict';

var EXT_ID = 'bfbebndmpilbbpbnkgbncolimffjgdnd';
var EN_PRUEBA = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

var C = {
  BASE: 'https://laquimerasa.alboragro.com',
  URL_EXISTENCIAS: 'https://laquimerasa.alboragro.com/1/ReportesInsumos/ExistenciaDeInsumos'
};

// Los puntos de stock de las oficinas. Los de las granjas salen de la
// configuración, porque ahí sí se agregan y se sacan.
var OFICINAS = ['123', '131', '134'];          // JM, CASA, LC 50
var EMPRESAS = ['1', '5'];                     // La Quimera, Consultores Asociados
var CATEGORIA_GANADEROS = '66';
var BTN_MAS = '.fa-plus, i.fa-plus, span.fa-plus, a:has(.fa-plus), button:has(.fa-plus)';
var TIPO_TRANSFERENCIA = '3';      // Transferencia de Mercadería
var TIPO_EGRESO = '180';            // Egreso de Mercadería
var PERSONAL_CODIGO = '7';
// Los que ya se conocen. El resto se lee de Albor la primera vez que se usa.
var NOMBRES_CUENTAS = { '510201003': 'GAN-Productos Veterinarios' };
var CLAVE_CUENTAS = 'programa-compras:nombres_cuentas';
var CLAVE_REGISTRO = 'programa-compras:registro_albor';

function primeraLinea(e, n){ return String((e && e.message) || e || '').split('\n')[0].slice(0, n || 80); }

/* ==================================================================
   Registro: lo último que pasó, para entender una falla (antes, motor.log).
   ================================================================== */
var REGISTRO = [];
(function(){ try{ REGISTRO = JSON.parse(localStorage.getItem(CLAVE_REGISTRO) || '[]') || []; }catch(e){ REGISTRO = []; } })();
function anotar(texto){
  var d = new Date();
  REGISTRO.push(('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' +
                ('0' + d.getSeconds()).slice(-2) + ' ' + texto);
  if(REGISTRO.length > 400) REGISTRO.splice(0, REGISTRO.length - 400);
  try{ localStorage.setItem(CLAVE_REGISTRO, JSON.stringify(REGISTRO)); }catch(e){}
}

/* ==================================================================
   La extensión ("las manos")
   ================================================================== */
var Mano = {
  puerto: null, n: 0, esperan: {}, escuchas: [],

  conectar: function(){
    if(this.puerto) return true;
    if(!(window.chrome && chrome.runtime && chrome.runtime.connect)) return false;
    var p;
    try{ p = chrome.runtime.connect(EXT_ID); }catch(e){ return false; }
    var yo = this;
    p.onMessage.addListener(function(m){
      if(m && m.evento){ yo.escuchas.forEach(function(f){ try{ f(m); }catch(e){} }); return; }
      var w = m && yo.esperan[m.id];
      if(!w) return;
      delete yo.esperan[m.id];
      if(w.t) clearTimeout(w.t);
      if(m.ok) w.ok(m.valor); else w.mal(new Error(m.error || 'La extensión no pudo.'));
    });
    p.onDisconnect.addListener(function(){
      void (chrome.runtime && chrome.runtime.lastError);
      if(yo.puerto === p) yo.puerto = null;
      var esperan = yo.esperan; yo.esperan = {};
      Object.keys(esperan).forEach(function(k){
        if(esperan[k].t) clearTimeout(esperan[k].t);
        esperan[k].mal(new Error('EXT_DESCONECTADA'));
      });
    });
    this.puerto = p;
    return true;
  },

  pedir: function(hacer, datos, limite){
    var yo = this;
    return new Promise(function(ok, mal){
      if(!yo.conectar()) return mal(new Error('SIN_EXTENSION'));
      var id = ++yo.n, m = Object.assign({ id: id, hacer: hacer }, datos || {});
      var w = { ok: ok, mal: mal };
      if(limite) w.t = setTimeout(function(){
        delete yo.esperan[id];
        mal(new Error('La extensión no contestó a tiempo (' + hacer + ').'));
      }, limite);
      yo.esperan[id] = w;
      try{ yo.puerto.postMessage(m); }
      catch(e){ delete yo.esperan[id]; yo.puerto = null; mal(new Error('EXT_DESCONECTADA')); }
    });
  },

  /* Lo mismo, pero si la extensión se reinició en el medio (Chrome la
     duerme a veces), se reconecta y se repite una vez. */
  pedirSeguro: function(hacer, datos, limite){
    var yo = this;
    return yo.pedir(hacer, datos, limite).catch(function(e){
      if(e.message !== 'EXT_DESCONECTADA') throw e;
      return yo.pedir(hacer, datos, limite);
    });
  }
};

function dormir(ms){
  return Mano.pedirSeguro('dormir', { ms: ms }, ms + 15000).catch(function(e){
    // Sin extensión, con el reloj de la página (más lento si está tapada).
    return new Promise(function(r){ setTimeout(r, ms); });
  });
}

/* ==================================================================
   La página de Albor: lo que antes era Playwright.
   ================================================================== */

/* Se corre ADENTRO de Albor: busca los elementos con los selectores de
   Playwright que usaba el programa (CSS más :visible, :has-text('…') y
   :text-matches('…', 'i')) y hace con ellos lo que se pide. */
var AYUDANTE = String(function(o){
  function partir(s, sep){
    var out = [], cur = '', d = 0, q = null;
    for(var i = 0; i < s.length; i++){
      var c = s[i];
      if(q){ cur += c; if(c === '\\'){ cur += s[++i] || ''; continue; } if(c === q) q = null; continue; }
      if(c === '"' || c === "'"){ q = c; cur += c; continue; }
      if(c === '(' || c === '[') d++;
      if(c === ')' || c === ']') d--;
      if(d === 0 && (sep === ',' ? c === ',' : /\s/.test(c))){ if(cur.trim()) out.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    if(cur.trim()) out.push(cur.trim());
    return out;
  }
  function visible(e){
    var r = e.getBoundingClientRect();
    if(!(r.width > 0 && r.height > 0)) return false;
    return getComputedStyle(e).visibility !== 'hidden';
  }
  function texto(e){ return (e.textContent || '').replace(/\s+/g, ' ').trim(); }
  function paso(raices, s){
    var filtros = [];
    s = s.replace(/:has-text\((['"])((?:\\.|(?!\1).)*)\1\)/g, function(_, q, t){
      var buscado = t.replace(/\s+/g, ' ').toLowerCase();
      filtros.push(function(e){ return texto(e).toLowerCase().indexOf(buscado) >= 0; });
      return '';
    });
    s = s.replace(/:text-matches\((['"])((?:\\.|(?!\1).)*)\1(?:\s*,\s*(['"])(\w*)\3)?\)/g, function(_, q, re, q2, fl){
      var rx = new RegExp(re, fl || '');
      filtros.push(function(e){ return rx.test(texto(e)); });
      return '';
    });
    s = s.replace(/:visible(?![\w-])/g, function(){ filtros.push(visible); return ''; });
    if(!s) s = '*';
    var res = [];
    raices.forEach(function(r){
      r.querySelectorAll(s).forEach(function(e){
        if(res.indexOf(e) < 0 && filtros.every(function(f){ return f(e); })) res.push(e);
      });
    });
    return res;
  }
  function buscar(sel){
    var todos = [];
    partir(sel, ',').forEach(function(g){
      var raices = [document];
      partir(g, ' ').forEach(function(p){ raices = paso(raices, p); });
      raices.forEach(function(e){ if(todos.indexOf(e) < 0) todos.push(e); });
    });
    todos.sort(function(a, b){ return a === b ? 0 : (a.compareDocumentPosition(b) & 4 ? -1 : 1); });
    return todos;
  }
  function caja(e){
    var r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }

  var els = buscar(o.sel);
  if(o.modo === 'contar') return els.length;
  if(o.modo === 'visibles') return els.filter(visible).length;
  var e = els[o.nth || 0];
  if(o.modo === 'elemento') return e || null;
  if(!e) return { existe: false };
  switch(o.modo){
    case 'estado':
      var c = caja(e);
      return { existe: true, visible: visible(e),
               habilitado: !e.disabled && !(e.closest && e.closest('fieldset[disabled]')),
               editable: !e.readOnly, marcado: !!e.checked, x: c.x, y: c.y, w: c.w, h: c.h };
    case 'scroll':
      try{ e.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); }catch(x){ e.scrollIntoView(); }
      return caja(e);
    case 'golpe':
      var h = document.elementFromPoint(o.x, o.y);
      return !!h && (h === e || e.contains(h));
    case 'enfocar':
      e.focus();
      if(o.seleccionar){
        if(/^(INPUT|TEXTAREA)$/.test(e.tagName) && typeof e.select === 'function'){ try{ e.select(); }catch(x){} }
        else{ var rg = document.createRange(); rg.selectNodeContents(e); var sl = getSelection(); sl.removeAllRanges(); sl.addRange(rg); }
      }
      return document.activeElement === e;
    case 'valor':
      if(!('value' in e)) throw new Error('Not an input element');
      return e.value;
    case 'marcado':
      return !!e.checked;
    case 'elegir':
      if(e.tagName !== 'SELECT') throw new Error('Element is not a <select> element');
      var hay = false;
      for(var i = 0; i < e.options.length; i++){
        var op = e.options[i], si = op.value === o.valor;
        op.selected = si;
        if(si) hay = true;
      }
      if(!hay) return false;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    case 'evento':
      e.dispatchEvent(new Event(o.tipo, { bubbles: true, cancelable: true }));
      return true;
  }
  return null;
});

// Las teclas que usa la carga, como las manda un teclado de verdad.
var TECLAS = {
  Tab:       { key: 'Tab', code: 'Tab', k: 9 },
  Enter:     { key: 'Enter', code: 'Enter', k: 13, text: '\r' },
  Escape:    { key: 'Escape', code: 'Escape', k: 27 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', k: 40 },
  Delete:    { key: 'Delete', code: 'Delete', k: 46 }
};
var SIGNOS = { '/': ['Slash', 191], '-': ['Minus', 189], ',': ['Comma', 188], '.': ['Period', 190], ' ': ['Space', 32] };
function teclaDe(c){
  if(/^[a-z]$/i.test(c)) return { key: c, code: 'Key' + c.toUpperCase(), k: c.toUpperCase().charCodeAt(0), text: c };
  if(/^[0-9]$/.test(c)) return { key: c, code: 'Digit' + c, k: c.charCodeAt(0), text: c };
  if(SIGNOS[c]) return { key: c, code: SIGNOS[c][0], k: SIGNOS[c][1], text: c };
  return null;
}

class Cortado extends Error {}

function Pagina(){
  this.porDefecto = 30000;           // contexto.set_default_timeout(30000)
  this.vigilarAnuncios = false;
  this.cortado = null;               // si tocaron "Cancelar" en la franja de Chrome
}

Pagina.prototype.revisarCorte = function(){
  if(this.cortado) throw new Cortado(this.cortado);
};

Pagina.prototype.cdp = async function(metodo, params, sesion){
  this.revisarCorte();
  return await Mano.pedirSeguro('cdp', { metodo: metodo, params: params || {}, sesion: sesion || null }, 120000);
};

Pagina.prototype.esperar = function(ms){ return dormir(ms); };

function textoExcepcion(d){
  var x = d.exception || {};
  return String(x.description || x.value || d.text || 'Error en la página').split('\n')[0];
}

/* page.evaluate / frame.evaluate. `fn` es el texto de una función. */
Pagina.prototype.evaluar = async function(fn, arg, ctx){
  var expr = '(' + fn + ')(' + (arg === undefined ? '' : JSON.stringify(arg)) + ')';
  var p = { expression: expr, returnByValue: true, awaitPromise: true };
  if(ctx) p.contextId = ctx.id;
  var r = await this.cdp('Runtime.evaluate', p, ctx && ctx.sesion);
  if(r.exceptionDetails) throw new Error(textoExcepcion(r.exceptionDetails));
  return r.result ? r.result.value : undefined;
};

/* page.wait_for_function: pregunta seguido hasta que dé verdadero. Si Albor
   está cambiando de página en el medio, la pregunta falla y se repite. */
Pagina.prototype.esperarFuncion = async function(fn, limite, arg){
  limite = limite || this.porDefecto;
  var fin = Date.now() + limite;
  for(;;){
    try{ if(await this.evaluar(fn, arg)) return true; }
    catch(e){ if(e instanceof Cortado || /closed|ya no está en Albor/.test(e.message)) throw e; }
    if(Date.now() > fin) throw new Error('Timeout ' + limite + 'ms exceeded.');
    await dormir(50);
  }
};

Pagina.prototype.ir = async function(url, limite){
  this.revisarCorte();
  return await Mano.pedirSeguro('ir', { url: url, limite: limite || this.porDefecto }, (limite || this.porDefecto) + 15000);
};

Pagina.prototype.url = async function(){
  return (await Mano.pedirSeguro('url', {}, 15000)) || '';
};

Pagina.prototype.viva = async function(){
  try{ return !!(await Mano.pedirSeguro('viva', {}, 15000)); }catch(e){ return false; }
};

Pagina.prototype.traer = function(){ return Mano.pedirSeguro('traer', {}, 15000).catch(function(){}); };

Pagina.prototype.loc = function(sel){ return new Localizador(this, sel, 0); };

Pagina.prototype.raton = async function(x, y){
  await this.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x, y: y });
  await this.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: x, y: y, button: 'left', buttons: 1, clickCount: 1 });
  await this.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x, y: y, button: 'left', buttons: 0, clickCount: 1 });
};

Pagina.prototype.tecla = async function(t){
  var base = { key: t.key, code: t.code, windowsVirtualKeyCode: t.k, nativeVirtualKeyCode: t.k };
  await this.cdp('Input.dispatchKeyEvent', Object.assign({ type: t.text ? 'keyDown' : 'rawKeyDown' },
                                                          base, t.text ? { text: t.text, unmodifiedText: t.text } : {}));
  await this.cdp('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
};

/* page.keyboard.press */
Pagina.prototype.presionar = async function(nombre){
  if(this.vigilarAnuncios) await cerrarAnunciosSiHay(this);
  var t = TECLAS[nombre] || teclaDe(nombre);
  if(!t) throw new Error('Tecla desconocida: ' + nombre);
  await this.tecla(t);
};

/* Escribe una letra como un teclado (o la pega, si no es de las comunes). */
Pagina.prototype.escribirLetra = async function(c){
  var t = teclaDe(c);
  if(t) await this.tecla(t);
  else await this.cdp('Input.insertText', { text: c });
};

/* El recuadro (iframe) que tiene ese selector, para preguntarle cosas
   adentro (marco.content_frame()). null si todavía no tiene página. */
Pagina.prototype.marcoDe = async function(sel){
  var r = await this.cdp('Runtime.evaluate', {
    expression: '(' + AYUDANTE + ')(' + JSON.stringify({ sel: sel, modo: 'elemento' }) + ')',
    returnByValue: false });
  if(!r.result || !r.result.objectId) return null;
  var d;
  try{ d = await this.cdp('DOM.describeNode', { objectId: r.result.objectId }); }
  finally{ this.cdp('Runtime.releaseObject', { objectId: r.result.objectId }).catch(function(){}); }
  var fid = d && d.node && d.node.frameId;
  if(!fid) return null;
  var ctxs = await Mano.pedirSeguro('contextos', {}, 15000);
  return ctxs.filter(function(c){ return c.frameId === fid && c.isDefault; }).pop() || null;
};

/* page.frames: todos los documentos de Albor, recuadros incluidos. */
Pagina.prototype.marcos = async function(){
  var ctxs = await Mano.pedirSeguro('contextos', {}, 15000);
  return ctxs.filter(function(c){ return c.isDefault; });
};

/* ---------- Localizador: page.locator(...) ---------- */

function Localizador(pg, sel, nth){ this.pg = pg; this.sel = sel; this.n = nth || 0; }

Localizador.prototype.first = function(){ return new Localizador(this.pg, this.sel, 0); };
Localizador.prototype.nth = function(i){ return new Localizador(this.pg, this.sel, i); };

Localizador.prototype._h = function(modo, extra){
  return this.pg.evaluar(AYUDANTE, Object.assign({ sel: this.sel, nth: this.n, modo: modo }, extra || {}));
};

Localizador.prototype._estado = async function(){
  try{ return await this._h('estado'); }
  catch(e){ if(e instanceof Cortado || /closed/.test(e.message)) throw e; return null; }
};

Localizador.prototype.count = async function(){ return await this._h('contar'); };

/* is_visible: sin esperar. */
Localizador.prototype.isVisible = async function(){
  var st = await this._estado();
  return !!(st && st.existe && st.visible);
};

/* wait_for(state=...): attached, visible, hidden o detached. */
Localizador.prototype.waitFor = async function(estado, limite){
  estado = estado || 'visible';
  limite = limite || this.pg.porDefecto;
  var fin = Date.now() + limite;
  for(;;){
    var st = await this._estado();
    var e = st && st.existe, v = e && st.visible;
    if(st && ((estado === 'attached' && e) || (estado === 'visible' && v) ||
              (estado === 'hidden' && !v) || (estado === 'detached' && !e))) return true;
    if(Date.now() > fin) throw new Error('Timeout ' + limite + 'ms exceeded waiting for ' + this.sel + ' to be ' + estado);
    await dormir(100);
  }
};

/* click: como Playwright, espera a que esté a la vista, habilitado, quieto
   y sin nada encima; lo trae a la vista y hace clic en el medio. Con force,
   no espera nada de eso (solo que exista y tenga tamaño). */
Localizador.prototype.click = async function(o){
  o = o || {};
  var limite = o.timeout || this.pg.porDefecto, fin = Date.now() + limite, falta = 'no existe';
  for(;;){
    if(this.pg.vigilarAnuncios && !o.anuncio) await cerrarAnunciosSiHay(this.pg);
    var st = await this._estado();
    if(st && st.existe){
      if(!o.force && !st.visible) falta = 'no está a la vista';
      else if(!o.force && !st.habilitado) falta = 'está deshabilitado';
      else{
        var r = null;
        try{ r = await this._h('scroll'); }catch(e){ if(e instanceof Cortado) throw e; }
        if(r && r.w > 0 && r.h > 0){
          var listo = true;
          if(!o.force){
            await dormir(40);
            var r2 = await this._estado();
            if(!r2 || !r2.existe || Math.abs(r2.x - r.x) > 1 || Math.abs(r2.y - r.y) > 1){ listo = false; falta = 'se está moviendo'; }
            else if(!(await this._h('golpe', { x: r2.x, y: r2.y }).catch(function(){ return false; }))){ listo = false; falta = 'otro elemento lo tapa'; }
            r = r2 || r;
          }
          if(listo){ await this.pg.raton(r.x, r.y); return; }
        }else falta = 'no tiene tamaño (está oculto)';
      }
    }
    if(Date.now() > fin) throw new Error('Timeout ' + limite + 'ms exceeded clicking ' + this.sel + ' (' + falta + ')');
    await dormir(100);
  }
};

Localizador.prototype._tildar = async function(quiero, o){
  o = o || {};
  var limite = o.timeout || this.pg.porDefecto;
  await this.waitFor('attached', limite);
  if((await this._h('marcado')) === quiero) return;
  await this.click(o);
  if((await this._h('marcado')) !== quiero) throw new Error('Clicking the checkbox did not change its state');
};
Localizador.prototype.check = function(o){ return this._tildar(true, o); };
Localizador.prototype.uncheck = function(o){ return this._tildar(false, o); };

/* Espera a que se pueda escribir: a la vista, habilitado y editable. */
Localizador.prototype._esperarEditable = async function(limite){
  limite = limite || this.pg.porDefecto;
  var fin = Date.now() + limite;
  for(;;){
    if(this.pg.vigilarAnuncios) await cerrarAnunciosSiHay(this.pg);
    var st = await this._estado();
    if(st && st.existe && st.visible && st.habilitado && st.editable) return;
    if(Date.now() > fin) throw new Error('Timeout ' + limite + 'ms exceeded waiting for ' + this.sel + ' to be editable');
    await dormir(100);
  }
};

/* fill: selecciona lo que hay y lo reemplaza de una vez. */
Localizador.prototype.fill = async function(texto, o){
  texto = String(texto == null ? '' : texto);
  await this._esperarEditable(o && o.timeout);
  await this._h('enfocar', { seleccionar: true });
  if(texto) await this.pg.cdp('Input.insertText', { text: texto });
  else await this.pg.tecla(TECLAS.Delete);
};

/* press_sequentially: letra por letra, con una pausa entre cada una. */
Localizador.prototype.pressSequentially = async function(texto, delay){
  texto = String(texto == null ? '' : texto);
  await this._esperarEditable();
  await this._h('enfocar', {});
  for(var i = 0; i < texto.length; i++){
    await this.pg.escribirLetra(texto[i]);
    if(delay) await dormir(delay);
  }
};

Localizador.prototype.inputValue = async function(o){
  await this.waitFor('attached', (o && o.timeout) || this.pg.porDefecto);
  return await this._h('valor');
};

Localizador.prototype.selectOption = async function(valor, o){
  var limite = (o && o.timeout) || this.pg.porDefecto, fin = Date.now() + limite;
  for(;;){
    var st = await this._estado();
    if(st && st.existe && st.visible && st.habilitado && await this._h('elegir', { valor: String(valor) })) return;
    if(Date.now() > fin) throw new Error('Timeout ' + limite + 'ms exceeded selecting "' + valor + '" in ' + this.sel);
    await dormir(100);
  }
};

Localizador.prototype.dispatchEvent = async function(tipo){
  await this.waitFor('attached');
  await this._h('evento', { tipo: tipo });
};

/* ==================================================================
   albor.py
   ================================================================== */

/* ---------- Esperas ----------
   Albor es ASP.NET con MicrosoftAjax. Sus partial postbacks no pasan por
   jQuery.active, así que mirar solo jQuery deja seguir con la página a medio
   armar. Tampoco sirve networkidle: hay pedidos periódicos de fondo y esa
   espera nunca se cumple. */
var JS_ALBOR_LIBRE = "() => {\n" +
"    if (document.readyState !== 'complete') return false;\n" +
"    if (window.jQuery && window.jQuery.active > 0) return false;\n" +
"    try {\n" +
"        const S = window.Sys;\n" +
"        if (S && S.WebForms && S.WebForms.PageRequestManager) {\n" +
"            const m = S.WebForms.PageRequestManager.getInstance();\n" +
"            if (m && m.get_isInAsyncPostBack && m.get_isInAsyncPostBack()) return false;\n" +
"        }\n" +
"    } catch (e) { }\n" +
"    return ![...document.querySelectorAll('.ui-widget-overlay, .blockUI, #divCargando')]\n" +
"        .some(e => e.offsetParent !== null);\n" +
"}";

/* Espera a que Albor termine de procesar. El `asentar` es una pausa corta
   después de que se cumple la condición: le da tiempo a un postback que
   está por arrancar a registrarse, para no salir justo en el hueco entre
   dos encadenados. */
async function esperar(pg, limite, asentar){
  limite = limite || 15000;
  if(asentar === undefined) asentar = 250;
  try{
    await pg.esperarFuncion(JS_ALBOR_LIBRE, limite);
    if(asentar){
      await pg.esperar(asentar);
      await pg.esperarFuncion(JS_ALBOR_LIBRE, limite);
    }
  }catch(e){ if(e instanceof Cortado) throw e; }
}

var JS_VISOR_LISTO = "() => {\n" +
"    try {\n" +
"        if (typeof $find !== 'function') return false;\n" +
"        const v = $find('visorReporte');\n" +
"        if (!v) return false;\n" +
"        if (v.get_isLoading && v.get_isLoading()) return false;\n" +
"        return true;\n" +
"    } catch (e) { return false; }\n" +
"}";

/* ¿El visor de reportes ya terminó de armar el reporte? Se pregunta adentro
   del iframe, que es donde vive el visor. */
async function visorListo(pg, marco){
  try{ return !!(await pg.evaluar(JS_VISOR_LISTO, undefined, marco)); }
  catch(e){ if(e instanceof Cortado) throw e; return false; }
}

/* Los anuncios que Albor muestra de vez en cuando (mantenimiento, eventos):
   un cartel que tapa la pantalla con un botón "Entendido". Se busca ESE
   texto exacto y nada más, para no tocar nunca un "Aceptar" que sí importe. */
var ANUNCIO = "button:text-matches('^\\s*Entendido\\s*$', 'i'), " +
              "a:text-matches('^\\s*Entendido\\s*$', 'i'), " +
              "input[type=button][value='Entendido'], input[type=submit][value='Entendido']";

async function cerrarAnuncios(pg){
  try{
    var botones = pg.loc(ANUNCIO);
    var n = Math.min(await botones.count(), 3);
    for(var i = 0; i < n; i++){
      var b = botones.nth(i);
      if(await b.isVisible()){
        await b.click({ timeout: 3000, anuncio: true });
        await pg.esperar(300);
      }
    }
  }catch(e){ if(e instanceof Cortado) throw e; }
}

/* Lo que antes hacía add_locator_handler: si aparece un anuncio en
   cualquier momento (no solo al entrar), se cierra antes de la próxima
   acción y se sigue. */
async function cerrarAnunciosSiHay(pg){
  try{
    if(!(await pg.evaluar(AYUDANTE, { sel: ANUNCIO, modo: 'visibles' }))) return;
  }catch(e){ if(e instanceof Cortado) throw e; return; }
  var antes = pg.vigilarAnuncios;
  pg.vigilarAnuncios = false;
  try{ await cerrarAnuncios(pg); } finally{ pg.vigilarAnuncios = antes; }
}

/* Cierra los diálogos que Albor deja abiertos y tapan el formulario. */
async function cerrarPopups(pg){
  await cerrarAnuncios(pg);
  try{
    var cruces = pg.loc('.ui-dialog:visible .ui-dialog-titlebar-close');
    var n = Math.min(await cruces.count(), 4);
    for(var i = 0; i < n; i++){
      try{
        await cruces.nth(0).click({ timeout: 2000 });
        await pg.esperar(300);
      }catch(e){ if(e instanceof Cortado) throw e; break; }
    }
  }catch(e){ if(e instanceof Cortado) throw e; }
}

/* Vacía un campo, escribe y COMPRUEBA que haya quedado lo escrito. Los
   campos recién abiertos se comen la primera tecla: 'ALIM0003' quedaba como
   'LIM0003' y después no encontraba el insumo. */
async function escribirCampo(pg, selector, texto, o){
  o = o || {};
  texto = String(texto);
  var secuencial = o.secuencial !== false, delay = o.delay == null ? 80 : o.delay, intentos = o.intentos || 3;
  var campo = pg.loc(selector);
  await campo.waitFor('visible', 15000);

  for(var intento = 1; intento <= intentos; intento++){
    await campo.click();
    await campo.fill('');
    await pg.esperar(120);
    if(secuencial) await campo.pressSequentially(texto, delay);
    else await campo.fill(texto);
    await pg.esperar(100);
    var quedo;
    try{ quedo = ((await campo.inputValue()) || '').trim(); }
    catch(e){ if(e instanceof Cortado) throw e; return campo; }
    if(quedo === texto.trim()) return campo;
  }

  await campo.fill(texto);
  try{
    await campo.dispatchEvent('input');
    await campo.dispatchEvent('keyup');
  }catch(e){ if(e instanceof Cortado) throw e; }
  return campo;
}

/* Los tildes de la lista de puntos de stock, con el nombre que muestra
   Albor. Se leen todos juntos para no adivinar en qué estado quedaron. */
var JS_PUNTOS_STOCK = "() => {\n" +
"    const pre = 'PuntosStock_Lista_chk_';\n" +
"    return [...document.querySelectorAll('input[id^=\"' + pre + '\"]')].map(e => {\n" +
"        const lab = document.querySelector('label[for=\"' + e.id + '\"]');\n" +
"        const txt = lab ? lab.textContent\n" +
"                        : (e.parentElement ? e.parentElement.textContent : '');\n" +
"        return {id: e.id.slice(pre.length), tildado: !!e.checked,\n" +
"                nombre: (txt || '').replace(/\\s+/g, ' ').trim()};\n" +
"    }).filter(p => p.id);\n" +
"}";

/* Marca o desmarca una casilla del filtro y espera al postback. */
async function tildar(pg, selector, marcado){
  if(marcado === undefined) marcado = true;
  try{
    var casilla = pg.loc(selector);
    await casilla.waitFor('attached', 10000);
    if(marcado) await casilla.check({ force: true });
    else await casilla.uncheck({ force: true });
    await esperar(pg, 20000);
    return true;
  }catch(e){
    if(e instanceof Cortado) throw e;
    anotar('   [!] No pude tocar ' + selector + ' (' + primeraLinea(e) + ')');
    return false;
  }
}

function Albor(avisar){
  this.avisar = avisar;
  this.pg = new Pagina();
  this.abierta = false;
  this.puntos_elegidos = [];      // los nombres que quedaron tildados
  this.hasta_reporte = null;      // la fecha "Hasta" que muestra el reporte
}

Albor.prototype.decir = function(texto){
  anotar(texto);
  try{ this.avisar(texto); }catch(e){}
};

/* Abre la pestaña de Albor en el Chrome de la persona, con su sesión.
   Devuelve si la pestaña es nueva. */
Albor.prototype.abrir = async function(){
  var r = await Mano.pedirSeguro('abrir', { url: C.URL_EXISTENCIAS }, 60000);
  this.abierta = true;
  this.pg.vigilarAnuncios = true;
  return !!(r && r.nueva);
};

Albor.prototype.cerrar = async function(){
  this.abierta = false;
  try{ await Mano.pedirSeguro('cerrar', {}, 15000); }catch(e){}
};

/* ---------- sesión ---------- */

/* ¿Seguimos adentro de Albor, o nos mandó al login? */
Albor.prototype.haySesion = async function(){
  try{ return (await this.pg.loc('#PuntosStock_Lista_disabler, #btReporte, #btnNuevo').count()) > 0; }
  catch(e){ if(e instanceof Cortado) throw e; return false; }
};

/* ¿La persona está parada en la pantalla de iniciar sesión? Mientras esté
   acá no hay que tocar la página: una recarga le borra lo que está
   escribiendo. */
Albor.prototype.enLogin = async function(){
  try{
    var url = (await this.pg.url()).toLowerCase();
    if(url.indexOf('/account/') >= 0 || url.indexOf('login') >= 0) return true;
    return (await this.pg.loc('input[type=password]').count()) > 0;
  }catch(e){ if(e instanceof Cortado) throw e; return false; }
};

/* Entra a una pantalla interna. Si Albor pide login, avisa y espera. No se
   toca la página mientras la persona está escribiendo: recién cuando sale
   del login se la lleva al reporte. Usa la sesión de Albor del Chrome de la
   persona: si ya entró a Albor, no pregunta nada. */
Albor.prototype.asegurarSesion = async function(minutos){
  minutos = minutos || 5;
  var nueva = await this.abrir();
  if(!nueva) await this.pg.ir(C.URL_EXISTENCIAS);
  await esperar(this.pg, 40000);
  await cerrarAnuncios(this.pg);

  if(await this.haySesion()) return true;

  // Chrome deja puestos usuario y contraseña: se toca INGRESAR (Feli, 2026-10-03).
  if(await this.enLogin()){
    this.decir('Albor pide ingresar: toco INGRESAR…');
    await tocarIngresar(this.pg);
    if(!(await this.enLogin())){
      try{ await this.pg.ir(C.URL_EXISTENCIAS); await esperar(this.pg, 20000); }catch(e){ if(e instanceof Cortado) throw e; }
      if(await this.haySesion()){ this.decir('Sesión iniciada.'); return true; }
    }
  }

  await this.pg.traer();
  this.decir('Iniciá sesión en la pestaña de Albor que se abrió. Cuando entres sigo solo.');

  var fin = Date.now() + minutos * 60000;
  while(Date.now() < fin){
    if(!(await this.pg.viva())) throw new Error('Se cerró la pestaña de Albor antes de iniciar sesión.');

    if(await this.haySesion()){ this.decir('Sesión iniciada.'); return true; }

    // Solo cuando ya salió del login se la lleva al reporte. Si se hiciera
    // antes, la recarga le borraría usuario y contraseña.
    if(!(await this.enLogin())){
      try{
        await this.pg.ir(C.URL_EXISTENCIAS);
        await esperar(this.pg, 20000);
        if(await this.haySesion()){ this.decir('Sesión iniciada.'); return true; }
      }catch(e){ if(e instanceof Cortado) throw e; }
    }
    await this.pg.esperar(1500);
  }
  return false;
};

/* ---------- existencias ---------- */

Albor.prototype.puntosEnPantalla = async function(){
  try{ return (await this.pg.evaluar(JS_PUNTOS_STOCK)) || []; }
  catch(e){ if(e instanceof Cortado) throw e; return []; }
};

/* Deja tildados exactamente los puntos de stock que se piden. Destildar
   'Todos' habilita la lista, pero deja los tildes como estaban: todos
   puestos. Así que marcar los tres que van no alcanzaba, había que apagar
   los otros. De ahí salía un reporte con ocho puntos cuando se habían
   pedido tres. */
Albor.prototype.elegirPuntos = async function(puntos){
  var pg = this.pg, yo = this;
  var quiero = puntos.map(String);
  await tildar(pg, '#PuntosStock_Lista_disabler', false);   // destilda 'Todos'

  var enPantalla = await this.puntosEnPantalla();
  if(!enPantalla.length){
    // No se pudo leer la lista (¿cambió la pantalla?). Al menos se marcan los
    // que van, como se hacía antes.
    for(var i = 0; i < quiero.length; i++) await tildar(pg, '#PuntosStock_Lista_chk_' + quiero[i], true);
    this.decir('[!] No pude leer la lista de puntos de stock. ' +
               'Mirá en la pestaña de Albor que queden tildados solo los que van.');
    return [];
  }

  var conocidos = {};
  enPantalla.forEach(function(p){ conocidos[p.id] = p; });
  var faltan = quiero.filter(function(p){ return !conocidos[p]; });
  if(faltan.length) this.decir('[!] Albor no muestra los puntos ' + faltan.join(', ') +
                               '. Fijate que estén tildadas las dos empresas.');

  // Primero se apaga lo que sobra y después se prende lo que falta: cada
  // clic es un postback, así que se toca solo lo que hace falta tocar.
  for(var a = 0; a < enPantalla.length; a++){
    var p = enPantalla[a];
    if(p.tildado && quiero.indexOf(p.id) < 0) await tildar(pg, '#PuntosStock_Lista_chk_' + p.id, false);
  }
  for(var b = 0; b < quiero.length; b++){
    var q = quiero[b];
    if(conocidos[q] && !conocidos[q].tildado) await tildar(pg, '#PuntosStock_Lista_chk_' + q, true);
  }

  var quedaron = (await this.puntosEnPantalla()).filter(function(p){ return p.tildado; });
  this.puntos_elegidos = quedaron.map(function(p){ return p.nombre || p.id; });
  var sobran = quedaron.filter(function(p){ return quiero.indexOf(p.id) < 0; }).map(function(p){ return p.nombre || p.id; });
  if(sobran.length) yo.decir('[!] Quedaron tildados de más: ' + sobran.join(', ') + '. El reporte los va a traer igual.');
  this.decir('Puntos de stock: ' + (this.puntos_elegidos.join(', ') || 'ninguno'));
  return quedaron;
};

/* La fecha 'Hasta' del reporte. Por defecto Albor pone hoy, y así el
   reporte no ve los comprobantes con fecha posterior: un stock que ya está
   comprometido en uno del 1/10 aparecía como disponible el 28/9, y al
   transferirlo Albor avisaba que quedaba en negativo. */
Albor.prototype.ponerHasta = async function(hasta){
  var pg = this.pg;
  try{
    await escribirCampo(pg, '#FechaHasta', hasta, { delay: 60 });
    await pg.presionar('Tab');
    // Por si el selector de fechas escucha 'change' y no las teclas.
    await pg.evaluar("f => { const e = document.querySelector('#FechaHasta');\n" +
                     "    if (!e) return; e.dispatchEvent(new Event('change', {bubbles: true}));\n" +
                     "    if (window.jQuery) window.jQuery(e).trigger('change'); }", hasta);
    await esperar(pg, 15000);
    var quedo = ((await pg.loc('#FechaHasta').inputValue({ timeout: 5000 })) || '').trim();
    if(quedo && quedo.replace(/^0+/, '') !== hasta.replace(/^0+/, '') && quedo !== hasta)
      this.decir("[!] La fecha 'Hasta' quedó en " + quedo + ' en vez de ' + hasta + '. Revisala en Albor.');
    else
      this.decir('Existencias hasta el ' + hasta);
  }catch(e){
    if(e instanceof Cortado) throw e;
    this.decir("[!] No pude poner la fecha 'Hasta' (" + primeraLinea(e) + '). Ponela a mano: ' + hasta);
  }
};

/* Saca el reporte de Existencia de Insumos y devuelve el CSV. Los pasos
   son los que se hacen a mano:
     1. empresas La Quimera + Consultores Asociados
     2. destildar 'Todos' en Punto de Stock y marcar los que van
     3. solapa 'Categoría de Insumo' -> Ganaderos
     4. VER y exportar
   No queda ningún archivo dando vueltas: el CSV se devuelve como texto, y
   si Chrome lo guardó en Descargas, se borra de ahí. */
Albor.prototype.bajarExistencias = async function(puntos, hasta){
  var pg = this.pg;
  this.hasta_reporte = null;
  puntos = (puntos && puntos.length) ? puntos.slice() : OFICINAS.slice();

  this.decir('Abriendo el reporte de existencias…');
  await pg.ir(C.URL_EXISTENCIAS);
  await esperar(pg, 40000);
  await cerrarPopups(pg);

  this.decir('Empresas: La Quimera + Consultores Asociados');
  for(var i = 0; i < EMPRESAS.length; i++) await tildar(pg, '#Empresas_Lista_chk_' + EMPRESAS[i], true);

  await this.elegirPuntos(puntos);

  this.decir('Categoría de insumo: Ganaderos');
  try{
    await pg.loc('#ui-id-6').click({ timeout: 10000 });    // solapa 'Categoría de Insumo'
    await esperar(pg, 15000);
    await pg.loc('#ID_Categoria_Insumo').selectOption(CATEGORIA_GANADEROS);
    await esperar(pg, 20000);
  }catch(e){
    if(e instanceof Cortado) throw e;
    this.decir('[!] No pude poner la categoría (' + primeraLinea(e, 90) + '). Ponela a mano y seguí.');
  }

  // La fecha va última, justo antes de VER: los postbacks de las solapas y
  // de la categoría pueden volver a dibujar el formulario con la fecha de
  // hoy, y así lo escrito antes se perdía sin aviso.
  if(hasta) await this.ponerHasta(hasta);

  this.decir('Pidiendo el reporte…');
  await pg.loc('#btReporte').click({ timeout: 20000 });
  var texto = await this.exportarCsv();

  // La prueba de verdad: el propio reporte dice "Hasta: d/m/aaaa" en sus
  // condiciones de filtro. Si no coincide con lo pedido, se avisa.
  this.hasta_reporte = await hastaEnReporte(pg);
  if(this.hasta_reporte) this.decir('El reporte dice: existencias hasta el ' + this.hasta_reporte + '.');
  return texto;
};

/* Exporta el reporte como CSV con el comando propio del visor. El visor es
   SSRS y tarda en armarse; hasta que no terminó, el comando de exportar no
   hace nada. Antes de pedirlo se pregunta si ya está listo, y entre
   pregunta y pregunta se espera de verdad (5 segundos): insistir rápido no
   lo apura y solo gastaba los intentos. Con estos valores aguanta dos
   minutos. */
Albor.prototype.exportarCsv = async function(espera, intentos){
  var pg = this.pg;
  espera = espera || 5000; intentos = intentos || 24;
  this.decir('Esperando a que Albor arme el reporte (puede tardar un minuto)…');
  try{
    await pg.loc('#iframeReporte').waitFor('attached', 60000);
  }catch(e){
    if(e instanceof Cortado) throw e;
    // Sin el recuadro del reporte no hay nada que exportar: casi siempre es
    // que quedó un aviso de Albor tapando el formulario.
    throw new Error('Albor no abrió el reporte. Mirá la pestaña de Albor: si quedó algún ' +
                    'cartel abierto, cerralo y volvé a tocar el botón.');
  }
  await esperar(pg, 30000);

  var ultimo = '';
  for(var intento = 1; intento <= intentos; intento++){
    await pg.esperar(espera);

    var marco = null;
    try{ marco = await pg.marcoDe('#iframeReporte'); }catch(e){ if(e instanceof Cortado) throw e; }
    if(!marco) ultimo = 'el visor todavía no está';
    else if(!(await visorListo(pg, marco))) ultimo = 'el visor sigue armando el reporte';
    else{
      // El archivo lo agarra la extensión antes de que Chrome lo guarde
      // (o, si igual se guardó en Descargas, lo lee y lo borra de ahí).
      await Mano.pedirSeguro('capturar', { si: true }, 15000);
      try{
        await pg.evaluar("() => { $find('visorReporte').exportReport('CSV'); }", undefined, marco);
        var crudo = await this.esperarArchivo(marco, 25000);
        if(crudo){
          var t = decodificar(crudo);
          this.decir('Reporte bajado (' + Math.floor((crudo.bytes ? crudo.bytes.length : t.length) / 1024) + ' KB' +
                     (crudo.deDescargas ? ', tomado de Descargas y borrado de ahí' : '') + ').');
          return t;
        }
        ultimo = 'el archivo no llegó';
      }catch(e){
        if(e instanceof Cortado) throw e;
        ultimo = primeraLinea(e, 120);
      }finally{
        await Mano.pedirSeguro('capturar', { si: false }, 15000).catch(function(){});
      }
    }

    if(intento % 3 === 0)        // una línea cada 15 segundos, no cada 5
      this.decir('   sigo esperando (' + (intento * espera / 1000) + ' s): ' + ultimo);
  }

  throw new Error('Albor no terminó de armar el reporte en ' + (intentos * espera / 1000) + ' segundos (' + ultimo + '). ' +
                  'La pestaña de Albor quedó abierta: si el reporte está en pantalla, probá de nuevo.');
};

/* Lo que llegó después de pedir el reporte: la respuesta de Albor copiada
   al vuelo, o una descarga. Devuelve {bytes} o {texto}, o null. */
Albor.prototype.esperarArchivo = async function(marco, limite){
  var pg = this.pg, fin = Date.now() + limite, crudo = null, vistas = {};
  while(Date.now() < fin && !crudo){
    var c = await Mano.pedirSeguro('capturados', {}, 15000);
    var a = c.archivos.filter(function(x){ return /csv/i.test(x.url); })[0] || c.archivos[0];
    if(a) crudo = a.base64 != null ? { bytes: deBase64(a.base64) } : { texto: a.texto };
    for(var i = 0; !crudo && i < c.descargas.length; i++){
      var d = c.descargas[i];
      if(vistas[d.id]) continue;
      vistas[d.id] = true;
      var r = await Mano.pedirSeguro('leerDescarga', { descarga: d.id }, 60000);
      if(r.enLaPagina){
        // Un archivo armado adentro de Albor (blob:): se lee desde ahí.
        var b64 = await pg.evaluar("u => fetch(u).then(r => r.arrayBuffer()).then(b => {\n" +
                                   "  let s = '', a = new Uint8Array(b);\n" +
                                   "  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));\n" +
                                   "  return btoa(s); })", r.url, marco).catch(function(){
                                     return pg.evaluar("u => fetch(u).then(r => r.text()).then(t => btoa(unescape(encodeURIComponent(t))))", r.url);
                                   });
        crudo = { bytes: deBase64(b64), deDescargas: true };
      }else crudo = { bytes: deBase64(r.base64), deDescargas: true };
    }
    if(!crudo) await pg.esperar(500);
  }
  if(crudo){
    // Si Chrome además lo guardó en Descargas, se borra de ahí (Feli: que
    // no se acumulen existencias viejas).
    await pg.esperar(1500);
    var resto = await Mano.pedirSeguro('capturados', {}, 15000).catch(function(){ return { descargas: [] }; });
    for(var k = 0; k < resto.descargas.length; k++)
      await Mano.pedirSeguro('borrarDescarga', { descarga: resto.descargas[k].id }, 30000).catch(function(){});
  }
  return crudo;
};

function deBase64(b64){
  var s = atob(b64), b = new Uint8Array(s.length);
  for(var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

function decodificar(crudo){
  if(crudo.texto != null) return String(crudo.texto).replace(/^﻿/, '');
  var b = crudo.bytes;
  try{ return new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^﻿/, ''); }catch(e){}
  try{ return new TextDecoder('windows-1252').decode(b); }catch(e){}
  return new TextDecoder('utf-8').decode(b);
}

/* La fecha 'Hasta' que imprime el reporte en sus condiciones de filtro
   ("Condiciones de filtro Hasta: 28/9/2026, Moneda: …"). El visor de SSRS
   puede estar en un iframe dentro de otro: se miran todos. */
async function hastaEnReporte(pg){
  var marcos = [];
  try{ marcos = await pg.marcos(); }catch(e){ if(e instanceof Cortado) throw e; }
  for(var i = 0; i < marcos.length; i++){
    var texto = '';
    try{ texto = (await pg.evaluar("() => document.body ? document.body.innerText : ''", undefined, marcos[i])) || ''; }
    catch(e){ if(e instanceof Cortado) throw e; continue; }
    var m = /Hasta:\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(texto);
    if(m) return m[1];
  }
  return null;
}

/* '1/10/2026' y '01/10/2026' son la misma fecha. */
function mismaFecha(a, b){
  try{
    var x = String(a).split('/').map(Number), y = String(b).split('/').map(Number);
    return x.length === y.length && x.every(function(v, i){ return !isNaN(v) && v === y[i]; });
  }catch(e){ return false; }
}

function filasCsv(texto){
  var filas = [], fila = [], campo = '', q = false;
  for(var i = 0; i < texto.length; i++){
    var c = texto[i];
    if(q){
      if(c === '"'){ if(texto[i + 1] === '"'){ campo += '"'; i++; } else q = false; }
      else campo += c;
    }else if(c === '"') q = true;
    else if(c === ','){ fila.push(campo); campo = ''; }
    else if(c === '\n' || c === '\r'){
      if(c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    }else campo += c;
  }
  if(campo || fila.length){ fila.push(campo); filas.push(fila); }
  return filas;
}

/* Los puntos de stock que trae un CSV de existencias. Sirve para avisar si
   el reporte no salió con lo que se esperaba. */
function puntosDelReporte(texto){
  var vistos = [];
  filasCsv(texto).forEach(function(f){
    if(f.length === 27 && f[0] !== 'Descripcion_Tipo_Insumo'){
      var p = (f[13] || '').trim();
      if(p && vistos.indexOf(p) < 0) vistos.push(p);
    }
  });
  return vistos;
}

/* ==================================================================
   cargas.py
   ================================================================== */

class Cancelado extends Error {}
// Albor llevó a la pantalla de ingreso en el medio de un comprobante: lo que
// estaba armado (sin guardar) se perdió y hay que armarlo de nuevo.
class SesionPerdida extends Error {}

/* Lo que la carga le dice a la pantalla y lo que la pantalla contesta.
   `decir(texto)` escribe una línea de avance. `preguntar(texto, boton)`
   muestra el texto con un botón y espera a que lo toquen; devuelve false si
   en vez de eso cancelaron. `cancelado()` dice si pidieron cancelar
   mientras se trabajaba. */
function Charla(decir, preguntar, cancelado){
  this.decir = decir;
  this._preguntar = preguntar;
  this.cancelado = cancelado;
}
Charla.prototype.pausa = async function(texto, boton){
  if(!(await this._preguntar(texto, boton || 'Seguir'))) throw new Cancelado();
};
Charla.prototype.revisar = function(){
  if(this.cancelado()) throw new Cancelado();
};

/* Albor espera coma decimal: 2.5 -> '2,5'. */
function unidadesAlbor(valor){ return String(valor).trim().replace(/\./g, ','); }

/* La grilla de ítems la dibuja Albor después de armar la cabecera. Sin ella
   no existe el botón '+' y no hay dónde cargar nada. */
async function esperarGrilla(pg, limite){
  try{ await pg.loc(BTN_MAS).first().waitFor('visible', limite || 25000); return true; }
  catch(e){ if(e instanceof Cortado) throw e; return false; }
}

/* Selecciona un <option> por valor. Si no existe, avisa y no lo toca: es
   preferible que lo elija una persona a cargar un punto equivocado. */
async function elegirOpcion(pg, selector, valor, etiqueta, charla){
  if(['', '?'].indexOf(String(valor == null ? '' : valor).trim()) >= 0){
    charla.decir('   ' + etiqueta + ': lo elegís a mano en Albor.');
    return false;
  }
  try{
    var sel = pg.loc(selector);
    await sel.waitFor('visible', 15000);
    if(!(await pg.loc(selector + " option[value='" + valor + "']").count())){
      charla.decir('   [!] ' + etiqueta + ': Albor no tiene la opción ' + valor + '. Elegila a mano.');
      return false;
    }
    await sel.selectOption(valor);
    await esperar(pg, 20000);
    return true;
  }catch(e){
    if(e instanceof Cortado) throw e;
    charla.decir('   [!] No se pudo elegir ' + etiqueta + ' (' + primeraLinea(e) + '). Elegilo a mano.');
    return false;
  }
}

/* Campos con desplegable (cuenta contable, personal): escribe y elige la
   sugerencia de ESE código, no la primera (con el personal "7" la primera
   podía ser un 70 y pico). Devuelve el texto elegido. */
async function autocompletar(pg, selector, texto){
  await escribirCampo(pg, selector, texto, { delay: 90 });
  var elegido = await elegirDeLista(pg, texto, null, 5000);
  await esperar(pg, 15000);
  return elegido;
}

// Lo que Albor escribe al lado del código de la cuenta, por si la lista no
// mostró el nombre.
var JS_NOMBRE_CUENTA = "() => [...document.querySelectorAll('[id^=\"ID_Cta_Contable_Debito\"]')]\n" +
"    .filter(e => e.id !== 'ID_Cta_Contable_Debito_codigo' && e.offsetParent !== null)\n" +
"    .map(e => ('value' in e ? e.value : e.textContent) || '')\n" +
"    .map(s => s.replace(/\\s+/g, ' ').trim()).filter(Boolean)";

function escRe(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* '510201003 - GAN-Productos Veterinarios' -> 'GAN-Productos Veterinarios'. */
async function nombreDeCuenta(pg, cuenta, textoElegido){
  var candidatos = textoElegido ? [textoElegido] : [];
  try{ candidatos = candidatos.concat((await pg.evaluar(JS_NOMBRE_CUENTA)) || []); }
  catch(e){ if(e instanceof Cortado) throw e; }
  for(var i = 0; i < candidatos.length; i++){
    // Solo el código del principio: el nombre en sí no se toca.
    var limpio = String(candidatos[i]).replace(new RegExp('^\\s*' + escRe(cuenta) + '\\b'), '');
    limpio = limpio.replace(/^[\s\-–:|·\t]+|[\s\-–:|·\t]+$/g, '');
    if(limpio && !/^\d+$/.test(limpio)) return limpio;
  }
  return null;
}

async function ponerFecha(pg, fecha, charla){
  if(!fecha) return;
  try{
    await escribirCampo(pg, '#Fecha', fecha, { delay: 80 });
    await pg.presionar('Tab');
    await esperar(pg, 15000);
  }catch(e){
    if(e instanceof Cortado) throw e;
    charla.decir('   [!] No se pudo cargar la fecha (' + primeraLinea(e) + '). Ponela a mano.');
  }
}

/* ---------- Empresa ---------- */

/* Albor pone el número de empresa en la dirección: /2/Comprobantes_Stock.
   El /0/ aparece cuando todavía no hay ninguna elegida: no sirve. */
async function empresaEnUrl(pg){
  var m = /^https?:\/\/[^/]+\/(\d+)(\/|$)/.exec(await pg.url());
  var num = m ? m[1] : null;
  return num && num !== '0' ? num : null;
}

/* Cambia de empresa y VERIFICA que haya cambiado: la pantalla de
   comprobantes de esa empresa tiene que abrir en su propia dirección. */
async function cambiarEmpresa(pg, empresa, empresaActual, charla){
  var origen = empresaActual || '1';
  charla.decir('Cambiando a la empresa ' + empresa + '…');

  for(var intento = 1; intento <= 3; intento++){
    try{
      await pg.ir(C.BASE + '/' + origen + '/Empresas/SeleccionEmpresa');
      await esperar(pg);
      var chk = pg.loc('#cboEmpresa_chk_' + empresa);
      await chk.waitFor('attached', 15000);
      await chk.check({ force: true });
      await pg.loc('#idBtnSeleccionEmpresa').click();
      await esperar(pg, 40000);

      await pg.ir(C.BASE + '/' + empresa + '/Comprobantes_Stock');
      await esperar(pg, 40000);
      if((await pg.url()).indexOf('/' + empresa + '/') >= 0){
        charla.decir('   empresa ' + empresa + ' activa.');
        return empresa;
      }
      charla.decir('   intento ' + intento + ': Albor redirigió a otra pantalla.');
    }catch(e){
      if(e instanceof Cortado) throw e;
      charla.decir('   intento ' + intento + ' falló: ' + primeraLinea(e));
    }
    await pg.esperar(2000);
  }

  await charla.pausa('No pude cambiar a la empresa ' + empresa + ' solo.\n' +
                     'Cambiala a mano en Albor, abrí Comprobantes de Stock y tocá Seguir.');
  return empresa;
}

/* Deja Albor en Comprobantes de Stock de la empresa pedida. */
async function irAEmpresa(pg, empresa, empresaActual, charla){
  empresa = String(empresa == null ? '' : empresa).trim();
  if(empresa === '' || empresa === '?'){
    await charla.pausa('Este comprobante no tiene el número de empresa.\n' +
                       'Cambiala a mano en Albor, abrí Comprobantes de Stock y tocá Seguir.');
    empresa = await empresaEnUrl(pg);
    if(!empresa) throw new Error('No pude leer la empresa en Albor. Completá el número ' +
                                 'en la lista (editar destinos / editar granjas).');
  }
  if(empresa !== empresaActual) return await cambiarEmpresa(pg, empresa, empresaActual, charla);
  await pg.ir(C.BASE + '/' + empresa + '/Comprobantes_Stock');
  await esperar(pg, 40000);
  return empresa;
}

async function nuevoComprobante(pg){
  await cerrarPopups(pg);
  await pg.loc("a:has-text('Nuevo'), button:has-text('Nuevo'), #btnNuevo").first().click({ timeout: 20000 });
  await esperar(pg, 40000);
}

/* Después de 'Guardar y crear otro' Albor deja la pantalla lista para el
   siguiente. Si no quedó así, se vuelve a empezar. */
async function formularioEnBlanco(pg){
  try{ return await pg.loc('#ID_Tipo_Comprobante').isVisible(); }
  catch(e){ if(e instanceof Cortado) throw e; return false; }
}

/* ---------- Renglones ---------- */

function clave(s){ return String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase(); }
function norm(s){ return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }

// Las sugerencias que muestra Albor mientras se escribe el código.
var JS_SUGERENCIAS = "() => [...document.querySelectorAll('ul.ui-autocomplete li')]\n" +
"    .filter(li => li.offsetParent !== null)\n" +
"    .map(li => (li.textContent || '').replace(/\\s+/g, ' ').trim())";

function elegirSugerencia(pg, item){ return elegirDeLista(pg, item.codigo, item.nombre); }

/* Elige de la lista de Albor la sugerencia que es ESE código, y devuelve su
   texto (null si no eligió ninguna). Antes se tomaba la primera, y la lista
   trae todo lo que empieza con lo escrito: con BIO0002 (Deptal GP) la
   primera era BIO00021 (DEPTA TN), y entraba el insumo equivocado sin que
   nada avisara. Se busca el código como palabra entera; si la lista no
   muestra códigos, el nombre; si hay una sola sugerencia, esa. Si no hay
   forma de saber cuál es, no se elige ninguna y Albor resuelve el código
   exacto al salir del campo. */
async function elegirDeLista(pg, codigo, nombre, espera){
  try{
    await pg.loc('ul.ui-autocomplete:visible li, .ui-autocomplete:visible li').waitFor('visible', espera || 4000);
  }catch(e){
    if(e instanceof Cortado) throw e;
    await pg.presionar('Tab');
    return null;
  }
  await esperar(pg, 5000, 150);       // que termine de llenarse la lista
  var opciones = [];
  try{ opciones = (await pg.evaluar(JS_SUGERENCIAS)) || []; }
  catch(e){ if(e instanceof Cortado) throw e; }

  codigo = clave(codigo);
  function traeElCodigo(texto){
    // Palabra por palabra, y también de a dos juntas: el código puede venir
    // con un espacio adentro ("VET 0006").
    var p = String(texto).toUpperCase().match(/[A-Z0-9]+/g) || [];
    if(p.indexOf(codigo) >= 0) return true;
    for(var i = 0; i + 1 < p.length; i++) if(p[i] + p[i + 1] === codigo) return true;
    return false;
  }

  var elegida = -1;
  opciones.some(function(o, i){ if(traeElCodigo(o)){ elegida = i; return true; } return false; });
  if(elegida < 0 && nombre){
    var n = norm(nombre);
    opciones.some(function(o, i){ if(n && norm(o).indexOf(n) >= 0){ elegida = i; return true; } return false; });
  }
  if(elegida < 0 && opciones.length === 1) elegida = 0;

  if(elegida < 0){
    await pg.presionar('Escape');     // cierra la lista sin elegir
    await pg.presionar('Tab');
    return null;
  }
  for(var k = 0; k < elegida + 1; k++) await pg.presionar('ArrowDown');
  await pg.presionar('Enter');
  return opciones[elegida];
}

// Qué quedó en el diálogo del insumo: el código y el resto de los campos.
var JS_DIALOGO = "() => {\n" +
"    const dlgs = [...document.querySelectorAll('.ui-dialog')].filter(d => d.offsetParent !== null);\n" +
"    const raiz = dlgs.length ? dlgs[dlgs.length - 1] : document;\n" +
"    const cod = document.querySelector('#ID_Insumo_codigo');\n" +
"    return {\n" +
"        codigo: cod ? (cod.value || '') : '',\n" +
"        textos: [...raiz.querySelectorAll('input')]\n" +
"            .filter(e => e.offsetParent !== null && e.type !== 'hidden'\n" +
"                      && e.id !== 'ID_Insumo_codigo' && e.id !== 'Unidades'\n" +
"                      && (e.value || '').trim() !== '')\n" +
"            .map(e => e.value)\n" +
"    };\n" +
"}";

/* Comprueba que el insumo del diálogo sea el que se pidió, no uno parecido.
   Lanza si no: el que llama reintenta. */
async function confirmarInsumo(pg, item){
  var d;
  try{ d = await pg.evaluar(JS_DIALOGO); }
  catch(e){ if(e instanceof Cortado) throw e; return; }
  var quedo = clave(d.codigo);
  if(quedo && quedo !== clave(item.codigo))
    throw new Error('Albor eligió ' + d.codigo + ' en vez de ' + item.codigo);
  if(!d.textos || !d.textos.length) throw new Error('el código no resolvió ningún insumo');
}

/* El modal de insumos se reusa y al abrirse muestra el código anterior
   hasta que Albor lo limpia: escribir antes es que te lo pisen. */
async function esperarModalLimpio(pg, limite){
  try{
    await pg.esperarFuncion("() => { const e = document.querySelector('#ID_Insumo_codigo');\n" +
                            "    return e && e.offsetParent !== null && (e.value || '').trim() === ''; }", limite || 4000);
  }catch(e){ if(e instanceof Cortado) throw e; }
  await esperar(pg, 8000);
}

/* ---------- La grilla y el ingreso a Albor en el medio (Feli, 2026-10-03) ----------
   En la carga de Feli cada insumo entró dos veces: Albor lo aceptó, pero la
   ventanita no se cerró a tiempo (pedía la contraseña) y el programa lo
   volvió a cargar. Ahora se cuentan los renglones de la grilla: si el
   insumo ya entró, no se carga de nuevo. */

// Cuántos renglones tiene la grilla ("Mostrando 1 - N de N" abajo; si no, las
// filas a la vista) y el texto de cada uno. n null: no se sabe.
var JS_FILAS_GRILLA = String(function(){
  var t = (document.body && document.body.innerText) || '';
  var filas = [].slice.call(document.querySelectorAll('tr.jqgrow')).filter(function(r){ return r.offsetParent !== null; });
  var textos = filas.map(function(r){ return (r.innerText || '').replace(/\s+/g, ' ').trim(); });
  var m = /Mostrando\s+\d+\s*-\s*\d+\s+de\s+(\d+)/i.exec(t);
  if(m) return { n: +m[1], textos: textos };
  if(filas.length) return { n: filas.length, textos: textos };
  if(/Sin registros|No hay registros|Mostrando 0/i.test(t)) return { n: 0, textos: [] };
  return { n: document.querySelector('#ID_Tipo_Comprobante') ? 0 : null, textos: [] };
});

async function filasGrilla(pg){
  try{ return (await pg.evaluar(JS_FILAS_GRILLA)) || { n: null, textos: [] }; }
  catch(e){ if(e instanceof Cortado) throw e; return { n: null, textos: [] }; }
}

function entroUno(antes, ahora){
  return antes && ahora && antes.n !== null && ahora.n !== null && ahora.n > antes.n;
}

// ¿Albor pide ingresar? (una contraseña a la vista o la pantalla de ingreso)
var JS_INGRESO = String(function(){
  var pw = [].slice.call(document.querySelectorAll('input[type=password]')).filter(function(e){ return e.offsetParent !== null; });
  var url = location.href.toLowerCase();
  return { pide: pw.length > 0 || url.indexOf('/account/') >= 0 || url.indexOf('login') >= 0,
           formulario: !!document.querySelector('#ID_Tipo_Comprobante') };
});
var BTN_INGRESAR = "button:text-matches('^\\s*ingresar\\s*$', 'i'), a:text-matches('^\\s*ingresar\\s*$', 'i'), " +
                   "input[type=submit][value='INGRESAR' i], input[type=button][value='INGRESAR' i]";

async function pideIngreso(pg){
  try{ return (await pg.evaluar(JS_INGRESO)) || { pide: false, formulario: true }; }
  catch(e){ if(e instanceof Cortado) throw e; return { pide: false, formulario: true }; }
}

/* Chrome deja puestos el usuario y la contraseña de Albor: alcanza con tocar
   INGRESAR (Feli). La contraseña nunca la escribe ni la guarda el programa. */
async function tocarIngresar(pg){
  try{
    await pg.esperar(1500);
    await pg.loc(BTN_INGRESAR).first().click({ timeout: 8000 });
    await esperar(pg, 30000);
    await pg.esperar(1500);
  }catch(e){ if(e instanceof Cortado) throw e; }
}

/* Si Albor pide ingresar en el medio de la carga: toca INGRESAR y, si no
   alcanza, frena para que lo haga la persona. Si Albor se fue a la pantalla
   de ingreso, el comprobante a medio armar se perdió: SesionPerdida. */
async function atenderIngreso(pg, charla){
  var d = await pideIngreso(pg);
  if(!d.pide) return;
  if(!d.formulario) throw new SesionPerdida('Albor cerró la sesión en el medio del comprobante.');
  charla.decir('   Albor pide ingresar de nuevo: toco INGRESAR…');
  await tocarIngresar(pg);
  d = await pideIngreso(pg);
  if(!d.formulario) throw new SesionPerdida('Albor cerró la sesión en el medio del comprobante.');
  if(d.pide){
    await charla.pausa('Albor pide la contraseña. Ingresala en la pestaña de Albor (sin cerrar nada ni salir de la ' +
                       'pantalla) y tocá Seguir.', 'Seguir');
  }
}

/* Cierra la ventanita del insumo si quedó abierta después de que entró. */
async function cerrarVentanita(pg){
  try{
    if(!(await pg.loc('#ID_Insumo_codigo').isVisible())) return;
    await pg.presionar('Escape');
    await pg.esperar(500);
    if(await pg.loc('#ID_Insumo_codigo').isVisible())
      await pg.loc('.ui-dialog-titlebar-close:visible').first().click({ timeout: 3000 });
  }catch(e){ if(e instanceof Cortado) throw e; }
  await esperar(pg, 8000);
}

/* Antes del control: ¿la grilla tiene renglones de más o repetidos? */
async function revisarGrilla(pg, cargados){
  var f = await filasGrilla(pg), avisos = [];
  if(f.n !== null && f.n > cargados)
    avisos.push('La grilla tiene ' + f.n + ' renglones y cargué ' + cargados + ': puede haber alguno repetido.');
  var vistos = {}, repetidos = [];
  f.textos.forEach(function(t){ if(vistos[t] && repetidos.indexOf(t) < 0) repetidos.push(t); vistos[t] = true; });
  if(repetidos.length)
    avisos.push('Estos renglones están repetidos: borrá los de más en Albor antes de seguir.\n' +
                repetidos.map(function(t){ return '   ' + t; }).join('\n'));
  return avisos.length ? '\n\n⚠️ ' + avisos.join('\n') : '';
}

/* Carga un renglón. Lanza si no entró: el que llama reintenta. `antes`: la
   grilla antes de empezar con este insumo. */
async function cargarItem(pg, item, antes){
  await cerrarPopups(pg);
  await pg.loc(BTN_MAS).first().click({ timeout: 15000 });

  var codigo = pg.loc('#ID_Insumo_codigo');
  await codigo.waitFor('visible', 15000);
  await esperarModalLimpio(pg);

  await escribirCampo(pg, '#ID_Insumo_codigo', item.codigo, { delay: 70 });
  await elegirSugerencia(pg, item);
  await esperar(pg, 15000);
  await confirmarInsumo(pg, item);

  await escribirCampo(pg, '#Unidades', unidadesAlbor(item.unidad), { secuencial: false });
  await pg.loc('#btAceptar_dialog').click({ timeout: 15000 });

  // Si a Albor no le gustó el renglón, el diálogo queda abierto. Pero si
  // la grilla ya sumó el renglón, entró (aunque la ventanita siga abierta).
  var fin = Date.now() + 20000;
  for(;;){
    if(!(await codigo.isVisible())) break;
    if(entroUno(antes, await filasGrilla(pg))){ await cerrarVentanita(pg); break; }
    if(Date.now() > fin) throw new Error('la ventanita del insumo no se cerró (Albor no lo tomó)');
    await pg.esperar(500);
  }
  await esperar(pg, 15000);
  // Si la ventanita "se cerró" porque Albor se fue a la pantalla de ingreso, se perdió todo.
  var d = await pideIngreso(pg);
  if(d.pide && !d.formulario) throw new SesionPerdida('Albor cerró la sesión en el medio del comprobante.');
}

/* Carga todos los renglones. Nunca aborta por un renglón: lo que falla se
   anota y se informa, para agregarlo a mano sin rehacer todo. */
async function cargarItems(pg, items, charla){
  var cargados = [], fallados = [], total = items.length;
  for(var n = 1; n <= total; n++){
    var item = items[n - 1], entro = false;
    charla.revisar();
    var arranque = Date.now();
    var antes = await filasGrilla(pg);
    for(var intento = 1; intento <= 3; intento++){
      if(intento > 1){
        // Antes de reintentar: ¿Albor pide ingresar? ¿entró igual?
        await atenderIngreso(pg, charla);
        if(entroUno(antes, await filasGrilla(pg))){
          await cerrarVentanita(pg);
          cargados.push(item);
          charla.decir('   [' + n + '/' + total + '] ' + item.codigo + ' × ' + item.unidad + '  ya había entrado: no lo cargo de nuevo');
          entro = true;
          break;
        }
      }
      try{
        await cargarItem(pg, item, antes);
        cargados.push(item);
        charla.decir('   [' + n + '/' + total + '] ' + item.codigo + ' × ' + item.unidad + '  ok (' +
                     ((Date.now() - arranque) / 1000).toFixed(1) + ' s)');
        entro = true;
        break;
      }catch(e){
        if(e instanceof Cortado || e instanceof SesionPerdida || e instanceof Cancelado) throw e;
        charla.decir('   [' + n + '/' + total + '] ' + item.codigo + ': intento ' + intento + ' — ' + primeraLinea(e));
        if((await pideIngreso(pg)).pide) continue;      // lo atiende el próximo intento, sin tocar nada
        try{ await pg.presionar('Escape'); }catch(e2){ if(e2 instanceof Cortado) throw e2; }
        await cerrarPopups(pg);
        await esperar(pg, 10000);
      }
    }
    if(!entro && entroUno(antes, await filasGrilla(pg))){
      cargados.push(item);
      charla.decir('   [' + n + '/' + total + '] ' + item.codigo + ' entró al final');
      entro = true;
    }
    if(!entro){
      charla.decir('   [!] ' + item.codigo + ' NO entró. Sigo con el resto.');
      fallados.push(item);
    }
  }
  await atenderIngreso(pg, charla);     // antes del control: con sesión y con el comprobante a la vista
  return { cargados: cargados, fallados: fallados };
}

// El cartel rojo de Albor: "Los siguientes Insumos generan saldos
// negativos", con un renglón "Insumo : ... Saldo : -1,0000" por cada uno.
// Mientras está, Albor no aplica ni guarda.
var JS_SALDOS_NEGATIVOS = "() => {\n" +
"    const lineas = (document.body.innerText || '').split('\\n').map(s => s.trim()).filter(Boolean);\n" +
"    const i = lineas.findIndex(l => /saldos negativos/i.test(l));\n" +
"    if (i < 0) return null;\n" +
"    const out = [];\n" +
"    for (let k = i + 1; k < lineas.length && out.length < 40; k++) {\n" +
"        if (!/^Insumo\\s*:/i.test(lineas[k])) break;\n" +
"        out.push(lineas[k]);\n" +
"    }\n" +
"    return out;\n" +
"}";

/* null si Albor no se quejó; si no, los renglones del cartel, cortos. */
async function saldosNegativos(pg){
  var lineas;
  try{ lineas = await pg.evaluar(JS_SALDOS_NEGATIVOS); }
  catch(e){ if(e instanceof Cortado) throw e; return null; }
  if(lineas == null) return null;
  return lineas.map(function(l){
    var m = /Insumo\s*:\s*(.*?)\s*Punto de Stock\s*:\s*(.*?)\s*(?:Referencia\s*:\s*(.*?)\s*)?Fecha\s*:\s*(\S+)\s*Saldo\s*:\s*(\S+)/.exec(l);
    if(!m) return '   ' + l;
    var saldo = m[5].replace(/,0+$/, '');
    return '   ' + m[1] + ': queda en ' + saldo + ' el ' + m[4] +
           (m[3] ? ' (por el comprobante ' + m[3].replace(/ /g, '') + ')' : '');
  });
}

/* ---------- La tarjeta roja de Albor y el guardado (Feli, 2026-10-02) ----------
   Al aplicar o guardar, Albor tarda unos segundos y puede mostrar un recuadro
   rojo ARRIBA DE TODO, encima de la cabecera: saldos negativos, o algo de la
   cabecera que no anda (lo que dice cambia). Mientras está, el comprobante NO
   se guardó, y salir de esa pantalla lo pierde. Por eso, después de tocar el
   botón se espera a que Albor conteste, y nunca se pasa al siguiente
   comprobante sin ver que quedó guardado. */

// El texto de los recuadros rojos (borde, fondo o letra roja) que están más
// arriba que la cabecera. null si no hay ninguno o no está el formulario.
// Con {marcar: true} anota los que hay como "ya vistos": uno que queda a la
// vista después de que la persona lo resolvió no cuenta como nuevo; sí uno
// que Albor vuelve a dibujar o que cambia de texto.
var JS_ADVERTENCIA = String(function(o){
  o = o || {};
  function rojo(c){
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c || '');
    if(!m || (m[4] !== undefined && +m[4] === 0)) return 0;
    var r = +m[1], g = +m[2], b = +m[3];
    if(r >= 140 && r - g >= 60 && r - b >= 60) return 2;          // rojo
    if(r >= 235 && r - g >= 12 && r - b >= 12 && g < 245) return 1; // rosado clarito (el fondo)
    return 0;
  }
  function borde(s, lado){ return parseFloat(s['border' + lado + 'Width']) > 0 ? rojo(s['border' + lado + 'Color']) : 0; }
  var ref = document.querySelector('#ID_Tipo_Comprobante');
  if(!ref) return null;
  var tope = ref.getBoundingClientRect().top, hallados = [];
  var todos = document.body ? document.body.querySelectorAll('div, ul, ol, p, span, table, section, fieldset, form > *') : [];
  for(var i = 0; i < todos.length; i++){
    var e = todos[i];
    if(e.id === '__pc_cartel' || hallados.some(function(h){ return h.contains(e); })) continue;
    var r = e.getBoundingClientRect();
    if(r.width < 40 || r.height < 10 || r.top >= tope) continue;
    var t = (e.innerText || '').trim();
    if(t.length < 12) continue;
    var st = getComputedStyle(e);
    if(st.visibility === 'hidden' || st.display === 'none' || +st.opacity === 0) continue;
    var marca = borde(st, 'Top') || borde(st, 'Left') || rojo(st.backgroundColor) || rojo(st.color) === 2 ||
                /(^|\s)(alert-danger|validation-summary-errors|field-validation-error|error|errores|msgError)(\s|$)/i.test(String(e.className || ''));
    if(marca) hallados.push(e);
  }
  var nuevos = hallados.filter(function(h){ return h.__pcVisto !== h.innerText.trim(); });
  if(o.marcar) hallados.forEach(function(h){ h.__pcVisto = h.innerText.trim(); });
  if(!nuevos.length) return null;
  return nuevos.map(function(h){ return h.innerText.trim(); }).join('\n').slice(0, 3000);
});

/* Lo rojo que hay ahora en Albor queda como "ya visto". */
async function marcarVistas(pg){
  try{ await pg.evaluar(JS_ADVERTENCIA, { marcar: true }); }
  catch(e){ if(e instanceof Cortado) throw e; }
  return JSON.stringify(await saldosNegativos(pg));
}

/* Una advertencia NUEVA de Albor, o null. `negVistos`: los saldos negativos
   que ya estaban (por si el recuadro no se viera rojo). */
async function advertenciaAlbor(pg, negVistos){
  var t = null;
  try{ t = await pg.evaluar(JS_ADVERTENCIA); }
  catch(e){ if(e instanceof Cortado) throw e; }
  var neg = await saldosNegativos(pg);
  if(neg && JSON.stringify(neg) === negVistos && !t) neg = null;
  if(!t && !neg) return null;
  if(t && !/saldos negativos/i.test(t)) neg = null;
  return { texto: t || 'Los siguientes Insumos generan saldos negativos', negativos: neg };
}

function textoAdvertencia(adv, que){
  var detalle = adv.negativos && adv.negativos.length
    ? 'Estos insumos quedarían con stock negativo:\n' + adv.negativos.join('\n') +
      '\n\nCuando dice «por el comprobante …», hay un movimiento con fecha posterior que ya usa ese stock.'
    : 'Albor dice:\n' + String(adv.texto).split('\n').map(function(l){ return l.trim(); })
                         .filter(Boolean).slice(0, 30).map(function(l){ return '   ' + l; }).join('\n');
  return 'Hay advertencias de Albor que no permiten ' + que + ' → gestionalo a mano en Albor. ' +
         'No cierres el recuadro rojo ni salgas de esa pantalla.\n\n' + detalle +
         '\n\nCuando termines, tocá Seguir. Si todavía no está guardado, lo guardo yo.';
}

/* La "huella" del comprobante abierto: si cambió alguno de estos campos (o ya
   no está el formulario), Albor lo guardó y abrió uno nuevo. Un error de
   Albor vuelve a dibujar la pantalla, pero con los mismos valores. */
var HUELLA = ['#Numero_Comprobante', '#ID_Punto_Stock_Destino', '#ID_Cta_Contable_Debito_codigo', '#Nro'];
var JS_HUELLA = "sels => { if (!document.querySelector('#ID_Tipo_Comprobante')) return null;\n" +
"    return sels.map(s => { const e = document.querySelector(s); return e ? String(e.value || '').trim() : ''; }); }";

async function huella(pg){
  try{ return await pg.evaluar(JS_HUELLA, HUELLA); }
  catch(e){ if(e instanceof Cortado) throw e; return undefined; }   // cambiando de página: no se sabe
}

function sigueAbierto(antes, ahora){
  if(ahora === null) return false;                    // ya no está el formulario
  if(!ahora || !antes) return true;                   // no se pudo leer: se da por abierto
  return antes.every(function(v, i){ return !v || ahora[i] === v; });
}

/* Toca un botón de Albor y espera su respuesta. `listo()` dice si ya hizo lo
   suyo. {ok}, {advertencia}, {nada} (no contestó) o {noToco}. */
async function tocarYEsperar(pg, selector, listo, limite){
  var negVistos = await marcarVistas(pg);
  try{ await pg.loc(selector).click({ timeout: 20000 }); }
  catch(e){ if(e instanceof Cortado) throw e; return { noToco: primeraLinea(e) }; }
  var fin = Date.now() + (limite || 90000);
  await pg.esperar(1500);
  while(Date.now() < fin){
    await esperar(pg, 20000);
    var ing = await pideIngreso(pg);
    if(ing.pide && !ing.formulario) return { sesion: true };     // se fue a la pantalla de ingreso: no es "guardado"
    var adv = await advertenciaAlbor(pg, negVistos);
    if(adv) return { advertencia: adv };
    if(await listo()){
      // El recuadro rojo puede llegar un poco después: se mira de nuevo.
      await pg.esperar(1500);
      await esperar(pg, 20000);
      adv = await advertenciaAlbor(pg, negVistos);
      if(adv) return { advertencia: adv };
      if(await listo()) return { ok: true };
    }
    await pg.esperar(1000);
  }
  return { nada: true };
}

/* Albor cerró la sesión mientras se aplicaba o guardaba: no se sabe si quedó.
   Nunca se rearma solo (podría quedar dos veces): lo verifica la persona. */
async function sesionCaidaAlGuardar(pg, charla, numero){
  charla.decir('   [!] Albor cerró la sesión mientras guardaba.');
  if((await pideIngreso(pg)).pide) await tocarIngresar(pg);
  await charla.pausa('Albor cerró la sesión justo mientras ' + (numero ? 'guardaba el comprobante ' + numero : 'aplicaba o guardaba') +
                     ', así que no sé si quedó.\n\nEntrá de nuevo en la pestaña de Albor (si pide la contraseña) y fijate en ' +
                     'Comprobantes de Stock si está. Si no está, cargalo a mano. Después tocá «Ya lo revisé» y sigo con el resto.',
                     'Ya lo revisé');
  if(M.albor && !(await M.albor.asegurarSesion(5)))
    throw new Error('Albor sigue sin sesión. Iniciá sesión en la pestaña de Albor y volvé a tocar el botón.');
  return numero;
}

// El GUARDAR de las transferencias (el botón verde; no "Guardar y crear otro").
var BTN_GUARDAR = "#btGuardar, button:text-matches('^\\s*guardar\\s*$', 'i'), a:text-matches('^\\s*guardar\\s*$', 'i'), " +
                  "input[type=submit][value='GUARDAR' i], input[type=button][value='GUARDAR' i]";

// Un cartel de Albor que dice que se guardó.
async function guardadoEnPantalla(pg){
  try{ return !!(await pg.evaluar("() => /se guard[óo]|guardad[oa] (correctamente|con [ée]xito)|se grab[óo]/i.test(document.body ? document.body.innerText : '')")); }
  catch(e){ if(e instanceof Cortado) throw e; return false; }
}

/* Aplica (transferencias) y guarda con "Guardar y crear otro", y no sale de
   ahí hasta ver que Albor lo guardó. Si Albor muestra una advertencia, frena
   para que la persona la resuelva a mano. Devuelve el número del comprobante. */
async function guardarComprobante(pg, charla, aplicar){
  var numero = '', antes = await huella(pg);
  for(var vuelta = 1; vuelta <= 8; vuelta++){
    var ing = await pideIngreso(pg);
    if(ing.pide && ing.formulario){ charla.decir('   Albor pide ingresar: toco INGRESAR…'); await tocarIngresar(pg); ing = await pideIngreso(pg); }
    if(ing.pide) return await sesionCaidaAlGuardar(pg, charla, numero);
    var ahora = await huella(pg);
    if(!sigueAbierto(antes, ahora)){ charla.decir('   guardado.'); return numero; }
    if(ahora && ahora[3]){
      if(!numero) numero = await leerNumero(pg);
      if(antes && !antes[3]) antes = ahora;            // ya aplicado: el número también es huella
    }
    var porAplicar = aplicar && !(ahora && ahora[3]);
    var que = porAplicar ? 'aplicar' : 'guardar';
    // Transferencias: después de Aplicar, GUARDAR (no tienen "Guardar y crear
    // otro", Feli 2026-10-03). Egresos: "Guardar y crear otro".
    charla.decir(porAplicar ? 'Aplicando…' : aplicar ? "Guardando ('Guardar')…" : "Guardando ('Guardar y crear otro')…");
    var urlAntes = await pg.url();
    var r = await tocarYEsperar(pg, porAplicar ? '#btAplicar' : aplicar ? BTN_GUARDAR : '#btGuardarYOtro', async function(){
      var h = await huella(pg);
      if(porAplicar) return h === null || !!(h && h[3]);
      return !sigueAbierto(antes, h) || (aplicar && (await pg.url()) !== urlAntes) || (await guardadoEnPantalla(pg));
    });
    if(r.sesion) return await sesionCaidaAlGuardar(pg, charla, numero);
    if(r.ok){
      if(porAplicar){
        numero = await leerNumero(pg);
        charla.decir('   comprobante ' + (numero || 'sin número todavía'));
        antes = await huella(pg) || antes;
        continue;
      }
      charla.decir('   guardado.');
      return numero;
    }
    if(r.advertencia){
      charla.decir('   [!] Albor no dejó ' + que + ': hay una advertencia arriba de la cabecera.');
      await charla.pausa(textoAdvertencia(r.advertencia, que), 'Seguir');
    }else{
      // No se pudo tocar el botón, o Albor no contestó: no se vuelve a tocar
      // (podría guardarlo dos veces). Lo termina la persona.
      await charla.pausa((r.noToco ? 'No pude tocar ' + (porAplicar ? 'Aplicar' : 'Guardar') + '.'
                                   : 'Albor no confirmó que terminó de ' + que + ' (pasó un minuto y medio).') +
                         '\nFijate en Albor: si hay un recuadro rojo arriba, resolvelo. ' +
                         (porAplicar ? 'Aplicalo y guardalo' : 'Guardalo') + ' a mano y tocá «Ya está guardado».',
                         'Ya está guardado');
      if(!numero) numero = await leerNumero(pg);
      return numero;
    }
  }
  await charla.pausa('No puedo confirmar que Albor haya guardado este comprobante.\nGuardalo a mano en Albor ' +
                     'y tocá «Ya está guardado».', 'Ya está guardado');
  return numero;
}

function textoFallados(fallados){
  return fallados.map(function(i){ return '   ' + i.codigo + '  ' + String(i.nombre).slice(0, 40) + ' × ' + i.unidad; }).join('\n');
}

/* ---------- Transferencias ---------- */

async function leerNumero(pg){
  async function valor(sel){
    try{ return await pg.loc(sel).inputValue({ timeout: 5000 }); }
    catch(e){ if(e instanceof Cortado) throw e; return ''; }
  }
  for(var i = 0; i < 8; i++){
    var nro = await valor('#Nro');
    if(nro) return (await valor('#Ej')) + '-' + (await valor('#Subd')) + '-' + nro;
    await pg.esperar(1000);
  }
  return '';
}

/* Un comprobante de transferencia. En control doble hay dos: uno por
   oficina, con las mismas cantidades. */
async function transferirBloque(pg, b, empresaActual, charla, n, total){
  charla.decir('');
  charla.decir('Comprobante ' + n + ' de ' + total + ': ' + b.origen_nombre + ' → ' + b.destino_nombre +
               ' (' + b.items.length + ' insumos)');

  empresaActual = await irAEmpresa(pg, b.empresa_id, empresaActual, charla);
  await nuevoComprobante(pg);

  await elegirOpcion(pg, '#ID_Tipo_Comprobante', TIPO_TRANSFERENCIA, 'Tipo de comprobante', charla);
  await elegirOpcion(pg, '#ID_Punto_Stock_Origen', b.origen_id, 'Origen', charla);
  await elegirOpcion(pg, '#ID_Punto_Stock_Destino', b.destino_id, 'Destino', charla);
  await ponerFecha(pg, b.fecha, charla);
  // La campaña también en las transferencias (Feli, 2026-10-07), después de la fecha
  var campania = b.campania ? await ponerCampania(pg, b.campania, charla) : '';

  var aMano = [['el origen', b.origen_id], ['el destino', b.destino_id]]
    .filter(function(x){ return ['', '?'].indexOf(String(x[1] == null ? '' : x[1]).trim()) >= 0; })
    .map(function(x){ return x[0]; });
  var grilla = await esperarGrilla(pg);

  var cabecera = '   Origen:  ' + b.origen_nombre + '\n   Destino: ' + b.destino_nombre + '\n   Fecha:   ' + b.fecha +
                 (b.campania ? '\n   Campaña: ' + (campania || 'SIN ELEGIR') : '');
  // Un solo control, después de cargar todo (Feli, 2026-10-02). Antes de
  // cargar solo frena si hay algo que el programa no pudo completar.
  if(aMano.length || !grilla){
    var falta = 'Antes de cargar los insumos, completá a mano en Albor:';
    if(aMano.length) falta += '\n   ' + aMano.join(' y ');
    if(!grilla) falta += "\n   la cabecera, hasta que se vea la tabla con el botón '+'";
    await charla.pausa(falta + '\n\n' + cabecera, 'Cargar los ' + b.items.length + ' insumos');
  }

  var r = await cargarItems(pg, b.items, charla);

  var aviso = 'Entraron ' + r.cargados.length + ' de ' + b.items.length + ' insumos.';
  if(r.fallados.length) aviso += '\n\nNO entraron (cargalos a mano antes de seguir):\n' + textoFallados(r.fallados);
  aviso += await revisarGrilla(pg, r.cargados.length);
  await charla.pausa(aviso + '\n\nRevisá en Albor la cabecera y la grilla:\n' + cabecera +
                     '\n\nCon este botón aplico y guardo solo.', 'Aplicar y guardar');

  var numero = await guardarComprobante(pg, charla, true);

  return { empresa: empresaActual, hecho: {
    origen: b.origen_nombre, destino: b.destino_nombre,
    comprobante: numero, cargados: r.cargados.length,
    total: b.items.length, fallados: r.fallados
  } };
}

/* `hechos` se va llenando comprobante por comprobante, así si se cancela a
   la mitad el que llama sabe qué quedó hecho. */
async function transferir(pg, bloques, charla, hechos){
  var empresa = await empresaEnUrl(pg), rehechos = 0;
  for(var n = 1; n <= bloques.length; n++){
    var r;
    try{ r = await transferirBloque(pg, bloques[n - 1], empresa, charla, n, bloques.length); }
    catch(e){
      if(!(e instanceof SesionPerdida) || ++rehechos > 2) throw e;
      await volverAEntrar(pg, charla);
      empresa = await empresaEnUrl(pg);
      n--;
      continue;
    }
    empresa = r.empresa;
    hechos.push(r.hecho);
  }
  return hechos;
}

/* Albor llevó a la pantalla de ingreso a mitad de un comprobante (no estaba
   guardado). Se entra de nuevo (INGRESAR solo, o la persona) y se arma ese
   comprobante otra vez desde el principio. */
async function volverAEntrar(pg, charla){
  charla.decir('   [!] Albor cerró la sesión en el medio: el comprobante a medio armar se perdió (no estaba guardado).');
  if((await pideIngreso(pg)).pide) await tocarIngresar(pg);
  if((await pideIngreso(pg)).pide)
    await charla.pausa('Albor cerró la sesión en el medio de la carga y pide la contraseña.\n' +
                       'El comprobante a medio armar no se había guardado: no hay nada que borrar.\n\n' +
                       'Ingresá en la pestaña de Albor y tocá Seguir: lo armo de nuevo desde el principio.', 'Seguir');
  if(M.albor && !(await M.albor.asegurarSesion(5)))
    throw new Error('Albor sigue sin sesión. Iniciá sesión en la pestaña de Albor y volvé a tocar el botón.');
  charla.decir('   Sesión de nuevo: armo el comprobante desde el principio.');
}

/* ---------- Egresos ---------- */

// Las opciones de un <select>: [[valor, texto], ...]
var JS_OPCIONES = "sel => [...document.querySelectorAll(sel + ' option')]\n" +
"    .map(o => [o.value, (o.textContent || '').replace(/\\s+/g, ' ').trim()])";

var CENTRO = '#ID_IT_Dimension_2';

/* 'G2 - CANDELARIA ENGORDE' y 'G2- CANDELARIA ENGORDE' -> 'CANDELARIAENGORDE'. */
function sinPrefijo(nombre){
  var k = String(nombre == null ? '' : nombre).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return k.replace(/^(G\d+|GRANJA)/, '');
}

/* El centro de costo del egreso es el de la misma granja. Primero el número
   de la lista de granjas (981, 983…); si Albor no tiene esa opción o la
   lista no dice ninguno, se busca por nombre: 'G2 - CANDELARIA ENGORDE' ->
   'G2- CANDELARIA ENGORDE'. */
async function centroDeLaGranja(pg, c, charla){
  // Albor llena la lista después de elegir la unidad de negocio: se espera
  // a que aparezca (antes se leía enseguida y quedaba sin elegir). A veces
  // tarda bastante: hasta 40 segundos.
  var fin = Date.now() + 40000, opciones = [];
  for(;;){
    try{ opciones = (await pg.evaluar(JS_OPCIONES, CENTRO)) || []; }
    catch(e){ if(e instanceof Cortado) throw e; }
    var v = buscarCentro(opciones, c);
    if(v || Date.now() > fin) break;
    await pg.esperar(1000);
    await esperar(pg, 10000);
  }
  if(!v) charla.decir('   centros de costos que ofrece Albor: ' +
                      (opciones.map(function(o){ return o[1]; }).filter(Boolean).join(', ') || 'ninguno (no encontré la lista)'));
  return v;
}

/* Primero el número de la lista de granjas; si no, por el nombre. "Ajuste
   stock inicial" y Biodigestor no se eligen nunca. */
function buscarCentro(opciones, c){
  opciones = opciones.filter(function(o){ return o[0] && !/AJUSTE|BIODIGESTOR/i.test(o[1]); });
  var valores = opciones.map(function(o){ return o[0]; });
  var pedido = String(c.centro_costo == null ? '' : c.centro_costo).trim();
  if(pedido && pedido !== '?' && valores.indexOf(pedido) >= 0) return pedido;
  var exacto = String(c.punto_nombre).toUpperCase().replace(/[^A-Z0-9]/g, '');
  for(var i = 0; i < opciones.length; i++)
    if(opciones[i][0] && opciones[i][1].toUpperCase().replace(/[^A-Z0-9]/g, '') === exacto) return opciones[i][0];
  var corto = sinPrefijo(c.punto_nombre);
  for(var j = 0; j < opciones.length; j++)
    if(opciones[j][0] && corto && sinPrefijo(opciones[j][1]) === corto) return opciones[j][0];
  return null;
}

/* [valor, texto] de lo que quedó elegido en el centro de costo. */
async function centroPuesto(pg){
  try{
    return await pg.evaluar("sel => { const s = document.querySelector(sel);\n" +
                            "    if (!s) return ['', ''];\n" +
                            "    const o = s.options[s.selectedIndex];\n" +
                            "    return [s.value || '', o ? (o.textContent || '').replace(/\\s+/g, ' ').trim() : '']; }", CENTRO);
  }catch(e){ if(e instanceof Cortado) throw e; return ['', '']; }
}

/* Lo elige y comprueba que haya quedado. Se llama dos veces: al armar la
   cabecera y justo antes de la pausa, porque un postback posterior (la
   fecha, por ejemplo) puede volver a dibujar el desplegable vacío. */
async function asegurarCentro(pg, valor, charla){
  if(!valor) return await centroPuesto(pg);
  for(var i = 0; i < 3; i++){
    if((await centroPuesto(pg))[0] === valor) break;
    await elegirOpcion(pg, CENTRO, valor, 'Centro de costos', charla);
  }
  return await centroPuesto(pg);
}

/* ---------- Campaña (Feli, 2026-10-02) ----------
   Albor la deja en la que tenga por defecto (25/26). La pantalla manda la
   que va (la del año de la fecha del egreso, o la de Ajustes). Se busca el
   desplegable por su rótulo "Campaña", y la opción por su texto: "26/27" y
   "2026/2027" son la misma. */
function campaniaCorta(t){
  var m = /(\d{2,4})\s*\/\s*(\d{2,4})/.exec(String(t == null ? '' : t));
  return m ? m[1].slice(-2) + '/' + m[2].slice(-2) : String(t == null ? '' : t).replace(/\s+/g, '');
}

var JS_CAMPANIA = String(function(){
  function limpio(s){ return String(s || '').replace(/\s+/g, ' ').trim(); }
  var sel = [].slice.call(document.querySelectorAll('select'))
    .filter(function(x){ return /campa/i.test((x.id || '') + ' ' + (x.name || '')); })[0] || null;
  if(!sel){
    var rotulos = [].slice.call(document.querySelectorAll('label, td, th, span, div, b, strong, dt'))
      .filter(function(e){ return !e.children.length && /^campa(ñ|n)a\s*:?$/i.test(limpio(e.textContent)); });
    for(var i = 0; i < rotulos.length && !sel; i++){
      var r = rotulos[i];
      if(r.htmlFor){ var s0 = document.getElementById(r.htmlFor); if(s0 && s0.tagName === 'SELECT') sel = s0; }
      for(var p = r.parentElement, k = 0; p && k < 4 && !sel; p = p.parentElement, k++){
        sel = [].slice.call(p.querySelectorAll('select')).filter(function(x){
          return r.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING; })[0] || null;
      }
    }
  }
  if(!sel) return null;
  sel.setAttribute('data-pc', 'campania');
  var o = sel.options[sel.selectedIndex];
  return { ops: [].slice.call(sel.options).map(function(x){ return [x.value, limpio(x.textContent)]; }),
           puesto: [sel.value || '', o ? limpio(o.textContent) : ''] };
});

/* La elige y devuelve cómo quedó, para mostrarlo en el control. */
async function ponerCampania(pg, campania, charla){
  if(!campania) return '';
  var quiero = campaniaCorta(campania);
  for(var i = 0; i < 3; i++){
    var d = null;
    try{ d = await pg.evaluar(JS_CAMPANIA); }
    catch(e){ if(e instanceof Cortado) throw e; }
    if(!d){
      charla.decir('   [!] No encontré la Campaña en Albor. Elegila a mano: ' + quiero + '.');
      return 'SIN ELEGIR: elegí a mano la ' + quiero;
    }
    if(campaniaCorta(d.puesto[1]) === quiero) return d.puesto[1];
    var op = d.ops.filter(function(o){ return o[0] && campaniaCorta(o[1]) === quiero; })[0];
    if(!op){
      charla.decir('   [!] Albor no tiene la campaña ' + quiero + ' (tiene: ' +
                   d.ops.map(function(o){ return o[1]; }).filter(Boolean).join(', ') + '). Elegila a mano.');
      return 'SIN ELEGIR: Albor no tiene la ' + quiero;
    }
    await elegirOpcion(pg, "select[data-pc='campania']", op[0], 'Campaña', charla);
  }
  return 'SIN ELEGIR: elegí a mano la ' + quiero;
}

/* Un comprobante de egreso: una granja, una cuenta contable. `cuentas` es
   {codigo: nombre}. Los nombres se leen de Albor al elegir la cuenta y
   quedan guardados: a la persona le sirve leer "GAN-Productos
   Veterinarios", no 510201003. */
async function egresarComprobante(pg, c, empresaActual, charla, n, total, primero, cuentas){
  function cuenta(){ return cuentas[String(c.cuenta)] || 'cuenta ' + c.cuenta; }

  charla.decir('');
  charla.decir('Comprobante ' + n + ' de ' + total + ': ' + c.punto_nombre + ' · ' + cuenta() +
               ' · N° ' + c.numero + ' (' + c.items.length + ' insumos)');

  var antes = empresaActual;
  empresaActual = await irAEmpresa(pg, c.empresa_id, empresaActual, charla);
  // Tras 'Guardar y crear otro' la pantalla ya queda lista; si no, se rehace.
  if(primero || antes !== empresaActual || !(await formularioEnBlanco(pg))) await nuevoComprobante(pg);

  await elegirOpcion(pg, '#ID_Tipo_Comprobante', c.tipo_comprobante, 'Tipo de comprobante', charla);
  await elegirOpcion(pg, '#ID_Punto_Stock_Origen', c.punto_id, 'Punto de origen', charla);

  try{
    await escribirCampo(pg, '#Numero_Comprobante', c.numero, { delay: 100 });
    await pg.presionar('Tab');
    await esperar(pg, 15000);
  }catch(e){
    if(e instanceof Cortado) throw e;
    charla.decir('   [!] No se pudo cargar el número (' + primeraLinea(e) + '). Ponelo a mano.');
  }

  try{ await autocompletar(pg, '#ID_Personal_codigo', PERSONAL_CODIGO); }
  catch(e){
    if(e instanceof Cortado) throw e;
    charla.decir('   [!] No se pudo cargar el personal (' + primeraLinea(e) + '). Ponelo a mano.');
  }
  try{
    var elegido = await autocompletar(pg, '#ID_Cta_Contable_Debito_codigo', c.cuenta);
    var leido = await nombreDeCuenta(pg, c.cuenta, elegido);
    if(leido && leido !== cuentas[String(c.cuenta)]){
      cuentas[String(c.cuenta)] = leido;
      charla.decir('   cuenta a debitar: ' + leido);
    }
  }catch(e){
    if(e instanceof Cortado) throw e;
    charla.decir('   [!] No se pudo cargar la cuenta (' + primeraLinea(e) + '). Ponela a mano.');
  }

  // La fecha y la campaña van antes que el centro: al cambiarlas, Albor
  // vuelve a dibujar el centro en "Ajuste stock" (Feli, 2026-10-05: se veía
  // el centro bueno, después Ajuste stock y recién al final el bueno otra vez).
  await ponerFecha(pg, c.fecha, charla);
  var campania = await ponerCampania(pg, c.campania, charla);
  // La unidad de negocio va antes: el centro de costo depende de ella.
  await elegirOpcion(pg, '#ID_IT_Dimension_3', c.unidad_negocio, 'Unidad de negocio', charla);
  var centro = await centroDeLaGranja(pg, c, charla);
  if(!centro) charla.decir('   [!] No encontré en Albor el centro de costos de ' + c.punto_nombre + '. Elegilo a mano.');
  await asegurarCentro(pg, centro, charla);
  var grilla = await esperarGrilla(pg);
  var puesto = await asegurarCentro(pg, centro, charla);
  var quedo = puesto[0], textoCentro = puesto[1];

  function cabecera(){
    var lineaCentro = (centro && quedo === centro)
      ? (textoCentro || quedo) + ' (' + quedo + ')'
      : 'SIN ELEGIR: elegí a mano el de ' + c.punto_nombre;
    return '   Punto:    ' + c.punto_nombre + '\n   Cuenta:   ' + cuenta() + '\n   Centro:   ' + lineaCentro +
           (c.campania ? '\n   Campaña:  ' + campania : '') +
           '\n   N°:       ' + c.numero + '\n   Fecha:    ' + c.fecha;
  }
  // Un solo control, después de cargar todo (Feli, 2026-10-02). Antes de
  // cargar solo frena si el programa no pudo completar algo de la cabecera.
  if(!(centro && quedo === centro) || !grilla){
    var falta = 'Antes de cargar los insumos, completá a mano en Albor:';
    if(!(centro && quedo === centro)) falta += '\n   el centro de costos de ' + c.punto_nombre;
    if(!grilla) falta += "\n   la cabecera, hasta que se vea la tabla con el botón '+'";
    await charla.pausa(falta + '\n\n' + cabecera(), 'Cargar los ' + c.items.length + ' insumos');
  }

  var r = await cargarItems(pg, c.items, charla);

  puesto = await centroPuesto(pg);
  quedo = puesto[0]; textoCentro = puesto[1];
  if(c.campania) campania = await ponerCampania(pg, c.campania, charla);
  var aviso = 'Entraron ' + r.cargados.length + ' de ' + c.items.length + ' insumos.';
  if(r.fallados.length) aviso += '\n\nNO entraron (cargalos a mano antes de guardar):\n' + textoFallados(r.fallados);
  aviso += await revisarGrilla(pg, r.cargados.length);
  await charla.pausa(aviso + '\n\nRevisá en Albor la cabecera y la grilla:\n' + cabecera() +
                     '\n\nCon este botón guardo solo.', 'Guardar');

  await guardarComprobante(pg, charla, false);

  return { empresa: empresaActual, hecho: {
    punto: c.punto_nombre, cuenta: c.cuenta, numero: c.numero,
    cuenta_nombre: cuentas[String(c.cuenta)] || '',
    centro: textoCentro || quedo,
    cargados: r.cargados.length, total: c.items.length, fallados: r.fallados
  } };
}

/* `hechos` se va llenando a medida que se guarda cada comprobante: si se
   cancela a la mitad, el que llama sabe cuáles números ya se usaron. */
async function egresar(pg, comprobantes, charla, hechos, cuentas){
  var empresa = await empresaEnUrl(pg), rehechos = 0, rehacer = false;
  for(var n = 1; n <= comprobantes.length; n++){
    var r;
    try{ r = await egresarComprobante(pg, comprobantes[n - 1], empresa, charla, n, comprobantes.length, n === 1 || rehacer, cuentas); }
    catch(e){
      if(!(e instanceof SesionPerdida) || ++rehechos > 2) throw e;
      await volverAEntrar(pg, charla);
      empresa = await empresaEnUrl(pg);
      rehacer = true;
      n--;
      continue;
    }
    rehacer = false;
    empresa = r.empresa;
    hechos.push(r.hecho);
  }
  return hechos;
}

/* ==================================================================
   Las listas de Albor y el control antes de empezar (Ajustes, Feli 2026-10-02)
   ================================================================== */

// Las empresas de la pantalla de selección: [[número, nombre]].
var JS_EMPRESAS = String(function(){
  return [].slice.call(document.querySelectorAll('input[id^="cboEmpresa_chk_"]')).map(function(i){
    var l = i.closest('label') || document.querySelector('label[for="' + i.id + '"]');
    var t = l ? l.innerText : '';
    if(!t || !t.replace(/\d/g, '').trim()){ var f = i.closest('tr, li'); if(f) t = f.innerText; }
    return [i.id.replace('cboEmpresa_chk_', ''), String(t || '').replace(/\s+/g, ' ').trim()];
  });
});

async function opcionesDe(pg, sel){
  var ops = [];
  try{ ops = (await pg.evaluar(JS_OPCIONES, sel)) || []; }
  catch(e){ if(e instanceof Cortado) throw e; }
  return ops.filter(function(o){ return o[0] && o[1] && !/^-*\s*selecc?ione/i.test(o[1]); });
}

/* Los centros de costos de una unidad de negocio: Albor los llena después de
   elegirla, y a veces tarda (Feli, 2026-10-05: el control del principio
   decía que faltaba un centro que sí estaba). Se espera a que la lista sea
   otra que la de antes (si no, se leían los centros de la unidad anterior;
   si a los 8 segundos sigue igual, es que las dos unidades tienen los
   mismos), que tenga algo más que "Ajuste stock" y que quede quieta dos
   lecturas seguidas. */
async function centrosDeUnidad(pg, unidad, charla, limite){
  function firma(ops){ return ops.map(function(o){ return o[0]; }).join('|'); }
  var antes = firma(await opcionesDe(pg, CENTRO));
  var yaEstaba = false;
  try{ yaEstaba = (await pg.evaluar("sel => { const s = document.querySelector(sel); return s ? s.value : ''; }", '#ID_IT_Dimension_3')) === String(unidad); }
  catch(e){ if(e instanceof Cortado) throw e; }
  await elegirOpcion(pg, '#ID_IT_Dimension_3', unidad, 'Unidad de negocio', charla);
  var desde = Date.now(), fin = desde + (limite || 25000), ops = [], anterior = null;
  for(;;){
    ops = await opcionesDe(pg, CENTRO);
    var f = firma(ops);
    var lista = ops.some(function(o){ return !/AJUSTE/i.test(o[1]); }) &&
                (yaEstaba || f !== antes || Date.now() - desde > 8000);
    if((lista && f === anterior) || Date.now() > fin) break;
    anterior = lista ? f : null;
    await pg.esperar(800);
    await esperar(pg, 10000);
  }
  return ops;
}

/* Lo que ofrece Albor en un comprobante nuevo de esa empresa. soloTransferencia: el control antes de
   transferir solo mira los puntos de stock, sin pasar el comprobante a Egreso (Feli, 2026-10-07: "se va a
   egresos dos veces y después recién hace la transferencia" en La Colorada, que usa dos empresas). */
async function listasDeEmpresa(pg, empresa, actual, charla, unidades, soloTransferencia){
  actual = await irAEmpresa(pg, empresa, actual, charla);
  await nuevoComprobante(pg);
  await elegirOpcion(pg, '#ID_Tipo_Comprobante', TIPO_TRANSFERENCIA, 'Tipo de comprobante', charla);
  var r = { origen: await opcionesDe(pg, '#ID_Punto_Stock_Origen'), destino: await opcionesDe(pg, '#ID_Punto_Stock_Destino') };
  if(soloTransferencia) return { actual: actual, listas: r };
  await elegirOpcion(pg, '#ID_Tipo_Comprobante', TIPO_EGRESO, 'Tipo de comprobante', charla);
  r.egreso = await opcionesDe(pg, '#ID_Punto_Stock_Origen');
  r.unidades = await opcionesDe(pg, '#ID_IT_Dimension_3');
  r.centros = [];
  var vistos = {};
  var cuales = unidades || r.unidades.map(function(u){ return u[0]; });
  for(var i = 0; i < cuales.length; i++){
    var ops = await centrosDeUnidad(pg, cuales[i], charla);
    // Por centro y unidad: un centro que está en dos unidades va con las dos
    // (antes quedaba solo con la primera y el control decía que faltaba).
    ops.forEach(function(o){ var k = o[0] + '|' + cuales[i]; if(!vistos[k]){ vistos[k] = true; r.centros.push([o[0], o[1], cuales[i]]); } });
  }
  var camp = null;
  try{ camp = await pg.evaluar(JS_CAMPANIA); }catch(e){ if(e instanceof Cortado) throw e; }
  r.campanias = camp ? camp.ops.filter(function(o){ return o[0] && o[1]; }).map(function(o){ return o[1]; }) : [];
  return { actual: actual, listas: r };
}

/* "Traer de Albor": las empresas y, de las que se usan, sus puntos de
   stock, unidades de negocio, centros de costos y campañas. */
function leer_albor(empresas){
  return trabajo('__alborLog', async function(){
    M.cancelar = false;
    var charla = new Charla(function(t){ anotar(t); avisar(t); }, preguntar, function(){ return M.cancelar; });
    try{
      var a = await alborConSesion(), pg = a.pg;
      var actual = await empresaEnUrl(pg);
      charla.decir('Leyendo las empresas…');
      await pg.ir(C.BASE + '/' + (actual || '1') + '/Empresas/SeleccionEmpresa');
      await esperar(pg, 30000);
      var lista = [];
      try{ lista = (await pg.evaluar(JS_EMPRESAS)) || []; }catch(e){ if(e instanceof Cortado) throw e; }
      charla.decir('   ' + (lista.length ? lista.map(function(e){ return e.join(' '); }).join(' · ') : 'no encontré la lista'));
      var pedir = [];
      (empresas || []).concat(EMPRESAS).forEach(function(e){ e = String(e).trim(); if(e && e !== '?' && pedir.indexOf(e) < 0) pedir.push(e); });
      var por = {};
      for(var i = 0; i < pedir.length; i++){
        charla.decir('Empresa ' + pedir[i] + ': puntos de stock, unidades, centros y campañas…');
        var r = await listasDeEmpresa(pg, pedir[i], actual, charla);
        actual = r.actual;
        por[pedir[i]] = r.listas;
        charla.decir('   ' + r.listas.origen.length + ' puntos · ' + r.listas.unidades.length + ' unidades · ' +
                     r.listas.centros.length + ' centros · ' + r.listas.campanias.length + ' campañas');
      }
      await a.cerrar();
      M.albor = null;
      charla.decir('Albor cerrado.');
      return { ok: true, empresas: lista, por: por, fecha: new Date().toISOString() };
    }catch(e){
      if(e instanceof Cancelado) return { ok: false, cancelado: true, motivo: 'Cancelaste.' };
      throw e;
    }finally{ M.esperando = null; }
  });
}

/* Antes de cargar nada, se fija que cada punto de stock y cada centro de
   costos de la carga exista en Albor (Feli, 2026-10-02): si falta alguno,
   avisa al principio, no a la mitad. Se puede cancelar y corregir en Ajustes,
   o seguir y elegirlo a mano. */
async function revisarAntes(pg, lista, egreso, charla){
  var porEmpresa = {}, orden = [];
  lista.forEach(function(c){
    var e = String(c.empresa_id == null ? '' : c.empresa_id).trim();
    if(!e || e === '?') return;
    if(!porEmpresa[e]){ porEmpresa[e] = []; orden.push(e); }
    porEmpresa[e].push(c);
  });
  if(!orden.length) return;
  charla.decir('Antes de empezar: me fijo que Albor tenga todo lo de la lista…');
  var actual = await empresaEnUrl(pg), faltan = [];
  function hay(ops, v){ v = String(v == null ? '' : v).trim(); return !v || v === '?' || ops.some(function(o){ return o[0] === v; }); }
  for(var i = 0; i < orden.length; i++){
    var cs = porEmpresa[orden[i]], unidades = [];
    if(egreso) cs.forEach(function(c){ var u = String(c.unidad_negocio || '').trim(); if(u && unidades.indexOf(u) < 0) unidades.push(u); });
    var r = await listasDeEmpresa(pg, orden[i], actual, charla, egreso ? unidades : [], !egreso);
    actual = r.actual;
    var L = r.listas;
    for(var k = 0; k < cs.length; k++){
      var c = cs[k];
      if(egreso){
        if(!hay(L.egreso, c.punto_id)) faltan.push('el punto de stock de ' + c.punto_nombre + ' (' + c.punto_id + ', empresa ' + orden[i] + ')');
        if(c.unidad_negocio && !hay(L.unidades, c.unidad_negocio)) faltan.push('la unidad de negocio ' + c.unidad_negocio + ' (empresa ' + orden[i] + ')');
        var u = String(c.unidad_negocio || '').trim();
        var deLaUnidad = function(){ return L.centros.filter(function(o){ return !u || o[2] === u; }); };
        // Si no aparece, se lee de nuevo esa unidad con más tiempo antes de
        // decir que falta: Albor a veces tarda en llenar la lista.
        if(!buscarCentro(deLaUnidad(), c) && u && hay(L.unidades, u)){
          var otra = await centrosDeUnidad(pg, u, charla, 45000);
          otra.forEach(function(o){ if(!L.centros.some(function(x){ return x[0] === o[0] && x[2] === u; })) L.centros.push([o[0], o[1], u]); });
        }
        if(!buscarCentro(deLaUnidad(), c))
          faltan.push('el centro de costos de ' + c.punto_nombre + ' (' + (c.centro_costo || 'sin número') + ', empresa ' + orden[i] + ')');
      }else{
        if(!hay(L.origen, c.origen_id)) faltan.push('el punto de stock ' + c.origen_nombre + ' (' + c.origen_id + ', empresa ' + orden[i] + ')');
        if(!hay(L.destino, c.destino_id)) faltan.push('el punto de stock ' + c.destino_nombre + ' (' + c.destino_id + ', empresa ' + orden[i] + ')');
      }
    }
  }
  faltan = faltan.filter(function(f, n){ return faltan.indexOf(f) === n; });
  if(!faltan.length){ charla.decir('   está todo.'); return; }
  charla.decir('   [!] falta: ' + faltan.join('; '));
  await charla.pausa('Antes de empezar revisé Albor y no encuentro:\n' +
                     faltan.map(function(f){ return '   ' + f; }).join('\n') +
                     '\n\nNo cargué nada todavía. Podés cancelar y corregirlo en Ajustes ' +
                     '("Traer de Albor" te muestra lo que hay), o seguir igual y elegirlo a mano en cada comprobante.',
                     'Seguir igual');
}

/* ==================================================================
   motor.py: lo que la pantalla le pide
   ================================================================== */

var M = {
  albor: null,            // la pestaña de Albor de esta pestaña (Albor)
  ocupado: false,
  salida: '__progreso',   // adónde van las líneas: Conteo de stock o el recuadro de la carga
  cancelar: false,
  esperando: null,        // la pausa a la vista: {texto, boton, responder}
  trabajo: null           // el que está corriendo: {pg}
};

function avisar(texto){
  var f = window[M.salida];
  if(f) f(String(texto));
}

/* El error, en una línea. Si se cerró la pestaña de Albor en el medio, dicho simple. */
function motivoDe(e){
  var t = primeraLinea(e, 200);
  if(e instanceof Cortado) return t;
  if(/has been closed|Target closed|No tab with id|ya no está en Albor/.test(t))
    return 'Se cerró la pestaña de Albor mientras se usaba. Tocá el botón de nuevo: se abre una pestaña nueva.';
  if(t === 'SIN_EXTENSION' || t === 'EXT_DESCONECTADA')
    return 'No encuentro la extensión "Programa de Compras · Albor" en este Chrome. Fijate que esté instalada y prendida.';
  return t;
}

/* Si tocan "Cancelar" en la franja de Chrome, el trabajo se corta. */
Mano.escuchas.push(function(ev){
  if(ev.evento === 'soltado' && ev.motivo === 'canceled_by_user' && M.trabajo)
    M.trabajo.pg.cortado = 'Tocaste "Cancelar" en la franja de Chrome: se cortó el trabajo en Albor. ' +
                           'Lo que ya estaba cargado quedó cargado.';
  if(ev.evento === 'dialogo') anotar('Albor mostró un aviso y se aceptó: ' + String(ev.texto || '').slice(0, 160));
  if(ev.evento === 'archivo') anotar('La extensión copió un archivo al vuelo: ' + String(ev.url || '').slice(0, 160));
  if(ev.evento === 'descarga') anotar('Chrome empezó una descarga: ' + String(ev.url || '').slice(0, 160));
});

/* Lo largo, de a uno: la extensión maneja una sola pestaña de Albor. */
async function trabajo(salida, fn){
  if(M.ocupado) return { ok: false, motivo: 'Ya se está trabajando en Albor. Esperá a que termine.' };
  M.ocupado = true;
  M.salida = salida;
  var latido = setInterval(function(){ Mano.pedir('hola', {}, 10000).catch(function(){}); }, 20000);
  try{
    await Mano.pedirSeguro('ocupar', {}, 15000);
    return await fn();
  }catch(e){
    anotar('ERROR: ' + String((e && e.stack) || e).slice(0, 600));
    return { ok: false, motivo: motivoDe(e) };
  }finally{
    clearInterval(latido);
    // Se saca el control remoto: se va la franja de Chrome. Si la pestaña de
    // Albor quedó abierta (algo no anduvo), queda al lado; se vuelve a la app.
    await Mano.pedirSeguro('soltar', {}, 15000).catch(function(){});
    await Mano.pedirSeguro('volver', {}, 15000).catch(function(){});
    await Mano.pedirSeguro('liberar', {}, 15000).catch(function(){});
    M.trabajo = null;
    M.ocupado = false;
  }
}

/* La pestaña de Albor abierta y adentro de Albor. */
async function alborConSesion(){
  if(M.albor && M.albor.abierta && !(await M.albor.pg.viva())){
    avisar('La pestaña de Albor estaba cerrada: abro una nueva.');
    M.albor = null;
  }
  if(!M.albor){
    avisar('Abriendo la pestaña de Albor…');
    M.albor = new Albor(avisar);
  }
  M.albor.pg.cortado = null;
  M.trabajo = { pg: M.albor.pg };
  if(!(await M.albor.asegurarSesion()))
    throw new Error('Pasaron 5 minutos y Albor seguía sin sesión iniciada. ' +
                    'La pestaña de Albor quedó abierta: iniciá sesión ahí y volvé a tocar el botón.');
  return M.albor;
}

function bajar_existencias(puntos, hasta){
  return trabajo('__progreso', async function(){
    var a = await alborConSesion();
    var texto = await a.bajarExistencias(puntos && puntos.length ? puntos : null, hasta);
    var traidos = puntosDelReporte(texto);
    var pedidos = (puntos && puntos.length ? puntos : OFICINAS).length;
    if(traidos.length > pedidos){
      // Que el reporte traiga más puntos de los que se pidieron no rompe nada
      // acá, pero conviene saberlo: algún filtro de Albor no quedó como se esperaba.
      a.decir('[!] Se pidieron ' + pedidos + ' puntos y el reporte trajo ' + traidos.length + ': ' + traidos.join(', ') + '.');
    }
    if(!traidos.length)
      return { ok: false, motivo: 'El reporte salió vacío. Fijate en la pestaña de Albor si quedó algún filtro puesto de más.' };
    a.decir('Listo: ' + traidos.join(', ') + '.');
    var leida = a.hasta_reporte, aviso = '';
    if(hasta && leida && !mismaFecha(hasta, leida)){
      aviso = 'Pediste existencias hasta el ' + hasta + ' pero el reporte de Albor salió hasta el ' + leida + '. ' +
              "Revisá la fecha 'Hasta' en la pestaña de Albor.";
      a.decir('[!] ' + aviso);
    }
    // Terminó bien: se cierra la pestaña de Albor. Si algo falló, en cambio,
    // queda abierta para que se vea qué pasó.
    await a.cerrar();
    M.albor = null;
    a.decir('Albor cerrado.');
    return { ok: true, csv: texto, puntos: traidos, hasta: leida || hasta || '', aviso: aviso };
  });
}

/* El cartel de la pausa ADENTRO de la pestaña de Albor (Feli, 2026-10-01):
   se revisa Albor y se toca el botón ahí mismo, sin ir y venir a la app. Se
   pregunta cada medio segundo si lo tocaron. Mientras está el cartel no se
   toca nada de Albor (es una pausa); se saca antes de seguir. Va en una
   "cajita aislada" (shadow DOM): los estilos de Albor no lo alcanzan. Antes
   pintaban los botones de blanco y no se leían (Feli, 2026-10-02). */
var JS_CARTEL = String(function(o){
  var r = window.__pcResp;
  if(r){ window.__pcResp = null; var v = document.getElementById('__pc_cartel'); if(v) v.remove(); return r; }
  var host = document.getElementById('__pc_cartel');
  if(!host){
    window.__pcResp = null;
    host = document.createElement('div');
    host.id = '__pc_cartel';
    host.setAttribute('style', 'all:initial !important;position:fixed !important;right:18px !important;' +
      'bottom:18px !important;z-index:2147483647 !important;display:block !important');
    var raiz = host.attachShadow({ mode: 'open' });
    var letra = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
    raiz.innerHTML = '<style>' +
      ':host{all:initial}' +
      '.c{box-sizing:border-box;width:min(440px,calc(100vw - 36px));background:#1d1d20;color:#eceae5;' +
      'border:1px solid #33333a;border-left:5px solid ' + o.color + ';border-radius:10px;padding:14px 16px;' +
      'font:14px/1.45 ' + letra + ';box-shadow:0 12px 36px rgba(0,0,0,.45);text-align:left}' +
      '.h{font-weight:700;margin-bottom:6px;color:' + o.color + '}' +
      '.t{white-space:pre-wrap;max-height:50vh;overflow:auto}' +
      '.b{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px}' +
      'button{all:initial;box-sizing:border-box;display:inline-block;font:600 14px/1.2 ' + letra + ';' +
      'border-radius:6px;padding:9px 14px;cursor:pointer}' +
      '.s{background:' + o.color + ';color:#1a1013}' +
      '.x{background:transparent;color:#cfccc5;border:1px solid #55555e}' +
      '.x.seguro{color:#f08b84;border-color:#f08b84}' +
      '.hh{display:flex;align-items:center;justify-content:space-between;gap:10px}' +
      '.m{color:#cfccc5;font-weight:500;font-size:13px;padding:4px 8px;border:1px solid #55555e}' +
      '.p{display:none;background:#1d1d20;color:#eceae5;border:1px solid #33333a;border-left:5px solid ' + o.color + ';' +
      'border-radius:10px;padding:10px 14px;font:600 14px/1.2 ' + letra + ';box-shadow:0 8px 24px rgba(0,0,0,.45)}' +
      '.p b{color:' + o.color + '}' +
      '.chico .c{display:none}.chico .p{display:inline-block}' +
      '</style><div class="w"><div class="c"><div class="hh"><div class="h">Programa de Compras</div>' +
      '<button type="button" class="m" title="Achicar el cartel para revisar Albor">Minimizar ▾</button></div>' +
      '<div class="t"></div>' +
      '<div class="b"><button type="button" class="s"></button>' +
      '<button type="button" class="x">Cancelar la carga</button></div></div>' +
      '<button type="button" class="p"><b>Programa de Compras</b> · esperando que revises ▴</button></div>';
    // Minimizar (Feli, 2026-10-05): el cartel tapaba los datos de Albor que hay que controlar
    raiz.querySelector('.m').onclick = function(){ raiz.querySelector('.w').classList.add('chico'); };
    raiz.querySelector('.p').onclick = function(){ raiz.querySelector('.w').classList.remove('chico'); };
    raiz.querySelector('.s').onclick = function(){ window.__pcResp = 'seguir'; host.remove(); };
    raiz.querySelector('.x').onclick = function(){
      if(this.dataset.seguro){ window.__pcResp = 'cancelar'; host.remove(); }
      else{ this.dataset.seguro = '1'; this.textContent = '¿Seguro? Tocá de nuevo para cancelar'; this.className = 'x seguro'; }
    };
    (document.body || document.documentElement).appendChild(host);
  }
  // Una pausa nueva (otro texto) vuelve a abrir el cartel aunque estuviera minimizado
  if(host.getAttribute('data-texto') !== o.texto){
    host.setAttribute('data-texto', o.texto);
    host.shadowRoot.querySelector('.w').classList.remove('chico');
  }
  host.shadowRoot.querySelector('.t').textContent = o.texto;
  host.shadowRoot.querySelector('.s').textContent = o.boton;
  return null;
});
var JS_SACAR_CARTEL = "() => { const c = document.getElementById('__pc_cartel'); if (c) c.remove(); window.__pcResp = null; }";

function colorDeLaApp(){
  try{ return (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '').trim() || '#d08a93'; }
  catch(e){ return '#d08a93'; }
}

async function cartelEnAlbor(pausa){
  var pg = M.albor && M.albor.pg;
  if(!pg) return;
  await pg.traer();
  while(M.esperando === pausa){
    try{
      var r = await pg.evaluar(JS_CARTEL, { texto: pausa.texto, boton: pausa.boton, color: colorDeLaApp() });
      if(r && M.esperando === pausa){
        if(window.__alborPausaFin) window.__alborPausaFin(r);
        responder_carga(r);
        break;
      }
    }catch(e){ if(e instanceof Cortado) break; }
    if(M.esperando === pausa) await dormir(500);
  }
}

/* ---------- Avisos de la compu (Feli, 2026-10-02) ----------
   Cada vez que hace falta que una persona controle (cada pausa: revisar la
   cabecera, la grilla, guardar el comprobante, saldos negativos) y cuando la
   carga termina, sale una notificación de Chrome en la compu (Mac o
   Windows), aunque se esté en otra pestaña o programa. Tocarla trae la
   pestaña de Albor (o la app, si ya terminó). El permiso se pide al tocar
   "Cargar en Albor"; si se niega, quedan los carteles de siempre. Mientras
   espera, el título de la pestaña de la app empieza con 🔔. */
var AVISO = { ultimo: null, titulo: null };

function pedirPermisoAvisos(){
  try{
    var N = window.Notification;
    if(N && N.permission === 'default') N.requestPermission();
  }catch(e){}
}

function tituloDePausa(boton, texto){
  if(/^Hay advertencias de Albor/.test(texto)) return 'Albor no guardó: hay una advertencia para resolver';
  if(/^Cargar los/.test(boton)) return 'Completá la cabecera en Albor';
  if(/^(Aplicar y guardar|Guardar)$/.test(boton)) return 'Terminó de cargar: revisá antes de guardar';
  if(boton === 'Ya está guardado') return 'Guardá el comprobante en Albor';
  return 'Falta que revises algo en Albor';
}

function avisarCompu(titulo, cuerpo, aAlbor){
  sacarAviso();
  if(!AVISO.titulo) AVISO.titulo = document.title;
  document.title = '🔔 ' + AVISO.titulo;
  try{
    var N = window.Notification;
    if(!N || N.permission !== 'granted') return;
    var n = new N(titulo, { body: String(cuerpo || '').slice(0, 240), tag: 'programa-compras-albor',
                            requireInteraction: true });
    n.onclick = function(){
      try{ window.focus(); }catch(e){}
      if(aAlbor && M.albor) M.albor.pg.traer();
      else Mano.pedirSeguro('volver', {}, 15000).catch(function(){});
      n.close();
    };
    AVISO.ultimo = n;
  }catch(e){}
}

function sacarAviso(){
  if(AVISO.ultimo){ try{ AVISO.ultimo.close(); }catch(e){} AVISO.ultimo = null; }
  if(AVISO.titulo){ document.title = AVISO.titulo; AVISO.titulo = null; }
}

/* Una pausa en la pantalla y en Albor; espera el botón (responder_carga). */
function preguntar(texto, boton){
  if(M.cancelar) return Promise.resolve(false);
  return new Promise(function(listo){
    var pausa = { texto: String(texto), boton: String(boton), responder: listo };
    M.esperando = pausa;
    anotar('PAUSA [' + boton + '] ' + String(texto).replace(/\n/g, ' | ').slice(0, 200));
    if(window.__alborPausa) window.__alborPausa(String(texto), String(boton));
    avisarCompu(tituloDePausa(String(boton), String(texto)),
                String(texto).split('\n').filter(Boolean).slice(0, 3).join(' · ') + '\n→ ' + boton, true);
    cartelEnAlbor(pausa);
  }).then(async function(r){
    M.esperando = null;
    sacarAviso();
    // Antes de seguir: sin cartel encima, y Albor a la vista mientras trabaja.
    var pg = M.albor && M.albor.pg;
    if(pg){
      try{ await pg.evaluar(JS_SACAR_CARTEL); }catch(e){}
      if(r === 'seguir' && !M.cancelar) await pg.traer();
    }
    return r === 'seguir' && !M.cancelar;
  });
}

function responder_carga(que){
  if(que === 'cancelar') M.cancelar = true;
  var p = M.esperando;
  if(p){ M.esperando = null; p.responder(que); }
  return Promise.resolve({ ok: true });
}

function hora(){ var d = new Date(); return ('0' + d.getHours()).slice(-2) + 'h' + ('0' + d.getMinutes()).slice(-2); }

/* Lo común a transferencias y egresos: las planillas de la operación (en
   Descargas, "Programa de Compras/…"), la sesión y la carga. */
function cargar(hacer, base, etiqueta, archivos, alFinal){
  pedirPermisoAvisos();        // todavía dentro del toque en "Cargar en Albor"
  return trabajo('__alborLog', async function(){
    var carpeta = null;
    var nombreCarpeta = 'Programa de Compras/' + base + '/' + (etiqueta || 'sin nombre') + ' (' + hora() + ')';
    async function guardarArchivos(){
      for(var i = 0; i < (archivos || []).length; i++){
        var a = archivos[i];
        if(!a) continue;
        try{
          var id = await Mano.pedirSeguro('guardar', { carpeta: nombreCarpeta, nombre: a.nombre, base64: a.base64 }, 30000);
          if(carpeta == null) carpeta = id;
        }catch(e){
          avisar('[!] No pude guardar ' + a.nombre + ' en Descargas (' + primeraLinea(e) + ').');
        }
      }
    }
    // Transferencias: las planillas se guardan después de transferir (Feli, 2026-10-07); egresos, antes
    if(!alFinal) await guardarArchivos();

    M.cancelar = false;
    var charla = new Charla(function(t){ anotar(t); avisar(t); }, preguntar, function(){ return M.cancelar; });
    var hechos = [];
    try{
      var a2 = await alborConSesion();
      await hacer(a2.pg, charla, hechos);
      if(alFinal && hechos.length) await guardarArchivos();
      // Terminó bien: se cierra la pestaña de Albor y se vuelve a la app
      // (Feli, 2026-10-01). Si algo falló o se canceló, queda abierta.
      await a2.cerrar();
      M.albor = null;
      charla.decir('Albor cerrado.');
      avisarCompu('Listo: terminó la carga en Albor', hechos.length + ' comprobante' + (hechos.length === 1 ? '' : 's') +
                  '. Mirá el resumen en la app.', false);
      return { ok: true, hechos: hechos, carpeta: carpeta };
    }catch(e){
      if(alFinal && hechos.length && carpeta == null){ try{ await guardarArchivos(); }catch(e2){} }    // lo que sí se transfirió
      if(e instanceof Cancelado)
        return { ok: false, cancelado: true, hechos: hechos, carpeta: carpeta,
                 motivo: 'Cancelaste la carga. Lo que ya estaba en Albor quedó cargado.' };
      anotar('ERROR: ' + String((e && e.stack) || e).slice(0, 600));
      avisarCompu('La carga en Albor no terminó', motivoDe(e), false);
      return { ok: false, hechos: hechos, carpeta: carpeta, motivo: motivoDe(e) };
    }finally{
      M.esperando = null;
    }
  });
}

function items(lista){
  return (lista || []).map(function(i){
    return { codigo: String(i.codigo == null ? '' : i.codigo).trim(),
             nombre: String(i.nombre == null ? '' : i.nombre).trim(),
             unidad: String(i.unidad == null ? '' : i.unidad).trim() };
  });
}

function cargar_transferencia(bloques, archivos, etiqueta){
  bloques = (bloques || []).map(function(b){ return Object.assign({}, b, { items: items(b.items) }); });
  if(!bloques.length) return Promise.resolve({ ok: false, motivo: 'No hay nada para transferir.' });
  return cargar(async function(pg, charla, hechos){
    await revisarAntes(pg, bloques, false, charla);
    return transferir(pg, bloques, charla, hechos);
  }, 'Transferencias', etiqueta, archivos, true);
}

function cargar_egresos(comprobantes, archivos, etiqueta){
  comprobantes = (comprobantes || []).map(function(c){ return Object.assign({}, c, { items: items(c.items) }); });
  if(!comprobantes.length) return Promise.resolve({ ok: false, motivo: 'No hay nada para egresar.' });
  // Los puntos de oficina no se egresan nunca, venga lo que venga de la
  // lista de granjas ("NO tocar los puntos de stock de oficina").
  var oficinas = comprobantes.filter(function(c){ return OFICINAS.indexOf(String(c.punto_id).trim()) >= 0; })
                             .map(function(c){ return c.punto_nombre; });
  if(oficinas.length)
    return Promise.resolve({ ok: false, motivo: 'La lista de granjas tiene puntos de oficina (' + oficinas.join(', ') + '). ' +
                             "Las oficinas no se egresan: sacalos de 'editar granjas'." });
  // Los nombres de las cuentas se aprenden de Albor en cada carga y se
  // guardan, así la próxima vez el avance los dice desde el principio.
  var cuentas = Object.assign({}, NOMBRES_CUENTAS);
  try{ Object.assign(cuentas, JSON.parse(localStorage.getItem(CLAVE_CUENTAS) || '{}') || {}); }catch(e){}
  return cargar(async function(pg, charla, hechos){
    await revisarAntes(pg, comprobantes, true, charla);
    return egresar(pg, comprobantes, charla, hechos, cuentas);
  }, 'Egresos', etiqueta, archivos).then(function(r){
    try{ localStorage.setItem(CLAVE_CUENTAS, JSON.stringify(cuentas)); }catch(e){}
    return r;
  });
}

function cerrar_albor(){
  if(M.ocupado) return Promise.resolve({ ok: false, motivo: 'Está cargando en Albor.' });
  var a = M.albor; M.albor = null;
  return (a ? a.cerrar() : Mano.pedirSeguro('cerrar', {}, 15000)).then(function(){ return { ok: true }; },
                                                                      function(e){ return { ok: false, motivo: primeraLinea(e) }; });
}

/* "Abrir la carpeta": muestra en Descargas la planilla de la operación. */
function abrir_carpeta(id){
  return Mano.pedirSeguro('mostrar', { descarga: id }, 15000).then(function(){ return { ok: true }; },
                                                                  function(e){ return { ok: false, motivo: primeraLinea(e) }; });
}

/* Existencias solas cada mañana (extensión 3.2; Feli, 2026-10-03): la hora
   ('' = apagado) se guarda en la extensión de esta compu, con esta página. */
function programar_existencias(hora){
  return Mano.pedirSeguro('programar', { hora: hora || '', url: location.href.split('#')[0] }, 15000)
    .then(function(r){ return Object.assign({ ok: true }, r); }, function(e){ return { ok: false, motivo: primeraLinea(e, 200) }; });
}
function estado_existencias(){
  return Mano.pedirSeguro('programacion', {}, 15000)
    .then(function(r){ return Object.assign({ ok: true }, r); }, function(e){ return { ok: false, motivo: primeraLinea(e, 200) }; });
}
/* La pestaña que abrió la extensión a la mañana se cierra cuando terminó bien. */
function cerrar_esta_pestana(){
  return Mano.pedirSeguro('cerrarme', {}, 15000).catch(function(){ return false; });
}

/* ¿Está la extensión en este Chrome? {ok, version} o null. */
function buscar(){
  return Mano.pedir('hola', {}, 3000).then(function(r){ return Object.assign({ ok: true }, r); },
                                           function(){ return null; });
}

window.AlborExt = {
  buscar: buscar,
  registro: function(){ return REGISTRO.slice(); },
  avisoVisto: function(){ if(!M.esperando) sacarAviso(); },
  api: {
    bajar_existencias: bajar_existencias,
    cargar_transferencia: cargar_transferencia,
    cargar_egresos: cargar_egresos,
    responder_carga: responder_carga,
    cerrar_albor: cerrar_albor,
    abrir_carpeta: abrir_carpeta,
    leer_albor: leer_albor,
    programar_existencias: programar_existencias,
    estado_existencias: estado_existencias,
    cerrar_esta_pestana: cerrar_esta_pestana
  }
};

/* Solo en el servidor de prueba (localhost): apuntar a un Albor falso. */
// (queda guardado en la compu, así también lo usa una pestaña que abre la extensión a la mañana)
if(EN_PRUEBA){
  try{ Object.assign(C, JSON.parse(localStorage.getItem('__alborPrueba') || '{}')); }catch(e){}
  window.__alborPrueba = function(o){
    Object.assign(C, o || {});
    try{ localStorage.setItem('__alborPrueba', JSON.stringify({ BASE: C.BASE, URL_EXISTENCIAS: C.URL_EXISTENCIAS })); }catch(e){}
    return C;
  };
}

})();
