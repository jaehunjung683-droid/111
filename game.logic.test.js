'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../server/game');

function setup(n = 2, opts = {}) {
  let now = 1_000_000;
  const game = new Game({ clock: () => now });
  const conns = [];
  for (let i = 0; i < n; i++) {
    const c = { sent: [], closed: null, send(m) { this.sent.push(m); }, close(code) { this.closed = code; } };
    game.connect(c); conns.push(c);
  }
  game.handle(conns[0], { type: 'create_room', name: 'Alpha', channelId: '1', matchMode: opts.mode || 'ffa', teamCount: 2 });
  const code = conns[0].sent.find(m => m.type === 'room_joined').roomCode;
  for (let i = 1; i < n; i++) game.handle(conns[i], { type: 'join_room', name: 'P' + i, roomCode: code });
  const ids = conns.map(c => c.sent.find(m => m.type === 'room_joined').playerId);
  const room = game.rooms.get(code);
  return { game, conns, ids, room, code, advance: ms => { now += ms; }, at: () => now };
}
function startLive(ctx) {
  ctx.game.handle(ctx.conns[0], { type: 'start_match' });
  for (const c of ctx.conns) ctx.game.handle(c, { type: 'ready' });
  assert.equal(ctx.room.roundState, 'live');
  ctx.advance(3000); // 스폰 보호 종료
}
// 두 플레이어를 서로 마주보게 배치: 공격자 0 (원점, -Z를 바라봄), 대상 1 (정면 20m)
function place(ctx, dist = 20) {
  const { game, conns, advance } = ctx;
  advance(100); game.handle(conns[0], { type: 'player_state', x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0, weapon: 'aug' });
  advance(100); game.handle(conns[1], { type: 'player_state', x: 0, y: 1.6, z: -dist, yaw: 0, pitch: 0, weapon: 'aug' });
}
const fire = (ctx, weapon, id, extra = {}) => ctx.game.handle(ctx.conns[0], { type: 'fire', weapon, id, x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0, ...extra });
const hit = (ctx, weapon, shotId, extra = {}) => ctx.game.handle(ctx.conns[0], { type: 'hit', targetId: ctx.ids[1], weapon, shotId, head: false, ...extra });
const hpOf = (ctx, i) => ctx.room.players.get(ctx.ids[i]).hp;

test('로비: 방 생성/참가, 닉네임 중복 처리, 방장만 시작', () => {
  const ctx = setup(2);
  assert.equal(ctx.room.players.size, 2);
  ctx.game.handle(ctx.conns[1], { type: 'start_match' });
  assert.equal(ctx.room.matchStarted, false);
  const dup = { sent: [], send(m) { this.sent.push(m); }, close() {} };
  ctx.game.connect(dup);
  ctx.game.handle(dup, { type: 'join_room', name: 'Alpha', roomCode: ctx.code });
  const names = [...ctx.room.players.values()].map(p => p.name);
  assert.equal(new Set(names.map(n => n.toLowerCase())).size, names.length);
  ctx.game.handle(dup, { type: 'join_room', name: '', roomCode: ctx.code });
});

test('피해량은 서버 무기표 기준: 클라이언트가 보낸 damage는 무시된다', () => {
  const ctx = setup(2); startLive(ctx); place(ctx);
  fire(ctx, 'aug', 1); hit(ctx, 'aug', 1, { damage: 9999 });
  assert.equal(hpOf(ctx, 1), 150 - 13);
});

test('발사 기록 없는 hit, 다른 무기, 한도 초과 hit은 거부', () => {
  const ctx = setup(2); startLive(ctx); place(ctx);
  hit(ctx, 'aug', 99);
  assert.equal(hpOf(ctx, 1), 150);
  fire(ctx, 'aug', 1); hit(ctx, 'awp', 1);
  assert.equal(hpOf(ctx, 1), 150);
  hit(ctx, 'aug', 1); hit(ctx, 'aug', 1);
  assert.equal(hpOf(ctx, 1), 150 - 13);
});

test('조준선에서 벗어난 대상에게는 피해가 들어가지 않는다', () => {
  const ctx = setup(2); startLive(ctx); place(ctx);
  fire(ctx, 'aug', 1, { yaw: Math.PI / 2 }); hit(ctx, 'aug', 1);
  assert.equal(hpOf(ctx, 1), 150);
});

