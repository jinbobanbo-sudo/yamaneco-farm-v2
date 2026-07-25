/* ヤマネコファーム v2 — app.js */
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

let S = {
  masters: { 作物: [], 販路: [], 作業種別: [] },
  work: [], sales: [],
  tab: 'home', recTab: 'sales',
  chat: [], // {role:'user'|'model', text}
  loaded: false,
};
try { Object.assign(S, JSON.parse(localStorage.getItem('cache') || '{}'), { tab: 'home', chat: [] }); } catch (e) {}

const $ = (s, el) => (el || document).querySelector(s);
const view = $('#view');
const yen = n => '¥' + Number(n || 0).toLocaleString('ja-JP');
const num = n => Number(n || 0).toLocaleString('ja-JP');
const today = () => new Date().toLocaleDateString('sv-SE'); // yyyy-mm-dd
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

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
    S.masters = d.masters; S.work = d.work; S.sales = d.sales; S.loaded = true;
    localStorage.setItem('cache', JSON.stringify({ masters: S.masters, work: S.work, sales: S.sales, loaded: true }));
    render();
    if (!silent) toast('最新の状態です');
  } catch (e) { toast(e.message); }
}

/* ---------- 共通UI ---------- */
let toastTimer;
function toast(msg, hold) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  if (!hold) toastTimer = setTimeout(() => t.hidden = true, 2400);
}
function openSheet(html) {
  $('#sheet').innerHTML = html;
  $('#sheet').hidden = false; $('#backdrop').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; $('#backdrop').hidden = true; }
$('#backdrop').addEventListener('click', closeSheet);

function chipRow(name, items, selected) {
  return `<div class="chips" data-chips="${name}">` +
    items.map(v => `<button type="button" class="chip${v === selected ? ' on' : ''}" data-v="${esc(v)}">${esc(v)}</button>`).join('') +
    `</div>`;
}
function bindChips(root) {
  root.querySelectorAll('[data-chips]').forEach(g => {
    g.addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b) return;
      g.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
      b.classList.add('on');
    });
  });
}
const chipVal = name => $(`[data-chips="${name}"] .chip.on`)?.dataset.v || '';

