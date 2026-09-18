/**
 * 演示模式应用生成器。
 * 根据用户提示词与主题,生成可运行的单文件 HTML 应用(Supabase 未连接时的端到端兜底)。
 * 生成的应用均为真实可交互代码,通过 iframe srcDoc 实时预览。
 */

export type DemoAppKind = 'reading' | 'todo' | 'calculator' | 'dashboard' | 'landing' | 'notes';

export interface DemoFile {
  name: string;
  content: string;
  language: string;
}

export interface DemoApp {
  title: string;
  kind: DemoAppKind;
  files: DemoFile[];
}

/** 主题色板:输入区选择的生成主题映射为具体配色 */
export interface Palette {
  primary: string;
  primarySoft: string;
  accent: string;
  bg: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  dark: boolean;
}

export function themeToPalette(theme: string): Palette {
  switch (theme) {
    case 'Aurora':
      return { primary: '#6366f1', primarySoft: '#eef2ff', accent: '#22d3ee', bg: '#f8fafc', card: '#ffffff', text: '#0f172a', muted: '#64748b', border: '#e2e8f0', dark: false };
    case '紫罗兰':
      return { primary: '#a855f7', primarySoft: '#faf5ff', accent: '#d946ef', bg: '#fafaff', card: '#ffffff', text: '#1e1b2e', muted: '#6b7280', border: '#e9e4f5', dark: false };
    case '森林':
      return { primary: '#059669', primarySoft: '#ecfdf5', accent: '#34d399', bg: '#f7faf8', card: '#ffffff', text: '#12241c', muted: '#5f7268', border: '#dbe7e0', dark: false };
    case '海洋':
      return { primary: '#0284c7', primarySoft: '#f0f9ff', accent: '#06b6d4', bg: '#f7fbfe', card: '#ffffff', text: '#0c2233', muted: '#5c7488', border: '#dcebf5', dark: false };
    case '暗夜':
      return { primary: '#f59e0b', primarySoft: '#451a03', accent: '#fbbf24', bg: '#0f172a', card: '#1e293b', text: '#f1f5f9', muted: '#94a3b8', border: '#334155', dark: true };
    default:
      return { primary: '#7c3aed', primarySoft: '#f5f3ff', accent: '#c084fc', bg: '#fafafc', card: '#ffffff', text: '#1c1626', muted: '#6b7280', border: '#e8e4f0', dark: false };
  }
}

/** 从提示词推断生成的应用类型 */
export function pickDemoAppKind(prompt: string): DemoAppKind {
  const p = prompt.toLowerCase();
  if (/阅读|书|reading|book|进度/.test(p)) return 'reading';
  if (/计算|calc/.test(p)) return 'calculator';
  if (/待办|清单|任务|todo|task/.test(p)) return 'todo';
  if (/看板|仪表|统计|分析|dashboard|数据/.test(p)) return 'dashboard';
  if (/落地页|官网|宣传|landing|产品页|主页/.test(p)) return 'landing';
  return 'notes';
}

/** 从提示词提炼应用标题 */
export function pickAppTitle(prompt: string): string {
  const cleaned = prompt
    .replace(/^(帮我|请|给我|我想|我想要|来|帮忙)?(做|制作|创建|生成|开发|搭建|写)?(一个|一款|个)?/g, '')
    .replace(/[。.!!,,?？]/g, '')
    .trim();
  if (!cleaned) return '我的应用';
  return cleaned.length > 14 ? cleaned.slice(0, 14) : cleaned;
}

// ---------------------------------------------------------------------------
// 公共 HTML 外壳与基础样式
// ---------------------------------------------------------------------------

function baseCss(pal: Palette): string {
  return ':root{--primary:' + pal.primary + ';--primary-soft:' + pal.primarySoft + ';--accent:' + pal.accent + ';--bg:' + pal.bg + ';--card:' + pal.card + ';--text:' + pal.text + ';--muted:' + pal.muted + ';--border:' + pal.border + ';}' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{background:var(--bg);color:var(--text);font-family:"PingFang SC","Microsoft YaHei",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}' +
    'button{font-family:inherit;cursor:pointer;border:none;background:none}' +
    'input,textarea,select{font-family:inherit;color:inherit}' +
    '.card{background:var(--card);border:1px solid var(--border);border-radius:14px}' +
    '.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:var(--primary);color:#fff;border-radius:10px;padding:9px 16px;font-size:14px;font-weight:600;transition:filter .15s}' +
    '.btn:hover{filter:brightness(1.08)}' +
    '.btn-ghost{background:transparent;color:var(--muted);border:1px solid var(--border)}' +
    '.btn-ghost:hover{color:var(--text);filter:none;background:var(--primary-soft)}';
}

function htmlShell(title: string, pal: Palette, body: string, script: string): string {
  return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n<title>' + title + '</title>\n<style>\n' + baseCss(pal) + '\n</style>\n</head>\n<body>\n' + body + '\n<script>\n' + script + '\n</script>\n</body>\n</html>';
}

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

