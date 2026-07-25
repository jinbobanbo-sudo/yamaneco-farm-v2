/* ヤマネコファーム v3.1 — app.js (日付正規化・記録編集・Gemini履歴の永続化) */
'use strict';

/* ---------- 設定と状態 ---------- */
const cfg = {
  get url() { return localStorage.getItem('gasUrl') || ''; },
  set url(v) { localStorage.setItem('gasUrl', v.trim()); },
  get token() { return localStorage.getItem('token') || ''; },
  set token(v) { localStorage.setItem('token', v.trim()); },
  get recorder() { return localStorage.getItem('recorder') || ''; },
  set recorder(v) { localStorage.setItem('recorder', v.trim()); },
};

const todayStr = () => new Date().toLocaleDateString('sv-SE');

let S = {
  masters: { 作物: [], 販路: [], 作業種別: [] },
  work: [], sales: [],
  tab: 'home',
  calMonth: todayStr().slice(0, 7),
  selDay: todayStr(),
  chat: [],
  loaded: false,
};
try { Object.assign(S, JSON.parse(localStorage.getItem('cache') || '{}'), { tab: 'home', calMonth: todayStr().slice(0, 7), selDay: todayStr() }); } catch (e) {}

const $ = (s, el) => (el || document).querySelector(s);
const view = $('#view');
const yen = n => '¥' + Number(n || 0).toLocaleString('ja-JP');
const num = n => Number(n || 0).toLocaleString('ja-JP');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDay = d => { const p = String(d).split('-'); return `${Number(p[1])}月${Number(p[2])}日`; };

/* 日付を必ず yyyy-mm-dd(端末タイムゾーン)に揃える */
function normDate(v) {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? s : d.toLocaleDateString('sv-SE');
}

