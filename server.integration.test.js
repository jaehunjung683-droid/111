'use strict';
/* 실제 ws 서버를 띄워 두 클라이언트가 접속·교전하는 전체 흐름을 확인 (npm install 후 실행) */
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..');
let proc, port;
const sockets = [];

async function freePort() {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const p = probe.address().port; await new Promise(r => probe.close(r)); return p;
}
const getJson = (p) => new Promise((resolve, reject) => {
  http.get(`http://127.0.0.1:${port}${p}`, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(JSON.parse(b))); }).on('error', reject);
});
class Peer {
  constructor(ws) {
    this.ws = ws; this.inbox = []; this.waiters = [];
    ws.on('message', raw => {
      const m = JSON.parse(raw.toString());
      const i = this.waiters.findIndex(w => w.pred(m));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(m); else this.inbox.push(m);
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  waitFor(pred, ms = 4000) {
    const i = this.inbox.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve: v => { clearTimeout(t); resolve(v); } };
      const t = setTimeout(() => { this.waiters = this.waiters.filter(x => x !== w); reject(new Error('timeout')); }, ms);
      this.waiters.push(w);
    });
  }
}
async function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`); sockets.push(ws); await once(ws, 'open'); return new Peer(ws);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('서버 기동과 /health', async () => {
  port = await freePort();
  proc = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), LOG_LEVEL: 'silent', MATCH_DURATION_SECONDS: '60' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { const h = await getJson('/health'); assert.equal(h.ok, true); assert.equal(h.authoritative, true); return; } catch (_) { await sleep(100); } }
  assert.fail('server did not start');
});

test('두 플레이어: 방 생성 → 시작 → 서버 피해량으로 처치', async () => {
  const a = await connect(), b = await connect();
  a.send({ type: 'create_room', name: 'Alice', channelId: '1', matchMode: 'ffa' });
  const ja = await a.waitFor(m => m.type === 'room_joined');
  b.send({ type: 'join_room', name: 'Bob', roomCode: ja.roomCode });
  const jb = await b.waitFor(m => m.type === 'room_joined');
  a.send({ type: 'start_match' });
  await a.waitFor(m => m.type === 'match_started');
  a.send({ type: 'ready' }); b.send({ type: 'ready' });
  await a.waitFor(m => m.type === 'round_started');
  await sleep(2700); // 스폰 보호 대기
  a.send({ type: 'player_state', x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0, weapon: 'awp' });
  b.send({ type: 'player_state', x: 0, y: 1.6, z: -20, yaw: 0, pitch: 0, weapon: 'aug' });
  await sleep(100);
  a.send({ type: 'fire', weapon: 'awp', id: 1, x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0 });
  a.send({ type: 'hit', targetId: jb.playerId, weapon: 'awp', shotId: 1, head: false, damage: 9999 });
  const hp = await b.waitFor(m => m.type === 'hp' && m.dmg);
  assert.equal(hp.hp, 80);                 // 150 - 70 (서버 무기표, 조작된 damage 무시)
  assert.equal(hp.dmg, 70);
  const confirm = await a.waitFor(m => m.type === 'hit_confirmed');
  assert.equal(confirm.killed, false);
});

test('메시지 폭주 연결은 정책 종료 코드로 닫힌다', async () => {
  const c = await connect();
  const closed = new Promise(res => c.ws.on('close', code => res(code)));
  for (let i = 0; i < 400; i++) c.send({ type: 'ping', t: i });
  assert.equal(await closed, 1008);
});

after(() => { for (const s of sockets) try { s.terminate(); } catch (_) {} if (proc) proc.kill(); });
