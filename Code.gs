/**
 * FruitSlot backend – Google Apps Script + Google Sheet.
 * 1. Create a Google Sheet, open Extensions > Apps Script, paste this file.
 * 2. Run setup() once (allow access).
 * 3. Project Settings > Script properties: add OWNER_KEY = a secret only you know.
 *    For the AI assistant, also add ANTHROPIC_API_KEY (and optionally AI_MODEL, default claude-haiku-4-5-20251001).
 *    For online payment (Razorpay), also add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (test keys first, then live keys).
 * 4. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Copy the URL into CONFIG.API_URL in index.html.
 */
const CUTOFF_HOUR = 21;            // 9 PM IST, must match index.html
const SHOPS = ["1town", "2town"];
const STATUSES = ["pending", "paid", "picked", "rejected"];
const FRUIT_COLS = ["id","name","te","unit","price","step","trayQty","trayCost","color","active","trayNet","boxSize","photo","storePrice","auto","profitPct","storePct","sizes","deleted","wastePct"];
const BOOK_COLS = ["date","shop","data","updated"];
const ORDER_COLS = ["id","created","name","phone","shop","pickupDate","items","total","utr","status"];

function book_(){ return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name){ return book_().getSheetByName(name); }

function setup(){
  const b = book_();
  let f = b.getSheetByName("Fruits") || b.insertSheet("Fruits");
  let o = b.getSheetByName("Orders") || b.insertSheet("Orders");
  if (f.getLastRow() === 0){
    f.appendRow(FRUIT_COLS);
    [
      ["pomegranate","Pomegranate","దానిమ్మ","kg",194,0.5,19,3350,"#B3123A",true,20,"","",214,true,10,10],
      ["apple","Apple","ఆపిల్","kg",220,0.5,24,0,"#C8202F",true,24,"","","","","",""],
      ["green-apple","Green apple","గ్రీన్ ఆపిల్","kg",260,0.5,18,0,"#7DB33A",true,18,"","","","","",""],
      ["black-grapes","Black grapes","నల్ల ద్రాక్ష","kg",140,0.5,8,0,"#3B1F4A",true,8,"","","","","",""],
      ["kiwi","Kiwi","కివి","kg",300,0.5,10,0,"#7A5A2B",true,10,"","","","","",""],
      ["orange","Orange","కమలా పండు","kg",120,0.5,20,0,"#F08A1C",true,20,"","","","","",""],
      ["pears","Pears","బేరి","piece",30,1,40,0,"#B9C34A",true,40,"","","","","",""],
      ["blueberry","Blueberry","బ్లూబెర్రీ","box",250,1,12,0,"#3A4A8C",true,12,"125 g","","","","",""],
      ["watermelon","Watermelon","పుచ్చకాయ","size",0,1,0,0,"#2F7D46",false,0,"","",0,true,10,10,'[{"id":"s1","name":"Small","min":2,"max":3},{"id":"s2","name":"Medium","min":3,"max":4},{"id":"s3","name":"Large","min":5,"max":6}]'],
      ["muskmelon","Muskmelon","కర్బూజ","size",0,1,0,0,"#E8B923",false,0,"","",0,true,10,10,'[{"id":"s1","name":"Small","min":1,"max":1.5},{"id":"s2","name":"Big","min":1.5,"max":2.5}]'],
      ["pineapple","Pineapple","అనాస","size",0,1,0,0,"#F08A1C",false,0,"","",0,true,10,10,'[{"id":"s1","name":"Small","min":0.8,"max":1.2},{"id":"s2","name":"Big","min":1.2,"max":1.8}]']
    ].forEach(r => f.appendRow(r));
  }
  ["trayNet","boxSize","photo","storePrice","auto","profitPct","storePct","sizes","deleted","wastePct"].forEach(c => { const col = FRUIT_COLS.indexOf(c) + 1; if (f.getRange(1, col).getValue() !== c) f.getRange(1, col).setValue(c); });
  let bk = b.getSheetByName("Book") || b.insertSheet("Book");
  if (bk.getLastRow() === 0){ bk.getRange("A:D").setNumberFormat("@"); bk.appendRow(BOOK_COLS); bk.setFrozenRows(1); }
  if (o.getLastRow() === 0){
    o.getRange("A:J").setNumberFormat("@");   // keep phone, UTR and dates as plain text
    o.appendRow(ORDER_COLS);
    o.setFrozenRows(1);
  }
}