/* ---------- API ---------- */
async function api(action, payload) {
  if (!cfg.url) throw new Error('GASのURLが未設定です。設定タブから登録してください。');
  const res = await fetch(cfg.url, {
    method: 'POST', redirect: 'follow',
    body: JSON.stringify({ action, payload, token: cfg.token }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || '不明なエラー');
  return json.data;
}

async function reload(silent) {
  try {
    if (!silent) toast('読み込み中…', true);
    const d = await api('boot');
    S.masters = d.masters;
    S.work = (d.work || []).map(r => ({ ...r, 作業日: normDate(r['作業日']) }));
    S.sales = (d.sales || []).map(r => ({ ...r, 販売日: normDate(r['販売日']) }));
    S.chat = d.chat || [];
    S.loaded = true;
    localStorage.setItem('cache', JSON.stringify({ masters: S.masters, work: S.work, sales: S.sales, chat: S.chat, loaded: true }));
    render();
    if (!silent) toast('最新の状態です');
  } catch (e) { toast(e.message); }
}

async function ensureMasters() {
  if (S.masters.作物.length && S.masters.販路.length) return true;
  toast('選択肢を読み込み中…', true);
  await reload(true);
  $('#toast').hidden = true;
  if (!S.masters.作物.length) {
    toast('マスタが空です。スプレッドシートの「マスタ」シートを確認してください。');
    return false;
  }
  return true;
}

/* ---------- 共通UI ---------- */
let toastTimer;
function toast(msg, hold) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  if (!hold) toastTimer = setTimeout(() => t.hidden = true, 2600);
}
function openSheet(html) {
  $('#sheet').innerHTML = html;
  $('#sheet').hidden = false; $('#backdrop').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; $('#backdrop').hidden = true; }
$('#backdrop').addEventListener('click', closeSheet);

/* ---------- チップ(選択+その場で追加・編集) ---------- */
function chipsHtml(name, kind, opts = {}) {
  const sel = opts.multi ? (opts.selected || []) : [opts.selected];
  return `<div class="chips" data-chips="${name}" data-kind="${kind}"${opts.multi ? ' data-multi="1"' : ''}>` +
    S.masters[kind].map(v => `<button type="button" class="chip${sel.includes(v) ? ' on' : ''}" data-v="${esc(v)}">${esc(v)}</button>`).join('') +
    `<button type="button" class="chip chip-add" data-add>＋</button></div>`;
}
function fieldChips(label, name, kind, opts) {
  return `<div class="field"><label>${label}<button type="button" class="edit-toggle" data-edit="${name}">編集</button></label>${chipsHtml(name, kind, opts)}</div>`;
}
function rebuildChips(g) {
  const selected = [...g.querySelectorAll('.chip.on')].map(c => c.dataset.v);
  const kind = g.dataset.kind;
  g.innerHTML = S.masters[kind].map(v => `<button type="button" class="chip${selected.includes(v) ? ' on' : ''}" data-v="${esc(v)}">${esc(v)}</button>`).join('') +
    `<button type="button" class="chip chip-add" data-add>＋</button>`;
}
function bindChips(root) {
  root.querySelectorAll('.edit-toggle').forEach(t => {
    t.addEventListener('click', () => {
      const g = root.querySelector(`[data-chips="${t.dataset.edit}"]`);
      g.classList.toggle('editing');
      t.textContent = g.classList.contains('editing') ? '完了' : '編集';
    });
  });
  root.querySelectorAll('[data-chips]').forEach(g => {
    g.addEventListener('click', async e => {
      const kind = g.dataset.kind;
      if (e.target.closest('[data-add]')) {
        const v = (prompt(kind + 'を追加:') || '').trim(); if (!v) return;
        if (S.masters[kind].includes(v)) return toast('すでにあります');
        try { S.masters = await api('addMaster', { kind, name: v }); rebuildChips(g); toast('追加しました'); }
        catch (err) { toast(err.message); }
        return;
      }
      const b = e.target.closest('.chip'); if (!b) return;
      if (g.classList.contains('editing')) {
        if (!confirm(`「${b.dataset.v}」を選択肢から削除しますか?\n(過去の記録は変わりません)`)) return;
        try { S.masters = await api('deleteMaster', { kind, name: b.dataset.v }); rebuildChips(g); toast('削除しました'); }
        catch (err) { toast(err.message); }
        return;
      }
      if (g.dataset.multi) b.classList.toggle('on');
      else { g.querySelectorAll('.chip').forEach(c => c.classList.remove('on')); b.classList.add('on'); }
    });
  });
}
const chipVal = name => $(`[data-chips="${name}"] .chip.on`)?.dataset.v || '';
const chipVals = name => [...document.querySelectorAll(`[data-chips="${name}"] .chip.on`)].map(c => c.dataset.v);

/* ---------- 集計 ---------- */
const monthKey = d => String(d || '').slice(0, 7);
const thisMonthSales = () => S.sales.filter(r => monthKey(r['販売日']) === monthKey(todayStr()));
const thisMonthWork = () => S.work.filter(r => monthKey(r['作業日']) === monthKey(todayStr()));

/* ---------- ホーム ---------- */
function renderHome() {
  const ms = thisMonthSales();
  const total = ms.reduce((a, r) => a + Number(r['金額'] || 0), 0);
  const mw = thisMonthWork();
  const monthLabel = new Date().getMonth() + 1;
  const recent = [
    ...S.sales.slice(0, 4).map(r => ({ k: 'sales', r })),
    ...S.work.slice(0, 4).map(r => ({ k: 'work', r })),
  ].sort((a, b) => (b.r['販売日'] || b.r['作業日'] || '').localeCompare(a.r['販売日'] || a.r['作業日'] || '')).slice(0, 6);

  view.innerHTML = `
    <div class="hero">
      <div class="eyebrow">${monthLabel}月の売上 — ヤマネコファーム</div>
      <div class="big-num"><span class="yen">¥</span>${num(total)}</div>
      <div class="sub-stats">
        <div><div class="n"><em>${ms.length}</em></div><div class="l">販売件数</div></div>
        <div><div class="n"><em>${mw.length}</em></div><div class="l">作業記録</div></div>
        <div><div class="n"><em>${new Set(ms.map(r => r['品目'])).size}</em></div><div class="l">売れた品目</div></div>
      </div>
    </div>
    <div class="section">
      <h2>最近の記録 <button class="more" id="goRec">すべて見る</button></h2>
      <div id="recentList">${recent.length ? recent.map(x => recRow(x.k, x.r, false)).join('') : `<div class="empty">${S.loaded ? 'まだ記録がありません。<br>記録タブの + から始めましょう。' : '設定タブでGASのURLを登録すると、<br>データが表示されます。'}</div>`}</div>
    </div>`;
  $('#goRec').addEventListener('click', () => switchTab('records'));
}

function recRow(kind, r, editable) {
  if (kind === 'sales') {
    return `<div class="rec${editable ? ' tap' : ''}" data-id="${r.id}" data-k="sales">
      <span class="dot"></span>
      <div class="body"><div class="t1">${esc(r['品目'])} × ${esc(r['数量'])}</div>
      <div class="t2">${esc(r['販売日'])} ・ ${esc(r['販路'])}${r['メモ'] ? ' ・ ' + esc(r['メモ']) : ''}</div></div>
      <span class="amt">${yen(r['金額'])}</span>
      ${editable ? '<button class="del">削除</button>' : ''}</div>`;
  }
  return `<div class="rec${editable ? ' tap' : ''}" data-id="${r.id}" data-k="work">
    <span class="dot work"></span>
    ${r['写真URL'] ? `<img class="thumb" src="${esc(r['写真URL'])}" alt="">` : ''}
    <div class="body"><div class="t1">${esc(r['作物'])} ・ ${esc(r['作業種別'])}</div>
    <div class="t2">${esc(r['作業日'])}${r['作業時間分'] ? ' ・ ' + esc(r['作業時間分']) + '分' : ''}${r['メモ'] ? ' ・ ' + esc(r['メモ']) : ''}</div></div>
    ${editable ? '<button class="del">削除</button>' : ''}</div>`;
}

/* ---------- 記録(カレンダー) ---------- */
function renderRecords() {
  const [y, m] = S.calMonth.split('-').map(Number);
  const daysIn = new Date(y, m, 0).getDate();
  const startDow = new Date(y, m - 1, 1).getDay();
  const byDay = {};
  S.sales.forEach(r => { const d = r['販売日']; if (d) (byDay[d] = byDay[d] || { s: 0, w: 0 }).s++; });
  S.work.forEach(r => { const d = r['作業日']; if (d) (byDay[d] = byDay[d] || { s: 0, w: 0 }).w++; });

  let cells = '';
  for (let i = 0; i < startDow; i++) cells += '<div class="cal-cell off"></div>';
  for (let d = 1; d <= daysIn; d++) {
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const b = byDay[key];
    const cls = 'cal-cell' + (key === S.selDay ? ' sel' : '') + (key === todayStr() ? ' today' : '');
    cells += `<button class="${cls}" data-d="${key}"><span class="dnum">${d}</span><span class="dots">${b ? (b.s ? '<i class="ds"></i>' : '') + (b.w ? '<i class="dw"></i>' : '') : ''}</span></button>`;
  }

  const dayS = S.sales.filter(r => r['販売日'] === S.selDay);
  const dayW = S.work.filter(r => r['作業日'] === S.selDay);
  const daySum = dayS.reduce((a, r) => a + Number(r['金額'] || 0), 0);

  view.innerHTML = `
    <div class="cal-head">
      <button class="cal-nav" data-nav="-1" aria-label="前の月">‹</button>
      <div class="cal-title">${y}<span>年</span>${m}<span>月</span></div>
      <button class="cal-nav" data-nav="1" aria-label="次の月">›</button>
    </div>
    <div class="cal-dow">${'日月火水木金土'.split('').map((c, i) => `<div class="${i === 0 ? 'sun' : ''}">${c}</div>`).join('')}</div>
    <div class="cal-grid" id="calGrid">${cells}</div>
    <div class="cal-legend"><span><i class="ds"></i>販売</span><span><i class="dw"></i>作業</span><span class="hint">記録をタップで編集</span></div>
    <div class="section">
      <h2>${fmtDay(S.selDay)}の記録${daySum ? `<span class="day-sum">${yen(daySum)}</span>` : ''}</h2>
      <div id="list">${dayS.length + dayW.length
        ? dayS.map(r => recRow('sales', r, true)).join('') + dayW.map(r => recRow('work', r, true)).join('')
        : '<div class="empty">この日の記録はありません。<br>+ から追加できます。</div>'}</div>
    </div>
    <button class="fab" id="fab" aria-label="記録を追加">＋</button>`;

  view.querySelector('.cal-head').addEventListener('click', e => {
    const b = e.target.closest('.cal-nav'); if (!b) return;
    const d = new Date(y, m - 1 + Number(b.dataset.nav), 1);
    S.calMonth = d.toLocaleDateString('sv-SE').slice(0, 7);
    renderRecords();
  });
  $('#calGrid').addEventListener('click', e => {
    const c = e.target.closest('.cal-cell[data-d]'); if (!c) return;
    S.selDay = c.dataset.d;
    renderRecords();
  });
  $('#fab').addEventListener('click', sheetChoose);
  $('#list').addEventListener('click', async e => {
    const rec = e.target.closest('.rec'); if (!rec) return;
    const isSales = rec.dataset.k === 'sales';
    if (e.target.closest('.del')) {
      if (!confirm('この記録を削除しますか?')) return;
      try {
        await api('deleteRecord', { sheet: rec.dataset.k, id: rec.dataset.id });
        toast('削除しました');
        const arr = isSales ? S.sales : S.work;
        const i = arr.findIndex(r => String(r.id) === rec.dataset.id);
        if (i >= 0) arr.splice(i, 1);
        renderRecords();
        reload(true);
      } catch (err) { toast(err.message); }
      return;
    }
    const arr = isSales ? S.sales : S.work;
    const r = arr.find(x => String(x.id) === rec.dataset.id);
    if (r) isSales ? sheetSales(r) : sheetWork(r);
  });
}

function sheetChoose() {
  openSheet(`
    <h3>${fmtDay(S.selDay)}に記録する</h3>
    <button class="btn green" id="c-sales" style="margin-bottom:10px">販売を記録</button>
    <button class="btn" id="c-work">作業を記録</button>
    <button class="btn-ghost" onclick="closeSheet()">キャンセル</button>`);
  $('#c-sales').addEventListener('click', () => sheetSales());
  $('#c-work').addEventListener('click', () => sheetWork());
}

async function sheetSales(rec) {
  if (!await ensureMasters()) return;
  openSheet(`
    <h3>${rec ? '販売を編集' : '販売を記録'}</h3>
    <div class="field"><label>販売日</label><input type="date" id="f-date" value="${rec ? esc(rec['販売日']) : S.selDay}"></div>
    ${fieldChips('品目', 'item', '作物', { selected: rec ? rec['品目'] : S.masters.作物[0] })}
    ${fieldChips('販路', 'channel', '販路', { selected: rec ? rec['販路'] : S.masters.販路[0] })}
    <div class="row2">
      <div class="field"><label>数量</label><input type="number" id="f-qty" inputmode="decimal" value="${rec ? esc(rec['数量']) : ''}" placeholder="0"></div>
      <div class="field"><label>単価(円)</label><input type="number" id="f-price" inputmode="numeric" value="${rec ? esc(rec['単価']) : ''}" placeholder="0"></div>
    </div>
    <div class="row2">
      <div class="field"><label>手数料(円・任意)</label><input type="number" id="f-fee" inputmode="numeric" value="${rec ? esc(rec['手数料']) : ''}"></div>
      <div class="field"><label>メモ(任意)</label><input type="text" id="f-memo" value="${rec ? esc(rec['メモ']) : ''}"></div>
    </div>
    <button class="btn green" id="f-save">${rec ? '更新する' : '保存する'}</button>
    <button class="btn-ghost" onclick="closeSheet()">キャンセル</button>`);
  bindChips($('#sheet'));
  $('#f-save').addEventListener('click', async () => {
    const p = {
      date: $('#f-date').value, item: chipVal('item'), channel: chipVal('channel'),
      qty: $('#f-qty').value, unitPrice: $('#f-price').value,
      fee: $('#f-fee').value, memo: $('#f-memo').value, recorder: cfg.recorder,
    };
    if (!p.date || !p.item || !p.channel || !p.qty || !p.unitPrice) return toast('日付・品目・販路・数量・単価は必須です');
    if (rec) p.id = rec.id;
    await save(rec ? 'updateSales' : 'addSales', p);
  });
}

async function sheetWork(rec) {
  if (!await ensureMasters()) return;
  const selCrops = rec ? String(rec['作物']).split('、').filter(Boolean) : [];
  openSheet(`
    <h3>${rec ? '作業を編集' : '作業を記録'}</h3>
    <div class="field"><label>作業日</label><input type="date" id="f-date" value="${rec ? esc(rec['作業日']) : S.selDay}"></div>
    ${fieldChips('作物(複数選択可)', 'crop', '作物', { multi: true, selected: selCrops })}
    ${fieldChips('作業種別', 'wtype', '作業種別', { selected: rec ? rec['作業種別'] : S.masters.作業種別[0] })}
    <div class="row2">
      <div class="field"><label>作業時間(分・任意)</label><input type="number" id="f-min" inputmode="numeric" value="${rec ? esc(rec['作業時間分']) : ''}"></div>
      <div class="field"><label>写真(任意)</label><input type="file" id="f-photo" accept="image/*"></div>
    </div>
    <div class="field"><label>メモ(任意)</label><textarea id="f-memo" rows="2">${rec ? esc(rec['メモ']) : ''}</textarea></div>
    <button class="btn green" id="f-save">${rec ? '更新する' : '保存する'}</button>
    <button class="btn-ghost" onclick="closeSheet()">キャンセル</button>`);
  bindChips($('#sheet'));
  $('#f-save').addEventListener('click', async () => {
    const crops = chipVals('crop');
    const p = {
      date: $('#f-date').value, crop: crops.join('、'), type: chipVal('wtype'),
      minutes: $('#f-min').value, memo: $('#f-memo').value, recorder: cfg.recorder,
    };
    if (!p.date || !crops.length || !p.type) return toast('日付・作物(1つ以上)・作業種別は必須です');
    const file = $('#f-photo').files[0];
    if (file) p.photoBase64 = await compress(file);
    if (rec) { p.id = rec.id; p.photoUrl = rec['写真URL'] || ''; }
    await save(rec ? 'updateWork' : 'addWork', p);
  });
}

async function save(action, payload) {
  const btn = $('#f-save');
  btn.disabled = true; btn.textContent = '保存中…';
  try {
    await api(action, payload);
    closeSheet(); toast('保存しました');
    reload(true);
  } catch (e) {
    toast(e.message); btn.disabled = false;
    btn.textContent = action.startsWith('update') ? '更新する' : '保存する';
  }
}

function compress(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 1000;
      const sc = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = img.width * sc; c.height = img.height * sc;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.72).split(',')[1]);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/* ---------- 分析 ---------- */
