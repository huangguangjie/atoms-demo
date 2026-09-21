/**
 * T31 预览沙箱:把模型生成的单文件 HTML 装进受控 iframe 文档。
 *
 * 威胁模型——产物是模型非确定性输出,可能包含恶意或异常代码:
 * 读取宿主 Cookie/存储、改写宿主 DOM、弹出新窗口、把用户数据外发到第三方。
 * 因此预览层做三层隔离:
 *
 * 1) iframe sandbox 不授予 `allow-same-origin`:文档落入 opaque origin,
 *    `parent.document` / `localStorage` / `document.cookie` 等跨源访问天然抛错;
 *    不授予 `allow-popups`,弹窗被浏览器拦截。
 * 2) 注入 CSP meta:默认禁止一切外部资源与外发连接(`connect-src 'none'`),
 *    只放行内联脚本/样式与图片,阻断 CDN 脚本注入与数据外泄。
 * 3) 注入守卫 shim(排在应用脚本之前):为存储/Cookie 提供内存兜底
 *    (opaque origin 下直接访问会抛 SecurityError,会让正常应用白屏),
 *    并额外拦截 `window.open` 与 target 逃逸链接。
 *
 * 产物内容不被修改(不重写用户代码),只在文档头部追加隔离层。
 */

/** iframe sandbox 令牌:无 allow-same-origin(隔离宿主)、无 allow-popups(禁弹窗) */
export const PREVIEW_SANDBOX_ATTRIBUTES = 'allow-scripts allow-forms allow-modals';

/** 预览文档 CSP:内联脚本/样式与图片可用,外部脚本、网络请求、表单外发、嵌套框架一律禁止 */
const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src * data: blob:",
  'media-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
].join('; ');

/** 守卫脚本:必须早于产物自身脚本执行,内部全程 try/catch,绝不向宿主抛错 */
const PREVIEW_GUARD_SCRIPT = `<script>
(function () {
  function memoryStorage() {
    var data = {};
    return {
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[String(k)] = String(v); },
      removeItem: function (k) { delete data[String(k)]; },
      clear: function () { data = {}; },
      key: function (i) { var keys = Object.keys(data); return i >= 0 && i < keys.length ? keys[i] : null; },
      get length() { return Object.keys(data).length; }
    };
  }
  function installStorage(name) {
    var usable = false;
    try {
      var store = window[name];
      if (store) {
        store.setItem('__atoms_probe__', '1');
        store.removeItem('__atoms_probe__');
        usable = true;
      }
    } catch (e) { usable = false; }
    if (usable) return;
    var shim = memoryStorage();
    try {
      Object.defineProperty(window, name, { configurable: true, enumerable: true, get: function () { return shim; } });
    } catch (e) { /* 极端情况下无法覆盖,交由产物自身容错 */ }
  }
  try { installStorage('localStorage'); } catch (e) {}
  try { installStorage('sessionStorage'); } catch (e) {}
  try {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: function () { return ''; },
      set: function () { /* 沙箱内 Cookie 写入被丢弃 */ }
    });
  } catch (e) {}
  try {
    window.open = function () {
      try { console.warn('[atoms-preview] window.open 已被预览沙箱拦截'); } catch (e) {}
      return null;
    };
  } catch (e) {}
  try {
    document.addEventListener('click', function (event) {
      var node = event.target;
      while (node && node !== document) {
        if (node.tagName === 'A') {
          var target = node.getAttribute('target');
          if (target && target !== '_self' && target !== '_blank') { event.preventDefault(); return; }
        }
        node = node.parentNode;
      }
    }, true);
  } catch (e) {}
})();
</script>`;

/** 隔离层标记:走查脚本据此断言预览文档确实经过沙箱包装 */
export const PREVIEW_SANDBOX_MARKER = 'atoms-preview-sandbox-v1';

function isolationHead(): string {
  return `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`
    + `<meta name="atoms-preview-sandbox" content="${PREVIEW_SANDBOX_MARKER}">`
    + PREVIEW_GUARD_SCRIPT;
}

/**
 * 把产物 HTML 包装为沙箱预览文档:隔离层插到 `<head>` 最前(必须早于产物脚本)。
 * 产物缺少 head/html 标签时按序降级补齐,保证隔离层始终生效。
 */
export function buildSandboxedPreview(html: string): string {
  const source = typeof html === 'string' ? html : '';
  const head = isolationHead();
  const headMatch = source.match(/<head[^>]*>/i);
  if (headMatch && headMatch.index !== undefined) {
    const at = headMatch.index + headMatch[0].length;
    return `${source.slice(0, at)}${head}${source.slice(at)}`;
  }
  const htmlMatch = source.match(/<html[^>]*>/i);
  if (htmlMatch && htmlMatch.index !== undefined) {
    const at = htmlMatch.index + htmlMatch[0].length;
    return `${source.slice(0, at)}<head>${head}</head>${source.slice(at)}`;
  }
  return `<head>${head}</head>${source}`;
}