function doGet(e){ return handle_((e && e.parameter) || {}); }
function doPost(e){
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok:false, error:"Bad request" }); }
  return handle_(body);
}
function handle_(p){
  try {
    switch (p.action){
      case "fruits":      return out_({ ok:true, data: fruitsPublic_() });
      case "photos":      return out_({ ok:true, data: photosOf_() });
      case "status":      return out_({ ok:true, data: statusOf_(String(p.ids || "").split(",").map(s => s.trim()).filter(String).slice(0, 20)) });
      case "order":       return out_({ ok:true, data: placeOrder_(p) });
      case "payConfirm":  return out_({ ok:true, data: payConfirm_(p) });
      case "orders":      owner_(p.key); return out_({ ok:true, data: readOrders_() });
      case "updateOrder": owner_(p.key); return out_({ ok:true, data: updateOrder_(p.id, p.status) });
      case "book":        owner_(p.key); return out_({ ok:true, data: readBook_() });
      case "saveBook":    owner_(p.key); return out_({ ok:true, data: saveBook_(p.row) });
      case "ai":          owner_(p.key); return out_({ ok:true, data: aiChat_(p) });
      case "saveFruits":  owner_(p.key); saveFruits_(p.fruits); return out_({ ok:true, data: fruitsPublic_() });
      default:            return out_({ ok:false, error:"Unknown action" });
    }
  } catch (err) {
    if (err && err.user) return out_({ ok:false, error: String(err.message) });
    logError_(p && p.action, err);   // anything unexpected (lock timeout, quota, bug) goes to the Errors sheet
    return out_({ ok:false, busy:true, error:"The shop is busy right now. Try again in a moment." });
  }
}
/* An error whose message is safe to show to the user as it is. */
function bad_(msg){ const e = new Error(msg); e.user = true; return e; }
/* Server errors: Errors sheet with time, action, message. Keeps the last 200 rows. Never throws. */
function logError_(action, err){
  try {
    const b = book_();
    let sh = b.getSheetByName("Errors");
    if (!sh){ sh = b.insertSheet("Errors"); sh.appendRow(["time","action","message"]); sh.setFrozenRows(1); }
    sh.appendRow([new Date().toISOString(), String(action || ""), String((err && err.message) || err).slice(0, 500)]);
    const n = sh.getLastRow() - 1;
    if (n > ERROR_KEEP + 50) sh.deleteRows(2, n - ERROR_KEEP);   // trim in batches so most logs are a single append
  } catch (e) {}
}
function out_(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function owner_(key){
  const k = PropertiesService.getScriptProperties().getProperty("OWNER_KEY");
  if (!k || key !== k) throw bad_("Wrong owner key.");
}

function rows_(name, cols){
  const sh = sheet_(name), n = sh.getLastRow();
  if (n < 2) return [];
  const w = Math.min(cols.length, sh.getMaxColumns());   // a sheet that doesn't have the newest column yet still reads fine
  return sh.getRange(2, 1, n - 1, w).getValues().map(r => {
    const o = {}; cols.forEach((c, i) => o[c] = i < w ? r[i] : ""); return o;
  });
}
const FRUITS_KEY = "fruits_v2", PHOTO_KEY = "photo_", STATUS_KEY = "st_", IDEM_KEY = "idem_";
const FRUITS_TTL = 60, PHOTO_TTL = 600, STATUS_TTL = 20, IDEM_TTL = 21600;   // seconds; idempotency keys live 6 hours (the maximum)
function cache_(){ return CacheService.getScriptCache(); }
/* The public list, without photos, cached for 60 seconds. Cleared whenever fruits are saved. */
function fruitsPublic_(){
  const c = cache_(), hit = c.get(FRUITS_KEY);
  if (hit){ try { return JSON.parse(hit); } catch (e) {} }
  const list = readFruits_(false);
  if (list.length){ try { c.put(FRUITS_KEY, JSON.stringify(list), FRUITS_TTL); } catch (e) {} }
  return list;
}
/* Photos are served on their own ({id: dataUrl}), one cache entry per fruit (a cache value is limited to 100 KB). */
function photosOf_(){
  const c = cache_(), ids = fruitsPublic_().filter(f => f.hasPhoto).map(f => f.id);
  if (!ids.length) return {};
  const got = c.getAll(ids.map(id => PHOTO_KEY + id)), out = {};
  let missing = false;
  ids.forEach(id => { const v = got[PHOTO_KEY + id]; if (v) out[id] = v; else missing = true; });
  if (missing){
    const put = {};
    readFruits_(true).forEach(f => { if (f.photo && ids.indexOf(f.id) >= 0){ out[f.id] = f.photo; put[PHOTO_KEY + f.id] = f.photo; } });
    try { c.putAll(put, PHOTO_TTL); } catch (e) {}
  }
  return out;
}
function clearFruitCache_(ids){
  const keys = [FRUITS_KEY];
  (ids || []).forEach(id => keys.push(PHOTO_KEY + id));
  cache_().removeAll(keys);
}
function readFruits_(withPhotos){
  return rows_("Fruits", FRUIT_COLS).filter(f => f.id).map(f => ({
    id:String(f.id), name:String(f.name), te:String(f.te), unit:String(f.unit),
    price:Number(f.price), step:Number(f.step) || 1, trayQty:Number(f.trayQty), trayCost:Number(f.trayCost) || 0,
    color:String(f.color || "#B3123A"), active: f.active === true || String(f.active).toUpperCase() === "TRUE",
    trayNet: Number(f.trayNet) || Number(f.trayQty), boxSize: String(f.boxSize || ""),
    hasPhoto: !!f.photo, photo: withPhotos ? String(f.photo || "") : undefined,
    storePrice: Number(f.storePrice) || 0, auto: f.auto === "" ? "" : (f.auto === true || String(f.auto).toUpperCase() === "TRUE"),
    profitPct: f.profitPct === "" ? "" : Number(f.profitPct), storePct: f.storePct === "" ? "" : Number(f.storePct),
    sizes: parseSizes_(f.sizes),
    deleted: f.deleted === true || String(f.deleted).toUpperCase() === "TRUE",
    wastePct: f.wastePct === "" || f.wastePct == null ? "" : Number(f.wastePct)
  }));
}
function dateStr_(v){
  return v instanceof Date ? Utilities.formatDate(v, "Asia/Kolkata", "yyyy-MM-dd") : String(v).slice(0, 10);
}
function readOrders_(){
  reconcileUnpaid_(10);
  return rows_("Orders", ORDER_COLS).slice(-1000).filter(o => String(o.status) !== "unpaid").map(o => ({   // orders still waiting for online payment are not shown to the owner
    id:String(o.id), created:String(o.created), name:String(o.name), phone:String(o.phone), shop:String(o.shop),
    pickupDate: dateStr_(o.pickupDate), items: JSON.parse(o.items || "[]"), total:Number(o.total), utr:"", status:String(o.status)
  }));
}
/* ===== Online payment (Razorpay) =====
   The server works out the total from the sheet's prices, creates a Razorpay order for exactly that amount, and only marks an
   order Paid after Razorpay says so: the signature from the checkout is checked with the secret key, or Razorpay is asked directly.
   The Razorpay order id is kept in the Orders sheet's utr column. The secret key lives only in Script properties. */
function rpKeys_(){
  const pr = PropertiesService.getScriptProperties(), id = pr.getProperty("RAZORPAY_KEY_ID"), secret = pr.getProperty("RAZORPAY_KEY_SECRET");
  return id && secret ? { id:id, secret:secret } : null;
}
function rpCall_(method, path, payload){
  const k = rpKeys_(); if (!k) throw bad_("Online payment isn't switched on yet. Please visit the shop to pay.");
  const opt = { method:method, muteHttpExceptions:true, headers:{ Authorization:"Basic " + Utilities.base64Encode(k.id + ":" + k.secret) } };
  if (payload){ opt.contentType = "application/json"; opt.payload = JSON.stringify(payload); }
  const res = UrlFetchApp.fetch("https://api.razorpay.com/v1/" + path, opt), code = res.getResponseCode();
  let body = {}; try { body = JSON.parse(res.getContentText()); } catch (e) {}
  if (code >= 400) throw new Error("Razorpay " + code + ": " + String((body.error && body.error.description) || res.getContentText()).slice(0, 200));
  return body;
}
function payConfirm_(p){
  const k = rpKeys_(); if (!k) throw bad_("Online payment isn't switched on yet.");
  const id = String(p.id || ""), orderId = String(p.rpOrderId || ""), payId = String(p.rpPaymentId || ""), sig = String(p.rpSignature || "");
  if (!/^[A-Za-z0-9_]{6,40}$/.test(orderId) || !/^[A-Za-z0-9_]{6,40}$/.test(payId) || !/^[a-f0-9]{64}$/.test(sig)) throw bad_("Payment details look wrong.");
  const want = Utilities.computeHmacSha256Signature(orderId + "|" + payId, k.secret).map(b => ("0" + (b & 255).toString(16)).slice(-2)).join("");
  if (want !== sig) throw bad_("Payment could not be verified. If money was taken, show your payment screen at the shop.");
  const sh = sheet_("Orders"), n = sh.getLastRow();
  if (n < 2) throw bad_("Order not found.");
  const rows = sh.getRange(2, 1, n - 1, ORDER_COLS.length).getValues();
  for (let i = rows.length - 1; i >= 0; i--){
    if (String(rows[i][0]) !== id) continue;
    if (String(rows[i][8]) !== orderId) throw bad_("Payment doesn't match this order.");
    if (String(rows[i][9]) === "unpaid") sh.getRange(i + 2, ORDER_COLS.indexOf("status") + 1).setValue("paid");
    cache_().remove(STATUS_KEY + id);
    return { id:id, status: String(rows[i][9]) === "unpaid" ? "paid" : String(rows[i][9]) };
  }
  throw bad_("Order not found.");
}
/* Asks Razorpay about orders still "unpaid" (the customer paid but closed the page before we heard). Newest first, at most `max` per call. */
function reconcileUnpaid_(max, onlyIds){
  if (!rpKeys_()) return;
  const sh = sheet_("Orders"), n = sh.getLastRow(); if (n < 2) return;
  const first = Math.max(2, n - 199), rows = sh.getRange(first, 1, n - first + 1, ORDER_COLS.length).getValues(), cutoff = Date.now() - 36 * 3600 * 1000;
  let done = 0;
  for (let i = rows.length - 1; i >= 0 && done < max; i--){
    const r = rows[i];
    if (String(r[9]) !== "unpaid" || !/^order_/.test(String(r[8])) || (onlyIds && onlyIds.indexOf(String(r[0])) < 0)) continue;
    if (new Date(String(r[1])).getTime() < cutoff) continue;
    done++;
    try {
      if (rpCall_("get", "orders/" + encodeURIComponent(String(r[8]))).status === "paid"){
        sh.getRange(first + i, ORDER_COLS.indexOf("status") + 1).setValue("paid"); cache_().remove(STATUS_KEY + String(r[0]));
      }
    } catch (e) { logError_("reconcile", e); }
  }
}
function pickupDate_(){
  const now = new Date();
  const hour = Number(Utilities.formatDate(now, "Asia/Kolkata", "H"));
  return Utilities.formatDate(new Date(now.getTime() + (hour >= CUTOFF_HOUR ? 2 : 1) * 86400000), "Asia/Kolkata", "yyyy-MM-dd");
}

function placeOrder_(p){
  // 1. Validate everything first, without touching the lock or the Orders sheet.
  const idem = String(p.idem || "");
  if (idem && !/^[A-Za-z0-9_-]{8,64}$/.test(idem)) throw bad_("Something went wrong. Try again.");
  const cache = cache_();
  if (idem){ const prev = cache.get(IDEM_KEY + idem); if (prev) return JSON.parse(prev); }   // double tap or retry: same order back

  const name = String(p.name || "").trim().slice(0, 60);
  const phone = String(p.phone || "").replace(/\D/g, "");
  if (!name) throw bad_("Enter your name.");
  if (!/^[6-9]\d{9}$/.test(phone)) throw bad_("Enter a 10-digit mobile number.");
  if (SHOPS.indexOf(p.shop) < 0) throw bad_("Choose a shop to pick up from.");
  if (!Array.isArray(p.items) || !p.items.length || p.items.length > 20) throw bad_("Your order is empty.");

  const fruits = fruitsPublic_();   // cached for 60 seconds, cleared whenever prices are saved
  const items = p.items.map(i => {
    const f = fruits.find(x => x.id === i.id && x.active);
    const qty = Math.round(Number(i.qty) * 10) / 10;
    if (!f) throw bad_("A fruit in your order is no longer available. Go back and check your order.");
    if (!(qty > 0) || qty > 50) throw bad_("Check the quantity for " + f.name + ".");
    if (f.unit === "size"){
      const s = f.sizes.filter(x => x.id === String(i.size))[0];
      if (!s) throw bad_("A size in your order is no longer available.");
      if (qty !== Math.round(qty)) throw bad_("Check the quantity for " + f.name + ".");
      const mid = (s.min + s.max) / 2;
      return { id:f.id, size:s.id, name:f.name + " " + s.name + " (" + s.min + "–" + s.max + " kg)", unit:"piece", qty:qty,
               price: Math.ceil(Math.round(f.price * mid * 100) / 100), kg: Math.round(mid * qty * 10) / 10 };
    }
    return { id:f.id, name:f.name, unit:f.unit, qty:qty, price:f.price };   // price always comes from the sheet
  });
  const total = items.reduce((s, i) => s + i.qty * i.price, 0);
  const created = new Date().toISOString(), pickup = pickupDate_(), itemsJson = JSON.stringify(items);
  let rp = null;   // online payment: create the Razorpay order for exactly this total before taking an order number
  if (p.gateway){
    if (!rpKeys_()) throw bad_("Online payment isn't switched on yet. Please visit the shop to pay.");
    const o = rpCall_("post", "orders", { amount: Math.round(total * 100), currency: "INR", receipt: (idem || Utilities.getUuid()).slice(0, 40), notes: { name: name, phone: phone, shop: p.shop } });
    rp = { key: rpKeys_().id, orderId: o.id, amount: o.amount };
  }

  // 2. The locked part: check the key again, take the next number, append one row.
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (idem){ const prev = cache.get(IDEM_KEY + idem); if (prev) return JSON.parse(prev); }
    const sh = sheet_("Orders"), props = PropertiesService.getScriptProperties();
    let seq = Number(props.getProperty("ORDER_SEQ"));
    if (!(seq >= 1000)) seq = 999 + sh.getLastRow();   // first run: carry on from the old row-count numbering
    seq += 1;
    props.setProperty("ORDER_SEQ", String(seq));
    const id = "FS" + seq;
    sh.appendRow([id, created, name, phone, p.shop, pickup, itemsJson, total, rp ? rp.orderId : "", rp ? "unpaid" : "pending"]);
    const res = { id:id, total:total, pickupDate:pickup, shop:p.shop, status: rp ? "unpaid" : "pending" };
    if (rp) res.rp = rp;
    if (idem) cache.put(IDEM_KEY + idem, JSON.stringify(res), IDEM_TTL);
    return res;
  } finally { lock.releaseLock(); }
}
/* Looks up only the requested ids, in the last 300 rows, and caches each answer for 20 seconds. */
function statusOf_(ids){
  if (!ids.length) return [];
  reconcileUnpaid_(5, ids);
  const c = cache_(), got = c.getAll(ids.map(id => STATUS_KEY + id)), found = {};
  const todo = ids.filter(id => { const v = got[STATUS_KEY + id]; if (v) { found[id] = JSON.parse(v); return false; } return true; });
  if (todo.length){
    const sh = sheet_("Orders"), n = sh.getLastRow();
    if (n >= 2){
      const first = Math.max(2, n - 299);
      const rows = sh.getRange(first, 1, n - first + 1, ORDER_COLS.length).getValues(), put = {};
      rows.forEach(r => {
        const id = String(r[0]);
        if (todo.indexOf(id) < 0) return;
        const o = { id:id, status:String(r[9]), pickupDate:dateStr_(r[5]), total:Number(r[7]), shop:String(r[4]) };
        found[id] = o; put[STATUS_KEY + id] = JSON.stringify(o);
      });
      try { c.putAll(put, STATUS_TTL); } catch (e) {}
    }
  }
  return ids.map(id => found[id]).filter(Boolean);
}
function updateOrder_(id, status){
  if (STATUSES.indexOf(status) < 0) throw bad_("Unknown status.");
  const sh = sheet_("Orders"), ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  for (let i = 0; i < ids.length; i++){
    if (String(ids[i][0]) === String(id)){ sh.getRange(i + 2, ORDER_COLS.indexOf("status") + 1).setValue(status); cache_().remove(STATUS_KEY + id); return { id:id, status:status }; }
  }
  throw bad_("Order not found.");
}
function saveFruits_(list){
  if (!Array.isArray(list) || !list.length || list.length > 80) throw bad_("No fruits to save.");
  list.forEach(f => {
    if (!/^[a-z0-9-]{1,40}$/.test(String(f.id))) throw bad_("Bad fruit id: " + f.id);
    if (!String(f.name || "").trim()) throw bad_("Every fruit needs a name.");
    if (["kg","piece","box","size"].indexOf(f.unit) < 0) throw bad_("Unknown unit for " + f.name);
  });
  list.forEach(f => {   // recompute automatic prices on the server too
    if (f.auto && Number(f.trayCost) > 0 && Number(f.trayQty) > 0){
      f.price = Math.ceil(Math.round(Number(f.trayCost) * (1 + (Number(f.profitPct) || 0) / 100) / Number(f.trayQty) * 100) / 100);
      f.storePrice = Math.ceil(Math.round(f.price * (1 + (Number(f.storePct) || 0) / 100) * 100) / 100);
    }
  });
  const old = rows_("Fruits", FRUIT_COLS), oldIds = old.map(f => String(f.id)), oldPhoto = {};
  old.forEach(f => { oldPhoto[String(f.id)] = f.photo; });
  const rows = list.map(f => [String(f.id), String(f.name), String(f.te || ""), String(f.unit), Number(f.price) || 0, Number(f.step) || 1,
    Number(f.trayQty) || 0, Number(f.trayCost) || 0, String(f.color || "#B3123A"), !!f.active, Number(f.trayNet) || Number(f.trayQty) || 0, String(f.boxSize || "").slice(0, 20), f.photo === undefined ? cleanPhoto_(oldPhoto[String(f.id)]) : cleanPhoto_(f.photo), Number(f.storePrice) || Number(f.price) || 0, !!f.auto, Number(f.profitPct) || 0, Number(f.storePct) || 0,
    f.unit === "size" ? JSON.stringify(parseSizes_(f.sizes)) : "", !!f.deleted, f.wastePct === "" || f.wastePct == null ? "" : Number(f.wastePct) || 0]);
  const sh = sheet_("Fruits");
  if (sh.getMaxColumns() < FRUIT_COLS.length) sh.insertColumnsAfter(sh.getMaxColumns(), FRUIT_COLS.length - sh.getMaxColumns());
  FRUIT_COLS.forEach((c, i) => { if (sh.getRange(1, i + 1).getValue() !== c) sh.getRange(1, i + 1).setValue(c); });   // header for any new column, no need to run setup() again
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, FRUIT_COLS.length).clearContent();
  sh.getRange(2, 1, rows.length, FRUIT_COLS.length).setValues(rows);
  clearFruitCache_(oldIds.concat(list.map(f => String(f.id))));   // after the write, so nobody caches a half-written list
}

