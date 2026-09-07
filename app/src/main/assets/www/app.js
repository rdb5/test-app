import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  nip19,
  SimplePool,
} from 'https://esm.sh/nostr-tools@2.10.4';
import { bytesToHex, hexToBytes } from 'https://esm.sh/@noble/hashes@1.5.0/utils';

/* ============ إعدادات التطبيق ============ */

// وسم فريد لهذا التطبيق: كل إعلان يُنشر من هنا يحمل هذا الوسم،
// وكل قراءة تُصفّى بنفس الوسم. هذا هو ما يجعل السوق "مغلقاً" على
// محتوى هذا التطبيق فقط رغم أن الشبكة نفسها عامة.
const APP_TAG = 'souqdz-v1';
const LISTING_KIND = 30402; // NIP-99: Classified Listing

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
];

const WILAYAS = [
  'أدرار','الشلف','الأغواط','أم البواقي','باتنة','بجاية','بسكرة','بشار','البليدة','البويرة',
  'تمنراست','تبسة','تلمسان','تيارت','تيزي وزو','الجزائر العاصمة','الجلفة','جيجل','سطيف','سعيدة',
  'سكيكدة','سيدي بلعباس','عنابة','قالمة','قسنطينة','المدية','مستغانم','المسيلة','معسكر','ورقلة',
  'وهران','البيض','إليزي','برج بوعريريج','بومرداس','الطارف','تندوف','تيسمسيلت','الوادي','خنشلة',
  'سوق أهراس','تيبازة','ميلة','عين الدفلى','النعامة','عين تموشنت','غرداية','غليزان','تيميمون',
  'برج باجي مختار','أولاد جلال','بني عباس','عين صالح','عين قزام','تقرت','جانت','المغير','المنيعة',
];

const CATEGORY_LABELS = {
  electronics:'إلكترونيات', vehicles:'سيارات ومركبات', realestate:'عقارات',
  fashion:'ملابس وأزياء', home:'أثاث ومنزل', jobs:'عروض عمل',
  services:'خدمات', other:'أخرى',
};

/* ============ التخزين المحلي (بدون قاعدة بيانات) ============ */

const store = {
  getSk(){ return localStorage.getItem('souqdz_sk'); },
  setSk(hex){ localStorage.setItem('souqdz_sk', hex); },
  getRelays(){
    const raw = localStorage.getItem('souqdz_relays');
    return raw ? JSON.parse(raw) : DEFAULT_RELAYS.slice();
  },
  setRelays(list){ localStorage.setItem('souqdz_relays', JSON.stringify(list)); },
};

let sk, pk, pool;

function ensureIdentity(){
  let hex = store.getSk();
  if(!hex){
    const bytes = generateSecretKey();
    hex = bytesToHex(bytes);
    store.setSk(hex);
  }
  sk = hexToBytes(hex);
  pk = getPublicKey(sk);
}

/* ============ نشر إعلان ============ */

async function publishListing(data){
  const id = 'l' + Date.now() + Math.random().toString(36).slice(2,8);
  const tags = [
    ['d', id],
    ['title', data.title],
    ['summary', data.title],
    ['price', String(data.price), 'DZD'],
    ['location', data.wilaya],
    ['t', APP_TAG],
    ['t', data.category],
    ['published_at', String(Math.floor(Date.now()/1000))],
  ];
  if(data.image) tags.push(['image', data.image]);
  if(data.phone) tags.push(['contact', data.phone]);

  const event = finalizeEvent({
    kind: LISTING_KIND,
    created_at: Math.floor(Date.now()/1000),
    tags,
    content: data.desc,
  }, sk);

  const relays = store.getRelays();
  const results = await Promise.allSettled(pool.publish(relays, event));
  const okCount = results.filter(r => r.status === 'fulfilled').length;
  return { event, okCount, total: relays.length };
}

/* ============ قراءة الإعلانات ============ */

async function fetchListings(filterExtra = {}){
  const relays = store.getRelays();
  const filter = {
    kinds: [LISTING_KIND],
    '#t': [APP_TAG],
    limit: 200,
    ...filterExtra,
  };
  const events = await pool.querySync(relays, filter);
  // أحدث نسخة فقط لكل معرّف (d tag) — النشر يستبدل النسخ الأقدم
  const byId = new Map();
  for(const ev of events){
    const dTag = ev.tags.find(t => t[0] === 'd');
    const key = dTag ? dTag[1] : ev.id;
    const existing = byId.get(key);
    if(!existing || ev.created_at > existing.created_at) byId.set(key, ev);
  }
  return [...byId.values()].sort((a,b) => b.created_at - a.created_at);
}

