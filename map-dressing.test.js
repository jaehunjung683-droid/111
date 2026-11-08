'use strict';
/* 맵 장식 배치 로직 검증: 결정성, 장애물/스폰/경계 회피, 개수 범위 (THREE는 최소 스텁 사용) */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '..', '게임클라이언트_V2.0.html'), 'utf8');
const start = html.indexOf('const MAP_DRESSING_DENSITY');
const end = html.indexOf('        function getRandomSpawn', start);
assert.ok(start > 0 && end > start, 'dressing source found');
const source = html.slice(start, end);

class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
class Box3 { constructor(min, max) { this.min = min; this.max = max; } }
class Quat { setFromEuler() { return this; } multiply() { return this; } }
class Euler { set() { return this; } }
class Mtx { compose(v) { this.px = v.x; this.pz = v.z; this.py = v.y; return this; } clone() { const m = new Mtx(); m.px = this.px; m.py = this.py; m.pz = this.pz; return m; } }
class Col { setHex() { return this; } }
class Geo { }
class Inst { constructor(g, m, count) { this.count = count; this.instanceMatrix = {}; this.instanceColor = {}; this.positions = []; } setMatrixAt(i, m) { this.positions[i] = m; } setColorAt() {} }
class Group { constructor() { this.children = []; } add(c) { this.children.push(c); } }
class Mat { }

function run(mapId, extraObstacles = []) {
  const THREE = { Vector3: V3, Box3, Quaternion: Quat, Euler, Matrix4: Mtx, Color: Col, InstancedMesh: Inst, Group,
    BoxGeometry: Geo, CylinderGeometry: Geo, ConeGeometry: Geo, IcosahedronGeometry: Geo, CircleGeometry: Geo, MeshStandardMaterial: Mat };
  const group = new Group();
  const spawns = { map1: [[-24, 100], [0, 100]], map2: [[-100, -100], [35, 100]], map3: [[-92, -82], [0, 100]], map4: [[-46, -46], [0, 48]],
    map5: [[-56, -56], [0, -58]], map6: [[-70, -68], [0, 76]], map7: [[-76, -72], [12, -74]], map8: [[0, 25], [8, 25]] };
  const ctx = { THREE, MAP_SPAWNS: spawns, matWoodCrate: {}, matMetalDark: {}, matConcreteDark: {},
    colliderBoxes: extraObstacles.map(o => new Box3(new V3(o[0], 0, o[2]), new V3(o[1], 4, o[3]))),
    highPlatforms: [], ramps: [{ x: 0, z: 0, width: 6, length: 16 }], jumpPads: [{ x: 20, z: 20 }], dummyTargets: [],
    raycastTargets: [], mapObjectsGroup: group, shotRaycastTargetsDirty: false };
  vm.runInNewContext(`${source}\nthis.result = addMapDressing('${mapId}');`, ctx);
  return { ctx, group, result: ctx.result };
}

test('모든 맵에 장식이 배치되고 같은 입력이면 항상 같은 결과(멀티플레이 동기화)', () => {
  for (let n = 1; n <= 8; n++) {
    const a = run('map' + n), b = run('map' + n);
    assert.ok(a.result.sites >= 5, `map${n} sites ${a.result.sites}`);
    assert.deepEqual(a.ctx.colliderBoxes.map(x => [x.min.x, x.min.z]), b.ctx.colliderBoxes.map(x => [x.min.x, x.min.z]), `map${n} deterministic`);
  }
});

test('장식물은 기존 구조물·스폰·경사로·점프패드와 겹치지 않고 경계/물 영역 안쪽에만 놓인다', () => {
  const walls = [[-30, -20, -40, 40], [20, 28, -60, 60], [-10, 10, 50, 56]];
  for (let n = 1; n <= 8; n++) {
    const { ctx } = run('map' + n, walls);
    const added = ctx.colliderBoxes.slice(walls.length);
    const bounds = vm.runInNewContext(`(${source.match(/const DRESS_BOUNDS = (\{[\s\S]*?\n        \});/)[1]})`)['map' + n];
    const overlaps = (b, r) => b.max.x > r[0] && b.min.x < r[1] && b.max.z > r[2] && b.min.z < r[3];
    for (const box of added) {
      for (const w of walls) assert.ok(!overlaps(box, w), `map${n} overlaps wall`);
      assert.ok(!overlaps(box, [-3, 3, -8, 8]), `map${n} blocks ramp`);
      assert.ok(!overlaps(box, [18, 22, 18, 22]), `map${n} blocks jump pad`);
      for (const sp of ctx.MAP_SPAWNS['map' + n]) assert.ok(!overlaps(box, [sp[0] - 8, sp[0] + 8, sp[1] - 8, sp[1] + 8]), `map${n} too close to spawn`);
      assert.ok(box.min.x >= bounds[0] && box.max.x <= bounds[1] && box.min.z >= bounds[2] && box.max.z <= bounds[3], `map${n} within bounds ${JSON.stringify([box.min.x,box.max.x,box.min.z,box.max.z,bounds])}`);
    }
    assert.ok(added.length > 0, `map${n} has solid props`);
  }
});

test('엄폐물 사이 간격이 충분해 이동 경로가 막히지 않는다 (최소 통로 폭)', () => {
  for (let n = 1; n <= 8; n++) {
    const { ctx } = run('map' + n);
    const b = ctx.colliderBoxes;
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
      const gapX = Math.max(b[j].min.x - b[i].max.x, b[i].min.x - b[j].max.x), gapZ = Math.max(b[j].min.z - b[i].max.z, b[i].min.z - b[j].max.z);
      const gap = Math.max(gapX, gapZ);
      if (gap < 0) continue;                       // 같은 사이트 내부(붙어 있는 묶음)
      if (gap < 1.0 && Math.hypot(b[i].min.x - b[j].min.x, b[i].min.z - b[j].min.z) > 9) assert.fail(`map${n}: narrow gap ${gap.toFixed(2)}`);
    }
  }
});