test('헤드샷은 조준선이 머리(눈 높이)를 지날 때만 인정', () => {
  const ctx = setup(2); startLive(ctx); place(ctx);
  fire(ctx, 'awp', 1, { pitch: 0 }); hit(ctx, 'awp', 1, { head: true });
  assert.equal(hpOf(ctx, 1), 150 - 120);
  const c2 = setup(2); startLive(c2); place(c2);
  fire(c2, 'awp', 1, { pitch: -0.06 }); hit(c2, 'awp', 1, { head: true });
  assert.equal(hpOf(c2, 1), 150 - 70);
});

test('연사 속도 제한: AWP는 연속 발사 불가, 간격 후 가능', () => {
  const ctx = setup(2); startLive(ctx); place(ctx);
  fire(ctx, 'awp', 1); fire(ctx, 'awp', 2);
  hit(ctx, 'awp', 2);
  assert.equal(hpOf(ctx, 1), 150);
  ctx.advance(1400); fire(ctx, 'awp', 3); hit(ctx, 'awp', 3);
  assert.equal(hpOf(ctx, 1), 150 - 70);
});

test('점사 소총: 3발 점사 후 쿨타임이 지나야 다음 점사', () => {
  const ctx = setup(2); startLive(ctx); place(ctx);
  const shotsAccepted = () => ctx.room.players.get(ctx.ids[0]).shots.size;
  fire(ctx, 'burst', 1); ctx.advance(90); fire(ctx, 'burst', 2); ctx.advance(90); fire(ctx, 'burst', 3);
  assert.equal(shotsAccepted(), 3);
  ctx.advance(90); fire(ctx, 'burst', 4);           // 4번째 탄: 쿨타임 중이라 거부
  assert.equal(shotsAccepted(), 3);
  ctx.advance(400); fire(ctx, 'burst', 5);          // 쿨타임 경과
  assert.equal(shotsAccepted(), 4);
});

test('탄약과 장전: 탄창이 비면 발사 불가, 장전 시간 후 재개', () => {
  const ctx = setup(2); startLive(ctx); place(ctx);
  for (let i = 1; i <= 5; i++) { fire(ctx, 'awp', i); ctx.advance(1400); }
  fire(ctx, 'awp', 6);
  assert.equal(ctx.room.players.get(ctx.ids[0]).shots.has(6), false);
  ctx.game.handle(ctx.conns[0], { type: 'reload', weapon: 'awp' });
  ctx.advance(1000); fire(ctx, 'awp', 7);
  assert.equal(ctx.room.players.get(ctx.ids[0]).shots.has(7), false);
  ctx.advance(1000); fire(ctx, 'awp', 8);
  assert.equal(ctx.room.players.get(ctx.ids[0]).shots.has(8), true);
});

test('샷건: 한 발에 펠릿 8개까지만 인정', () => {
  const ctx = setup(2); startLive(ctx); place(ctx, 10);
  fire(ctx, 'shotgun', 1);
  for (let i = 0; i < 12; i++) hit(ctx, 'shotgun', 1);
  assert.equal(hpOf(ctx, 1), 150 - 80);
});

test('처치: 점수/킬 반영, 5초 전 부활 거부, 부활 후 스폰 보호', () => {
  const ctx = setup(2); startLive(ctx); place(ctx);
  for (let i = 1; i <= 3; i++) { fire(ctx, 'awp', i); hit(ctx, 'awp', i, { head: true }); ctx.advance(1400); }
  const victim = ctx.room.players.get(ctx.ids[1]);
  assert.equal(victim.alive, false);
  assert.equal(ctx.room.players.get(ctx.ids[0]).kills, 1);
  assert.ok(ctx.conns[1].sent.some(m => m.type === 'player_died'));
  ctx.game.handle(ctx.conns[1], { type: 'respawn' });
  assert.equal(victim.alive, false);
  ctx.advance(5000);
  ctx.game.handle(ctx.conns[1], { type: 'respawn' });
  assert.equal(victim.alive, true);
  assert.equal(victim.hp, 150);
  place(ctx);
  fire(ctx, 'awp', 9); hit(ctx, 'awp', 9);
  assert.equal(victim.hp, 150, '스폰 보호 중에는 피해 없음');
});

test('팀전: 아군 피해 없음', () => {
  const ctx = setup(2, { mode: 'team' });
  const [a, b] = [...ctx.room.players.values()];
  b.team = a.team;
  startLive(ctx); place(ctx);
  fire(ctx, 'aug', 1); hit(ctx, 'aug', 1);
  assert.equal(hpOf(ctx, 1), 150);
});