function parseListing(ev){
  const get = (name) => (ev.tags.find(t => t[0] === name) || [])[1];
  const category = ev.tags.filter(t => t[0]==='t').map(t=>t[1]).find(t => t !== APP_TAG);
  return {
    id: ev.id,
    author: ev.pubkey,
    title: get('title') || '(بدون عنوان)',
    price: get('price') || '0',
    wilaya: get('location') || '',
    category,
    image: get('image'),
    phone: get('contact'),
    desc: ev.content,
    createdAt: ev.created_at,
  };
}

/* ============ واجهة المستخدم ============ */

function $(sel){ return document.querySelector(sel); }
function $all(sel){ return [...document.querySelectorAll(sel)]; }

function fillWilayaSelects(){
  const opts = WILAYAS.map(w => `<option value="${w}">${w}</option>`).join('');
  $('#f-wilaya').innerHTML = opts;
  $('#filter-wilaya').insertAdjacentHTML('beforeend', opts);
}

function renderListingRow(item){
  const li = document.createElement('li');
  li.className = 'listing-item';
  li.dataset.id = item.id;
  const thumb = item.image
    ? `<img class="listing-thumb" src="${escapeAttr(item.image)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'listing-thumb placeholder',textContent:'📦'}))" />`
    : `<div class="listing-thumb placeholder">📦</div>`;
  li.innerHTML = `
    ${thumb}
    <div class="listing-meta">
      <p class="listing-title">${escapeHtml(item.title)}</p>
      <p class="listing-sub">${escapeHtml(item.wilaya || '')} · ${escapeHtml(CATEGORY_LABELS[item.category] || '')}</p>
      <p class="listing-price">${formatPrice(item.price)}</p>
    </div>
  `;
  li.addEventListener('click', () => openDetail(item));
  return li;
}

function formatPrice(p){
  const n = Number(p);
  if(!n) return 'اتصل للسعر';
  return n.toLocaleString('ar-DZ') + ' دج';
}

function escapeHtml(s=''){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s=''){ return escapeHtml(s); }

let allListings = [];

async function loadBrowse(){
  const statusEl = $('#status-line');
  statusEl.textContent = 'جارٍ التحميل من الشبكة...';
  $('#listing-list').innerHTML = '';
  try{
    const events = await fetchListings();
    allListings = events.map(parseListing);
    statusEl.textContent = allListings.length
      ? `${allListings.length} إعلان`
      : '';
    renderFilteredBrowse();
  }catch(e){
    console.error(e);
    statusEl.textContent = 'تعذّر الاتصال بالشبكة. تحقق من الإنترنت.';
    statusEl.className = 'status-line error';
  }
}

function renderFilteredBrowse(){
  const q = $('#search-input').value.trim().toLowerCase();
  const wilaya = $('#filter-wilaya').value;
  const category = $('#filter-category').value;
  const list = $('#listing-list');
  list.innerHTML = '';
  const filtered = allListings.filter(it => {
    if(wilaya && it.wilaya !== wilaya) return false;
    if(category && it.category !== category) return false;
    if(q && !it.title.toLowerCase().includes(q) && !it.desc.toLowerCase().includes(q)) return false;
    return true;
  });
  if(!filtered.length){
    list.innerHTML = `<li class="empty-state">لا توجد إعلانات مطابقة حالياً.</li>`;
    return;
  }
  for(const item of filtered) list.appendChild(renderListingRow(item));
}

async function loadMine(){
  const statusEl = $('#status-line-mine');
  const list = $('#listing-list-mine');
  statusEl.textContent = 'جارٍ التحميل...';
  list.innerHTML = '';
  try{
    const events = await fetchListings({ authors: [pk] });
    const items = events.map(parseListing);
    statusEl.textContent = items.length ? '' : '';
    if(!items.length){
      list.innerHTML = `<li class="empty-state">لم تنشر أي إعلان بعد. اضغط على "نشر" للبدء.</li>`;
      return;
    }
    for(const item of items) list.appendChild(renderListingRow(item));
  }catch(e){
    console.error(e);
    statusEl.textContent = 'تعذّر الاتصال بالشبكة.';
    statusEl.className = 'status-line error';
  }
}