// ---------------------------------------------------------------------------
// 阅读进度小站
// ---------------------------------------------------------------------------

function buildReading(pal: Palette, title: string): string {
  const body =
    '<main class="wrap">' +
    '<header class="head"><div><h1>' + esc(title) + '</h1><p class="sub">记录每一本书的阅读足迹</p></div>' +
    '<div class="stat card"><span class="stat-num" id="overall">0%</span><span class="stat-label">总阅读进度</span></div></header>' +
    '<form id="addForm" class="card add"><input id="bookTitle" placeholder="书名,如:三体" required /><input id="bookTotal" type="number" min="1" value="200" title="总页数" /><button class="btn" type="submit">加入书单</button></form>' +
    '<section id="list" class="list"></section></main>' +
    '<style>.wrap{max-width:720px;margin:0 auto;padding:32px 20px 48px}.head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}h1{font-size:26px}.sub{color:var(--muted);font-size:13px;margin-top:4px}.stat{text-align:center;padding:12px 20px}.stat-num{display:block;font-size:24px;font-weight:700;color:var(--primary)}.stat-label{font-size:12px;color:var(--muted)}.add{display:flex;gap:10px;padding:14px;margin-bottom:18px}.add input{flex:1;border:1px solid var(--border);border-radius:10px;padding:9px 12px;font-size:14px;background:var(--bg);outline:none}.add input:focus{border-color:var(--primary)}.add input[type=number]{flex:0 0 110px}.list{display:flex;flex-direction:column;gap:14px}.book{padding:16px 18px}.book-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.book h3{font-size:16px}.del{color:var(--muted);font-size:13px}.del:hover{color:#ef4444}.pages{font-size:12px;color:var(--muted);margin-top:4px}.bar{height:8px;border-radius:99px;background:var(--primary-soft);margin-top:12px;overflow:hidden}.bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--primary),var(--accent));transition:width .25s}.row{display:flex;align-items:center;gap:10px;margin-top:12px}.row input[type=range]{flex:1;accent-color:var(--primary)}.pct{font-size:13px;font-weight:600;color:var(--primary);min-width:44px;text-align:right}.empty{padding:40px;text-align:center;color:var(--muted);font-size:14px}</style>';

  const script =
    "var KEY='atoms_reading_books';\n" +
    "var books=[{title:'三体',total:302,current:168},{title:'人类简史',total:440,current:56}];\n" +
    "try{var saved=JSON.parse(localStorage.getItem(KEY)||'null');if(Array.isArray(saved)&&saved.length)books=saved;}catch(e){}\n" +
    "function persist(){try{localStorage.setItem(KEY,JSON.stringify(books));}catch(e){}}\n" +
    "function esc(s){return String(s).replace(/[&<>\\\"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c];});}\n" +
    "var list=document.getElementById('list');\n" +
    "function render(){\n" +
    "  if(!books.length){list.innerHTML='<div class=\"card empty\">书单还是空的,先加一本想读的书吧。</div>';document.getElementById('overall').textContent='0%';return;}\n" +
    "  var html='';\n" +
    "  books.forEach(function(b,i){\n" +
    "    var pct=Math.min(100,Math.round(b.current/b.total*100));\n" +
    "    html+='<article class=\"card book\"><div class=\"book-top\"><div><h3>'+esc(b.title)+'</h3><div class=\"pages\">第 '+b.current+' 页 / 共 '+b.total+' 页</div></div><button class=\"del\" data-del=\"'+i+'\">删除</button></div>';\n" +
    "    html+='<div class=\"bar\"><i style=\"width:'+pct+'%\"></i></div>';\n" +
    "    html+='<div class=\"row\"><input type=\"range\" min=\"0\" max=\"'+b.total+'\" value=\"'+b.current+'\" data-range=\"'+i+'\" /><span class=\"pct\">'+pct+'%</span></div></article>';\n" +
    "  });\n" +
    "  list.innerHTML=html;\n" +
    "  var sum=books.reduce(function(a,b){return a+b.current/b.total;},0);\n" +
    "  document.getElementById('overall').textContent=Math.round(sum/books.length*100)+'%';\n" +
    "}\n" +
    "document.getElementById('addForm').addEventListener('submit',function(ev){\n" +
    "  ev.preventDefault();\n" +
    "  var t=document.getElementById('bookTitle').value.trim();\n" +
    "  var total=parseInt(document.getElementById('bookTotal').value,10)||200;\n" +
    "  if(!t)return;\n" +
    "  books.unshift({title:t,total:Math.max(1,total),current:0});\n" +
    "  document.getElementById('bookTitle').value='';\n" +
    "  persist();render();\n" +
    "});\n" +
    "list.addEventListener('input',function(ev){\n" +
    "  var i=ev.target.getAttribute&&ev.target.getAttribute('data-range');\n" +
    "  if(i===null||i===undefined)return;\n" +
    "  books[+i].current=+ev.target.value;\n" +
    "  var b=books[+i];var card=ev.target.closest('.book');\n" +
    "  var pct=Math.min(100,Math.round(b.current/b.total*100));\n" +
    "  card.querySelector('.pages').textContent='第 '+b.current+' 页 / 共 '+b.total+' 页';\n" +
    "  card.querySelector('.bar i').style.width=pct+'%';\n" +
    "  card.querySelector('.pct').textContent=pct+'%';\n" +
    "  var sum=books.reduce(function(a,x){return a+x.current/x.total;},0);\n" +
    "  document.getElementById('overall').textContent=Math.round(sum/books.length*100)+'%';\n" +
    "  persist();\n" +
    "});\n" +
    "list.addEventListener('click',function(ev){\n" +
    "  var i=ev.target.getAttribute&&ev.target.getAttribute('data-del');\n" +
    "  if(i===null||i===undefined)return;\n" +
    "  books.splice(+i,1);persist();render();\n" +
    "});\n" +
    "render();";

  return htmlShell(title, pal, body, script);
}

