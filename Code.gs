/**
 * FruitSlot backend – Google Apps Script + Google Sheet.
 * 1. Create a Google Sheet, open Extensions > Apps Script, paste this file.
 * 2. Run setup() once (allow access).
 * 3. Project Settings > Script properties: add OWNER_KEY = a secret only you know.
 *    For the AI assistant, also add ANTHROPIC_API_KEY (and optionally AI_MODEL, default claude-haiku-4-5-20251001).
 * 4. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Copy the URL into CONFIG.API_URL in index.html.
 */
const CUTOFF_HOUR = 21;            // 9 PM IST, must match index.html
const SHOPS = ["1town", "2town"];
const STATUSES = ["pending", "paid", "picked", "rejected"];
const FRUIT_COLS = ["id","name","te","unit","price","step","trayQty","trayCost","color","active","trayNet","boxSize","photo","storePrice","auto","profitPct","storePct","sizes"];
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
  ["trayNet","boxSize","photo","storePrice","auto","profitPct","storePct","sizes"].forEach(c => { const col = FRUIT_COLS.indexOf(c) + 1; if (f.getRange(1, col).getValue() !== c) f.getRange(1, col).setValue(c); });
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
      case "fruits":      return out_({ ok:true, data: readFruits_() });
      case "status":      return out_({ ok:true, data: statusOf_(String(p.ids || "").split(",").filter(String).slice(0, 20)) });
      case "order":       return out_({ ok:true, data: placeOrder_(p) });
      case "orders":      owner_(p.key); return out_({ ok:true, data: readOrders_() });
      case "updateOrder": owner_(p.key); return out_({ ok:true, data: updateOrder_(p.id, p.status) });
      case "book":        owner_(p.key); return out_({ ok:true, data: readBook_() });
      case "saveBook":    owner_(p.key); return out_({ ok:true, data: saveBook_(p.row) });
      case "ai":          owner_(p.key); return out_({ ok:true, data: aiChat_(p) });
      case "saveFruits":  owner_(p.key); saveFruits_(p.fruits); return out_({ ok:true, data: readFruits_() });
      default:            return out_({ ok:false, error:"Unknown action" });
    }
  } catch (err) {
    return out_({ ok:false, error: String(err.message || err) });
  }
}
function out_(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function owner_(key){
  const k = PropertiesService.getScriptProperties().getProperty("OWNER_KEY");
  if (!k || key !== k) throw new Error("Wrong owner key.");
}

function rows_(name, cols){
  const sh = sheet_(name), n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, cols.length).getValues().map(r => {
    const o = {}; cols.forEach((c, i) => o[c] = r[i]); return o;
  });
}
function readFruits_(){
  return rows_("Fruits", FRUIT_COLS).filter(f => f.id).map(f => ({
    id:String(f.id), name:String(f.name), te:String(f.te), unit:String(f.unit),
    price:Number(f.price), step:Number(f.step) || 1, trayQty:Number(f.trayQty), trayCost:Number(f.trayCost) || 0,
    color:String(f.color || "#B3123A"), active: f.active === true || String(f.active).toUpperCase() === "TRUE",
    trayNet: Number(f.trayNet) || Number(f.trayQty), boxSize: String(f.boxSize || ""), photo: String(f.photo || ""),
    storePrice: Number(f.storePrice) || 0, auto: f.auto === "" ? "" : (f.auto === true || String(f.auto).toUpperCase() === "TRUE"),
    profitPct: f.profitPct === "" ? "" : Number(f.profitPct), storePct: f.storePct === "" ? "" : Number(f.storePct),
    sizes: parseSizes_(f.sizes)
  }));
}
function dateStr_(v){
  return v instanceof Date ? Utilities.formatDate(v, "Asia/Kolkata", "yyyy-MM-dd") : String(v).slice(0, 10);
}
function readOrders_(){
  return rows_("Orders", ORDER_COLS).slice(-1000).map(o => ({
    id:String(o.id), created:String(o.created), name:String(o.name), phone:String(o.phone), shop:String(o.shop),
    pickupDate: dateStr_(o.pickupDate), items: JSON.parse(o.items || "[]"), total:Number(o.total), utr:String(o.utr), status:String(o.status)
  }));
}
function pickupDate_(){
  const now = new Date();
  const hour = Number(Utilities.formatDate(now, "Asia/Kolkata", "H"));
  return Utilities.formatDate(new Date(now.getTime() + (hour >= CUTOFF_HOUR ? 2 : 1) * 86400000), "Asia/Kolkata", "yyyy-MM-dd");
}