/* ---------- 集計 ---------- */
function monthKey(d) { return String(d || '').slice(0, 7); }
function thisMonthSales() {
  const m = monthKey(today());
  return S.sales.filter(r => monthKey(r['販売日']) === m);
}
function thisMonthWork() {
  const m = monthKey(today());
  return S.work.filter(r => monthKey(r['作業日']) === m);
}

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
        <div><div class="n">${ms.length}</div><div class="l">販売件数</div></div>
        <div><div class="n">${mw.length}</div><div class="l">作業記録</div></div>
        <div><div class="n">${new Set(ms.map(r => r['品目'])).size}</div><div class="l">売れた品目</div></div>
      </div>
    </div>
    <div class="section">
      <h2>最近の記録 <button class="more" id="goRec">すべて見る</button></h2>
      <div id="recentList">${recent.length ? recent.map(x => recRow(x.k, x.r, false)).join('') : `<div class="empty">${S.loaded ? 'まだ記録がありません。記録タブの + から始めましょう。' : '設定タブでGASのURLと合言葉を登録すると、データが表示されます。'}</div>`}</div>
    </div>`;
  $('#goRec').addEventListener('click', () => switchTab('records'));
}

function recRow(kind, r, delBtn) {
  if (kind === 'sales') {
    return `<div class="rec" data-id="${r.id}" data-k="sales">
      <span class="dot"></span>
      <div class="body"><div class="t1">${esc(r['品目'])} × ${esc(r['数量'])}</div>
      <div class="t2">${esc(r['販売日'])} ・ ${esc(r['販路'])}${r['メモ'] ? ' ・ ' + esc(r['メモ']) : ''}</div></div>
      <span class="amt">${yen(r['金額'])}</span>
      ${delBtn ? '<button class="del">削除</button>' : ''}</div>`;
  }
  return `<div class="rec" data-id="${r.id}" data-k="work">
    <span class="dot work"></span>
    ${r['写真URL'] ? `<img class="thumb" src="${esc(r['写真URL'])}" alt="">` : ''}
    <div class="body"><div class="t1">${esc(r['作物'])} ・ ${esc(r['作業種別'])}</div>
    <div class="t2">${esc(r['作業日'])}${r['作業時間分'] ? ' ・ ' + esc(r['作業時間分']) + '分' : ''}${r['メモ'] ? ' ・ ' + esc(r['メモ']) : ''}</div></div>
    ${delBtn ? '<button class="del">削除</button>' : ''}</div>`;
}

/* ---------- 記録 ---------- */
function renderRecords() {
  const isSales = S.recTab === 'sales';
  const list = isSales ? S.sales : S.work;
  view.innerHTML = `
    <div class="seg">
      <button data-s="sales" class="${isSales ? 'on' : ''}">販売</button>
      <button data-s="work" class="${!isSales ? 'on' : ''}">作業</button>
    </div>
    <div id="list">${list.length ? list.map(r => recRow(S.recTab, r, true)).join('') : '<div class="empty">まだ記録がありません</div>'}</div>
    <button class="fab" id="fab" aria-label="記録を追加">＋</button>`;
  view.querySelector('.seg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S.recTab = b.dataset.s; renderRecords();
  });
  $('#fab').addEventListener('click', () => isSales ? sheetSales() : sheetWork());
  $('#list').addEventListener('click', async e => {
    const del = e.target.closest('.del'); if (!del) return;
    const rec = del.closest('.rec');
    if (!confirm('この記録を削除しますか?')) return;
    try {
      await api('deleteRecord', { sheet: rec.dataset.k, id: rec.dataset.id });
      toast('削除しました'); reload(true);
      rec.remove();
    } catch (err) { toast(err.message); }
  });
}

function sheetSales() {
  openSheet(`
    <h3>販売を記録</h3>
    <div class="field"><label>販売日</label><input type="date" id="f-date" value="${today()}"></div>
    <div class="field"><label>品目</label>${chipRow('item', S.masters.作物, S.masters.作物[0])}</div>
    <div class="field"><label>販路</label>${chipRow('channel', S.masters.販路, S.masters.販路[0])}</div>
    <div class="row2">
      <div class="field"><label>数量</label><input type="number" id="f-qty" inputmode="decimal" placeholder="0"></div>
      <div class="field"><label>単価(円)</label><input type="number" id="f-price" inputmode="numeric" placeholder="0"></div>
    </div>
    <div class="row2">
      <div class="field"><label>手数料(円・任意)</label><input type="number" id="f-fee" inputmode="numeric"></div>
      <div class="field"><label>メモ(任意)</label><input type="text" id="f-memo"></div>
    </div>
    <button class="btn green" id="f-save">保存する</button>
    <button class="btn-ghost" onclick="closeSheet()">キャンセル</button>`);
  bindChips($('#sheet'));
  $('#f-save').addEventListener('click', async () => {
    const p = {
      date: $('#f-date').value, item: chipVal('item'), channel: chipVal('channel'),
      qty: $('#f-qty').value, unitPrice: $('#f-price').value,
      fee: $('#f-fee').value, memo: $('#f-memo').value, recorder: cfg.recorder,
    };
    if (!p.date || !p.item || !p.channel || !p.qty || !p.unitPrice) return toast('日付・品目・販路・数量・単価は必須です');
    await save('addSales', p);
  });
}

function sheetWork() {
  openSheet(`
    <h3>作業を記録</h3>
    <div class="field"><label>作業日</label><input type="date" id="f-date" value="${today()}"></div>
    <div class="field"><label>作物</label>${chipRow('crop', S.masters.作物, S.masters.作物[0])}</div>
    <div class="field"><label>作業種別</label>${chipRow('wtype', S.masters.作業種別, S.masters.作業種別[0])}</div>
    <div class="row2">
      <div class="field"><label>作業時間(分・任意)</label><input type="number" id="f-min" inputmode="numeric"></div>
      <div class="field"><label>写真(任意)</label><input type="file" id="f-photo" accept="image/*"></div>
    </div>
    <div class="field"><label>メモ(任意)</label><textarea id="f-memo" rows="2"></textarea></div>
    <button class="btn green" id="f-save">保存する</button>
    <button class="btn-ghost" onclick="closeSheet()">キャンセル</button>`);
  bindChips($('#sheet'));
  $('#f-save').addEventListener('click', async () => {
    const p = {
      date: $('#f-date').value, crop: chipVal('crop'), type: chipVal('wtype'),
      minutes: $('#f-min').value, memo: $('#f-memo').value, recorder: cfg.recorder,
    };
    if (!p.date || !p.crop || !p.type) return toast('日付・作物・作業種別は必須です');
    const file = $('#f-photo').files[0];
    if (file) p.photoBase64 = await compress(file);
    await save('addWork', p);
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
    toast(e.message); btn.disabled = false; btn.textContent = '保存する';
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
    <div class="chat" id="chat">${S.chat.length ? '' : '<div class="empty">記録データをもとにGeminiが答えます。<br>上のボタンか、下の入力欄からどうぞ。</div>'}</div>
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
  c.innerHTML = S.chat.map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'ai'}">${esc(m.text)}</div>`).join('') || c.innerHTML;
  window.scrollTo(0, document.body.scrollHeight);
}
async function ask(question, label) {
  S.chat.push({ role: 'user', text: label });
  S.chat.push({ role: 'model', text: '考え中…' });
  drawChat();
  try {
    const history = S.chat.slice(0, -2).map(m => ({ role: m.role, parts: [{ text: m.text }] }));
    const d = await api('askGemini', { question, history });
    S.chat[S.chat.length - 1].text = d.answer;
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
    <div class="field"><label>合言葉(APP_TOKEN)</label><input id="s-token" value="${esc(cfg.token)}"></div>
    <div class="field"><label>記録者の名前(任意)</label><input id="s-rec" value="${esc(cfg.recorder)}" placeholder="ゆい など"></div>
    <button class="btn" id="s-save">保存して接続テスト</button>
    <div class="section"><h2>作物マスタ</h2><div id="m-作物"></div></div>
    <div class="section"><h2>販路マスタ</h2><div id="m-販路"></div></div>
    <div class="section"><h2>作業種別マスタ</h2><div id="m-作業種別"></div></div>
    <p class="note">マスタを変更すると入力画面の選択肢に反映されます。過去の記録は変わりません。</p>`;
  ['作物', '販路', '作業種別'].forEach(kind => drawMaster(kind));
  $('#s-save').addEventListener('click', async () => {
    cfg.url = $('#s-url').value; cfg.token = $('#s-token').value; cfg.recorder = $('#s-rec').value;
    await reload();
  });
}
function drawMaster(kind) {
  const box = $('#m-' + kind); if (!box) return;
  box.innerHTML = S.masters[kind].map(n =>
    `<div class="master-item"><span>${esc(n)}</span><button data-k="${kind}" data-n="${esc(n)}" class="m-del">削除</button></div>`).join('') +
    `<div class="master-item"><input placeholder="追加する名前" id="add-${kind}" style="border:0;padding:4px 0"><button class="m-add" data-k="${kind}" style="color:var(--green);font-weight:700">追加</button></div>`;
  box.onclick = async e => {
    const del = e.target.closest('.m-del');
    const add = e.target.closest('.m-add');
    try {
      if (del) {
        if (!confirm(`「${del.dataset.n}」を選択肢から外しますか?`)) return;
        S.masters = await api('deleteMaster', { kind: del.dataset.k, name: del.dataset.n });
      } else if (add) {
        const v = $('#add-' + add.dataset.k).value.trim(); if (!v) return;
        S.masters = await api('addMaster', { kind: add.dataset.k, name: v });
      } else return;
      drawMaster(kind); toast('更新しました');
    } catch (err) { toast(err.message); }
  };
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
