/* 共享：把 index.html 的脚本放进一个最小假 DOM 里执行 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fakeCtx() {
  const noop = () => {};
  const o = {
    canvas: { width: 1280, height: 704 },
    fillRect: noop, strokeRect: noop, clearRect: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, arc: noop, ellipse: noop, fill: noop, stroke: noop,
    fillText: noop, save: noop, restore: noop, translate: noop, rotate: noop,
    measureText: () => ({ width: 10 }), createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    setTransform: noop, clip: noop, rect: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
  };
  return new Proxy(o, {
    get(t, k) { if (k in t) return t[k]; return noop; },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function fakeEl(init) {
  const store = Object.assign({}, init);
  const callable = function () { return fakeEl(); };
  return new Proxy(callable, {
    get(t, k) {
      if (k === 'width') return store.width !== undefined ? store.width : 100;
      if (k === 'height') return store.height !== undefined ? store.height : 100;
      if (k === 'value') return store.value !== undefined ? store.value : '';
      if (k === 'textContent' || k === 'innerHTML' || k === 'className') return store[k] !== undefined ? store[k] : '';
      if (k === 'dataset') return store.dataset || (store.dataset = {});
      if (k === 'style') return store.style || (store.style = {});
      if (k === 'classList') return store.classList || (store.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } });
      if (k === 'getContext') return () => fakeCtx();
      if (k === 'getBoundingClientRect') return () => ({ left: 0, top: 0, width: 800, height: 440 });
      if (k === 'addEventListener') return () => {};
      if (k === 'setPointerCapture') return () => {};
      if (k === 'toString' || k === Symbol.toPrimitive) return () => '';
      if (k in store) return store[k];
      return callable;
    },
    set(t, k, v) { store[k] = v; return true; },
  });
}
const gameCanvas = fakeEl({ width: 1280, height: 704 });
const editorCanvas = fakeEl({ width: 800, height: 440 });

const document = {
  body: fakeEl(),
  querySelector(sel) {
    if (sel === '#game') return gameCanvas;
    if (sel === '#editor') return editorCanvas;
    return fakeEl();
  },
  querySelectorAll() { return []; },
  createElement() { return fakeEl(); },
  addEventListener() {},
};
const window = { addEventListener() {} };

const sandbox = {
  document, window, console, performance,
  requestAnimationFrame: () => 0,
  Math, Date, JSON, Object, Array, Uint8Array, Int32Array, Float32Array,
  Symbol, Number, String, Boolean, isNaN, parseInt, parseFloat, Infinity, NaN,
  /* 地图保存 / 导出用到的浏览器 API。
     缺了它们会让「保存地图」在无头测试里静默失败（返回 undefined），
     排查起来很费劲 —— 所以宁可给出可用的替身。 */
  setTimeout: (fn) => { try { fn(); } catch (e) {} return 0; },
  clearTimeout: () => {},
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  Blob: function (parts) { this.parts = parts; },
  URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
  FileReader: function () {
    this.readAsText = function () {};
  },
  /* localStorage 替身：真实浏览器里由宿主提供，测试里用内存模拟 */
  localStorage: (function () {
    const m = {};
    return {
      getItem: (k) => (k in m ? m[k] : null),
      setItem: (k, v) => { m[k] = String(v); },
      removeItem: (k) => { delete m[k]; },
      clear: () => { for (const k in m) delete m[k]; },
    };
  })(),
};
sandbox.globalThis = sandbox;

function load() {
  const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const code = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'game.js' });
  return sandbox.window.QB;
}

module.exports = { sandbox, load, fakeEl };
