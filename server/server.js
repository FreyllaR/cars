'use strict';
// Turbo Lap server: a lap-record leaderboard (HTTP JSON) and online race rooms (WebSocket relay).
// No dependencies. Caddy proxies /api/* and /ws on the game's domain to this process.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = +process.env.PORT || 4100;
const DATA = process.env.DATA || path.join(__dirname, 'data');
const MAPS = ['valley', 'canyon', 'pass', 'city', 'volcano', 'beach', 'jungle', 'space'];
const VEHICLES = /^[a-z0-9]{2,16}$/;
const MAX_PLAYERS = 5;
const RELAYED = new Set(['s', 'b', 'hz', 'oil', 'fin']);
const STATIC = process.env.STATIC ? path.resolve(process.env.STATIC) : null;

// ---------- leaderboard ----------
fs.mkdirSync(DATA, { recursive: true });
const SCORES = path.join(DATA, 'scores.json');
let scores = {};
try { scores = JSON.parse(fs.readFileSync(SCORES, 'utf8')) || {}; } catch (e) { scores = {}; }
let saveTimer = null;
function saveScores() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = SCORES + '.tmp';
    fs.writeFile(tmp, JSON.stringify(scores), err => { if (!err) fs.rename(tmp, SCORES, () => {}); });
  }, 400);
}
const cleanName = n => String(n || '').replace(/[\u0000-\u001f\u007f<>"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Pilot';
const hits = new Map(); // simple per-IP rate limit
function limited(ip, max, windowMs) {
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < windowMs);
  list.push(now); hits.set(ip, list);
  return list.length > max;
}
setInterval(() => { const now = Date.now(); for (const [ip, l] of hits) if (!l.some(t => now - t < 120000)) hits.delete(ip); }, 60000).unref();
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > max) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function postScore(body) {
  const map = body.map, time = +body.time, name = cleanName(body.name), car = String(body.car || '');
  if (!MAPS.includes(map) || !isFinite(time) || time < 8 || time > 600 || !VEHICLES.test(car)) return { error: 'invalid' };
  const list = scores[map] || (scores[map] = []);
  const old = list.find(r => r.name.toLowerCase() === name.toLowerCase());
  if (old) { if (time >= old.time) return { ok: true, rank: list.indexOf(old) + 1, best: old.time, improved: false }; Object.assign(old, { time, car, date: Date.now() }); }
  else list.push({ name, time: Math.round(time * 1000) / 1000, car, date: Date.now() });
  list.sort((a, b) => a.time - b.time);
  if (list.length > 200) list.length = 200;
  saveScores();
  const me = list.find(r => r.name.toLowerCase() === name.toLowerCase());
  return { ok: true, rank: me ? list.indexOf(me) + 1 : 0, best: me ? me.time : time, improved: true };
}

const server = http.createServer(async (req, res) => {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const send = (code, obj) => { if (res.headersSent) return; res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  try {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/api/ping') return send(200, { ok: true, now: Date.now(), rooms: rooms.size });
    if (url.pathname === '/api/scores' && req.method === 'GET') {
      const map = url.searchParams.get('map');
      if (!MAPS.includes(map)) return send(400, { error: 'unknown map' });
      return send(200, { map, top: (scores[map] || []).slice(0, 30) });
    }
    if (url.pathname === '/api/scores' && req.method === 'POST') {
      if (limited(ip, 30, 60000)) return send(429, { error: 'slow down' });
      const body = JSON.parse(await readBody(req, 2048) || '{}');
      const r = postScore(body);
      return send(r.error ? 400 : 200, r);
    }
    if (STATIC && req.method === 'GET' && !url.pathname.startsWith('/api')) { // optional static files, for running everything locally
      const file = path.join(STATIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([.][.][/\\])+/, ''));
      if (!file.startsWith(STATIC)) return send(403, { error: 'forbidden' });
      return fs.readFile(file, (err, buf) => {
        if (err) return send(404, { error: 'not found' });
        res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' }); res.end(buf);
      });
    }
    send(404, { error: 'not found' });
  } catch (e) { send(400, { error: 'bad request' }); }
});