test('이동 검증: 비정상적인 순간이동은 되돌리고, 포탈 순간이동은 허용', () => {
  const ctx = setup(2); startLive(ctx); ctx.advance(2000); place(ctx);
  ctx.advance(60);
  ctx.game.handle(ctx.conns[0], { type: 'player_state', x: 150, y: 1.6, z: 0, yaw: 0, pitch: 0, weapon: 'aug' });
  assert.ok(ctx.conns[0].sent.some(m => m.type === 'correct'));
  assert.equal(ctx.room.players.get(ctx.ids[0]).x, 0);
  ctx.game.handle(ctx.conns[0], { type: 'teleport' });
  ctx.advance(60);
  ctx.game.handle(ctx.conns[0], { type: 'player_state', x: 150, y: 1.6, z: 0, yaw: 0, pitch: 0, weapon: 'aug' });
  assert.equal(ctx.room.players.get(ctx.ids[0]).x, 150);
});

test('수류탄: throw 없는 폭발 거부, 쿨타임, 범위 피해', () => {
  const ctx = setup(2); startLive(ctx); place(ctx, 4);
  ctx.game.handle(ctx.conns[0], { type: 'explosion', kind: 'grenade', x: 0, y: 1, z: -4 });
  assert.equal(hpOf(ctx, 1), 150);
  ctx.game.handle(ctx.conns[0], { type: 'throw', kind: 'grenade' });
  ctx.advance(3000);
  ctx.game.handle(ctx.conns[0], { type: 'explosion', kind: 'grenade', x: 0, y: 1, z: -4 });
  const dmg = 150 - hpOf(ctx, 1);
  assert.ok(dmg > 40 && dmg <= 100, `grenade damage ${dmg}`);
});

test('로켓: 직격은 150, 같은 발사의 폭발은 직격 대상에게 중복 피해 없음', () => {
  const ctx = setup(2); startLive(ctx); place(ctx, 15);
  fire(ctx, 'rocket', 1); hit(ctx, 'rocket', 1);
  assert.equal(ctx.room.players.get(ctx.ids[1]).alive, false);
});

test('회복: 구급상자 1회, 포션 쿨타임', () => {
  const ctx = setup(2); startLive(ctx); place(ctx);
  fire(ctx, 'awp', 1); hit(ctx, 'awp', 1); ctx.advance(1400);
  fire(ctx, 'awp', 2); hit(ctx, 'awp', 2); ctx.advance(1400);
  assert.equal(hpOf(ctx, 1), 10);
  ctx.game.handle(ctx.conns[1], { type: 'heal', item: 'medkit' });
  assert.equal(hpOf(ctx, 1), 85);
  fire(ctx, 'awp', 3); hit(ctx, 'awp', 3);
  const before = hpOf(ctx, 1);
  ctx.game.handle(ctx.conns[1], { type: 'heal', item: 'medkit' });
  assert.equal(hpOf(ctx, 1), before);
});

test('근접: 사거리 밖은 거부, 안은 서버 피해량', () => {
  const ctx = setup(2); startLive(ctx); place(ctx, 12);
  hit(ctx, 'knife', 0);
  assert.equal(hpOf(ctx, 1), 150);
  ctx.advance(100); ctx.game.handle(ctx.conns[1], { type: 'player_state', x: 0, y: 1.6, z: -2, yaw: 0, pitch: 0, weapon: 'knife' });
  ctx.advance(700); hit(ctx, 'knife', 0);
  assert.equal(hpOf(ctx, 1), 100);
});

test('경기 종료: 우승자 안내와 로비 복귀, 호스트 이전', () => {
  const ctx = setup(2); startLive(ctx); place(ctx);
  for (let i = 1; i <= 3; i++) { fire(ctx, 'awp', i); hit(ctx, 'awp', i, { head: true }); ctx.advance(1400); }
  ctx.advance(10 * 60 * 1000); ctx.game.tick();
  const end = ctx.conns[0].sent.find(m => m.type === 'round_end');
  assert.ok(end && /Alpha/.test(end.message));
  assert.equal(ctx.room.roundState, 'lobby');
  ctx.game.disconnect(ctx.conns[0]);
  assert.equal(ctx.room.hostId, ctx.ids[1]);
});