// ---------------------------------------------------------------------------
// 待办清单
// ---------------------------------------------------------------------------

function buildTodo(pal: Palette, title: string): string {
  const body =
    '<main class="wrap"><h1>' + esc(title) + '</h1><p class="sub" id="stat"></p>' +
    '<form id="addForm" class="card add"><input id="todoInput" placeholder="今天要做点什么?" required autocomplete="off" /><button class="btn" type="submit">添加</button></form>' +
    '<div class="filters" id="filters"><button class="chip active" data-f="all">全部</button><button class="chip" data-f="active">进行中</button><button class="chip" data-f="done">已完成</button><button class="chip danger" id="clearDone">清除已完成</button></div>' +
    '<section id="list" class="list"></section></main>' +
    '<style>.wrap{max-width:560px;margin:0 auto;padding:40px 20px}h1{font-size:26px}.sub{color:var(--muted);font-size:13px;margin:6px 0 20px}.add{display:flex;gap:10px;padding:12px;margin-bottom:14px}.add input{flex:1;border:none;outline:none;font-size:15px;background:transparent}.filters{display:flex;gap:8px;margin-bottom:14px}.chip{font-size:12px;padding:6px 12px;border-radius:99px;border:1px solid var(--border);color:var(--muted)}.chip.active{background:var(--primary);border-color:var(--primary);color:#fff}.chip.danger{margin-left:auto}.chip.danger:hover{border-color:#ef4444;color:#ef4444}.item{display:flex;align-items:center;gap:12px;padding:13px 16px;margin-bottom:10px;animation:pop .2s}.item input[type=checkbox]{width:18px;height:18px;accent-color:var(--primary)}.item span{flex:1;font-size:14px}.item.done span{text-decoration:line-through;color:var(--muted)}.del{color:var(--muted);font-size:16px;line-height:1}.del:hover{color:#ef4444}@keyframes pop{from{opacity:0;transform:translateY(4px)}}.empty{padding:36px;text-align:center;color:var(--muted);font-size:14px}</style>';

  const script =
    "var KEY='atoms_todo_items';\n" +
    "var items=[{text:'逛一逛 Atoms 资源页',done:false},{text:'用智能体生成第一个应用',done:true}];\n" +
    "try{var saved=JSON.parse(localStorage.getItem(KEY)||'null');if(Array.isArray(saved))items=saved;}catch(e){}\n" +
    "function persist(){try{localStorage.setItem(KEY,JSON.stringify(items));}catch(e){}}\n" +
    "function esc(s){return String(s).replace(/[&<>\\\"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c];});}\n" +
    "var filter='all';var list=document.getElementById('list');\n" +
    "function render(){\n" +
    "  var shown=items.filter(function(it){return filter==='all'||(filter==='done'?it.done:!it.done);});\n" +
    "  if(!shown.length){list.innerHTML='<div class=\"card empty\">这里空空如也。</div>';}\n" +
    "  else{list.innerHTML=shown.map(function(it){\n" +
    "    return '<div class=\"card item '+(it.done?'done':'')+'\"><input type=\"checkbox\" '+(it.done?'checked':'')+' data-check=\"'+it.id+'\"/><span>'+esc(it.text)+'</span><button class=\"del\" data-del=\"'+it.id+'\">×</button></div>';\n" +
    "  }).join('');}\n" +
    "  var left=items.filter(function(it){return !it.done;}).length;\n" +
    "  document.getElementById('stat').textContent='共 '+items.length+' 项,还剩 '+left+' 项待完成';\n" +
    "}\n" +
    "document.getElementById('addForm').addEventListener('submit',function(ev){\n" +
    "  ev.preventDefault();var input=document.getElementById('todoInput');\n" +
    "  var t=input.value.trim();if(!t)return;\n" +
    "  items.unshift({id:Date.now(),text:t,done:false});input.value='';persist();render();\n" +
    "});\n" +
    "list.addEventListener('change',function(ev){\n" +
    "  var id=ev.target.getAttribute&&ev.target.getAttribute('data-check');if(!id)return;\n" +
    "  items.forEach(function(it){if(String(it.id)===String(id))it.done=ev.target.checked;});persist();render();\n" +
    "});\n" +
    "list.addEventListener('click',function(ev){\n" +
    "  var id=ev.target.getAttribute&&ev.target.getAttribute('data-del');if(!id)return;\n" +
    "  items=items.filter(function(it){return String(it.id)!==String(id);});persist();render();\n" +
    "});\n" +
    "document.getElementById('filters').addEventListener('click',function(ev){\n" +
    "  var f=ev.target.getAttribute&&ev.target.getAttribute('data-f');\n" +
    "  if(f){filter=f;document.querySelectorAll('.chip').forEach(function(c){c.classList.remove('active');});ev.target.classList.add('active');render();}\n" +
    "  if(ev.target.id==='clearDone'){items=items.filter(function(it){return !it.done;});persist();render();}\n" +
    "});\n" +
    "render();";

  return htmlShell(title, pal, body, script);
}