function readBook_(){
  return rows_("Book", BOOK_COLS).slice(-800).map(r => {
    let d = {}; try { d = JSON.parse(r.data || "{}"); } catch (e) {}
    d.date = dateStr_(r.date); d.shop = String(r.shop); return d;
  });
}
function saveBook_(row){
  if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.date))) throw bad_("Pick a valid day.");
  if (SHOPS.indexOf(row.shop) < 0) throw bad_("Pick a shop.");
  const data = JSON.stringify({ fruits: row.fruits || {}, cash: row.cash, upi: row.upi, expenses: row.expenses, brotherPaid: Array.isArray(row.brotherPaid) ? row.brotherPaid.slice(0, 200).map(p => ({ amount: Number(p && p.amount) || 0 })) : undefined, updated: row.updated });
  if (data.length > 40000) throw bad_("Entry is too large.");
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = sheet_("Book"), n = sh.getLastRow();
    const keys = n > 1 ? sh.getRange(2, 1, n - 1, 2).getValues() : [];
    for (let i = 0; i < keys.length; i++){
      if (dateStr_(keys[i][0]) === row.date && String(keys[i][1]) === row.shop){
        sh.getRange(i + 2, 3, 1, 2).setValues([[data, new Date().toISOString()]]); return row;
      }
    }
    sh.appendRow([row.date, row.shop, data, new Date().toISOString()]);
    return row;
  } finally { lock.releaseLock(); }
}