const PRESETS = [
  ['今月のサマリー', '今月の売上と作業を要約して、良かった点と気になる点を教えてください。'],
  ['作業と売上の関係', '作業記録と販売実績を照らし合わせて、手間と売上のバランスが良い作物・悪い作物を分析してください。'],
  ['作物別の振り返り', '作物ごとに販売実績を振り返り、来期に向けたアドバイスをください。'],
];
function renderAnalysis() {
  view.innerHTML = `
    <div class="eyebrow" style="margin-bottom:12px">GEMINI 分析</div>
    <div class="presets">${PRESETS.map((p, i) => `<button class="chip" data-p="${i}">${p[0]}</button>`).join('')}</div>
    <div class="chat" id="chat">${S.chat.length ? '' : '<div class="empty">記録データをもとにGeminiが答えます。<br>やりとりはスプレッドシートの「分析履歴」に保存されます。</div>'}</div>
    <div class="chat-input"><div class="inner">
      <input id="q" placeholder="質問を入力…" autocomplete="off">
      <button id="send" aria-label="送信">↑</button>
    </div></div>`;
  drawChat();
  view.querySelector('.presets').addEventListener('click', e => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    ask(PRESETS[b.dataset.p][1], PRESETS[b.dataset.p][0]);
  });
  $('#send').addEventListener('click', () => { const q = $('#q').value.trim(); if (q) { $('#q').value = ''; ask(q, q); } });
  $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') $('#send').click(); });
}
function drawChat() {
  const c = $('#chat'); if (!c) return;
  if (S.chat.length) c.innerHTML = S.chat.map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'ai'}">${esc(m.text)}</div>`).join('');
  window.scrollTo(0, document.body.scrollHeight);
}
async function ask(question, label) {
  S.chat.push({ role: 'user', text: label });
  S.chat.push({ role: 'model', text: '考え中…' });
  drawChat();
  try {
    const history = S.chat.slice(0, -2).slice(-20).map(m => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text }] }));
    const d = await api('askGemini', { question, label, history });
    S.chat[S.chat.length - 1].text = d.answer;
    localStorage.setItem('cache', JSON.stringify({ masters: S.masters, work: S.work, sales: S.sales, chat: S.chat, loaded: S.loaded }));
  } catch (e) {
    S.chat[S.chat.length - 1].text = 'エラー: ' + e.message;
  }
  drawChat();
}