function openDetail(item){
  const c = $('#detail-content');
  c.innerHTML = `
    ${item.image ? `<img class="detail-img" src="${escapeAttr(item.image)}" />` : ''}
    <h2 class="detail-title">${escapeHtml(item.title)}</h2>
    <div class="detail-price">${formatPrice(item.price)}</div>
    <div class="detail-tags">${escapeHtml(item.wilaya||'')} · ${escapeHtml(CATEGORY_LABELS[item.category]||'')}</div>
    <div class="detail-desc">${escapeHtml(item.desc)}</div>
    <div class="detail-seller">
      البائع: ${escapeHtml(nip19.npubEncode(item.author).slice(0,16))}...<br/>
      ${item.phone ? `التواصل: ${escapeHtml(item.phone)}` : 'لا يوجد رقم تواصل، تصفح فقط عبر التطبيق.'}
    </div>
  `;
  $('#detail-overlay').classList.remove('hidden');
}

/* ============ نشر إعلان: معالجة الفورم ============ */

$('#post-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const statusEl = $('#post-status');
  statusEl.className = 'status-line';
  statusEl.textContent = 'جارٍ النشر على الشبكة...';
  const data = {
    title: $('#f-title').value.trim(),
    desc: $('#f-desc').value.trim(),
    price: $('#f-price').value,
    category: $('#f-category').value,
    wilaya: $('#f-wilaya').value,
    image: $('#f-image').value.trim(),
    phone: $('#f-phone').value.trim(),
  };
  try{
    const { okCount, total } = await publishListing(data);
    if(okCount === 0) throw new Error('no relay accepted');
    statusEl.className = 'status-line ok';
    statusEl.textContent = `تم النشر بنجاح على ${okCount} من ${total} خوادم ✅`;
    e.target.reset();
  }catch(err){
    console.error(err);
    statusEl.className = 'status-line error';
    statusEl.textContent = 'فشل النشر. تحقق من الإنترنت وحاول مجدداً.';
  }
});

/* ============ التنقل بين الشاشات ============ */

function showView(id){
  $all('.view').forEach(v => v.classList.toggle('active', v.id === id));
  $all('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === id));
  if(id === 'view-browse') loadBrowse();
  if(id === 'view-mine') loadMine();
  if(id === 'view-account') renderAccount();
}

$all('.tab').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

$('#search-input').addEventListener('input', renderFilteredBrowse);
$('#filter-wilaya').addEventListener('change', renderFilteredBrowse);
$('#filter-category').addEventListener('change', renderFilteredBrowse);

$('#detail-close').addEventListener('click', () => $('#detail-overlay').classList.add('hidden'));
$('#detail-overlay').addEventListener('click', (e) => {
  if(e.target.id === 'detail-overlay') $('#detail-overlay').classList.add('hidden');
});

$('#btn-keys').addEventListener('click', () => showView('view-account'));

/* ============ شاشة الحساب ============ */

function renderAccount(){
  $('#acct-npub').value = nip19.npubEncode(pk);
  $('#acct-nsec').value = '••••••••••••••••••••••••••••';
  $('#acct-nsec').dataset.real = nip19.nsecEncode(sk);
  renderRelayList();
}

$('#btn-reveal-nsec').addEventListener('click', (e) => {
  const input = $('#acct-nsec');
  if(input.type === 'password'){
    input.type = 'text';
    input.value = input.dataset.real;
    e.target.textContent = 'إخفاء المفتاح السري';
  }else{
    input.type = 'password';
    input.value = '••••••••••••••••••••••••••••';
    e.target.textContent = 'إظهار المفتاح السري';
  }
});

$('#btn-copy-npub').addEventListener('click', async () => {
  try{
    await navigator.clipboard.writeText($('#acct-npub').value);
    $('#account-status').className = 'status-line ok';
    $('#account-status').textContent = 'تم نسخ المعرّف العام.';
  }catch(e){
    $('#account-status').textContent = $('#acct-npub').value;
  }
});

$('#btn-import').addEventListener('click', () => {
  const raw = $('#import-nsec').value.trim();
  const statusEl = $('#account-status');
  try{
    const decoded = nip19.decode(raw);
    if(decoded.type !== 'nsec') throw new Error('bad type');
    store.setSk(bytesToHex(decoded.data));
    ensureIdentity();
    renderAccount();
    statusEl.className = 'status-line ok';
    statusEl.textContent = 'تم استيراد الحساب بنجاح.';
    $('#import-nsec').value = '';
  }catch(e){
    statusEl.className = 'status-line error';
    statusEl.textContent = 'مفتاح غير صالح. تأكد أنه يبدأ بـ nsec1.';
  }
});

function renderRelayList(){
  const relays = store.getRelays();
  const ul = $('#relay-list');
  ul.innerHTML = relays.map(r => `<li><span>${r}</span><span class="ok-dot">●</span></li>`).join('');
}

/* ============ الإقلاع ============ */

function boot(){
  ensureIdentity();
  pool = new SimplePool();
  fillWilayaSelects();
  showView('view-browse');
}

boot();
