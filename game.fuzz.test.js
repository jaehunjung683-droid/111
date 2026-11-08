'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../server/game');

/* 잘못된/악의적 입력을 대량으로 보내도 서버 로직이 예외 없이 상태를 유지하는지 확인 */
test('무작위·비정상 메시지 5만 건에도 예외 없이 동작한다', () => {
  let now = 5_000_000;
  const game = new Game({ clock: () => now });
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const weirdValues = [0, 1, -1, NaN, Infinity, -Infinity, 1e308, '1', 'x', null, undefined, true, {}, [], [1, 2], { x: 1 }, '<script>', 'a'.repeat(500)];
  const types = ['list_servers', 'quick_match', 'create_room', 'join_room', 'leave_room', 'player_state', 'choose_weapon', 'ready',
    'start_match', 'vote_map', 'transfer_host', 'kick', 'fire', 'reload', 'hit', 'throw', 'c4_place', 'explosion', 'ability', 'heal',
    'teleport', 'respawn', 'ping', 'bogus', 42, null];
  const fields = ['name', 'channelId', 'matchMode', 'roomCode', 'x', 'y', 'z', 'yaw', 'pitch', 'weapon', 'mapId', 'targetId', 'shotId', 'id',
    'head', 'alt', 'pierce', 'ult', 'dmg', 'damage', 'kind', 'item', 'positions', 'teamSize', 'teamCount'];
  const conns = [];
  for (let i = 0; i < 24; i++) {
    const c = { sent: 0, send() { this.sent++; }, close() {} };
    game.connect(c); conns.push(c);
  }
  for (let i = 0; i < 50000; i++) {
    const c = pick(conns);
    const msg = { type: pick(types) };
    const n = Math.floor(rnd() * 8);
    for (let k = 0; k < n; k++) msg[pick(fields)] = pick(weirdValues);
    if (msg.type === 'create_room' || msg.type === 'quick_match') msg.name = pick(['A', 'Bob', 'Cy', 'Dee', 'Eve']);
    if (rnd() < 0.15) msg.roomCode = pick([...game.rooms.keys(), 'nope']);
    if (rnd() < 0.2 && game.players.size) msg.targetId = pick([...game.players.values()]).id;
    now += Math.floor(rnd() * 400);
    if (rnd() < 0.02) game.disconnect(c), game.connect(c);
    game.handle(c, typeof msg.type === 'string' ? msg : null);
    if (i % 25 === 0) game.tick();
  }
  for (const room of game.rooms.values()) {
    assert.ok(room.players.size <= 20);
    for (const p of room.players.values()) {
      assert.ok(Number.isFinite(p.hp) && p.hp <= 150, `hp ${p.hp}`);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
    }
  }
  assert.ok(game.stats().rooms >= 0);
});
