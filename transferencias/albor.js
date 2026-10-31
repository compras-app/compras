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
  try{ return (await this.pg.loc('#PuntosStock_Lista_disabler, #btReporte, #btnNuevo, #btNuevoRegistro').count()) > 0; }
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

/* ¿El comprobante a la vista está en blanco? (Feli, 29/10) Formulario a la vista, sin renglones en la
   grilla, sin número propio (Nro, el que da Albor al aplicar) y sin número de egreso. Así se usa el que dejó
   abierto el control de antes de empezar o "Guardar y crear otro", en vez de abrir la página de nuevo y tocar
   Nuevo. Ante la duda (no se pudo leer algo), no está en blanco y se abre uno nuevo como siempre. */
var JS_FORMULARIO_VACIO = String(function(){
  var t = document.querySelector('#ID_Tipo_Comprobante');
  if(!t || t.offsetParent === null) return false;
  function vacio(sel){ var e = document.querySelector(sel); return !e || !String(e.value || '').trim(); }
  if(!vacio('#Nro') || !vacio('#Numero_Comprobante')) return false;
  if([].slice.call(document.querySelectorAll('tr.jqgrow')).some(function(r){ return r.offsetParent !== null; })) return false;
  var m = /Mostrando\s+\d+\s*-\s*\d+\s+de\s+(\d+)/i.exec((document.body && document.body.innerText) || '');
  return !(m && +m[1] > 0);
});

async function formularioVacio(pg){
  try{ return !!(await pg.evaluar(JS_FORMULARIO_VACIO)); }
  catch(e){ if(e instanceof Cortado) throw e; return false; }
}

/* El comprobante sigue en pantalla sin guardar: el formulario está y tiene su número o sus renglones (uno en blanco,
   el que deja "Guardar y crear otro", no cuenta). */
async function sigueEnPantalla(pg){
  var hay = false;
  try{ hay = !!(await pg.evaluar("() => { const t = document.querySelector('#ID_Tipo_Comprobante'); return !!t && t.offsetParent !== null; }")); }
  catch(e){ if(e instanceof Cortado) throw e; }
  return hay && !(await formularioVacio(pg));
}

/* Deja un comprobante en blanco de esa empresa: el que ya está abierto si sirve (misma empresa, Comprobantes
   de Stock y en blanco), o la página de nuevo y "Nuevo", como siempre. deNuevo: después de que Albor cerró la
   sesión, siempre uno nuevo. Devuelve la empresa activa. */
async function comprobanteEnBlanco(pg, empresa, empresaActual, charla, deNuevo){
  var e = String(empresa == null ? '' : empresa).trim();
  if(!deNuevo && e && e === empresaActual && (await pg.url()).indexOf('/' + e + '/Comprobantes_Stock') >= 0 && (await formularioVacio(pg))){
    charla.decir('   uso el comprobante en blanco que ya está abierto.');
    return e;
  }
  empresaActual = await irAEmpresa(pg, empresa, empresaActual, charla);
  await nuevoComprobante(pg);
  return empresaActual;
}

