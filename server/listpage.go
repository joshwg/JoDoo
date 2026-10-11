package main

import (
	"net/http"
)

// handleListPage serves the browser view/edit page for a share
// (https://server/<key>). Like the join page it is registered without
// requireAuth and is completely static: it never touches the store, so it
// neither confirms nor denies that a key exists, and it embeds no list data.
// Everything the page shows arrives client-side, after the visitor supplies
// the server access key (kept in the browser's localStorage, exactly as the
// app keeps it in secure storage). Share links still never carry the server
// key - a person opening this page must get it out-of-band.
//
// The page speaks the same protocol as the app: it merges its records with
// every incoming snapshot using the item-level last-write-wins rules from
// app/src/syncCore.ts (the server relays items verbatim and never merges, so
// every client must), and deletes by writing tombstones. Keep the merge and
// the item shapes here in step with syncCore.ts.
//
// Styling deliberately mirrors the app: the Post-It task cards come from
// app/src/components/TaskCard.tsx + colors.ts, the shopping rows from
// ShoppingSection.tsx. Change the look there and this page should follow.
func (s *Server) handleListPage(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if !joinKeyPattern.MatchString(key) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(listPageHTML))
}

const listPageHTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jodoo list</title>
<style>
  /* Same canvas and type as the app (System font, #fffdf5 background). */
  body { font-family: -apple-system, Roboto, "Segoe UI", sans-serif; background: #fffdf5;
         color: #222; margin: 0; padding: 0 0 32px; }
  .wrap { max-width: 560px; margin: 0 auto; }
  .card { background: #fff; border-radius: 12px; padding: 24px; margin: 48px 16px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.12); }
  h1 { font-size: 20px; font-weight: bold; margin: 0; display: inline; }
  .head { padding: 16px 16px 0; }
  .kind { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px;
          margin-left: 8px; }
  .status { font-size: 12px; padding: 4px 16px 8px; }
  .status.live { color: #2e7d32; }
  .status.off { color: #b26a00; }
  ul { list-style: none; margin: 0; padding: 0; }
  button { font: inherit; border: none; background: none; cursor: pointer; padding: 4px; }

  /* To Do: Post-It cards - TaskCard.tsx made of CSS. */
  li.todo { border-radius: 4px; padding: 12px; margin: 6px 12px;
            box-shadow: 1px 2px 3px rgba(0,0,0,0.2); }
  .trow { display: flex; align-items: center; gap: 8px; }
  .title { flex: 1; min-width: 0; font-size: 16px; font-weight: bold; color: #222;
           overflow-wrap: break-word; }
  .sub { font-size: 14px; color: #333; margin: 6px 0 0 30px; white-space: pre-wrap;
         overflow-wrap: break-word; }
  .due { font-size: 12px; color: rgba(0,0,0,0.55); margin: 6px 0 0 30px; }
  .due.overdue { color: #B00020; font-weight: 600; }
  li.todo .cb { width: 22px; height: 22px; border-radius: 4px; flex: none;
                border: 1.5px solid rgba(0,0,0,0.45); background: rgba(255,255,255,0.5);
                color: #333; font-weight: bold; font-size: 14px; line-height: 1; }
  li.done .title, li.done .sub, li.done .name {
    text-decoration: line-through; color: rgba(0,0,0,0.4); }

  /* Shopping: plain divided rows - ShoppingSection.tsx's item list. */
  li.shop { display: flex; align-items: center; gap: 10px; padding: 10px 16px;
            border-bottom: 1px solid #ddd; }
  .name { flex: 1; min-width: 0; font-size: 16px; color: #222; overflow-wrap: break-word; }
  li.shop .cb { width: 22px; height: 22px; border-radius: 4px; flex: none;
                border: 1.5px solid #999; background: #fff;
                color: #fff; font-weight: bold; font-size: 14px; line-height: 1; }
  li.shop.done .cb { background: #1a5fb4; border-color: #1a5fb4; }
  li.shop.done .name { color: #999; }

  .icon { color: rgba(0,0,0,0.45); font-size: 16px; flex: none; }
  .icon:hover { color: #1a5fb4; }
  .primary { background: #1a5fb4; color: #fff; font-weight: bold; border-radius: 8px;
             padding: 10px 20px; }
  .linkish { color: #1a5fb4; font-size: 13px; text-decoration: none; }
  input[type=text], input[type=password], input[type=date], textarea {
    font: inherit; border: 1px solid #ccc; border-radius: 8px; padding: 8px 10px;
    background: #fff; box-sizing: border-box; width: 100%; }
  .addrow { display: flex; gap: 8px; margin: 14px 16px 0; }
  .addrow input { flex: 1; }
  .editbox { margin-top: 8px; display: grid; gap: 6px; }
  .editbox .row { display: flex; gap: 8px; justify-content: flex-end; }
  form.keyform { display: grid; gap: 10px; }
  .note { color: #555; font-size: 14px; line-height: 1.5; }
  .error { color: #b00020; font-size: 14px; }
  .footer { margin: 20px 16px 0; display: flex; gap: 16px; flex-wrap: wrap; }
  .hidden { display: none !important; }
</style>
</head>
<body>
<div class="wrap">

<div class="card hidden" id="keyCard">
  <h1>Jodoo shared list</h1>
  <p class="note">This page can show and edit the list, but only with the
     server's access key. Ask the person who shared the list for it &mdash;
     the link deliberately does not include it.</p>
  <form class="keyform" id="keyForm">
    <input type="password" id="keyInput" placeholder="Server access key" autocomplete="off">
    <div class="error hidden" id="keyError"></div>
    <button class="primary" type="submit">Connect</button>
  </form>
</div>

<div class="card hidden" id="fatalCard">
  <h1 id="fatalTitle"></h1>
  <p class="note" id="fatalText"></p>
</div>

<div class="hidden" id="listCard">
  <div class="head">
    <h1 id="listName"></h1><button class="icon" id="renameBtn" title="Rename list">&#9998;</button>
    <span class="kind" id="kindBadge"></span>
    <div class="editbox hidden" id="renameBox">
      <input type="text" id="renameInput">
      <div class="row">
        <button class="linkish" id="renameCancel">Cancel</button>
        <button class="primary" id="renameSave">Save</button>
      </div>
    </div>
  </div>
  <div class="status" id="status"></div>
  <ul id="items"></ul>
  <div class="addrow">
    <input type="text" id="addInput" placeholder="">
    <input type="text" id="addAmount" placeholder="Amount" style="max-width:110px">
    <button class="primary" id="addBtn">Add</button>
  </div>
  <div class="footer">
    <a class="linkish" id="openApp" href="#">Open in the Jodoo app</a>
    <button class="linkish" id="changeKey">Change server key</button>
  </div>
</div>

</div>
<script>
"use strict";
var shareKey = location.pathname.replace(/^\//, "");
var KEY_STORE = "jodooServerKey";
var state = { kind: null, name: "", version: 0, records: [] };
var ws = null, backoff = 1000, pendingPush = false, editingUuid = null;

// app/src/colors.ts POSTIT_COLORS, in the same rotation order.
var POSTIT = ["#FFF6A5", "#FFD9A8", "#FFB9C2", "#F6C6EA",
              "#DCC9F7", "#BDE0FE", "#B7F0DA", "#D5EFA9"];
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function $(id) { return document.getElementById(id); }
// localStorage can throw (private browsing, blocked site data); degrade to
// asking for the key each visit rather than breaking the page.
function getKey() { try { return localStorage.getItem(KEY_STORE) || ""; } catch (_) { return sessionKey; } }
function setKey(v) { sessionKey = v; try { localStorage.setItem(KEY_STORE, v); } catch (_) {} }
function clearKey() { sessionKey = ""; try { localStorage.removeItem(KEY_STORE); } catch (_) {} }
var sessionKey = "";
function show(id) { $(id).classList.remove("hidden"); }
function hide(id) { $(id).classList.add("hidden"); }
function nowIso() { return new Date().toISOString(); }
function newUuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 3 | 8)).toString(16);
  });
}
// app/src/dates.ts formatIso / isOverdue, for identical "Due" lines.
function formatIso(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + ", " + m[1];
}
function todayIso() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0");
}

// ---- protocol: mirrors app/src/syncCore.ts ----

function parseTs(ts) {
  if (!ts) return 0;
  var ms = Date.parse(String(ts).replace(/\.(\d+)/, function (_, f) {
    return "." + (f + "00").slice(0, 3);
  }));
  return isNaN(ms) ? 0 : ms;
}

function normalize(items) {
  var out = [];
  (items || []).forEach(function (i, index) {
    if (!i || typeof i.uuid !== "string" || i.uuid === "") return;
    var r;
    if (state.kind === "todo") {
      r = {
        uuid: i.uuid,
        title: String(i.title == null ? "" : i.title),
        description: String(i.description == null ? "" : i.description),
        dueDate: i.dueDate == null ? null : i.dueDate,
        colorIndex: isFinite(i.colorIndex) ? i.colorIndex : index % 8,
        done: !!i.done,
        position: isFinite(i.position) ? i.position : index,
        updatedAt: typeof i.updatedAt === "string" ? i.updatedAt : "",
      };
    } else {
      r = {
        uuid: i.uuid,
        name: String(i.name == null ? "" : i.name),
        checked: !!i.checked,
        position: isFinite(i.position) ? i.position : index,
        updatedAt: typeof i.updatedAt === "string" ? i.updatedAt : "",
        amount: typeof i.amount === "string" && i.amount !== "" ? i.amount : null,
      };
    }
    if (i.deleted === true) r.deleted = true;
    out.push(r);
  });
  return out;
}

function recordKey(i) {
  if (state.kind === "todo") {
    return JSON.stringify([i.uuid, i.title, i.description,
      i.dueDate == null ? null : i.dueDate, i.colorIndex, !!i.done,
      i.position, i.updatedAt, i.deleted === true]);
  }
  return JSON.stringify([i.uuid, i.name, !!i.checked, i.position,
    i.updatedAt, i.amount == null ? null : i.amount, i.deleted === true]);
}

function merge(local, remote) {
  var chosen = {};
  function consider(r) {
    var prev = chosen[r.uuid];
    if (!prev) { chosen[r.uuid] = r; return; }
    var tPrev = parseTs(prev.updatedAt), tNext = parseTs(r.updatedAt);
    if (tNext > tPrev || (tNext === tPrev && recordKey(r) < recordKey(prev))) {
      chosen[r.uuid] = r;
    }
  }
  local.forEach(consider);
  remote.forEach(consider);
  var all = Object.keys(chosen).map(function (u) { return chosen[u]; });
  function byUuid(a, b) { return a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0; }
  var live = all.filter(function (r) { return !r.deleted; })
    .sort(function (a, b) { return a.position - b.position || byUuid(a, b); });
  var dead = all.filter(function (r) { return r.deleted; }).sort(byUuid);
  return live.concat(dead);
}

function liveRecords() {
  return state.records.filter(function (r) { return !r.deleted; });
}

// ---- networking ----

function connect() {
  var key = getKey();
  if (!key) { askForKey(""); return; }
  fetch("/api/lists/" + shareKey, { headers: { "X-Server-Key": key } })
    .then(function (res) {
      if (res.status === 401) { askForKey("That server key was not accepted."); return null; }
      if (res.status === 404) {
        fatal("Unknown list", "This list does not exist on this server. It may " +
          "have expired: shares are deleted after 30 days without updates. " +
          "Whoever owns the list can share it again with a new key.");
        return null;
      }
      if (!res.ok) { fatal("Server error", "The server could not fetch the list. Try again later."); return null; }
      return res.json();
    })
    .then(function (sh) {
      if (!sh) return;
      state.kind = sh.kind;
      adoptSnapshot(sh.version, sh.name, sh.items);
      hide("keyCard"); hide("fatalCard"); show("listCard");
      $("addInput").placeholder = state.kind === "todo" ? "New task" : "New item";
      if (state.kind === "todo") $("addAmount").classList.add("hidden");
      $("kindBadge").textContent = state.kind === "todo" ? "to do" : "shopping";
      $("openApp").href = "jodoo://join?key=" + shareKey + "&server=" +
        encodeURIComponent(location.protocol + "//" + location.host);
      openWs();
    })
    .catch(function () { fatal("Server unreachable", "Could not reach the server. Check the address and try again."); });
}

function openWs() {
  var key = getKey();
  var proto = location.protocol === "https:" ? "wss://" : "ws://";
  ws = new WebSocket(proto + location.host + "/ws/" + shareKey +
    "?serverKey=" + encodeURIComponent(key));
  ws.onopen = function () {
    backoff = 1000;
    setStatus("live", "Live - changes sync instantly");
    if (pendingPush) push();
  };
  ws.onmessage = function (e) {
    var m; try { m = JSON.parse(e.data); } catch (_) { return; }
    if (m.type !== "snapshot") return;
    adoptSnapshot(m.version, m.name, m.items);
  };
  ws.onclose = function () {
    ws = null;
    setStatus("off", "Reconnecting…");
    setTimeout(openWs, backoff);
    backoff = Math.min(backoff * 2, 30000);
  };
}

function adoptSnapshot(version, name, items) {
  if (version < state.version) return; // stale frame
  state.version = version;
  state.records = merge(state.records, normalize(items));
  if (name) state.name = name;
  render();
}

// Sends the whole merged record set (tombstones included): the server stores
// updates verbatim, so partial sends would clobber concurrent edits.
function push() {
  if (!ws || ws.readyState !== 1) { pendingPush = true; return; }
  pendingPush = false;
  ws.send(JSON.stringify({
    type: "update", name: state.name, items: state.records, updatedAt: nowIso(),
  }));
}

function setStatus(cls, text) {
  var el = $("status");
  el.className = "status " + cls;
  el.textContent = text;
}

function askForKey(message) {
  hide("listCard"); hide("fatalCard"); show("keyCard");
  var err = $("keyError");
  if (message) { err.textContent = message; err.classList.remove("hidden"); }
  else err.classList.add("hidden");
  $("keyInput").focus();
}

function fatal(title, text) {
  hide("listCard"); hide("keyCard");
  $("fatalTitle").textContent = title;
  $("fatalText").textContent = text;
  show("fatalCard");
}

// ---- edits ----

function touch(r) { r.updatedAt = nowIso(); }

function toggle(r) {
  if (state.kind === "todo") r.done = !r.done; else r.checked = !r.checked;
  touch(r); afterEdit();
}

function removeRecord(r) {
  var t = { uuid: r.uuid, position: 0, updatedAt: nowIso(), deleted: true };
  if (state.kind === "todo") {
    t.title = ""; t.description = ""; t.dueDate = null; t.colorIndex = 0; t.done = false;
  } else {
    t.name = ""; t.checked = false; t.amount = null;
  }
  state.records = state.records.filter(function (x) { return x.uuid !== r.uuid; });
  state.records.push(t);
  afterEdit();
}

function addRecord() {
  var text = $("addInput").value.trim();
  if (!text) return;
  var live = liveRecords();
  var pos = live.reduce(function (m, r) { return Math.max(m, r.position); }, 0) + 1;
  var r = { uuid: newUuid(), position: pos, updatedAt: nowIso() };
  if (state.kind === "todo") {
    r.title = text; r.description = ""; r.dueDate = null;
    r.colorIndex = live.length % 8; r.done = false;
  } else {
    r.name = text; r.checked = false;
    var amount = $("addAmount").value.trim();
    r.amount = amount ? amount : null;
  }
  state.records.push(r);
  $("addInput").value = ""; $("addAmount").value = "";
  afterEdit();
  $("addInput").focus();
}

function afterEdit() {
  state.records = merge(state.records, []); // canonical order
  render();
  push();
}

// ---- rendering (textContent only - list content is untrusted) ----

function render() {
  $("listName").textContent = state.name;
  document.title = state.name ? state.name + " - Jodoo" : "Jodoo list";
  var ul = $("items");
  ul.textContent = "";
  liveRecords().forEach(function (r) {
    ul.appendChild(state.kind === "todo" ? renderTask(r) : renderShopItem(r));
  });
}

function checkboxFor(r, checkedFlag) {
  var cb = document.createElement("button");
  cb.className = "cb";
  cb.title = checkedFlag ? "Mark not done" : "Mark done";
  cb.textContent = checkedFlag ? "✓" : "";
  cb.onclick = function () { toggle(r); };
  return cb;
}

function iconButtons(li, r) {
  var edit = document.createElement("button");
  edit.className = "icon"; edit.title = "Edit"; edit.innerHTML = "&#9998;";
  edit.onclick = function () {
    editingUuid = editingUuid === r.uuid ? null : r.uuid;
    render();
  };
  li.appendChild(edit);
  var del = document.createElement("button");
  del.className = "icon"; del.title = "Delete"; del.textContent = "✕";
  del.onclick = function () {
    var label = state.kind === "todo" ? r.title : r.name;
    if (confirm('Delete "' + label + '"?')) removeRecord(r);
  };
  li.appendChild(del);
}

function renderTask(r) {
  var li = document.createElement("li");
  li.className = "todo" + (r.done ? " done" : "");
  var idx = ((r.colorIndex % 8) + 8) % 8;
  li.style.background = POSTIT[idx];

  var row = document.createElement("div");
  row.className = "trow";
  row.appendChild(checkboxFor(r, r.done));
  var title = document.createElement("div");
  title.className = "title";
  title.textContent = r.title;
  row.appendChild(title);
  iconButtons(row, r);
  li.appendChild(row);

  if (r.description) {
    var sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = r.description;
    li.appendChild(sub);
  }
  if (r.dueDate) {
    var due = document.createElement("div");
    due.className = "due" + (!r.done && r.dueDate < todayIso() ? " overdue" : "");
    due.textContent = "Due " + formatIso(r.dueDate);
    li.appendChild(due);
  }
  if (editingUuid === r.uuid) li.appendChild(buildEditor(r));
  return li;
}

function renderShopItem(r) {
  var li = document.createElement("li");
  li.className = "shop" + (r.checked ? " done" : "");
  li.appendChild(checkboxFor(r, r.checked));
  var name = document.createElement("div");
  name.className = "name";
  name.textContent = r.name + (r.amount ? " (" + r.amount + ")" : "");
  if (editingUuid === r.uuid) name.appendChild(buildEditor(r));
  li.appendChild(name);
  iconButtons(li, r);
  return li;
}

function buildEditor(r) {
  var box = document.createElement("div");
  box.className = "editbox";
  var text = document.createElement("input");
  text.type = "text";
  text.value = state.kind === "todo" ? r.title : r.name;
  box.appendChild(text);
  var desc, due, amount;
  if (state.kind === "todo") {
    desc = document.createElement("textarea");
    desc.rows = 2; desc.placeholder = "Description";
    desc.value = r.description;
    box.appendChild(desc);
    due = document.createElement("input");
    due.type = "date"; due.value = r.dueDate || "";
    box.appendChild(due);
  } else {
    amount = document.createElement("input");
    amount.type = "text"; amount.placeholder = "Amount";
    amount.value = r.amount || "";
    box.appendChild(amount);
  }
  var row = document.createElement("div");
  row.className = "row";
  var cancel = document.createElement("button");
  cancel.className = "linkish"; cancel.textContent = "Cancel";
  cancel.onclick = function () { editingUuid = null; render(); };
  row.appendChild(cancel);
  var save = document.createElement("button");
  save.className = "primary"; save.textContent = "Save";
  save.onclick = function () {
    var v = text.value.trim();
    if (!v) return;
    if (state.kind === "todo") {
      r.title = v;
      r.description = desc.value.trim();
      r.dueDate = due.value || null;
    } else {
      r.name = v;
      r.amount = amount.value.trim() || null;
    }
    touch(r);
    editingUuid = null;
    afterEdit();
  };
  row.appendChild(save);
  box.appendChild(row);
  return box;
}

// ---- wiring ----

$("keyForm").onsubmit = function (e) {
  e.preventDefault();
  var v = $("keyInput").value.trim();
  if (!v) return;
  setKey(v);
  connect();
};
$("changeKey").onclick = function () {
  clearKey();
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  askForKey("");
};
$("addBtn").onclick = addRecord;
$("addInput").addEventListener("keydown", function (e) {
  if (e.key === "Enter") addRecord();
});
$("renameBtn").onclick = function () {
  $("renameInput").value = state.name;
  show("renameBox");
  $("renameInput").focus();
};
$("renameCancel").onclick = function () { hide("renameBox"); };
$("renameSave").onclick = function () {
  var v = $("renameInput").value.trim();
  hide("renameBox");
  if (!v || v === state.name) return;
  state.name = v;
  render();
  push();
};

connect();
</script>
</body>
</html>
`