/* ---------- 設定 ---------- */
function renderSettings() {
  view.innerHTML = `
    <div class="eyebrow" style="margin-bottom:14px">設定</div>
    <div class="field"><label>GAS WebアプリのURL</label><input id="s-url" value="${esc(cfg.url)}" placeholder="https://script.google.com/macros/s/…/exec"></div>
    <div class="field"><label>合言葉(使わない場合は空欄)</label><input id="s-token" value="${esc(cfg.token)}"></div>
    <div class="field"><label>記録者の名前(任意)</label><input id="s-rec" value="${esc(cfg.recorder)}" placeholder="ゆい など"></div>
    <button class="btn" id="s-save">保存して接続テスト</button>
    <p class="note">作物・販路・作業種別の選択肢は、記録の入力画面で「編集」「＋」からいつでも変更できます。Gemini分析のやりとりはスプレッドシートの「分析履歴」シートに保存されます。</p>`;
  $('#s-save').addEventListener('click', async () => {
    cfg.url = $('#s-url').value; cfg.token = $('#s-token').value; cfg.recorder = $('#s-rec').value;
    await reload();
  });
}

/* ---------- タブ切替 ---------- */
function switchTab(tab) {
  S.tab = tab;
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  render();
}
function render() {
  ({ home: renderHome, records: renderRecords, analysis: renderAnalysis, settings: renderSettings })[S.tab]();
}
$('#tabbar').addEventListener('click', e => {
  const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab);
});

/* ---------- 起動 ---------- */
render();
if (cfg.url) reload(true); else switchTab('settings');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