function placeOrder_(p){
  const name = String(p.name || "").trim().slice(0, 60);
  const phone = String(p.phone || "").replace(/\D/g, "");
  const utr = String(p.utr || "").replace(/\D/g, "");
  if (!name) throw new Error("Enter your name.");
  if (!/^[6-9]\d{9}$/.test(phone)) throw new Error("Enter a 10-digit mobile number.");
  if (SHOPS.indexOf(p.shop) < 0) throw new Error("Choose a shop to pick up from.");
  if (!/^\d{12}$/.test(utr)) throw new Error("Enter the 12-digit UTR from your payment screen.");
  if (!Array.isArray(p.items) || !p.items.length || p.items.length > 20) throw new Error("Your order is empty.");

  const fruits = readFruits_();
  const items = p.items.map(i => {
    const f = fruits.find(x => x.id === i.id && x.active);
    const qty = Math.round(Number(i.qty) * 10) / 10;
    if (!f) throw new Error("A fruit in your order is no longer available. Go back and check your order.");
    if (!(qty > 0) || qty > 50) throw new Error("Check the quantity for " + f.name + ".");
    if (f.unit === "size"){
      const s = f.sizes.filter(x => x.id === String(i.size))[0];
      if (!s) throw new Error("A size in your order is no longer available.");
      if (qty !== Math.round(qty)) throw new Error("Check the quantity for " + f.name + ".");
      const mid = (s.min + s.max) / 2;
      return { id:f.id, size:s.id, name:f.name + " " + s.name + " (" + s.min + "–" + s.max + " kg)", unit:"piece", qty:qty,
               price: Math.ceil(f.price * mid), kg: Math.round(mid * qty * 10) / 10 };
    }
    return { id:f.id, name:f.name, unit:f.unit, qty:qty, price:f.price };   // price always comes from the sheet
  });
  const total = items.reduce((s, i) => s + i.qty * i.price, 0);

  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = sheet_("Orders");
    if (rows_("Orders", ORDER_COLS).some(o => String(o.utr) === utr)) throw new Error("This UTR is already used for another order.");
    const id = "FS" + (1000 + sh.getLastRow());
    const pickup = pickupDate_();
    sh.appendRow([id, new Date().toISOString(), name, phone, p.shop, pickup, JSON.stringify(items), total, utr, "pending"]);
    return { id:id, total:total, pickupDate:pickup, shop:p.shop, status:"pending" };
  } finally { lock.releaseLock(); }
}
function statusOf_(ids){
  const all = rows_("Orders", ORDER_COLS);
  return ids.map(id => all.find(o => String(o.id) === id)).filter(Boolean)
    .map(o => ({ id:String(o.id), status:String(o.status), pickupDate:dateStr_(o.pickupDate), total:Number(o.total), shop:String(o.shop) }));
}
function updateOrder_(id, status){
  if (STATUSES.indexOf(status) < 0) throw new Error("Unknown status.");
  const sh = sheet_("Orders"), ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  for (let i = 0; i < ids.length; i++){
    if (String(ids[i][0]) === String(id)){ sh.getRange(i + 2, ORDER_COLS.indexOf("status") + 1).setValue(status); return { id:id, status:status }; }
  }
  throw new Error("Order not found.");
}
function saveFruits_(list){
  if (!Array.isArray(list) || !list.length || list.length > 80) throw new Error("No fruits to save.");
  list.forEach(f => {
    if (!/^[a-z0-9-]{1,40}$/.test(String(f.id))) throw new Error("Bad fruit id: " + f.id);
    if (!String(f.name || "").trim()) throw new Error("Every fruit needs a name.");
    if (["kg","piece","box","size"].indexOf(f.unit) < 0) throw new Error("Unknown unit for " + f.name);
  });
  list.forEach(f => {   // recompute automatic prices on the server too
    if (f.auto && Number(f.trayCost) > 0 && Number(f.trayQty) > 0){
      f.price = Math.ceil(Number(f.trayCost) * (1 + (Number(f.profitPct) || 0) / 100) / Number(f.trayQty));
      f.storePrice = Math.ceil(f.price * (1 + (Number(f.storePct) || 0) / 100));
    }
  });
  const rows = list.map(f => [String(f.id), String(f.name), String(f.te || ""), String(f.unit), Number(f.price) || 0, Number(f.step) || 1,
    Number(f.trayQty) || 0, Number(f.trayCost) || 0, String(f.color || "#B3123A"), !!f.active, Number(f.trayNet) || Number(f.trayQty) || 0, String(f.boxSize || "").slice(0, 20), cleanPhoto_(f.photo), Number(f.storePrice) || Number(f.price) || 0, !!f.auto, Number(f.profitPct) || 0, Number(f.storePct) || 0,
    f.unit === "size" ? JSON.stringify(parseSizes_(f.sizes)) : ""]);
  const sh = sheet_("Fruits");
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, FRUIT_COLS.length).clearContent();
  sh.getRange(2, 1, rows.length, FRUIT_COLS.length).setValues(rows);
}

function readBook_(){
  return rows_("Book", BOOK_COLS).slice(-800).map(r => {
    let d = {}; try { d = JSON.parse(r.data || "{}"); } catch (e) {}
    d.date = dateStr_(r.date); d.shop = String(r.shop); return d;
  });
}
function saveBook_(row){
  if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.date))) throw new Error("Pick a valid day.");
  if (SHOPS.indexOf(row.shop) < 0) throw new Error("Pick a shop.");
  const data = JSON.stringify({ fruits: row.fruits || {}, cash: row.cash, upi: row.upi, expenses: row.expenses, updated: row.updated });
  if (data.length > 40000) throw new Error("Entry is too large.");
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
  if (!apiKey) throw new Error("The assistant isn't set up yet. Add ANTHROPIC_API_KEY in Script properties.");
  const model = props.getProperty("AI_MODEL") || "claude-haiku-4-5-20251001";
  if (!Array.isArray(p.messages) || !p.messages.length) throw new Error("Empty message.");
  const body = { model: model, max_tokens: 1024, system: String(p.system || "").slice(0, 120000), messages: p.messages.slice(-24), tools: Array.isArray(p.tools) ? p.tools.slice(0, 12) : [] };
  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify(body)
  });
  let j = {}; try { j = JSON.parse(res.getContentText()); } catch (e) {}
  if (res.getResponseCode() >= 300) throw new Error((j.error && j.error.message) || ("The assistant had a problem (" + res.getResponseCode() + "). Try again."));
  return { content: j.content || [], stop_reason: j.stop_reason };
}