async function nuevoComprobante(pg){
  await cerrarPopups(pg);
  await pg.loc("a:has-text('Nuevo'), button:has-text('Nuevo'), #btnNuevo").first().click({ timeout: 20000 });
  await esperar(pg, 40000);
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
      // Para resolverlo, la persona pudo cambiar la cabecera (Feli, 30/10: el número repetido, cambiado a mano, se
      // tomaba como "guardado"). Si el comprobante sigue en pantalla con sus renglones, esa es su huella de ahora.
      if(await sigueEnPantalla(pg)){ var h2 = await huella(pg); if(h2) antes = h2; }
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

/* ---------- Se fija en Albor que el comprobante quedó (Feli, 30/10) ----------
   El 30/10 tres egresos con un número ya usado se dieron por guardados sin estarlo (el número cambiado a mano
   parecía un comprobante nuevo) y la extensión se colgó a mitad de otra carga. Ahora, después de guardar cada
   comprobante, se lo busca en la lista de Comprobantes de Stock, pidiéndosela a Albor con las fechas (como las
   órdenes de compra: la lista en pantalla recuerda un filtro viejo), y se miran sus renglones y, en los egresos,
   el centro de costos. Si no está: "Intentar de nuevo" o "Cancelar la carga". */

// El comprobante no se guardó y ya no está en pantalla: se arma de nuevo desde el principio.
class Rehacer extends Error {}

function fechaDeTexto(t){
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(t || '').trim()) || null;
  if(m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(t || '').trim());
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function diaParaAlbor(d){ return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

// "1111-00000065" y "1111-65" son el mismo: ['1111-', 65]. null si no tiene esa forma.
function partesNumero(t){
  var m = /^(.*-)\s*0*(\d+)$/.exec(String(t || '').replace(/\s+/g, ''));
  return m ? [m[1], +m[2]] : null;
}
function numeroCorto(t){ var p = partesNumero(t); return p ? p[0] + p[1] : String(t || '').trim(); }

// Los comprobantes de Stock de una empresa entre dos fechas (yyyy-mm-dd), sin los anulados. null si Albor no contesta.
var JS_LISTA_STOCK = String(function(o){
  var q = { jqGridID: 'DetalleGrid', _search: false, rows: o.filas || 500, page: 1, sidx: 'Fecha', sord: 'desc', nd: Date.now(),
            filtro_FechaDesde: o.desde, filtro_FechaHasta: o.hasta };
  return fetch('/' + o.empresa + '/Comprobantes_Stock/ObtenerLista?' + new URLSearchParams(q).toString(), { credentials: 'include' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){
      if(!j || !Array.isArray(j.rows)) return null;
      return j.rows.filter(function(r){ return String(r.Anulada) !== 'True'; }).map(function(r){
        return { id: String(r.ID_Comprobante), nro: String(r.Numero_Comprobante || '').trim(),
                 ref: String(r.Referencia || '').replace(/\s+/g, ''), destino: String(r.Punto_Stock_Destino || '').trim() };
      });
    })
    .catch(function(){ return null; });
});

// Los renglones ([código, unidades]) y el centro de costos (su número; solo egresos) de un comprobante guardado.
var JS_DETALLE_STOCK = String(function(o){
  var base = '/' + o.empresa + '/Comprobantes_Stock/';
  var items = fetch(base + 'ListaItems?' + new URLSearchParams({ parentRowId: o.id, idTipoComprobante: o.tipo, jqGridID: 'DetalleGrid',
                                                                rows: 2000, page: 1 }).toString(), { credentials: 'include' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){ return j && Array.isArray(j.rows) ? j.rows.map(function(r){ return [String(r.Codigo_Insumo || '').trim(), Number(r.Unidades)]; }) : null; })
    .catch(function(){ return null; });
  var centro = !o.centro ? Promise.resolve('') : fetch(base + 'Edit/' + o.id, { credentials: 'include' })
    .then(function(r){ return r.ok ? r.text() : ''; })
    .then(function(h){
      var m = /evalJSON\('(\[\{"ID_Dimension[^']+)'\)/.exec(h || '');
      if(!m) return '';
      var d = JSON.parse(m[1]).filter(function(x){ return String(x.ID_Dimension) === '2'; })[0];
      return d ? String(d.ID_IT_Dimension) : '';
    })
    .catch(function(){ return ''; });
  return Promise.all([items, centro]).then(function(v){ return { items: v[0], centro: v[1] }; });
});

async function listaStock(pg, empresa, desde, hasta, filas){
  try{ return await pg.evaluar(JS_LISTA_STOCK, { empresa: String(empresa).trim(), desde: diaParaAlbor(desde), hasta: diaParaAlbor(hasta), filas: filas }); }
  catch(e){ if(e instanceof Cortado) throw e; return null; }
}

// La lista alrededor de la fecha del comprobante (y de hoy).
async function listaDelDia(pg, empresa, fecha){
  var d = fechaDeTexto(fecha) || new Date(), hoy = new Date(), DIA = 86400000;
  return listaStock(pg, empresa, new Date(Math.min(d, hoy) - 3 * DIA), new Date(Math.max(d, hoy) + 3 * DIA));
}

/* Lo que hay en Albor antes de guardar (sus números internos), para reconocer después el comprobante nuevo. */
async function antesDeGuardar(pg, empresa, fecha){
  var l = await listaDelDia(pg, empresa, fecha);
  return l ? l.map(function(r){ return r.id; }) : null;
}

/* El comprobante recién guardado: uno que no estaba antes, con ese número (egreso: "1111-65"; transferencia:
   "2026-STK-3028") o, si no, el único nuevo de su tipo (la persona pudo cambiarle el número a mano). Nunca uno
   viejo con el mismo número: el 30/10, el 1111-66 de La Colorada "estaba" porque era el de Candelaria. */
function buscarGuardado(lista, o){
  var nuevos = lista.filter(function(r){ return !o.antes || o.antes.indexOf(r.id) < 0; })
                    .filter(function(r){ return o.egreso ? !!r.nro : !!r.destino; });
  var mismo = nuevos.filter(function(r){
    return o.egreso ? numeroCorto(r.nro) === numeroCorto(o.numero) : !!o.numero && r.ref === String(o.numero).replace(/\s+/g, '');
  });
  if(mismo.length) return mismo[0];
  return o.antes && nuevos.length === 1 ? nuevos[0] : null;
}

// Lo que no coincide entre lo que se cargó y lo que quedó guardado.
function diferenciasGuardado(det, o){
  var dif = [];
  if(det.items){
    var quedo = {}, cargo = {};
    det.items.forEach(function(x){ quedo[x[0].toUpperCase()] = (quedo[x[0].toUpperCase()] || 0) + x[1]; });
    o.renglones.forEach(function(i){ var k = String(i.codigo).toUpperCase(); cargo[k] = (cargo[k] || 0) + (parseFloat(String(i.unidad).replace(',', '.')) || 0); });
    var faltan = Object.keys(cargo).filter(function(k){ return !(k in quedo); });
    var sobran = Object.keys(quedo).filter(function(k){ return !(k in cargo); });
    var otra = Object.keys(cargo).filter(function(k){ return k in quedo && Math.abs(quedo[k] - cargo[k]) > 0.0001; });
    if(det.items.length !== Object.keys(quedo).length) dif.push('tiene insumos repetidos');
    if(faltan.length) dif.push('no tiene ' + faltan.join(', '));
    if(sobran.length) dif.push('tiene de más ' + sobran.join(', '));
    if(otra.length) dif.push('con otra cantidad: ' + otra.map(function(k){ return k + ' (' + quedo[k] + ' en vez de ' + cargo[k] + ')'; }).join(', '));
  }
  if(o.centro && det.centro && det.centro !== String(o.centro))
    dif.push('quedó con otro centro de costos (tiene que ser ' + (o.centroTexto || o.centro) + ')');
  return dif;
}

/* Después de guardar: {fila} si está en Albor; {otraVez: 'guardar'} si no está y sigue en pantalla; {otraVez: 'armar'}
   si no está ni en pantalla; {sinControl: true} si no se pudo mirar la lista (se sigue como antes, avisando). */
async function confirmarEnAlbor(pg, charla, o){
  var nombre = o.egreso ? 'el egreso N° ' + o.numero + ' de ' + o.punto : 'la transferencia ' + o.punto + (o.numero ? ' (' + o.numero + ')' : '');
  for(var vuelta = 1; vuelta <= 2; vuelta++){
    var lista = await listaDelDia(pg, o.empresa, o.fecha);
    if(!lista){
      charla.decir('   [!] No pude mirar la lista de Albor para confirmar que quedó guardado: fijate en Comprobantes de Stock.');
      return { sinControl: true };
    }
    var fila = buscarGuardado(lista, o);
    if(fila){
      charla.decir('   confirmado en Albor' + (o.egreso ? ': N° ' + numeroCorto(fila.nro) : fila.ref ? ': ' + fila.ref : '') + '.');
      var det = null;
      try{ det = await pg.evaluar(JS_DETALLE_STOCK, { empresa: String(o.empresa).trim(), id: fila.id, tipo: o.egreso ? TIPO_EGRESO : TIPO_TRANSFERENCIA, centro: !!o.centro }); }
      catch(e){ if(e instanceof Cortado) throw e; }
      var dif = det ? diferenciasGuardado(det, o) : [];
      if(dif.length){
        charla.decir('   [!] Quedó guardado, pero ' + dif.join('; ') + '.');
        await charla.pausa('Albor guardó ' + nombre + ', pero:\n   ' + dif.join('\n   ') +
                           '\n\nCorregilo a mano en Albor (Comprobantes de Stock) y tocá Seguir.', 'Seguir');
      }
      return { fila: fila };
    }
    if(vuelta === 1){ await pg.esperar(2500); continue; }       // Albor puede tardar un poco en mostrarlo
    charla.decir('   [!] No está en la lista de Albor: no se guardó.');
    await charla.pausa('Albor no guardó ' + nombre + ': no está en la lista de Comprobantes de Stock.\n\n' +
                       'Si en Albor hay un recuadro rojo, resolvelo (sin salir de esa pantalla). «Intentar de nuevo» lo vuelve a ' +
                       'guardar, o lo armo de nuevo si ya no está en pantalla. «Cancelar la carga» corta acá: lo que ya se guardó queda.',
                       'Intentar de nuevo');
  }
  // ¿Lo guardó la persona mientras tanto?
  lista = await listaDelDia(pg, o.empresa, o.fecha);
  fila = lista && buscarGuardado(lista, o);
  if(fila){ charla.decir('   confirmado en Albor.'); return { fila: fila }; }
  return { otraVez: (await sigueEnPantalla(pg)) ? 'guardar' : 'armar' };
}

/* Guarda y confirma en Albor; si no quedó, lo vuelve a guardar o lo manda a armar de nuevo (Rehacer). */
async function guardarYConfirmar(pg, charla, aplicar, o){
  for(;;){
    var numero = await guardarComprobante(pg, charla, aplicar);
    if(!o.egreso) o.numero = numero;
    var c = await confirmarEnAlbor(pg, charla, o);
    if(c.otraVez === 'armar'){ charla.decir('   Lo armo de nuevo desde el principio.'); throw new Rehacer(); }
    if(c.otraVez === 'guardar'){ charla.decir('   Lo guardo de nuevo.'); continue; }
    return { numero: numero, fila: c.fila || null };
  }
}

/* El próximo número de egreso sale de Albor (Feli, 30/10: la app quedó atrasada y repetía números ya usados). Mira los
   egresos de las dos empresas de los últimos cuatro meses con el mismo prefijo ("1111-"); si el primero de la carga ya
   está usado, avisa y numera desde el siguiente al último. */
async function numeroLibre(pg, comprobantes, charla){
  var p = partesNumero(comprobantes[0].numero);
  if(!p) return;
  var hoy = new Date(), DIA = 86400000, mayor = 0, leidas = 0;
  var empresas = EMPRESAS.concat(comprobantes.map(function(c){ return String(c.empresa_id).trim(); }))
                         .filter(function(e, i, a){ return e && a.indexOf(e) === i; });
  for(var i = 0; i < empresas.length; i++){
    var l = await listaStock(pg, empresas[i], new Date(hoy - 120 * DIA), new Date(+hoy + 3 * DIA), 3000);
    if(!l) continue;
    leidas++;
    l.forEach(function(r){ var x = partesNumero(r.nro); if(x && x[0] === p[0]) mayor = Math.max(mayor, x[1]); });
  }
  if(!leidas){ charla.decir('   [!] No pude mirar en Albor el último número de egreso: sigo con el ' + comprobantes[0].numero + '.'); return; }
  if(p[1] > mayor){ charla.decir('Número de egreso: el ' + comprobantes[0].numero + ' está libre en Albor.'); return; }
  var desde = mayor + 1;
  await charla.pausa('El N° ' + comprobantes[0].numero + ' ya está usado en Albor (el último egreso es el ' + p[0] + mayor + ').\n\n' +
                     'Cargo estos ' + comprobantes.length + ' egresos desde el ' + p[0] + desde + '.', 'Seguir desde el ' + p[0] + desde);
  comprobantes.forEach(function(c, k){ c.numero = p[0] + (desde + k); });
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
async function transferirBloque(pg, b, empresaActual, charla, n, total, deNuevo){
  charla.decir('');
  charla.decir('Comprobante ' + n + ' de ' + total + ': ' + b.origen_nombre + ' → ' + b.destino_nombre +
               ' (' + b.items.length + ' insumos)');

  empresaActual = await comprobanteEnBlanco(pg, b.empresa_id, empresaActual, charla, deNuevo);

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

  var antes = await antesDeGuardar(pg, b.empresa_id, b.fecha);
  var numero = (await guardarYConfirmar(pg, charla, true, {
    egreso: false, empresa: b.empresa_id, fecha: b.fecha, punto: b.origen_nombre + ' → ' + b.destino_nombre, antes: antes,
    renglones: r.cargados })).numero;

  return { empresa: empresaActual, hecho: {
    origen: b.origen_nombre, destino: b.destino_nombre, bloque: b._i,      // bloque: su lugar en la lista de la pantalla (el orden puede cambiar)
    comprobante: numero, cargados: r.cargados.length,
    total: b.items.length, fallados: r.fallados
  } };
}

/* `hechos` se va llenando comprobante por comprobante, así si se cancela a
   la mitad el que llama sabe qué quedó hecho. */
async function transferir(pg, bloques, charla, hechos, alHacer){
  var empresa = await empresaEnUrl(pg), rehechos = 0, rehacer = false;
  for(var n = 1; n <= bloques.length; n++){
    var r;
    try{ r = await transferirBloque(pg, bloques[n - 1], empresa, charla, n, bloques.length, rehacer); }
    catch(e){
      if(!(e instanceof SesionPerdida || e instanceof Rehacer) || ++rehechos > 2) throw e;
      if(e instanceof SesionPerdida) await volverAEntrar(pg, charla);
      empresa = await empresaEnUrl(pg);
      rehacer = true;
      n--;
      continue;
    }
    rehacer = false;
    empresa = r.empresa;
    hechos.push(r.hecho);
    avisarHecho(alHacer, r.hecho);
  }
  return hechos;
}

/* Cada comprobante confirmado va enseguida a la pantalla, que lo anota en el historial (Feli, 30/10: la extensión se
   colgó al final de los egresos y no quedó anotado ninguno). */
function avisarHecho(alHacer, hecho){
  if(typeof alHacer !== 'function') return;
  try{ alHacer(hecho); }catch(e){ anotar('No se pudo avisar a la pantalla: ' + primeraLinea(e)); }
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
async function egresarComprobante(pg, c, empresaActual, charla, n, total, deNuevo, cuentas){
  function cuenta(){ return cuentas[String(c.cuenta)] || 'cuenta ' + c.cuenta; }

  charla.decir('');
  charla.decir('Comprobante ' + n + ' de ' + total + ': ' + c.punto_nombre + ' · ' + cuenta() +
               ' · N° ' + c.numero + ' (' + c.items.length + ' insumos)');

  // Tras 'Guardar y crear otro' (o el control de antes de empezar) la pantalla ya queda lista; si no, se
  // abre uno nuevo. Antes se volvía a abrir la página en cada comprobante y se tocaba Nuevo (Feli, 29/10).
  empresaActual = await comprobanteEnBlanco(pg, c.empresa_id, empresaActual, charla, deNuevo);

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

  var antes = await antesDeGuardar(pg, c.empresa_id, c.fecha);
  var g = await guardarYConfirmar(pg, charla, false, {
    egreso: true, empresa: c.empresa_id, fecha: c.fecha, numero: c.numero, punto: c.punto_nombre, antes: antes,
    renglones: r.cargados, centro: centro, centroTexto: textoCentro });

  return { empresa: empresaActual, hecho: {
    punto: c.punto_nombre, cuenta: c.cuenta, bloque: c._i,
    numero: g.fila ? numeroCorto(g.fila.nro) : c.numero,      // el que quedó en Albor, aunque lo hayan cambiado a mano
    cuenta_nombre: cuentas[String(c.cuenta)] || '',
    centro: textoCentro || quedo,
    cargados: r.cargados.length, total: c.items.length, fallados: r.fallados
  } };
}

/* `hechos` se va llenando a medida que se guarda cada comprobante: si se
   cancela a la mitad, el que llama sabe cuáles números ya se usaron. */
async function egresar(pg, comprobantes, charla, hechos, cuentas, alHacer){
  var empresa = await empresaEnUrl(pg), rehechos = 0, rehacer = false;
  for(var n = 1; n <= comprobantes.length; n++){
    var r;
    try{ r = await egresarComprobante(pg, comprobantes[n - 1], empresa, charla, n, comprobantes.length, rehacer, cuentas); }
    catch(e){
      if(!(e instanceof SesionPerdida || e instanceof Rehacer) || ++rehechos > 2) throw e;
      if(e instanceof SesionPerdida) await volverAEntrar(pg, charla);
      empresa = await empresaEnUrl(pg);
      rehacer = true;
      n--;
      continue;
    }
    rehacer = false;
    empresa = r.empresa;
    hechos.push(r.hecho);
    avisarHecho(alHacer, r.hecho);
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

/* ---------- Lo que ya se sabe de Albor (Feli, 29/10) ----------
   El control de antes de empezar abría un comprobante en cada empresa para ver sus listas: en La Colorada,
   La Quimera, Consultores Asociados y de vuelta La Quimera antes de cargar nada. Ahora usa lo que ya se leyó
   de Albor en esta compu: "Traer de Albor" (Ajustes) y lo que leyeron los controles anteriores. Entra a Albor
   solo si eso no alcanza (algo no figura, o tiene más de DIAS_LISTAS días). */
var CLAVE_LISTAS_ALBOR = 'programa-compras:albor_listas';     // "Traer de Albor" (la pantalla de Ajustes)
var CLAVE_CONTROL_ALBOR = 'programa-compras:albor_control';   // lo que leyó el control antes de empezar
var DIAS_LISTAS = 60;

function listasGuardadas(empresa){
  var desde = Date.now() - DIAS_LISTAS * 864e5, L = { origen: [], destino: [], egreso: [], unidades: [], centros: [] }, hay = false;
  function sumar(x, fecha){
    if(!x || !(new Date(fecha).getTime() > desde)) return;
    hay = true;
    Object.keys(L).forEach(function(k){
      (x[k] || []).forEach(function(o){ if(!L[k].some(function(y){ return y[0] === o[0] && y[2] === o[2]; })) L[k].push(o); });
    });
  }
  try{ var a = JSON.parse(localStorage.getItem(CLAVE_LISTAS_ALBOR) || 'null'); if(a && a.por) sumar(a.por[empresa], a.fecha); }catch(e){}
  try{ var b = JSON.parse(localStorage.getItem(CLAVE_CONTROL_ALBOR) || '{}') || {}; if(b[empresa]) sumar(b[empresa], b[empresa].fecha); }catch(e){}
  return hay ? L : null;
}

/* Lo que leyó el control de esa empresa. Los centros, por unidad: cada control lee solo las que usa. */
function anotarListas(empresa, L){
  try{
    var b = JSON.parse(localStorage.getItem(CLAVE_CONTROL_ALBOR) || '{}') || {}, v = b[empresa] || {};
    var x = { fecha: new Date().toISOString() };
    ['origen', 'destino', 'egreso', 'unidades'].forEach(function(k){ x[k] = L[k] && L[k].length ? L[k] : (v[k] || []); });
    var leidas = (L.centros || []).map(function(o){ return o[2]; });
    x.centros = (L.centros || []).concat((v.centros || []).filter(function(o){ return leidas.indexOf(o[2]) < 0; }));
    b[empresa] = x;
    localStorage.setItem(CLAVE_CONTROL_ALBOR, JSON.stringify(b));
  }catch(e){}
}

/* Lo que falta en esas listas para los comprobantes de esa empresa. */
function faltanEn(L, empresa, cs, egreso){
  function hay(ops, v){ v = String(v == null ? '' : v).trim(); return !v || v === '?' || (ops || []).some(function(o){ return o[0] === v; }); }
  var faltan = [];
  cs.forEach(function(c){
    if(egreso){
      if(!hay(L.egreso, c.punto_id)) faltan.push('el punto de stock de ' + c.punto_nombre + ' (' + c.punto_id + ', empresa ' + empresa + ')');
      if(c.unidad_negocio && !hay(L.unidades, c.unidad_negocio)) faltan.push('la unidad de negocio ' + c.unidad_negocio + ' (empresa ' + empresa + ')');
      var u = String(c.unidad_negocio || '').trim();
      if(!buscarCentro((L.centros || []).filter(function(o){ return !u || o[2] === u; }), c))
        faltan.push('el centro de costos de ' + c.punto_nombre + ' (' + (c.centro_costo || 'sin número') + ', empresa ' + empresa + ')');
    }else{
      if(!hay(L.origen, c.origen_id)) faltan.push('el punto de stock ' + c.origen_nombre + ' (' + c.origen_id + ', empresa ' + empresa + ')');
      if(!hay(L.destino, c.destino_id)) faltan.push('el punto de stock ' + c.destino_nombre + ' (' + c.destino_id + ', empresa ' + empresa + ')');
    }
  });
  return faltan;
}

/* Antes de cargar nada, se fija que cada punto de stock y cada centro de
   costos de la carga exista en Albor (Feli, 2026-10-02): si falta alguno,
   avisa al principio, no a la mitad. Se puede cancelar y corregir en Ajustes,
   o seguir y elegirlo a mano. Devuelve la empresa en la que dejó un comprobante
   en blanco abierto (o null si no tuvo que entrar a Albor). */
async function revisarAntes(pg, lista, egreso, charla){
  var porEmpresa = {}, orden = [];
  lista.forEach(function(c){
    var e = String(c.empresa_id == null ? '' : c.empresa_id).trim();
    if(!e || e === '?') return;
    if(!porEmpresa[e]){ porEmpresa[e] = []; orden.push(e); }
    porEmpresa[e].push(c);
  });
  if(!orden.length) return null;
  var enAlbor = orden.filter(function(e){ var L = listasGuardadas(e); return !L || faltanEn(L, e, porEmpresa[e], egreso).length; });
  if(!enAlbor.length){ charla.decir('Antes de empezar: según lo que ya leí de Albor en esta compu, está todo.'); return null; }
  charla.decir('Antes de empezar: me fijo en Albor que esté todo lo de la lista…');
  var actual = await empresaEnUrl(pg), primera = String(lista[0].empresa_id == null ? '' : lista[0].empresa_id).trim(), faltan = [];
  // Primero la empresa en la que ya está (sin cambiar). En egresos, la del primer comprobante al final: su
  // comprobante en blanco queda abierto y se carga ahí. En transferencias, se empieza por la última que se miró.
  function peso(e){ return e === actual ? 0 : (egreso && e === primera ? 2 : 1); }
  enAlbor.sort(function(a, b){ return peso(a) - peso(b); });
  for(var i = 0; i < enAlbor.length; i++){
    var e = enAlbor[i], cs = porEmpresa[e], unidades = [];
    if(egreso) cs.forEach(function(c){ var u = String(c.unidad_negocio || '').trim(); if(u && unidades.indexOf(u) < 0) unidades.push(u); });
    var r = await listasDeEmpresa(pg, e, actual, charla, egreso ? unidades : [], !egreso);
    actual = r.actual;
    var L = r.listas;
    if(egreso){
      // Si un centro no aparece, se lee de nuevo esa unidad con más tiempo antes de
      // decir que falta: Albor a veces tarda en llenar la lista.
      for(var k = 0; k < cs.length; k++){
        var c = cs[k], u = String(c.unidad_negocio || '').trim();
        if(!u || !L.unidades.some(function(o){ return o[0] === u; })) continue;
        if(buscarCentro(L.centros.filter(function(o){ return o[2] === u; }), c)) continue;
        var otra = await centrosDeUnidad(pg, u, charla, 45000);
        otra.forEach(function(o){ if(!L.centros.some(function(x){ return x[0] === o[0] && x[2] === u; })) L.centros.push([o[0], o[1], u]); });
      }
    }
    anotarListas(e, L);
    faltan = faltan.concat(faltanEn(L, e, cs, egreso));
  }
  faltan = faltan.filter(function(f, n){ return faltan.indexOf(f) === n; });
  if(!faltan.length) charla.decir('   está todo.');
  else{
    charla.decir('   [!] falta: ' + faltan.join('; '));
    await charla.pausa('Antes de empezar revisé Albor y no encuentro:\n' +
                       faltan.map(function(f){ return '   ' + f; }).join('\n') +
                       '\n\nNo cargué nada todavía. Podés cancelar y corregirlo en Ajustes ' +
                       '("Traer de Albor" te muestra lo que hay), o seguir igual y elegirlo a mano en cada comprobante.',
                       'Seguir igual');
  }
  return actual;
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
  if(boton === 'Intentar de nuevo') return 'Albor no guardó el comprobante';
  if(/^Seguir desde el /.test(boton)) return 'El número de egreso ya estaba usado en Albor';
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

function cargar_transferencia(bloques, archivos, etiqueta, alHacer){
  bloques = (bloques || []).map(function(b, i){ return Object.assign({}, b, { items: items(b.items), _i: i }); });
  if(!bloques.length) return Promise.resolve({ ok: false, motivo: 'No hay nada para transferir.' });
  return cargar(async function(pg, charla, hechos){
    var donde = await revisarAntes(pg, bloques, false, charla);
    // Se empieza por la empresa en la que dejó el comprobante en blanco: en La Colorada, un solo cambio de
    // empresa en vez de tres (Feli, 29/10). Los comprobantes son independientes: el orden no cambia nada.
    if(donde) bloques = bloques.filter(function(b){ return String(b.empresa_id).trim() === donde; })
                               .concat(bloques.filter(function(b){ return String(b.empresa_id).trim() !== donde; }));
    // El resumen, en el orden de la pantalla
    try{ return await transferir(pg, bloques, charla, hechos, alHacer); }
    finally{ hechos.sort(function(a, b){ return a.bloque - b.bloque; }); }
  }, 'Transferencias', etiqueta, archivos, true);
}

function cargar_egresos(comprobantes, archivos, etiqueta, alHacer){
  comprobantes = (comprobantes || []).map(function(c, i){ return Object.assign({}, c, { items: items(c.items), _i: i }); });
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
    await numeroLibre(pg, comprobantes, charla);
    return egresar(pg, comprobantes, charla, hechos, cuentas, alHacer);
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

/* ==================================================================
   Fase 6, Paso 5 (Feli, 28/10 y 29/10): la orden de compra en Albor
   ------------------------------------------------------------------
   La arma la app al comprar, en la misma pestaña de Albor de siempre, con
   los pasos del video (mapa en "Conexion con Albor - Orden de compra/Mapa de
   la orden de compra en Albor.md"):
     1. Compras → Órdenes de Compra no Stockeables. Si una orden con la misma
        clave en sus Observaciones ya está (un intento anterior la guardó), no
        se carga de nuevo: se lee su número y su PDF.
     2. Nuevo. Proveedor por su código de Albor o, la primera vez, por CUIT
        (con guiones) en la ventanita de la lupa. Si no está en Albor, frena
        para darlo de alta a mano.
     3. Solicitante, Responsable y Observaciones (con la clave).
     4. Un ítem por renglón: insumo, cantidad, precio y lo que escribió el
        proveedor. Se cuentan los renglones de la grilla para no cargar uno
        dos veces.
     5. Frena una vez para controlar; GUARDAR una sola vez.
     6. En la lista: el número ("2026 - OCNS - 124") y el PDF del
        "Comprobante Detallado" (ExportUrlBase + PDF del visor).
   ================================================================== */
var URL_ORDENES = '/1/Ordenes_Compra_No_Stockeables';

function numeroOrden(t){
  var m = /(\d{4})\s*-\s*([A-Z]{2,6})\s*-\s*(\d+)/.exec(String(t || ''));
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}

// La fila de la lista con esa clave en las Observaciones: {id, texto} o null.
var JS_FILA_ORDEN = String(function(clave){
  var filas = [].slice.call(document.querySelectorAll('#DetalleGrid tr.jqgrow'));
  for(var i = 0; i < filas.length; i++){
    var t = (filas[i].innerText || filas[i].textContent || '').replace(/\s+/g, ' ');
    if(t.indexOf(clave) >= 0) return { id: filas[i].id, texto: t };
  }
  return null;
});

// Los renglones de la grilla de ítems de la orden (null: no está la grilla).
var JS_ITEMS_ORDEN = String(function(){
  var g = document.querySelector('#DetalleGrid');
  if(!g) return null;
  return [].slice.call(g.querySelectorAll('tr.jqgrow')).map(function(r){ return (r.innerText || '').replace(/\s+/g, ' ').trim(); });
});

// El valor de un campo (el nombre que Albor pone al lado de un código).
var JS_VALOR = String(function(sel){ var e = document.querySelector(sel); return e ? String(('value' in e ? e.value : e.textContent) || '').trim() : null; });

// Pone un texto en un textarea#Observaciones: el de la orden (fuera de la
// ventanita) o el del ítem (adentro). Hay dos con el mismo nombre.
var JS_OBSERVACIONES = String(function(o){
  var ts = [].slice.call(document.querySelectorAll('textarea#Observaciones, textarea[name="Observaciones"]'));
  var t = ts.filter(function(x){ var d = x.closest('.ui-dialog'); return o.dialogo ? (d && d.offsetParent !== null) : !d; })[0];
  if(!t) return false;
  t.focus(); t.value = o.texto;
  ['input', 'change', 'blur'].forEach(function(ev){ t.dispatchEvent(new Event(ev, { bubbles: true })); });
  if(window.jQuery) window.jQuery(t).trigger('change');
  return t.value === o.texto;
});

// Elige la fila en la lista (jqGrid) para el "Comprobante Detallado".
var JS_ELEGIR_FILA = String(function(id){
  try{ if(window.jQuery && window.jQuery('#DetalleGrid').jqGrid){ window.jQuery('#DetalleGrid').jqGrid('setSelection', id); return true; } }catch(e){}
  var f = document.getElementById(id);
  if(!f) return false;
  f.click();
  return true;
});

// El PDF del informe abierto: el visor de Microsoft lo da en ExportUrlBase + 'PDF'.
var JS_PDF_VISOR = String(function(){
  var v = $find('visorReporte');
  var url = v._getInternalViewer().ExportUrlBase + 'PDF';
  return fetch(url, { credentials: 'include' }).then(function(r){
    if(!r.ok) throw new Error('Albor contestó ' + r.status + ' al pedir el PDF');
    return r.arrayBuffer();
  }).then(function(b){
    var s = '', a = new Uint8Array(b);
    for(var i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
    return btoa(s);
  });
});

// Abre el "Comprobante Detallado" de una orden por su número interno (lo que hace abrirReporte_OC con la fila elegida).
var JS_REPORTE_ORDEN = String(function(id){
  var campo = document.querySelector('#ID_Comprobante');
  if(typeof window.mostrarReporteEnDialogo !== 'function' || !campo) return false;
  var $ = window.jQuery;
  if($) $('#ID_Comprobante').val(id); else campo.value = id;
  try{ if($){ var v = $.fn.tval ? 'tval' : 'val'; $('#Hash_Actual')[v]($('#Hash_Actual_Reporte')[v]()); } }catch(e){}     // Albor usa su .tval()
  window.mostrarReporteEnDialogo('#dialogoReporte', 'Comprobante_OC_No_Stockeable', 'Comprobante Detallado', '#frmFiltrosReportes');
  return true;
});

// La lupa de un campo: el botón al lado (sus IDs cambian cada vez: "bt_" + letras).
var JS_LUPA = String(function(campo){
  var e = document.querySelector(campo);
  if(!e) return null;
  for(var p = e.parentElement, n = 0; p && n < 4; p = p.parentElement, n++){
    var b = p.querySelector('[id^="bt_"], .fa-search, button[title*="usc" i], a[title*="usc" i]');
    if(b){ var x = b.closest('a, button') || b; if(!x.id) x.id = '__lupa_' + Date.now(); return '#' + x.id; }
  }
  return null;
});

// Las filas de la grilla de la ventanita del proveedor (a la vista). Con elegir, hace clic en la primera.
var JS_FILAS_PROVEEDOR = String(function(elegir){
  var filas = [].slice.call(document.querySelectorAll('[id^="DetalleGrid_dialog"] tr.jqgrow')).filter(function(r){ return r.offsetParent !== null; });
  if(elegir && filas[0]){
    filas[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    filas[0].click();
  }
  return filas.length;
});

/* Escribe un código y espera el nombre que pone Albor (unos 2 s). Devuelve el nombre o ''. */
async function codigoConNombre(pg, campo, codigo, limite){
  await escribirCampo(pg, '#' + campo + '_codigo', codigo, { delay: 70 });
  await pg.presionar('Tab');
  var fin = Date.now() + (limite || 15000);
  while(Date.now() < fin){
    await esperar(pg, 10000, 100);
    var n = await pg.evaluar(JS_VALOR, '#' + campo + '_nombre');
    if(n) return n;
    await pg.esperar(400);
  }
  return '';
}

/* El proveedor: por su código si ya lo tiene; si no, por CUIT en la ventanita de la lupa. {codigo, nombre}. */
async function proveedorDeOrden(pg, p, charla){
  if(p.codigo){
    var n = await codigoConNombre(pg, 'ID_Tercero_Proveedor', p.codigo);
    if(n){ charla.decir('Proveedor: ' + p.codigo + ' · ' + n); return { codigo: p.codigo, nombre: n }; }
    charla.decir('[!] El código ' + p.codigo + ' no trajo ningún proveedor: lo busco por CUIT.');
  }
  if(!p.cuit) throw new Error(p.nombre + ' no tiene CUIT: cargalo en la app.');
  for(var vuelta = 1; vuelta <= 2; vuelta++){
    var lupa = await pg.evaluar(JS_LUPA, '#ID_Tercero_Proveedor_nombre');
    if(!lupa) throw new Error('No encontré la lupa del proveedor en Albor.');
    await pg.loc(lupa).click({ timeout: 15000 });
    await pg.loc('#gs_CUIT').waitFor('visible', 15000);
    await esperar(pg, 15000);
    charla.decir('Buscando el proveedor por CUIT ' + p.cuit + '…');
    await escribirCampo(pg, '#gs_CUIT', p.cuit, { delay: 50 });
    await pg.presionar('Enter');
    await pg.esperar(800);
    await esperar(pg, 20000);
    var cuantas = await pg.evaluar(JS_FILAS_PROVEEDOR, false);
    if(cuantas === 1){
      await pg.evaluar(JS_FILAS_PROVEEDOR, true);          // la elige (clic en la fila, como jqGrid)
      await pg.esperar(300);
      await pg.loc('#btSeleccionarDialogoPopUp').click({ timeout: 10000 });
      await esperar(pg, 15000);
      var fin = Date.now() + 15000, nom = '', cod = '';
      while(Date.now() < fin && !nom){
        nom = await pg.evaluar(JS_VALOR, '#ID_Tercero_Proveedor_nombre');
        cod = await pg.evaluar(JS_VALOR, '#ID_Tercero_Proveedor_codigo');
        if(!nom) await pg.esperar(400);
      }
      if(nom){ charla.decir('Proveedor (por CUIT): ' + cod + ' · ' + nom); return { codigo: cod, nombre: nom }; }
    }
    if(cuantas > 1) throw new Error('Albor tiene ' + cuantas + ' proveedores con el CUIT ' + p.cuit + '. Elegí el bueno a mano y cargá su código en la app.');
    // No está en Albor: se da de alta a mano (con AFIP) y se sigue
    if(vuelta === 2) break;
    await charla.pausa('El proveedor ' + p.nombre + ' (CUIT ' + p.cuit + ') no está en Albor.\n\nEn la ventanita del proveedor tocá «Nuevo», ' +
                       'escribí el CUIT, «Cargar datos desde AFIP», tildá «Proveedor» y «Guardar». Después cerrá la ventanita y tocá Seguir: lo busco de nuevo.',
                       'Seguir');
    await cerrarPopups(pg);
  }
  throw new Error('No encontré en Albor el proveedor con CUIT ' + p.cuit + '.');
}

/* Un ítem: insumo, cantidad, precio y lo que escribió el proveedor. Lanza si no entró. */
async function itemDeOrden(pg, it, antes){
  await cerrarAnuncios(pg);
  await pg.loc('#btAdd_DetalleGrid').click({ timeout: 15000 });
  await pg.loc('#ID_Insumo_No_Stockeable_codigo').waitFor('visible', 15000);
  await esperar(pg, 8000);
  var nombre = await codigoConNombre(pg, 'ID_Insumo_No_Stockeable', it.insumo);
  if(!nombre) throw new Error('Albor no encontró el insumo ' + it.insumo);
  await escribirCampo(pg, '#Cantidad', unidadesAlbor(it.cantidad), { secuencial: false });
  await escribirCampo(pg, '#Precio_Unitario', unidadesAlbor(it.precio), { secuencial: false });
  if(it.observaciones) await pg.evaluar(JS_OBSERVACIONES, { texto: it.observaciones, dialogo: true });
  await pg.loc('#btAceptar_dialog').click({ timeout: 15000 });
  var fin = Date.now() + 20000;
  for(;;){
    var ahora = (await pg.evaluar(JS_ITEMS_ORDEN)) || [];
    if(ahora.length > antes) break;
    if(Date.now() > fin) throw new Error('la ventanita del ítem no se cerró (Albor no lo tomó)');
    await pg.esperar(500);
  }
  if(await pg.loc('#ID_Insumo_No_Stockeable_codigo').isVisible()){
    try{ await pg.loc('#btCancelar_dialog').click({ timeout: 3000 }); }catch(e){ if(e instanceof Cortado) throw e; }
  }
  await esperar(pg, 10000);
}

/* Arma la orden (sin guardar). Si Albor pide ingresar en el medio, se arma de nuevo desde el principio (como en Transferencias). */
async function armarOrden(pg, o, charla){
  charla.decir('Nueva orden de compra…');
  // Feli (29/10, Safari): "Nuevo" abre otra página y la extensión de Safari se quedaba en la anterior. Se va directo, como a las demás páginas.
  await pg.ir(C.BASE + URL_ORDENES + '/Create');
  await pg.loc('#ID_Tercero_Proveedor_codigo').waitFor('visible', 40000);
  await esperar(pg, 40000);
  var prov = await proveedorDeOrden(pg, o.proveedor, charla);
  charla.revisar();
  var moneda = await monedaDeOrden(pg, o.moneda, charla);
  var sol = await codigoConNombre(pg, 'ID_Personal_Solicitante', o.solicitante);
  var res = await codigoConNombre(pg, 'ID_Personal_Responsable', o.responsable);
  charla.decir('Solicitante: ' + (sol || '¿' + o.solicitante + '?') + ' · Responsable: ' + (res || '¿' + o.responsable + '?'));
  if(!(await pg.evaluar(JS_OBSERVACIONES, { texto: o.observaciones, dialogo: false })))
    charla.decir('[!] No pude escribir las Observaciones de la orden: escribí «' + o.clave + '» a mano.');
  var cargados = 0, fallados = [];
  for(var i = 0; i < o.items.length; i++){
    var it = o.items[i];
    charla.revisar();
    var antes = ((await pg.evaluar(JS_ITEMS_ORDEN)) || []).length;
    charla.decir('Ítem ' + (i + 1) + ' de ' + o.items.length + ': ' + it.insumo + ' · ' + it.cantidad + ' × $ ' + unidadesAlbor(it.precio));
    var ok = false;
    for(var intento = 1; intento <= 2 && !ok; intento++){
      try{ await itemDeOrden(pg, it, antes); ok = true; }
      catch(e){
        if(e instanceof Cortado || e instanceof Cancelado) throw e;
        if(await M.albor.enLogin()) throw new SesionPerdida('Albor cerró la sesión mientras se armaba la orden.');
        // ¿Entró igual? (la ventanita no se cerró a tiempo): no se carga de nuevo
        if(((await pg.evaluar(JS_ITEMS_ORDEN)) || []).length > antes){ ok = true; await cerrarPopups(pg); break; }
        charla.decir('   [!] ' + primeraLinea(e) + (intento === 1 ? ': pruebo de nuevo.' : ''));
        await cerrarPopups(pg);
      }
    }
    if(ok) cargados++; else fallados.push(it);
  }
  return { prov: prov, sol: sol, res: res, cargados: cargados, fallados: fallados, moneda: moneda };
}

// La cotización que pone Albor al elegir Dólares (el campo de al lado de "Moneda de origen").
var JS_COTIZACION = String(function(){
  var e = [].slice.call(document.querySelectorAll('input')).filter(function(x){ return /cotiz/i.test(x.id + ' ' + (x.name || '')) && x.offsetParent !== null; })[0];
  return e ? String(e.value || '').trim() : '';
});

/* Contador (Feli, 30/10): en dólares, "Moneda de origen" = Dólares y la cotización que pone Albor. Los precios van como vienen
   del presupuesto (en dólares). En pesos no se toca (viene elegida). "Precio con IVA incluido" siempre sin tildar. Devuelve
   lo que se ve, para la pausa de control. */
async function monedaDeOrden(pg, moneda, charla){
  try{ if((await pg.evaluar(AYUDANTE, { sel: '#Precio_Con_IVA', modo: 'marcado' })) === true) await tildar(pg, '#Precio_Con_IVA', false); }
  catch(e){ if(e instanceof Cortado) throw e; }
  if(moneda !== 'USD') return 'Pesos';
  charla.decir('La compra es en dólares: elijo Dólares en «Moneda de origen» (la cotización la pone Albor).');
  if(!(await elegirOpcion(pg, '#ID_Moneda_Origen', '2', 'Moneda de origen', charla))) return 'SIN ELEGIR: elegí Dólares a mano';
  var fin = Date.now() + 15000, cot = '';
  while(Date.now() < fin && !cot){ await esperar(pg, 10000, 150); cot = await pg.evaluar(JS_COTIZACION); if(!cot) await pg.esperar(500); }
  return 'Dólares' + (cot ? ' (cotización de Albor: ' + cot + ')' : '');
}

/* Guarda una sola vez y espera a que Albor vuelva a la lista. */
async function guardarOrden(pg, charla){
  charla.decir('Guardando…');
  var r = await tocarYEsperar(pg, '#btGuardar', async function(){
    var u = await pg.url();
    return u.indexOf('/Create') < 0 && u.indexOf(URL_ORDENES) >= 0;
  }, 90000);
  if(r.ok) { charla.decir('   guardada.'); return; }
  if(r.sesion){
    if(M.albor && await M.albor.enLogin()) await tocarIngresar(pg);
    await charla.pausa('Albor cerró la sesión justo mientras guardaba la orden, así que no sé si quedó.\n\nEntrá de nuevo en la pestaña de ' +
                       'Albor (si pide la contraseña) y fijate en Órdenes de Compra no Stockeables. Si no está, cargala y guardala a mano. Después tocá «Ya lo revisé».',
                       'Ya lo revisé');
    return;
  }
  if(r.advertencia){
    await charla.pausa(textoAdvertencia(r.advertencia, 'guardar') .replace('Si todavía no está guardado, lo guardo yo.', 'Guardala a mano.'), 'Ya está guardada');
    return;
  }
  await charla.pausa((r.noToco ? 'No pude tocar Guardar.' : 'Albor no confirmó que guardó la orden (pasó un minuto y medio).') +
                     '\nFijate en Albor: si hay un recuadro rojo arriba, resolvelo. Guardala a mano y tocá «Ya está guardada».', 'Ya está guardada');
}

/* La orden con esa clave en las Observaciones, pidiéndole a Albor la lista de los últimos días (Feli, 29/10: la lista en
   pantalla recuerda un filtro de fechas viejo, "del 13/10 al 28/10", y la orden de hoy no aparecía). {id, texto} o null.
   Si Albor no contesta así (o en el Albor falso sin esa dirección), se mira la lista en pantalla. */
var JS_BUSCAR_ORDEN = String(function(o){
  function f(d){ return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  var hoy = new Date(), desde = new Date(hoy.getTime() - o.dias * 86400000), hasta = new Date(hoy.getTime() + 86400000);
  var base = {};
  try{ if(window.jQuery && window.jQuery('#DetalleGrid').jqGrid) base = window.jQuery('#DetalleGrid').jqGrid('getGridParam', 'postData') || {}; }catch(e){}
  var q = Object.assign({ _search: false, filtro_Solo_No_Stockeable: 'True', filtro_OC_Sin_Pendientes: 'false' }, base,
                        { rows: 200, page: 1, sidx: 'Fecha', sord: 'desc', nd: Date.now(), filtro_FechaDesde: f(desde), filtro_FechaHasta: f(hasta) });
  return fetch('/1/Ordenes_Compra/ObtenerLista?jqGridID=DetalleGrid&' + new URLSearchParams(q).toString(), { credentials: 'include' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){
      if(!j || !Array.isArray(j.rows)) return { sinLista: true };
      var x = j.rows.filter(function(r){ return String(r.Observaciones || '').indexOf(o.clave) >= 0; })[0];
      return x ? { id: String(x.ID_Comprobante), texto: String(x.Referencia || '') + ' ' + String(x.Observaciones || '') } : null;
    })
    .catch(function(){ return { sinLista: true }; });
});

/* La orden de la lista (por la clave). Abre la lista cada vez (después de Guardar, Albor vuelve solo a la lista, pero la
   extensión de Safari puede quedar en la página anterior); yaEsta: se acaba de abrir. */
async function filaDeOrden(pg, clave, intentos, yaEsta){
  for(var i = 0; i < (intentos || 4); i++){
    if(i || !yaEsta){ await pg.ir(C.BASE + URL_ORDENES); await esperar(pg, 40000); }
    try{ await pg.loc('#btNuevoRegistro').waitFor('visible', 30000); }catch(e){ if(e instanceof Cortado) throw e; }
    await esperar(pg, 20000);
    var b = await pg.evaluar(JS_BUSCAR_ORDEN, { clave: clave, dias: 10 });
    if(b && !b.sinLista) return b;
    if(b && b.sinLista){ var f = await pg.evaluar(JS_FILA_ORDEN, clave); if(f) return f; }
    await pg.esperar(1500);
  }
  return null;
}

/* El PDF del "Comprobante Detallado" de una orden de la lista (base64) o ''. */
async function pdfDeOrden(pg, fila, charla){
  try{
    // Como "Comprobante Detallado" (abrirReporte_OC), pero con el número interno de la orden: no hace falta que esté a la vista
    var directo = await pg.evaluar(JS_REPORTE_ORDEN, fila.id);
    if(!directo){
      await pg.evaluar(JS_ELEGIR_FILA, fila.id);
      await pg.esperar(300);
      await pg.loc('#btReporteDetallado').click({ timeout: 15000 });
    }
    await pg.loc('#iframeReporte').waitFor('attached', 30000);
    var fin = Date.now() + 90000, marco = null;
    while(Date.now() < fin){
      await pg.esperar(1500);
      try{ marco = await pg.marcoDe('#iframeReporte'); }catch(e){ if(e instanceof Cortado) throw e; }
      if(marco && await visorListo(pg, marco)) break;
      marco = null;
    }
    if(!marco) throw new Error('el informe no terminó de armarse');
    var b64 = await pg.evaluar(JS_PDF_VISOR, undefined, marco);
    if(!b64 || String(b64).indexOf('JVBER') !== 0) throw new Error('lo que bajó no es un PDF');
    charla.decir('PDF de la orden bajado (' + Math.round(b64.length * 3 / 4 / 1024) + ' KB).');
    await cerrarPopups(pg);
    return b64;
  }catch(e){
    if(e instanceof Cortado) throw e;
    charla.decir('[!] No pude bajar el PDF de la orden (' + primeraLinea(e) + ').');
    return '';
  }
}

/* La carga entera. o = lo que da datosOrdenAlbor: {id, clave, observaciones, proveedor: {nombre, cuit, codigo},
   solicitante, responsable, items: [{insumo, cantidad, precio, observaciones}], total}.
   Devuelve {ok, numero, pdf, proveedor: {codigo, nombre}} o {ok: false, motivo, cancelado}. */
function cargar_orden_compra(o){
  pedirPermisoAvisos();
  o = o || {};
  if(!o.clave || !(o.items || []).length) return Promise.resolve({ ok: false, motivo: 'La orden llegó sin ítems.' });
  return trabajo('__alborLog', async function(){
    M.cancelar = false;
    var charla = new Charla(function(t){ anotar(t); avisar(t); }, preguntar, function(){ return M.cancelar; });
    try{
      var a = await alborConSesion(), pg = a.pg, prov = null;
      await pg.ir(C.BASE + URL_ORDENES);
      await esperar(pg, 40000);
      await cerrarAnuncios(pg);
      // ¿Ya está? (un intento anterior la guardó): nunca dos veces
      var fila = await filaDeOrden(pg, o.clave, 1, true);
      if(fila) charla.decir('Esta orden ya estaba guardada en Albor: leo su número.');
      else{
        var r = null;
        for(var vuelta = 1; vuelta <= 2 && !r; vuelta++){
          try{ r = await armarOrden(pg, o, charla); }
          catch(e){
            if(!(e instanceof SesionPerdida) || vuelta === 2) throw e;
            charla.decir('[!] Albor cerró la sesión mientras armaba la orden (no estaba guardada): la armo de nuevo.');
            if(!(await a.asegurarSesion(5))) throw new Error('Albor sigue sin sesión. Iniciá sesión y tocá «Cargar en Albor» de nuevo.');
            await pg.ir(C.BASE + URL_ORDENES); await esperar(pg, 40000);
          }
        }
        prov = r.prov;
        var en = (await pg.evaluar(JS_ITEMS_ORDEN)) || [];
        var aviso = r.fallados.length ? '\n\n⚠️ No pude cargar ' + r.fallados.length + ' ítem' + (r.fallados.length === 1 ? '' : 's') + ': ' +
                    r.fallados.map(function(i){ return i.insumo + ' (' + i.cantidad + ' × ' + unidadesAlbor(i.precio) + ')'; }).join(', ') + '. Cargalos a mano antes de guardar.' : '';
        if(en.length > o.items.length) aviso += '\n\n⚠️ La grilla tiene ' + en.length + ' renglones y son ' + o.items.length + ': borrá los de más antes de guardar.';
        await charla.pausa('Revisá la orden en Albor antes de guardarla:\n' +
                           '• Proveedor: ' + prov.nombre + '\n• Solicitante: ' + (r.sol || '—') + ' · Responsable: ' + (r.res || '—') + '\n' +
                           '• Moneda: ' + (r.moneda || 'Pesos') + '\n' +
                           '• ' + r.cargados + ' de ' + o.items.length + ' ítems · total ' + (o.moneda === 'USD' ? 'US$ ' : '$ ') + unidadesAlbor(o.total) + (o.prueba ? '\n\n🧪 Es una prueba: después borrala en Albor.' : '') +
                           aviso + '\n\nTocá Guardar y la guardo (una sola vez).', 'Guardar');
        await guardarOrden(pg, charla);
        fila = await filaDeOrden(pg, o.clave, 4);
      }
      if(!fila) throw new Error('Albor guardó, pero no encontré la orden en la lista (busqué «' + o.clave + '» en las Observaciones). Cargá el número y el PDF a mano.');
      var numero = numeroOrden(fila.texto);
      charla.decir('Orden de compra N° ' + (numero || '?'));
      var pdf = await pdfDeOrden(pg, fila, charla);
      await a.cerrar();
      M.albor = null;
      avisarCompu('Listo: la orden ' + numero + ' quedó en Albor', 'Volvé a la app.', false);
      return { ok: true, numero: numero, pdf: pdf, proveedor: prov || null };
    }catch(e){
      if(e instanceof Cancelado) return { ok: false, cancelado: true, motivo: 'Cancelaste la carga de la orden. Si ya estaba guardada en Albor, la próxima vez la encuentro.' };
      anotar('ERROR: ' + String((e && e.stack) || e).slice(0, 600));
      avisarCompu('La orden no quedó cargada en Albor', motivoDe(e), false);
      return { ok: false, motivo: motivoDe(e) };
    }finally{
      M.esperando = null;
    }
  });
}

/* ==================================================================
   Fase 6-bis, Paso 2 (Feli, 31/10): la factura en Albor
   ------------------------------------------------------------------
   Mapa: "Conexion con Albor - Orden de compra/Mapa de la factura en Albor.md". Solo una compra con su orden en Albor.
     1. ¿Ya está cargada? (Comprobantes de Compra de los últimos meses, por número y proveedor): no se carga de nuevo.
     2. Mis Comprobantes AFIP (Feli, 31/10: todo en la misma pantalla): se le pide a Albor la lista por CUIT y número. Si está,
        se va directo a CreateMisComprobantesAfip (lo que hace "Siguiente": Albor completa fecha, número y proveedor) y se
        comparan neto, IVA y total. Si no está (puede estar ya vinculada), Nuevo: la persona elige A, B o C y la extensión
        pone la fecha, el número y el proveedor.
     3. "¿Desea dar de alta automáticamente el ítem de concepto?": Cancelar (los renglones salen de la orden; Feli, 31/10).
     4. OCNS: los renglones de nuestra orden, con "A vincular" = lo facturado (si no coincide con la orden, se cambia ahí).
     5. El IVA de cada renglón (Modificar → IVA).
     6. Frena con el resumen (el Tipo de compra lo trae Albor: lo revisa la persona). Una prueba nunca se guarda (Feli,
        30/10); si no, Guardar una sola vez y se confirma en la lista.
   ================================================================== */
var URL_COMPRAS = '/1/Comprobantes_Compra';
var IVA_ALBOR = { 21: 'IVA21', 10.5: 'IVA105', 27: 'IVA27' };

// "11.325,80" o "11325.80" → 11325.8
function numAlbor(t){
  var s = String(t == null ? '' : t).trim();
  if(!s) return null;
  if(s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  var n = parseFloat(s.replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? null : n;
}
function plataAlbor(n){ return n == null ? '—' : Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function soloLetras(t){ return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ''); }

// Los comprobantes de compra entre dos fechas (yyyy-mm-dd), sin los anulados. null si Albor no contesta.
var JS_COMPRAS_LISTA = String(function(o){
  var q = { jqGridID: 'DetalleGrid', _search: false, rows: 1000, page: 1, sidx: 'Fecha', sord: 'desc', nd: Date.now(),
            filtro_FechaDesde: o.desde, filtro_FechaHasta: o.hasta };
  return fetch('/1/Comprobantes_Compra/ObtenerLista?' + new URLSearchParams(q).toString(), { credentials: 'include' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){
      if(!j || !Array.isArray(j.rows)) return null;
      return j.rows.filter(function(r){ return String(r.Anulada) !== 'True'; }).map(function(r){
        return { id: String(r.ID_Comprobante), numero: String(r.Numero_Comprobante || ''), proveedor: String(r.Tercero_Proveedor || ''),
                 ref: [r.Ej, r.Subd, r.Nro].filter(Boolean).join('-'), tipo: String(r.Tipo_Comprobante || '') };
      });
    })
    .catch(function(){ return null; });
});

// La factura en Mis Comprobantes AFIP (por CUIT y número): [{id, tipo, pv, nro, neto, iva, total, tipos}] o null.
var JS_AFIP = String(function(o){
  var q = { desdeOP_FF: 'False', ID_Moneda_Origen: 0, jqGridID: 'DetalleGridMisComprobantesAfip', _search: true, page: 1, rows: 50,
            nd: Date.now(), Nro_Doc_Emisor: o.cuit, Nro_Desde: o.numero };
  return fetch('/1/Comprobantes_Compra/MisComprobantesAfipPendientesComprasLista?' + new URLSearchParams(q).toString(), { credentials: 'include' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){
      if(!j || !Array.isArray(j.rows)) return null;
      return j.rows.map(function(r){ return r.cell || r; })
        .filter(function(r){ return Number(r.Nro_Desde) === o.numero && Number(r.Punto_Venta) === o.pv && String(r.Nro_Doc_Emisor).replace(/\D/g, '') === o.cuit; })
        .map(function(r){
          return { id: String(r.ID_Mi_Comprobante_Afip), tipo: String(r.Tipo || ''), neto: r.Importe_Neto_Gravado, iva: r.Iva, total: r.Importe_Total,
                   tipos: String(r.TiposComprobanteCITI || '') };
        });
    })
    .catch(function(){ return null; });
});

/* ¿Ya está en Albor? El comprobante de compra con ese número y de ese proveedor (o null). */
async function facturaYaEnAlbor(pg, d){
  var f = fechaDeTexto(d.fecha) || new Date(), DIA = 86400000;
  var l = null;
  try{ l = await pg.evaluar(JS_COMPRAS_LISTA, { desde: diaParaAlbor(new Date(f - 90 * DIA)), hasta: diaParaAlbor(new Date(Date.now() + 3 * DIA)) }); }
  catch(e){ if(e instanceof Cortado) throw e; }
  if(!l) return { sinLista: true };
  var prov = soloLetras(d.proveedor.nombre);
  return l.filter(function(c){
    var n = numeroComprobante(c.numero);
    if(!n || n[0] !== d.puntoVenta || n[1] !== d.numero) return false;
    var p = soloLetras(c.proveedor);
    return !prov || !p || p.indexOf(prov) >= 0 || prov.indexOf(p) >= 0;
  })[0] || null;
}
function numeroComprobante(t){ var m = /(\d+)\s*-\s*(\d+)/.exec(String(t || '')); return m ? [Number(m[1]), Number(m[2])] : null; }

// El valor (o el texto elegido) de varios campos de la cabecera.
var JS_CAMPOS = String(function(ids){
  var o = {};
  ids.forEach(function(id){
    var e = document.getElementById(id);
    o[id] = !e ? null : e.tagName === 'SELECT' ? { valor: e.value, texto: e.selectedIndex >= 0 ? (e.options[e.selectedIndex].text || '').trim() : '' } : String(e.value || '').trim();
  });
  return o;
});

/* La cabecera sin AFIP: la persona eligió el tipo; la extensión pone la fecha, el número y el proveedor. */
async function cabeceraAMano(pg, d, charla){
  await pg.ir(C.BASE + URL_COMPRAS + '/Create');
  await pg.loc('#ID_Tipo_Comprobante').waitFor('visible', 40000);
  await esperar(pg, 40000);
  for(var vuelta = 1; ; vuelta++){
    await charla.pausa('La factura ' + d.letra + ' ' + d.numeroAlbor + ' de ' + (d.emisor || d.proveedor.nombre) + ' no está en «Mis Comprobantes AFIP» ' +
                       '(puede que AFIP todavía no la tenga).\n\nEn Albor, elegí el «Tipo de comprobante»: Factura ' + d.letra + ' (o B o C, si no es ' + d.letra + '). ' +
                       'Después tocá Seguir: pongo la fecha, el número y el proveedor.', 'Seguir');
    var t = (await pg.evaluar(JS_CAMPOS, ['ID_Tipo_Comprobante']))['ID_Tipo_Comprobante'] || {};
    if(t.valor && t.valor !== '2147483647') { charla.decir('Tipo de comprobante: ' + t.texto); break; }
    if(vuelta >= 3) throw new Error('No se eligió el tipo de comprobante.');
  }
  await esperar(pg, 20000);
  for(var i = 0; i < 2; i++){
    for(var id of ['#Fecha', '#Fecha_Contable']){
      try{ await escribirCampo(pg, id, d.fecha, { delay: 60 }); await pg.presionar('Tab'); await esperar(pg, 10000); }
      catch(e){ if(e instanceof Cortado) throw e; charla.decir('[!] No pude poner ' + id.slice(1) + ': ponela a mano (' + d.fecha + ').'); }
    }
  }
  try{ await escribirCampo(pg, '#Numero_Comprobante', d.numeroAlbor, { delay: 60 }); await pg.presionar('Tab'); await esperar(pg, 10000); }
  catch(e){ if(e instanceof Cortado) throw e; charla.decir('[!] No pude poner el número: ponelo a mano (' + d.numeroAlbor + ').'); }
  var prov = await proveedorDeOrden(pg, { codigo: d.proveedor.codigo, cuit: d.cuitGuiones, nombre: d.proveedor.nombre }, charla);
  return prov;
}

/* "¿Desea dar de alta automáticamente el ítem de concepto?" → Cancelar (con orden, los renglones salen de la OCNS). */
async function sinItemDeConcepto(pg, charla, limite){
  var fin = Date.now() + (limite || 12000);
  while(Date.now() < fin){
    if(await pg.loc('#btCancelarDialogoConfirmacion').isVisible()){
      await pg.loc('#btCancelarDialogoConfirmacion').click({ timeout: 5000 });
      charla.decir('«Ítem de concepto»: no (los renglones salen de la orden).');
      await pg.esperar(800);
      // Si igual se abrió la ventanita del renglón, se cierra sin agregar nada
      if(await pg.loc('#btCancelar_dialog').isVisible()) await pg.loc('#btCancelar_dialog').click({ timeout: 5000 });
      return true;
    }
    if(await pg.loc('#btCancelar_dialog').isVisible() && await pg.loc('#ID_IT_Tipo_Comprobante').isVisible()){
      await pg.loc('#btCancelar_dialog').click({ timeout: 5000 });       // ya lo aceptó Albor: se cierra el renglón de concepto
      return true;
    }
    await pg.esperar(500);
  }
  return false;
}

// Marca las filas de nuestra orden en "Vinculaciones" y pone "A vincular" = lo facturado. o = {ej, nro, items: [{texto, facturada}]}.
var JS_VINCULAR = String(function(o){
  var grilla = document.getElementById('GridVinculacionesPosibles');
  if(!grilla) return { error: 'No se abrió la ventanita de Vinculaciones.' };
  var celda = function(tr, col){
    var td = tr.querySelector('td[aria-describedby="GridVinculacionesPosibles_' + col + '"]');
    return td ? String(td.getAttribute('title') || td.textContent || '').trim() : '';
  };
  var limpio = function(t){ return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ''); };
  var num = function(t){ var s = String(t || '').trim(); if(s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.'); var n = parseFloat(s); return isNaN(n) ? 0 : n; };
  var filas = [].slice.call(grilla.querySelectorAll('tr.jqgrow')).filter(function(tr){
    return Number(celda(tr, 'Nro')) === Number(o.nro) && (!o.ej || celda(tr, 'Ej') === String(o.ej));
  });
  if(!filas.length) return { ninguna: true, hay: grilla.querySelectorAll('tr.jqgrow').length };
  var usadas = {}, out = [];
  o.items.forEach(function(it, k){
    var tr = filas.filter(function(f){ return !usadas[f.id] && limpio(celda(f, 'Detalle_OC_Detalle')) === limpio(it.texto); })[0] ||
             filas.filter(function(f){ return !usadas[f.id]; })[0];
    if(!tr) { out.push({ texto: it.texto, falta: true }); return; }
    usadas[tr.id] = true;
    var cb = tr.querySelector('input[type=checkbox]');
    if(cb && !cb.checked) cb.click();
    var inp = document.getElementById(tr.id + '_aVincular');
    var pend = num(celda(tr, 'Pendiente'));
    var quiero = Math.min(it.facturada, pend || it.facturada);
    if(inp){
      var txt = String(quiero).replace('.', ',');
      var $ = window.jQuery;
      try{ if($ && $.fn.autoNumeric && $(inp).data('autoNumeric')) $(inp).autoNumeric('set', quiero); else inp.value = txt; }catch(e){ inp.value = txt; }
      ['input', 'change', 'keyup', 'blur'].forEach(function(ev){ inp.dispatchEvent(new Event(ev, { bubbles: true })); });
    }
    out.push({ texto: it.texto, fila: tr.id, pendiente: pend, facturada: it.facturada, puesto: inp ? num(inp.value) : null, marcada: !!(cb && cb.checked) });
  });
  return { filas: out };
});

// Los renglones de la grilla de ítems: [id].
var JS_IDS_DETALLE = String(function(){
  return [].slice.call(document.querySelectorAll('#DetalleGrid tr.jqgrow')).map(function(r){ return r.id; });
});
// Elige un renglón de la grilla de ítems (jqGrid, o un clic en el Albor falso).
var JS_ELEGIR_RENGLON = String(function(id){
  var $ = window.jQuery;
  if($ && $('#DetalleGrid').jqGrid){ $('#DetalleGrid').jqGrid('setSelection', id, true); return true; }
  var r = document.getElementById(id); if(r) r.click(); return !!r;
});
// Los totales de abajo y el tipo de compra.
var JS_TOTALES_COMPRA = String(function(){
  var v = function(id){ var e = document.getElementById(id); return e ? String(e.value || '').trim() : ''; };
  var tc = document.getElementById('ID_Tipo_Compra');
  return { neto: v('Total_NG'), iva21: v('Total_IVA21'), iva105: v('Total_IVA105'), iva27: v('Total_IVA27'), total: v('Importe_Total'),
           tipoCompra: tc && tc.selectedIndex > 0 ? tc.options[tc.selectedIndex].text.trim() : '' };
});

/* El IVA de cada renglón vinculado: Modificar → IVA → Aceptar. items = los de la orden (texto → iva). */
async function ivaDeRenglones(pg, ids, d, charla){
  var hechos = 0, sinTasa = [];
  for(var i = 0; i < ids.length; i++){
    await pg.evaluar(JS_ELEGIR_RENGLON, ids[i]);
    await pg.esperar(400);
    await pg.loc('#btEdit_DetalleGrid').click({ timeout: 15000 });
    await pg.loc('#IVA').waitFor('visible', 20000);
    await esperar(pg, 15000);
    var desc = await pg.evaluar(JS_VALOR, '#Descripcion');
    var it = d.items.filter(function(x){ return soloLetras(x.texto) === soloLetras(desc); })[0] || d.items[i] || {};
    var tasa = it.iva || (d.items.length === 1 ? d.items[0].iva : null);
    if(tasa && IVA_ALBOR[tasa]){
      await elegirOpcion(pg, '#IVA', IVA_ALBOR[tasa], 'IVA', charla);
      await pg.esperar(800);
      charla.decir('   ' + (desc || 'renglón ' + (i + 1)) + ': IVA ' + String(tasa).replace('.', ',') + ' %');
      hechos++;
    } else sinTasa.push(desc || 'renglón ' + (i + 1));
    await pg.loc('#btAceptar_dialog').click({ timeout: 15000 });
    var fin = Date.now() + 15000;
    while(Date.now() < fin && await pg.loc('#IVA').isVisible()) await pg.esperar(400);
    await esperar(pg, 10000);
  }
  return { hechos: hechos, sinTasa: sinTasa };
}

/* La carga entera. d = lo que da datosFacturaAlbor. Devuelve {ok, prueba, referencia} o {ok: false, motivo, cancelado}. */
function cargar_factura(d){
  pedirPermisoAvisos();
  d = d || {};
  if(!d.numero || !d.cuit || !(d.items || []).length) return Promise.resolve({ ok: false, motivo: 'Faltan datos de la factura o de la orden.' });
  return trabajo('__alborLog', async function(){
    M.cancelar = false;
    var charla = new Charla(function(t){ anotar(t); avisar(t); }, preguntar, function(){ return M.cancelar; });
    try{
      var a = await alborConSesion(), pg = a.pg;
      await pg.ir(C.BASE + URL_COMPRAS);
      await esperar(pg, 40000);
      await cerrarAnuncios(pg);
      charla.decir('Factura ' + d.letra + ' ' + d.numeroAlbor + ' · ' + (d.emisor || d.proveedor.nombre) + ' · orden ' + d.orden.numero);
      // 1. ¿Ya está?
      var ya = await facturaYaEnAlbor(pg, d);
      if(ya && ya.id){
        charla.decir('Ya está cargada en Albor: ' + ya.ref + '.');
        await a.cerrar(); M.albor = null;
        return { ok: true, ya: true, prueba: false, referencia: ya.ref };
      }
      if(ya && ya.sinLista) charla.decir('[!] No pude mirar si ya estaba cargada: fijate en Comprobantes de Compra antes de guardar.');
      // 2. Mis Comprobantes AFIP
      var afip = null, avisos = (d.avisos || []).slice();
      try{ afip = await pg.evaluar(JS_AFIP, { cuit: d.cuit, numero: d.numero, pv: d.puntoVenta }); }catch(e){ if(e instanceof Cortado) throw e; }
      var fila = afip && afip[0];
      if(fila){
        var opciones = fila.tipos.split(',').map(function(x){ var p = x.split('|'); return { id: p[0], texto: (p[1] || '').trim() }; }).filter(function(x){ return x.id !== '0'; });
        var tipo = opciones.filter(function(x){ return x.texto.toLowerCase() === ('factura ' + d.letra).toLowerCase(); })[0] || opciones[0];
        charla.decir('Está en Mis Comprobantes AFIP: la abro como «' + (tipo ? tipo.texto : '?') + '».');
        var difs = [['neto', d.neto, fila.neto], ['IVA', d.iva, fila.iva], ['total', d.total, fila.total]].filter(function(x){
          var n = numAlbor(x[2]); return x[1] != null && n != null && Math.abs(n - x[1]) > 0.009;
        });
        difs.forEach(function(x){ avisos.push('AFIP dice ' + x[0] + ' ' + plataAlbor(numAlbor(x[2])) + ' y la factura leída ' + plataAlbor(x[1]) + '.'); });
        if(!tipo) throw new Error('Albor no ofrece ningún tipo para esta factura en Mis Comprobantes AFIP.');
        await pg.ir(C.BASE + URL_COMPRAS + '/CreateMisComprobantesAfip?idMiComprobanteAfip=' + encodeURIComponent(fila.id) + '&idTipoComprobante=' + encodeURIComponent(tipo.id));
        await pg.loc('#ID_Tercero_Proveedor_codigo').waitFor('attached', 40000);
        await esperar(pg, 40000);
      } else {
        if(afip === null) charla.decir('[!] No pude mirar Mis Comprobantes AFIP.');
        else charla.decir('No está en Mis Comprobantes AFIP.');
        await cabeceraAMano(pg, d, charla);
      }
      // 3. Sin ítem de concepto
      await sinItemDeConcepto(pg, charla, 15000);
      var cab = await pg.evaluar(JS_CAMPOS, ['Numero_Comprobante', 'ID_Tercero_Proveedor_nombre', 'Fecha']);
      charla.decir('Cabecera: N° ' + (cab.Numero_Comprobante || '?') + ' · ' + (cab.ID_Tercero_Proveedor_nombre || '¿proveedor?') + ' · ' + (cab.Fecha || ''));
      // 4. OCNS
      charla.revisar();
      charla.decir('Vinculo la orden ' + d.orden.numero + '…');
      await pg.loc('#btVinc_45').click({ timeout: 20000 });
      await pg.loc('#GridVinculacionesPosibles').waitFor('visible', 30000);
      await esperar(pg, 20000);
      await pg.esperar(800);
      var antes = (await pg.evaluar(JS_IDS_DETALLE)) || [];
      var v = await pg.evaluar(JS_VINCULAR, { ej: d.orden.ej, nro: d.orden.nro, items: d.items.map(function(i){ return { texto: i.texto, facturada: i.facturada }; }) });
      if(v.error) throw new Error(v.error);
      if(v.ninguna){
        await charla.pausa('La orden ' + d.orden.numero + ' no tiene nada pendiente para vincular' + (v.hay ? ' (hay renglones de otras órdenes)' : '') +
                           ': ¿la factura ya está cargada en Albor?\n\nFijate en Albor. Si hay que vincularla igual, hacelo a mano en la ventanita y tocá Seguir; si no, «Cancelar la carga».', 'Seguir');
      } else {
        v.filas.forEach(function(x){
          if(x.falta) avisos.push('No encontré en la orden el renglón «' + x.texto + '»: vinculalo a mano.');
          else {
            if(x.puesto !== null && Math.abs(x.puesto - x.facturada) > 0.0001) avisos.push('«' + x.texto + '»: la orden tiene pendiente ' + x.pendiente + ' y se facturó ' + x.facturada + ': quedó ' + x.puesto + ' para vincular. Revisalo.');
            if(Math.abs(x.facturada - (d.items.filter(function(i){ return i.texto === x.texto; })[0] || {}).cantidad) > 0.0001)
              avisos.push('«' + x.texto + '»: se facturó ' + x.facturada + ' (en la orden, ' + (d.items.filter(function(i){ return i.texto === x.texto; })[0] || {}).cantidad + '). Se vincula lo facturado.');
          }
        });
        charla.decir('   ' + v.filas.filter(function(x){ return !x.falta; }).length + ' renglón(es) de la orden, con lo facturado.');
        await pg.loc('#opciones-vinculacionesBtAceptar').click({ timeout: 15000 });
      }
      var fin = Date.now() + 30000, ids = [];
      while(Date.now() < fin){
        ids = ((await pg.evaluar(JS_IDS_DETALLE)) || []).filter(function(id){ return antes.indexOf(id) < 0; });
        if(ids.length) break;
        await pg.esperar(600);
      }
      if(!ids.length) throw new Error('Albor no agregó los renglones de la orden.');
      await esperar(pg, 15000);
      // 5. El IVA de cada renglón
      charla.decir('El IVA de cada renglón…');
      var iv = await ivaDeRenglones(pg, ids, d, charla);
      if(iv.sinTasa.length) avisos.push('Sin IVA elegido (la factura no lo dice): ' + iv.sinTasa.join(', ') + '. Elegilo a mano en ✏️.');
      // 6. Control y Guardar
      var t = await pg.evaluar(JS_TOTALES_COMPRA);
      var tot = numAlbor(t.total);
      if(tot != null && d.total != null && Math.abs(tot - d.total) > 0.009)
        avisos.push('Albor da total ' + plataAlbor(tot) + ' y la factura dice ' + plataAlbor(d.total) + ' (diferencia de $ ' + plataAlbor(Math.abs(tot - d.total)) + ').');
      var resumen = 'Revisá la factura en Albor antes de guardarla:\n' +
        '• Factura ' + d.letra + ' ' + d.numeroAlbor + ' · ' + (cab.ID_Tercero_Proveedor_nombre || d.proveedor.nombre) + '\n' +
        '• Orden ' + d.orden.numero + ': ' + ids.length + ' renglón(es) vinculados\n' +
        '• Neto ' + t.neto + ' · IVA ' + [t.iva105 && numAlbor(t.iva105) ? '10,5 %: ' + t.iva105 : '', t.iva21 && numAlbor(t.iva21) ? '21 %: ' + t.iva21 : '', t.iva27 && numAlbor(t.iva27) ? '27 %: ' + t.iva27 : ''].filter(String).join(' · ') +
        ' · Total ' + t.total + '\n' +
        '• Tipo de compra: ' + (t.tipoCompra || 'sin elegir') + ' (revisalo)' +
        (avisos.length ? '\n\n⚠️ ' + avisos.join('\n⚠️ ') : '');
      if(d.prueba){
        await charla.pausa(resumen + '\n\n🧪 Es una prueba: NO la guardes. Cuando termines de mirar, tocá el botón y cerrá la pestaña de Albor sin guardar.', 'Terminar sin guardar');
        return { ok: true, prueba: true, motivo: 'Prueba: se armó en Albor y no se guardó.' };
      }
      await charla.pausa(resumen + '\n\nTocá Guardar y la guardo (una sola vez).', 'Guardar');
      charla.decir('Guardando…');
      var hallada = null;
      var r = await tocarYEsperar(pg, '#btGuardar', async function(){
        var x = await facturaYaEnAlbor(pg, d);
        if(x && x.id) hallada = x;
        return !!hallada;
      }, 90000);
      if(!hallada){
        if(r.advertencia) await charla.pausa(textoAdvertencia(r.advertencia, 'guardar').replace('Si todavía no está guardado, lo guardo yo.', 'Guardala a mano.'), 'Ya está guardada');
        else await charla.pausa((r.sesion ? 'Albor cerró la sesión mientras guardaba.' : r.noToco ? 'No pude tocar Guardar.' : 'Albor no confirmó que la guardó.') +
                                '\nFijate en Albor y, si hace falta, guardala a mano. Después tocá «Ya está guardada».', 'Ya está guardada');
        hallada = await facturaYaEnAlbor(pg, d);
      }
      if(!hallada || !hallada.id) throw new Error('No encontré la factura en la lista de Comprobantes de Compra de Albor: fijate si quedó guardada.');
      charla.decir('Guardada en Albor: ' + hallada.ref + '.');
      await a.cerrar(); M.albor = null;
      avisarCompu('Listo: la factura quedó en Albor', hallada.ref, false);
      return { ok: true, prueba: false, referencia: hallada.ref };
    }catch(e){
      if(e instanceof Cancelado) return { ok: false, cancelado: true, motivo: 'Cancelaste la carga de la factura. En Albor no se guardó nada (salí de la pantalla sin guardar).' };
      anotar('ERROR: ' + String((e && e.stack) || e).slice(0, 600));
      avisarCompu('La factura no quedó cargada en Albor', motivoDe(e), false);
      return { ok: false, motivo: motivoDe(e) };
    }finally{
      M.esperando = null;
    }
  });
}

window.AlborExt = {
  buscar: buscar,
  registro: function(){ return REGISTRO.slice(); },
  avisoVisto: function(){ if(!M.esperando) sacarAviso(); },
  api: {
    bajar_existencias: bajar_existencias,
    cargar_transferencia: cargar_transferencia,
    cargar_egresos: cargar_egresos,
    cargar_orden_compra: cargar_orden_compra,          // Fase 6, Paso 5
    cargar_factura: cargar_factura,                    // Fase 6-bis, Paso 2
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