// ---------------------------------------------------------------------------
// 计算器
// ---------------------------------------------------------------------------

function buildCalculator(pal: Palette, title: string): string {
  const body =
    '<main class="wrap"><h1>' + esc(title) + '</h1>' +
    '<div class="card calc"><div class="screen"><div class="expr" id="expr">0</div><div class="result" id="result">0</div></div>' +
    '<div class="keys" id="keys"></div></div><div class="card history"><h2>历史记录</h2><ul id="history"></ul></div></main>' +
    '<style>.wrap{max-width:420px;margin:0 auto;padding:36px 20px}h1{font-size:24px;text-align:center;margin-bottom:20px}.calc{padding:16px}.screen{background:var(--primary-soft);border-radius:12px;padding:16px;text-align:right;margin-bottom:14px}.expr{font-size:14px;color:var(--muted);min-height:20px;word-break:break-all}.result{font-size:32px;font-weight:700;color:var(--primary);margin-top:4px}.keys{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.keys button{padding:16px 0;border-radius:12px;font-size:17px;font-weight:600;background:var(--bg);border:1px solid var(--border);transition:transform .06s}.keys button:active{transform:scale(.95)}.keys .op{color:var(--primary);border-color:var(--primary-soft);background:var(--primary-soft)}.keys .eq{background:var(--primary);color:#fff;border-color:var(--primary)}.keys .fn{color:#ef4444}.history{margin-top:16px;padding:14px 16px}.history h2{font-size:13px;color:var(--muted);margin-bottom:8px}.history li{list-style:none;font-size:13px;padding:6px 0;border-bottom:1px dashed var(--border);color:var(--muted);display:flex;justify-content:space-between}.history b{color:var(--text);font-weight:600}</style>';

  const script =
    "var KEYS=['C','(',')','÷','7','8','9','×','4','5','6','−','1','2','3','+','±','0','.','='];\n" +
    "var keysEl=document.getElementById('keys');\n" +
    "keysEl.innerHTML=KEYS.map(function(k){\n" +
    "  var cls='';if('÷×−+'.indexOf(k)>=0)cls='op';if(k==='=')cls='eq';if(k==='C')cls='fn';\n" +
    "  return '<button data-key=\"'+k+'\" class=\"'+cls+'\">'+k+'</button>';\n" +
    "}).join('');\n" +
    "var expr='';var hist=[];\n" +
    "function compute(e){\n" +
    "  var js=e.replace(/÷/g,'/').replace(/×/g,'*').replace(/−/g,'-').replace(/%/g,'/100');\n" +
    "  if(!/^[0-9+\\-*/.() ]+$/.test(js))return null;\n" +
    "  try{return Function('return ('+js+')')();}catch(err){return null;}\n" +
    "}\n" +
    "function render(){\n" +
    "  document.getElementById('expr').textContent=expr||'0';\n" +
    "  var v=compute(expr);\n" +
    "  document.getElementById('result').textContent=(expr&&v!==null&&!isNaN(v))?(Math.round(v*1e10)/1e10):'…';\n" +
    "}\n" +
    "function press(k){\n" +
    "  if(k==='C'){expr='';}\n" +
    "  else if(k==='±'){expr=expr.startsWith('-')?expr.slice(1):'-'+expr;}\n" +
    "  else if(k==='='){\n" +
    "    var v=compute(expr);\n" +
    "    if(v===null||isNaN(v))return;\n" +
    "    hist.unshift({e:expr,r:Math.round(v*1e10)/1e10});hist=hist.slice(0,5);\n" +
    "    document.getElementById('history').innerHTML=hist.map(function(h){return '<li><span>'+h.e+'</span><b>= '+h.r+'</b></li>';}).join('');\n" +
    "    expr=String(Math.round(v*1e10)/1e10);\n" +
    "  }\n" +
    "  else{expr+=k;}\n" +
    "  render();\n" +
    "}\n" +
    "keysEl.addEventListener('click',function(ev){var k=ev.target.getAttribute&&ev.target.getAttribute('data-key');if(k)press(k);});\n" +
    "document.addEventListener('keydown',function(ev){\n" +
    "  var k=ev.key;\n" +
    "  if(/[0-9.()+%]/.test(k)&&k.length===1)press(k);\n" +
    "  else if(k==='Enter')press('=');else if(k==='Backspace')expr=expr.slice(0,-1),render();\n" +
    "  else if(k==='Escape')press('C');else if(k==='*')press('×');else if(k==='/')press('÷');else if(k==='-')press('−');\n" +
    "});\n" +
    "render();";

  return htmlShell(title, pal, body, script);
}