function cleanPhoto_(p){
  p = String(p || "");
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(p) && p.length <= 45000 ? p : "";
}

function parseSizes_(v){
  let a = v;
  if (typeof a === "string"){ try { a = JSON.parse(a || "[]"); } catch (e) { a = []; } }
  if (!Array.isArray(a)) return [];
  return a.slice(0, 8).map(s => ({ id: String(s.id || "").replace(/[^a-z0-9]/gi, "").slice(0, 8), name: String(s.name || "").slice(0, 20),
    min: Number(s.min) || 0, max: Number(s.max) || 0 })).filter(s => s.id);
}

/* AI assistant: the API key stays here in Script properties, never in the app. */
function aiChat_(p){
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty("ANTHROPIC_API_KEY");
  if (!apiKey) throw bad_("The assistant isn't set up yet. Add ANTHROPIC_API_KEY in Script properties.");
  const model = props.getProperty("AI_MODEL") || "claude-haiku-4-5-20251001";
  if (!Array.isArray(p.messages) || !p.messages.length) throw bad_("Empty message.");
  const body = { model: model, max_tokens: 4096, system: String(p.system || "").slice(0, 120000), messages: p.messages.slice(-24), tools: Array.isArray(p.tools) ? p.tools.slice(0, 12) : [] };
  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify(body)
  });
  let j = {}; try { j = JSON.parse(res.getContentText()); } catch (e) {}
  if (res.getResponseCode() >= 300) throw bad_((j.error && j.error.message) || ("The assistant had a problem (" + res.getResponseCode() + "). Try again."));
  return { content: j.content || [], stop_reason: j.stop_reason };
}