// ---------- minimal WebSocket (RFC 6455): text frames, ping/pong, close ----------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function frame(str) {
  const data = Buffer.from(str, 'utf8'), n = data.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : null;
  if (!head) { const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return Buffer.concat([h, data]); }
  return Buffer.concat([head, data]);
}
class Client {
  constructor(sock) {
    this.sock = sock; this.buf = Buffer.alloc(0); this.id = crypto.randomBytes(4).toString('hex'); this.alive = true; this.room = null;
    this.name = 'Pilot'; this.car = 'start'; this.color = '#ffc629'; this.winAt = 0; this.winN = 0;
    sock.on('data', d => this.onData(d));
    sock.on('close', () => leave(this));
    sock.on('error', () => sock.destroy());
    this.send({ t: 'hello', id: this.id, now: Date.now() });
  }
  send(obj) {
    if (this.sock.destroyed) return;
    if (this.sock.writableLength > 1 << 20) return this.close(); // a client that stops reading is dropped
    this.sock.write(frame(typeof obj === 'string' ? obj : JSON.stringify(obj)));
  }
  close() { try { this.sock.end(Buffer.from([0x88, 0])); } catch (e) {} this.sock.destroy(); }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    if (this.buf.length > 1 << 20) return this.close();
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1], op = b0 & 15, masked = b1 & 128;
      let len = b1 & 127, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 65536 || !masked) return this.close();
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4), body = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      if (!(b0 & 128) || op === 0) return this.close(); // fragmented messages are not used by the game
      if (op === 8) return this.close();
      if (op >= 8 && len > 125) return this.close(); // control frames are at most 125 bytes
      if (op === 9) { this.sock.write(Buffer.concat([Buffer.from([0x8a, body.length]), body])); continue; }
      if (op === 10) { this.alive = true; continue; }
      if (op === 1) {
        this.alive = true;
        let msg; try { msg = JSON.parse(body.toString('utf8')); } catch (e) { continue; }
        if (!msg || typeof msg !== 'object' || Array.isArray(msg)) continue;
        if (RELAYED.has(msg.t)) { // race traffic is capped at ~60 messages a second; room commands always pass
          const now = Date.now();
          if (now - this.winAt > 1000) { this.winAt = now; this.winN = 0; }
          if (++this.winN > 60) continue;
        }
        try { onMessage(this, msg); } catch (e) { console.error('message failed', e && e.message); }
      }
    }
  }
}
server.on('upgrade', (req, sock) => {
  let url; try { url = new URL(req.url, 'http://local'); } catch (e) { sock.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (url.pathname !== '/ws' || !key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Accept: ' + accept, '', ''].join('\r\n'));
  sock.setNoDelay(true);
  const c = new Client(sock);
  clients.add(c);
});
const clients = new Set();
setInterval(() => { // heartbeat: drop clients that stop answering pings
  for (const c of clients) {
    if (c.sock.destroyed) { clients.delete(c); continue; }
    if (!c.alive) { c.close(); clients.delete(c); continue; }
    c.alive = false; try { c.sock.write(Buffer.from([0x89, 0])); } catch (e) {}
  }
}, 20000).unref();

// ---------- rooms ----------
const rooms = new Map();
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() { let c; do { c = Array.from({ length: 4 }, () => LETTERS[crypto.randomInt(LETTERS.length)]).join(''); } while (rooms.has(c)); return c; }
const pub = c => ({ id: c.id, name: c.name, car: c.car, color: c.color });
function roomState(r) { return { t: 'room', code: r.code, host: r.host.id, started: r.started, cfg: r.cfg, players: [...r.clients].map(pub) }; }
function broadcast(r, obj, except) { const s = JSON.stringify(obj); for (const c of r.clients) if (c !== except) c.send(s); }
function setProfile(c, m) {
  c.name = cleanName(m.name); c.car = VEHICLES.test(String(m.car || '')) ? m.car : 'start';
  c.color = /^#[0-9a-f]{6}$/i.test(String(m.color || '')) ? m.color : '#ffc629';
}
function leave(c) {
  clients.delete(c);
  const r = c.room; if (!r) return;
  r.clients.delete(c); c.room = null;
  if (!r.clients.size) { rooms.delete(r.code); return; }
  if (r.host === c) {
    if (r.started) { broadcast(r, { t: 'closed', reason: 'host' }); for (const o of r.clients) o.room = null; rooms.delete(r.code); return; }
    r.host = r.clients.values().next().value;
  }
  broadcast(r, { t: 'left', id: c.id });
  broadcast(r, roomState(r));
}
function onMessage(c, m) {
  const r = c.room;
  switch (m.t) {
    case 'ping': c.send({ t: 'pong', c: m.c, s: Date.now() }); return;
    case 'create': {
      if (r) leave(c);
      setProfile(c, m);
      const room = { code: newCode(), host: c, clients: new Set([c]), started: false, cfg: { map: 'valley', laps: 3, bots: true } };
      rooms.set(room.code, room); c.room = room; c.send(roomState(room)); return;
    }
    case 'join': {
      const room = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!room) return c.send({ t: 'error', e: 'noroom' });
      if (room.started) return c.send({ t: 'error', e: 'started' });
      if (room === r) { c.send(roomState(room)); return; }
      if (room.clients.size >= MAX_PLAYERS) return c.send({ t: 'error', e: 'full' });
      if (r) leave(c);
      setProfile(c, m); room.clients.add(c); c.room = room;
      broadcast(room, roomState(room)); return;
    }
    case 'profile': if (r && !r.started) { setProfile(c, m); broadcast(r, roomState(r)); } return;
    case 'leave': if (r) leave(c); return;
    case 'cfg':
      if (!r || r.host !== c || r.started) return;
      r.cfg = { map: MAPS.includes(m.map) ? m.map : r.cfg.map, laps: [1, 3, 5].includes(m.laps) ? m.laps : r.cfg.laps, bots: !!m.bots };
      broadcast(r, roomState(r)); return;
    case 'start': {
      if (!r || r.host !== c || r.started) return;
      r.started = true;
      const humans = [...r.clients].map(pub), bots = r.cfg.bots ? Math.max(0, MAX_PLAYERS - humans.length) : 0;
      broadcast(r, { t: 'start', map: r.cfg.map, laps: r.cfg.laps, seed: crypto.randomInt(1e9), startAt: Date.now() + 4800, humans, bots });
      return;
    }
    case 'lobby': if (r && r.host === c) { r.started = false; broadcast(r, roomState(r)); } return;
    case 'b': case 'hz': // bots and hazards are simulated by the host only
      if (r && r.started && r.host === c) { m.id = c.id; broadcast(r, m, c); }
      return;
    case 's': case 'oil': case 'fin':
      if (r && r.started) { m.id = c.id; broadcast(r, m, c); }
      return;
  }
}

server.listen(PORT, '127.0.0.1', () => console.log('turbo-krug server on', PORT));

process.on('uncaughtException', e => console.error('uncaught', e && e.message));
process.on('unhandledRejection', e => console.error('unhandled', e && e.message));