// ---------------------------------------------------------------------------
// 数据看板
// ---------------------------------------------------------------------------

function buildDashboard(pal: Palette, title: string): string {
  const body =
    '<main class="wrap"><header class="head"><h1>' + esc(title) + '</h1><span class="range">近 30 天</span></header>' +
    '<section class="kpis" id="kpis"></section>' +
    '<section class="card chart-card"><h2>收入趋势</h2><svg id="line" viewBox="0 0 560 200" preserveAspectRatio="none"></svg></section>' +
    '<section class="card chart-card"><h2>渠道转化</h2><div id="bars"></div></section>' +
    '<section class="card table-card"><h2>最近订单</h2><table><thead><tr><th>订单号</th><th>客户</th><th>金额</th><th>状态</th></tr></thead><tbody id="orders"></tbody></table></section></main>' +
    '<style>.wrap{max-width:960px;margin:0 auto;padding:32px 20px 48px}.head{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}h1{font-size:24px}.range{font-size:12px;color:var(--muted);border:1px solid var(--border);padding:5px 12px;border-radius:99px}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:18px}.kpi{padding:16px 18px}.kpi .label{font-size:12px;color:var(--muted)}.kpi .num{font-size:24px;font-weight:700;margin-top:6px}.kpi .delta{font-size:12px;margin-top:4px}.up{color:#10b981}.down{color:#ef4444}.chart-card{padding:18px;margin-bottom:18px}.chart-card h2,.table-card h2{font-size:14px;margin-bottom:12px;color:var(--muted);font-weight:600}svg{width:100%;height:200px}.bar-row{display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:13px}.bar-row .name{width:72px;color:var(--muted)}.bar-row .track{flex:1;height:10px;background:var(--primary-soft);border-radius:99px;overflow:hidden}.bar-row .track i{display:block;height:100%;background:linear-gradient(90deg,var(--primary),var(--accent));border-radius:99px}.bar-row .val{width:48px;text-align:right;font-weight:600}.table-card{padding:18px}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;color:var(--muted);font-weight:600;padding:8px 6px;border-bottom:1px solid var(--border)}td{padding:10px 6px;border-bottom:1px solid var(--border)}.tag{font-size:11px;padding:3px 10px;border-radius:99px;background:var(--primary-soft);color:var(--primary);font-weight:600}.tag.ok{background:#ecfdf5;color:#059669}</style>';

  const script =
    "var kpis=[{label:'总收入',num:'¥ 128,460',delta:'+12.4%',up:true},{label:'新增用户',num:'3,208',delta:'+8.1%',up:true},{label:'转化率',num:'4.6%',delta:'-0.8%',up:false},{label:'订单数',num:'946',delta:'+3.2%',up:true}];\n" +
    "document.getElementById('kpis').innerHTML=kpis.map(function(k){\n" +
    "  return '<div class=\"card kpi\"><div class=\"label\">'+k.label+'</div><div class=\"num\">'+k.num+'</div><div class=\"delta '+(k.up?'up':'down')+'\">'+(k.up?'▲ ':'▼ ')+k.delta+' vs 上期</div></div>';\n" +
    "}).join('');\n" +
    "var data=[42,58,50,66,60,74,68,86,80,92,88,104];\n" +
    "var w=560,h=200,max=Math.max.apply(null,data)*1.15;\n" +
    "var pts=data.map(function(v,i){return [i*(w/(data.length-1)),h-(v/max)*h];});\n" +
    "var path=pts.map(function(pt){return pt[0].toFixed(1)+','+pt[1].toFixed(1);}).join(' ');\n" +
    "var area=path+' '+w+','+h+' 0,'+h;\n" +
    "document.getElementById('line').innerHTML=\n" +
    "  '<defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\""+'var(--primary)'+"\" stop-opacity=\".25\"/><stop offset=\"1\" stop-color=\""+'var(--primary)'+"\" stop-opacity=\"0\"/></linearGradient></defs>'+\n" +
    "  '<polygon points=\"'+area+'\" fill=\"url(#g)\"/>'+\n" +
    "  '<polyline points=\"'+path+'\" fill=\"none\" stroke=\""+'var(--primary)'+"\" stroke-width=\"2.5\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>'+\n" +
    "  pts.map(function(pt){return '<circle cx=\"'+pt[0]+'\" cy=\"'+pt[1]+'\" r=\"3\" fill=\""+'var(--card)'+"\" stroke=\""+'var(--primary)'+"\" stroke-width=\"2\"/>';}).join('');\n" +
    "var channels=[{name:'自然流量',v:86},{name:'社交媒体',v:64},{name:'邮件营销',v:48},{name:'付费广告',v:31}];\n" +
    "document.getElementById('bars').innerHTML=channels.map(function(c){\n" +
    "  return '<div class=\"bar-row\"><span class=\"name\">'+c.name+'</span><div class=\"track\"><i style=\"width:'+c.v+'%\"></i></div><span class=\"val\">'+c.v+'%</span></div>';\n" +
    "}).join('');\n" +
    "var orders=[['#2026-0918','林晓','¥ 1,299','已完成'],['#2026-0917','陈默','¥ 899','配送中'],['#2026-0916','王一诺','¥ 2,480','已完成'],['#2026-0915','赵辰','¥ 459','已退款'],['#2026-0914','苏芮','¥ 1,680','已完成']];\n" +
    "document.getElementById('orders').innerHTML=orders.map(function(o){\n" +
    "  var cls=o[3]==='已完成'?'tag ok':'tag';\n" +
    "  return '<tr><td>'+o[0]+'</td><td>'+o[1]+'</td><td>'+o[2]+'</td><td><span class=\"'+cls+'\">'+o[3]+'</span></td></tr>';\n" +
    "}).join('');";

  return htmlShell(title, pal, body, script);
}

// ---------------------------------------------------------------------------
// 产品落地页
// ---------------------------------------------------------------------------

function buildLanding(pal: Palette, title: string): string {
  const body =
    '<nav><div class="logo">◆ ' + esc(title) + '</div><div class="links"><a href="#feat">功能</a><a href="#price">定价</a><a href="#faq">FAQ</a></div><button class="btn">免费开始</button></nav>' +
    '<header class="hero"><div class="glow"></div><h1>让团队协作<br />快人一步</h1><p>' + esc(title) + ' 帮你把想法变成可执行的任务流,实时同步、自动提醒,团队效率提升 3 倍。</p>' +
    '<div class="cta"><button class="btn">立即体验</button><button class="btn btn-ghost">观看演示</button></div>' +
    '<div class="stats"><div><b>12k+</b><span>活跃团队</span></div><div><b>98%</b><span>好评率</span></div><div><b>40%</b><span>效率提升</span></div></div></header>' +
    '<section id="feat" class="feats"><h2>核心功能</h2><div class="grid"><div class="card feat"><div class="ico">⚡</div><h3>极速任务流</h3><p>拖拽即可编排任务,状态自动流转,减少 80% 沟通成本。</p></div><div class="card feat"><div class="ico">🔔</div><h3>智能提醒</h3><p>按优先级与截止时间自动提醒,重要事项不再遗漏。</p></div><div class="card feat"><div class="ico">📊</div><h3>数据洞察</h3><p>团队效率可视化,瓶颈一目了然,持续优化交付节奏。</p></div></div></section>' +
    '<section id="price" class="price"><h2>选择适合你的方案</h2><div class="grid"><div class="card plan"><h3>入门版</h3><div class="amount">¥0<span>/月</span></div><ul><li>最多 3 人协作</li><li>基础任务管理</li><li>社区支持</li></ul><button class="btn btn-ghost">免费使用</button></div>' +
    '<div class="card plan hot"><span class="badge">最受欢迎</span><h3>专业版</h3><div class="amount">¥68<span>/人/月</span></div><ul><li>不限成员</li><li>自动化工作流</li><li>数据看板</li><li>优先支持</li></ul><button class="btn">开始 14 天试用</button></div>' +
    '<div class="card plan"><h3>企业版</h3><div class="amount">定制</div><ul><li>私有化部署</li><li>SSO 与审计</li><li>专属客户成功</li></ul><button class="btn btn-ghost">联系销售</button></div></div></section>' +
    '<section id="faq" class="faq"><h2>常见问题</h2>' +
    '<details class="card"><summary>可以随时取消订阅吗?</summary><p>可以,订阅按月计费,随时可取消,取消后服务将持续到当前计费周期结束。</p></details>' +
    '<details class="card"><summary>支持哪些平台?</summary><p>支持网页端、Windows、macOS 客户端,以及 iOS 与 Android 移动端,数据实时同步。</p></details>' +
    '<details class="card"><summary>如何保障数据安全?</summary><p>全链路 TLS 加密传输,静态数据 AES-256 加密存储,支持 SSO 与细粒度权限控制。</p></details></section>' +
    '<footer>© 2026 ' + esc(title) + ' · 让协作更简单</footer>' +
    '<style>nav{display:flex;align-items:center;gap:24px;max-width:1020px;margin:0 auto;padding:18px 20px;position:sticky;top:0;z-index:9;backdrop-filter:blur(10px)}.logo{font-weight:700;font-size:16px}.links{display:flex;gap:18px;margin-left:auto}.links a{color:var(--muted);text-decoration:none;font-size:14px}.links a:hover{color:var(--text)}.hero{position:relative;text-align:center;padding:80px 20px 60px;overflow:hidden}.glow{position:absolute;inset:auto;left:50%;top:-120px;transform:translateX(-50%);width:640px;height:360px;background:radial-gradient(closest-side,var(--primary-soft),transparent);filter:blur(10px);z-index:-1}.hero h1{font-size:44px;line-height:1.2;letter-spacing:-.5px}.hero p{color:var(--muted);max-width:520px;margin:18px auto 0;font-size:15px;line-height:1.7}.cta{display:flex;gap:12px;justify-content:center;margin-top:28px}.stats{display:flex;gap:48px;justify-content:center;margin-top:48px}.stats b{display:block;font-size:22px;color:var(--primary)}.stats span{font-size:12px;color:var(--muted)}section{max-width:1020px;margin:0 auto;padding:48px 20px}h2{text-align:center;font-size:24px;margin-bottom:28px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.feat{padding:24px}.ico{font-size:26px}.feat h3{margin:10px 0 6px;font-size:16px}.feat p{color:var(--muted);font-size:13.5px;line-height:1.7}.plan{padding:24px;text-align:center;position:relative}.plan.hot{border-color:var(--primary);box-shadow:0 8px 30px -12px var(--primary)}.badge{position:absolute;top:-11px;left:50%;transform:translateX(-50%);background:var(--primary);color:#fff;font-size:11px;padding:3px 12px;border-radius:99px}.amount{font-size:30px;font-weight:700;margin:12px 0}.amount span{font-size:12px;color:var(--muted);font-weight:400}.plan ul{list-style:none;margin:0 0 18px;color:var(--muted);font-size:13px;line-height:2}.plan .btn{width:100%}.faq{max-width:680px}.faq details{padding:16px 18px;margin-bottom:10px}.faq summary{font-weight:600;font-size:14px;cursor:pointer}.faq p{color:var(--muted);font-size:13px;line-height:1.8;margin-top:10px}footer{text-align:center;color:var(--muted);font-size:12px;padding:28px;border-top:1px solid var(--border)}</style>';

  return htmlShell(title, pal, body, '');
}

// ---------------------------------------------------------------------------
// 通用笔记应用
// ---------------------------------------------------------------------------

function buildNotes(pal: Palette, title: string): string {
  const body =
    '<main class="wrap"><header class="head"><h1>' + esc(title) + '</h1><button class="btn" id="newBtn">+ 新笔记</button></header>' +
    '<input id="search" class="card search" placeholder="搜索笔记…" />' +
    '<section id="grid" class="grid"></section></main>' +
    '<div class="mask" id="mask"><div class="card editor"><div class="ed-head"><input id="edTitle" placeholder="标题" /><button id="closeBtn" class="del">×</button></div><textarea id="edBody" placeholder="开始记录…"></textarea><div class="ed-foot"><span id="savedAt"></span><button class="btn" id="saveBtn">保存</button></div></div></div>' +
    '<style>.wrap{max-width:860px;margin:0 auto;padding:36px 20px 56px}.head{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}h1{font-size:24px}.search{width:100%;padding:11px 14px;font-size:14px;outline:none;margin-bottom:18px;background:var(--card)}.search:focus{border-color:var(--primary)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}.note{padding:16px;cursor:pointer;transition:transform .15s,border-color .15s;position:relative}.note:hover{transform:translateY(-2px);border-color:var(--primary)}.note h3{font-size:15px;margin-bottom:8px}.note p{color:var(--muted);font-size:13px;line-height:1.7;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.note time{display:block;margin-top:12px;font-size:11px;color:var(--muted)}.del{position:absolute;top:10px;right:12px;color:var(--muted);font-size:16px}.del:hover{color:#ef4444}.empty{grid-column:1/-1;padding:48px;text-align:center;color:var(--muted);font-size:14px}.mask{position:fixed;inset:0;background:rgba(15,15,25,.45);display:none;align-items:center;justify-content:center;padding:20px}.mask.open{display:flex}.editor{width:100%;max-width:560px;padding:18px;display:flex;flex-direction:column;gap:12px}.ed-head{display:flex;gap:10px}.ed-head input{flex:1;border:none;outline:none;font-size:16px;font-weight:600;background:transparent}.editor textarea{height:240px;border:1px solid var(--border);border-radius:10px;padding:12px;font-size:14px;line-height:1.7;outline:none;resize:none;background:var(--bg)}.editor textarea:focus{border-color:var(--primary)}.ed-foot{display:flex;align-items:center;justify-content:space-between}.ed-foot span{font-size:12px;color:var(--muted)}</style>';

  const script =
    "var KEY='atoms_notes_items';\n" +
    "var notes=[{id:1,title:'欢迎使用 '+" + JSON.stringify(title) + ",body:'这是我用 Atoms 智能体生成的第一个应用,点击卡片可以编辑,右上角 × 可以删除。',at:Date.now()},{id:2,title:'灵感速记',body:'把每天的想法随手记在这里,支持关键词搜索。',at:Date.now()-86400000}];\n" +
    "try{var saved=JSON.parse(localStorage.getItem(KEY)||'null');if(Array.isArray(saved)&&saved.length)notes=saved;}catch(e){}\n" +
    "function persist(){try{localStorage.setItem(KEY,JSON.stringify(notes));}catch(e){}}\n" +
    "function esc(s){return String(s).replace(/[&<>\\\"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c];});}\n" +
    "function fmt(t){var d=new Date(t);return (d.getMonth()+1)+'月'+d.getDate()+'日 '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}\n" +
    "var grid=document.getElementById('grid');var editing=null;\n" +
    "function render(){\n" +
    "  var q=document.getElementById('search').value.trim().toLowerCase();\n" +
    "  var shown=notes.filter(function(n){return !q||(n.title+n.body).toLowerCase().indexOf(q)>=0;});\n" +
    "  if(!shown.length){grid.innerHTML='<div class=\"empty\">没有匹配的笔记。</div>';return;}\n" +
    "  grid.innerHTML=shown.map(function(n){\n" +
    "    return '<article class=\"card note\" data-open=\"'+n.id+'\"><button class=\"del\" data-del=\"'+n.id+'\">×</button><h3>'+esc(n.title||'无标题')+'</h3><p>'+esc(n.body)+'</p><time>'+fmt(n.at)+'</time></article>';\n" +
    "  }).join('');\n" +
    "}\n" +
    "function openEditor(id){\n" +
    "  editing=id;\n" +
    "  var n=notes.filter(function(x){return String(x.id)===String(id);})[0];\n" +
    "  document.getElementById('edTitle').value=n?n.title:'';\n" +
    "  document.getElementById('edBody').value=n?n.body:'';\n" +
    "  document.getElementById('savedAt').textContent=n?('上次保存 '+fmt(n.at)):'新笔记';\n" +
    "  document.getElementById('mask').classList.add('open');\n" +
    "  document.getElementById('edTitle').focus();\n" +
    "}\n" +
    "function saveEditor(){\n" +
    "  var t=document.getElementById('edTitle').value.trim();\n" +
    "  var b=document.getElementById('edBody').value.trim();\n" +
    "  if(editing==='new'){notes.unshift({id:Date.now(),title:t,body:b,at:Date.now()});}\n" +
    "  else{notes.forEach(function(n){if(String(n.id)===String(editing)){n.title=t;n.body=b;n.at=Date.now();}});}\n" +
    "  persist();render();closeEditor();\n" +
    "}\n" +
    "function closeEditor(){document.getElementById('mask').classList.remove('open');editing=null;}\n" +
    "document.getElementById('newBtn').addEventListener('click',function(){editing='new';document.getElementById('edTitle').value='';document.getElementById('edBody').value='';document.getElementById('savedAt').textContent='新笔记';document.getElementById('mask').classList.add('open');document.getElementById('edTitle').focus();});\n" +
    "document.getElementById('saveBtn').addEventListener('click',saveEditor);\n" +
    "document.getElementById('closeBtn').addEventListener('click',closeEditor);\n" +
    "document.getElementById('mask').addEventListener('click',function(ev){if(ev.target===this)closeEditor();});\n" +
    "document.getElementById('search').addEventListener('input',render);\n" +
    "grid.addEventListener('click',function(ev){\n" +
    "  var del=ev.target.getAttribute&&ev.target.getAttribute('data-del');\n" +
    "  if(del){ev.stopPropagation();notes=notes.filter(function(n){return String(n.id)!==String(del);});persist();render();return;}\n" +
    "  var open=ev.target.closest&&ev.target.closest('[data-open]');\n" +
    "  if(open)openEditor(open.getAttribute('data-open'));\n" +
    "});\n" +
    "render();";

  return htmlShell(title, pal, body, script);
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

const BUILDERS: Record<DemoAppKind, (pal: Palette, title: string) => string> = {
  reading: buildReading,
  todo: buildTodo,
  calculator: buildCalculator,
  dashboard: buildDashboard,
  landing: buildLanding,
  notes: buildNotes,
};

/** 根据提示词与主题构建演示应用(单文件 HTML) */
export function buildDemoApp(prompt: string, theme: string): DemoApp {
  const kind = pickDemoAppKind(prompt);
  const title = pickAppTitle(prompt);
  const pal = themeToPalette(theme);
  const content = BUILDERS[kind](pal, title);
  return {
    title,
    kind,
    files: [{ name: 'index.html', content, language: 'html' }],
  };
}

/** 应用类型对应的封面元信息(生成项目落到「我的项目」时使用) */
export const DEMO_KIND_META: Record<
  DemoAppKind,
  { emoji: string; gradient: string; label: string }
> = {
  reading: { emoji: '📚', gradient: 'from-emerald-500 to-teal-400', label: '阅读工具' },
  todo: { emoji: '✅', gradient: 'from-violet-500 to-fuchsia-500', label: '待办清单' },
  calculator: { emoji: '🧮', gradient: 'from-slate-600 to-slate-400', label: '计算器' },
  dashboard: { emoji: '📊', gradient: 'from-rose-500 to-pink-500', label: '数据看板' },
  landing: { emoji: '🚀', gradient: 'from-blue-500 to-cyan-400', label: '落地页' },
  notes: { emoji: '📝', gradient: 'from-amber-500 to-orange-500', label: '笔记应用' },
};
