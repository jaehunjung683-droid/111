'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const htmlPath = path.join(__dirname, '..', '게임클라이언트_V2.0.html');
const html = fs.readFileSync(htmlPath, 'utf8');

function extractMap(id) {
  const start = html.indexOf(`function buildMap${id}()`);
  assert.notEqual(start, -1, `map ${id} builder exists`);
  const nextFunction = html.indexOf('\n        function ', start + 1);
  const nextMapComment = html.indexOf('\n        // MAP ', start + 1);
  const candidates = [nextFunction, nextMapComment].filter(index => index !== -1);
  return html.slice(start, candidates.length ? Math.min(...candidates) : html.length);
}

function callsIn(source, name) {
  const calls = [];
  const pattern = new RegExp(`${name}\\(([^)]*)\\)`, 'g');
  for (const match of source.matchAll(pattern)) {
    const args = match[1].split(',').map(value => value.trim());
    calls.push({ args, raw: match[0] });
  }
  return calls;
}

function findByPosition(source, name, x, z) {
  const call = callsIn(source, name).find(item => Number(item.args[0]) === x && Number(item.args[1]) === z);
  assert.ok(call, `${name} at (${x}, ${z}) exists`);
  return call.args;
}

function assertRampMeetsPlatform(source, x, platformCenterZ) {
  const platform = findByPosition(source, 'createMapPlatform', x, platformCenterZ);
  const ramp = callsIn(source, 'createRamp').map(call => call.args)
    .find(args => Number(args[0]) === x && Number(args[5]) === 0);
  assert.ok(ramp, `ramp at x=${x} exists`);
  const platformZ = Number(platform[1]);
  const platformDepth = Number(platform[3]);
  const platformSouthEdge = platformZ + platformDepth / 2;
  const rampZ = Number(ramp[1]);
  const rampLength = Number(ramp[3]);
  const direction = ramp[6].replace(/['\"]/g, '');
  const rampHighEdge = rampZ + (direction === 'south' ? rampLength / 2 : -rampLength / 2);
  assert.ok(Math.abs(platformSouthEdge - rampHighEdge) <= 1.05,
    `ramp high edge ${rampHighEdge} should meet platform south edge ${platformSouthEdge}`);
}

function runMapLoadSequenceSmokeTest() {
  const mapBuilders = Array.from({length:8}, (_,index)=>extractMap(index+1)).join('\n');
  const loadMapStart = html.indexOf('function loadMap(mapId)');
  const loadMapEnd = html.indexOf('\n        function changeMap', loadMapStart);
  assert.ok(loadMapStart !== -1 && loadMapEnd > loadMapStart, 'loadMap function can be isolated');
  const loadMapSource = html.slice(loadMapStart, loadMapEnd);
  class FakeMesh {
    constructor() {
      this.position = { set() {} };
      this.rotation = { set() {} };
      this.scale = { set() {} };
      this.instanceMatrix = { setUsage() {} };
      this.matrix = {};
      this.children = [];
    }
    add(child) { this.children.push(child); }
    updateMatrix() {}
    setMatrixAt() {}
  }
  class FakeGeometry {
    constructor() {
      this.position = { set() {} };
      this.rotation = { set() {} };
      this.scale = { set() {} };
      this.color = { set() {}, setHex() {} };
      this.instanceMatrix = { setUsage() {} };
      this.children = [];
    }
    add(child) { this.children.push(child); }
    setMatrixAt() {}
    updateMatrix() {}
    computeVertexNormals() {}
    dispose() {}
  }
  class FakeMaterial { constructor() { this.color = { set() {}, setHex() {} }; } }
  class FakeColor { setHex() {} }
  const spawned = [];
  const played = [];
  const context = {
    THREE: new Proxy({ Mesh: FakeMesh, MeshStandardMaterial: FakeMaterial, Color: FakeColor, Object3D: FakeMesh,
      MathUtils: {degToRad:value=>value*Math.PI/180, clamp:(value,min,max)=>Math.min(max,Math.max(min,value))},
      DoubleSide: 2, FrontSide: 0, BackSide: 1, StaticDrawUsage: 35044 }, {
      get(target, key) { return target[key] || FakeGeometry; }
    }),
    scene: { background: { setHex() {} }, fog: { color: { setHex() {} }, set density(_) {} }, add() {} },
    ambientLight: { color: { setHex() {} } }, sunLight: { color: { setHex() {} }, position: { set() {} } },
    skyLight: { color: { setHex() {} }, groundColor: { setHex() {} } },
    mapObjectsGroup: { add() {} }, raycastTargets: [], colliderBoxes: [], ramps: [], highPlatforms: [],
    jumpPads: [], MAP_SIZE: 256, currentSelectedMap: 'map1', activeMapPointLights: 0, MAX_MAP_POINT_LIGHTS: 16,
    addThemedMapSky() {}, createBoundaryWall() {}, createWallBlock() {}, createMapTrim() {},
    createMapWindow() {}, createMapPlatform() {}, createRamp() {}, createMapLaneBarrier() {},
    createMapLamp() {}, createDummy() {}, createJumpPad() {}, addAccurateCollider() {},
    clearCurrentMap() {}, addCombatFlowLayout() {}, addMapRouteInlays() {}, addMapDressing() {},
    placePlayerAtRandomSpawn(mapId) { spawned.push(mapId); }, resetReloadParts() {},
    playMapBGM(mapId) { played.push(mapId); }, weaponPivot: {position: {set() {}}, rotation: {set() {}}, visible: true},
    texHarborAsphalt: {}, texHeightConcrete: {}, texWeatheredConcrete: {}, texRifleMetal: {},
    texDesertRemakeFloor: {}, texHeightSand: {}, texDesertBrickWall: {}, texRangeGravel: {},
    texHeightGravel: {}, matMetalDark: {}, matConcreteDark: {}, matWallAccentGreen: {}
  };
  const sourceCalls = [...mapBuilders.matchAll(/\b(?:build|create|add)[A-Z]\w*(?=\s*\()/g)].map(match=>match[0]);
  sourceCalls.forEach(name=>{ if(!context[name]) context[name]=()=>new FakeMesh(); });
  [...mapBuilders.matchAll(/\b(?:tex|mat)[A-Z]\w*/g)].forEach(match=>{ if(!context[match[0]]) context[match[0]]={}; });
  const sequence = ['map1','map2','map3','map4','map5','map6','map7','map8','map3','map1'];
  const loads = sequence.map(mapId=>`loadMap('${mapId}');`).join('\n');
  vm.runInNewContext(`${mapBuilders}\n${loadMapSource}\n${loads}`, context, { timeout: 5000 });
  assert.deepEqual(spawned, sequence, 'every map reaches player spawn placement during repeated switching');
  assert.deepEqual(played, sequence, 'every map switches its map music during repeated switching');
  assert.equal(context.currentSelectedMap, 'map1', 'the active map id follows the final map after repeated changes');
}

test('all map builders load and permit repeated map switching without browser runtime exceptions', () => {
  runMapLoadSequenceSmokeTest();
});

test('inline browser scripts parse and map builders retain the improved map details', () => {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]).filter(source => source.trim());
  assert.equal(scripts.length, 2, 'both inline browser scripts are present');
  scripts.forEach((source, index) => new vm.Script(source, { filename: `game-inline-${index + 1}.js` }));
  const threeLoader = html.slice(html.indexOf('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"'), html.indexOf('</script>', html.indexOf('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"')));
  assert.ok(threeLoader.includes('document.write(') && threeLoader.includes('cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js'),
    'the fallback Three.js script is inserted synchronously before the game script');
  assert.ok(!threeLoader.includes('document.createElement') && !threeLoader.includes('appendChild'),
    'the fallback does not race the game bootstrap through an asynchronous script append');
  const onErrorMatch = threeLoader.match(/onerror="([^"]+)"/);
  assert.ok(onErrorMatch, 'primary CDN failure has a fallback handler');
  const decodedHandler = onErrorMatch[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  let fallbackMarkup = '';
  vm.runInNewContext(decodedHandler, { document: { write(markup) { fallbackMarkup = markup; } } });
  assert.equal(fallbackMarkup, '<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script>',
    'the fallback inserts a well-formed parser-blocking script element');

  const frameCapStart = html.indexOf('function shouldRenderFrame(now)');
  const frameCapEnd = html.indexOf('\n        }', frameCapStart) + '\n        }'.length;
  const frameCapSource = html.slice(frameCapStart, frameCapEnd);
  assert.ok(frameCapStart !== -1 && frameCapEnd > frameCapStart && frameCapSource.includes('minFrameMs'),
    'the selected FPS setting is converted into a render interval');
  const framesAt60 = JSON.parse(JSON.stringify(vm.runInNewContext(`let maxFPS=60;let lastFrameRenderTime=0;${frameCapSource};[shouldRenderFrame(16),shouldRenderFrame(17),shouldRenderFrame(33),shouldRenderFrame(34)]`)));
  assert.deepEqual(framesAt60, [false,true,false,true], '60 FPS cap skips frames that arrive too early');
  const framesAt30 = JSON.parse(JSON.stringify(vm.runInNewContext(`let maxFPS=30;let lastFrameRenderTime=0;${frameCapSource};[shouldRenderFrame(33),shouldRenderFrame(34)]`)));
  assert.deepEqual(framesAt30, [false,true], '30 FPS cap waits for a longer render interval');
  const animateStart = html.indexOf('function animate()');
  const animateEnd = html.indexOf('renderer.render(scene, camera)', animateStart);
  assert.ok(html.slice(animateStart, animateEnd).includes('if (!shouldRenderFrame(now)) return;'),
    'the animation loop applies the selected FPS cap before game updates and rendering');

  const qualityStart = html.indexOf('let adaptiveRenderStage = 0;');
  const qualityEnd = html.indexOf('\n        function shouldRenderFrame', qualityStart);
  assert.ok(qualityStart !== -1 && qualityEnd > qualityStart,
    'adaptive render quality controller is present');
  const qualitySource = html.slice(qualityStart, qualityEnd);
  const qualityContext = {
    selectedDeviceMode: 'pc', maxFPS: 240,
    window: { devicePixelRatio: 1.5 },
    renderer: { shadowMap: {}, pixelRatio: 1, setPixelRatio(value) { this.pixelRatio = value; } },
    THREE: { PCFSoftShadowMap: 2 },
    GFX_PRESETS: { high: { dpr: 2 } }, gfxPresetKey: 'high'
  };
  vm.runInNewContext(qualitySource.replace(/\blet (adaptive(?:RenderStage|LowFpsMs|RecoveryMs|ShadowsDisabled))/g, 'var $1'), qualityContext);
  for (let i = 0; i < 20; i++) qualityContext.updateAdaptiveRenderQuality(20, 500);
  assert.equal(qualityContext.adaptiveRenderStage, 2,
    'sustained low FPS lowers render resolution in two gradual steps');
  assert.equal(qualityContext.adaptiveShadowsDisabled, true,
    'desktop shadows are disabled only after sustained low FPS at minimum render scale');
  assert.ok(Math.abs(qualityContext.renderer.pixelRatio - 1.05) < 0.001,
    'adaptive resolution remains above the minimum readable pixel ratio');
  for (let i = 0; i < 10; i++) qualityContext.updateAdaptiveRenderQuality(60, 500);
  assert.equal(qualityContext.adaptiveShadowsDisabled, false,
    'desktop shadows recover after a sustained FPS improvement');
  for (let i = 0; i < 20; i++) qualityContext.updateAdaptiveRenderQuality(60, 500);
  assert.equal(qualityContext.adaptiveRenderStage, 0,
    'render resolution gradually returns to maximum after sustained recovery');

  const map4 = extractMap(4);
  const map5 = extractMap(5);
  const map1 = extractMap(1);
  const map8 = extractMap(8);
  const map2 = extractMap(2);
  const map3 = extractMap(3);
  assert.ok(map2.includes('service gantry') && map2.includes('createWallBlock(44,5.8,-84,21,.55,17,dockSteel,false)'),
    'map 2 includes an open service gantry landmark in its sparse container yard');
  assert.ok(map3.includes('field cistern') && map3.includes('outcropPositions') && map3.includes('addAccurateCollider(cistern)'),
    'map 3 adds a collidable cistern and natural rock cover away from the perimeter');
  const map2Spawn = html.match(/\bmap2:\s*(\[\[[^\n]+\]\])/);
  const map3Spawn = html.match(/\bmap3:\s*(\[\[[^\n]+\]\])/);
  assert.ok(map2Spawn && map3Spawn, 'maps 2 and 3 declare spawn positions');
  const map2Spawns = vm.runInNewContext(map2Spawn[1]);
  const map3Spawns = vm.runInNewContext(map3Spawn[1]);
  const gantryPosts = [[34,-92,.72,.72],[54,-92,.72,.72],[34,-76,.72,.72],[54,-76,.72,.72]];
  for (const [x,z] of map2Spawns) {
    const blocked = gantryPosts.some(([bx,bz,w,d]) => Math.abs(x-bx)<w/2+.3 && Math.abs(z-bz)<d/2+.3) ||
      (Math.abs(x-40)<5.2/2+.3 && Math.abs(z+82)<4.6/2+.3);
    assert.ok(!blocked, `map 2 spawn (${x}, ${z}) clears the new gantry and cargo`);
  }
  const map3NewCover = [
    {x:34,z:64,w:4.7,d:4.7}, {x:22,z:64,w:8.5,d:2.6}, {x:46,z:64,w:8.5,d:2.6},
    ...[[-57,63,4.5,3.5],[-51,66,3.3,2.8],[-61,69,2.7,2.4],[-54,57,2.8,2.3]]
      .map(([x,z,w,d])=>({x,z,w,d}))
  ];
  for (const [x,z] of map3Spawns) {
    const blocked = map3NewCover.find(item => Math.abs(x-item.x)<item.w/2+.3 && Math.abs(z-item.z)<item.d/2+.3);
    assert.ok(!blocked, `map 3 spawn (${x}, ${z}) clears the new cistern and outcrop`);
  }
  assert.ok(html.includes("else if (mapId === 'map3') buildMap3();") &&
    html.includes("function switchMapInGame(mapId)") && html.includes('loadMap(mapId);'),
    'map 3 remains connected to the in-game map-switch path');
  for (const landmark of ['barracksRoof', 'rafter', 'heliCircle', 'addSnowDrift', 'const pines=', 'new THREE.InstancedMesh']) {
    assert.ok(map5.includes(landmark), `map 5 includes ${landmark}`);
  }
  for (const feature of ['apronMat=', 'bermMat=', 'createMapLaneBarrier(0,-64,58,2.4,5.2', 'createMapPlatform(53,-48,9,9,7.2', "createRamp(53,-37.5,5.4,12,7.2,0,'north')", 'const rockGeo=']) {
    assert.ok(map8.includes(feature), `map 8 includes ${feature}`);
  }
  assert.ok(map8.includes('[-36,-27],[36,-27]'), 'map 8 side berms preserve a central firing lane');
  assert.ok(map1.includes('serviceYardMat=') && map1.includes('the original floor remains the movement surface'),
    'map 1 adds subtle ground variation without replacing its collision floor');
  const uziStart = html.indexOf('function createUziMesh()');
  const uziEnd = html.indexOf('/* 고급 전기 테이저 */', uziStart);
  const uzi = html.slice(uziStart, uziEnd);
  assert.ok(uzi.includes("magazine.position.set(0,-0.105,0.18)"), 'Uzi magazine sits in the grip well');
  assert.ok(uzi.includes('Split rubber grip panels leave the inserted magazine visible'),
    'Uzi grip panels do not obscure the reloadable magazine');
  assert.ok(html.includes('parts.magazine.position.set(0, -0.105, 0.18)'),
    'Uzi reload resets the magazine to the same grip position');
  const revolverStart = html.indexOf('function createRevolverMesh()');
  const revolverEnd = html.indexOf('function createUziMesh()', revolverStart);
  const revolver = html.slice(revolverStart, revolverEnd);
  assert.ok(revolver.includes('new THREE.ExtrudeGeometry(gripProfile'),
    'revolver grip uses a curved bevelled side profile');
  assert.ok(revolver.includes('frameProfile.holes.push(cylinderWindow)') && revolver.includes('frame.rotation.y=Math.PI/2'),
    'revolver frame leaves the cylinder window open in the visible side profile');
  assert.ok(!revolver.includes('guard.rotation.x=Math.PI/2'), 'revolver trigger guard faces the first-person camera');
  assert.ok(uzi.includes('new THREE.ExtrudeGeometry(receiverProfile') &&
    uzi.includes('Modern adjustable PDW stock with paired guide rails') &&
    uzi.includes('addWeaponBox(group,[0.14,0.13,0.034],[0,0.045,0.42],mWeaponRubber)') &&
    uzi.includes('[0,0.222,-0.144],mGlassSight'),
    'Uzi has a pressed receiver, adjustable tactical stock and reflex sight');
  assert.ok(!uzi.includes('stockPath') && !uzi.includes('new THREE.TubeGeometry'),
    'Uzi avoids the outdated wire-stock silhouette');
  assert.ok(!uzi.includes('guard.rotation.x=Math.PI/2'), 'Uzi trigger guard faces the first-person camera');
  assert.ok(revolver.includes('for(const side of [-1,1]) for(const portZ') &&
    revolver.includes('[0.08,0.035,0.09],[0.052,0.024,-0.56],mWeaponBlack') &&
    revolver.includes('new THREE.ExtrudeGeometry(frameProfile') &&
    revolver.includes('[0,0.254,-0.218],mGlassSight'),
    'revolver has a ported muzzle, rail-mounted optic and compact light');
  assert.ok(html.includes('TRAINING CAMPUS') && html.includes('RED DUNE OUTPOST') &&
    html.includes('ALPINE OUTPOST') && html.includes('FIELD TEST RANGE'),
    'the vote labels and multiplayer map names match the updated map atmospheres');
  assert.ok(html.includes("class=\"map-card map-btn-m8\" onclick=\"switchMapInGame('map8')\""),
    'the field test range has a matching in-game map selector card');
  const trimStart = html.indexOf('function createMapTrim(');
  const trimEnd = html.indexOf('\n        }', trimStart) + '\n        }'.length;
  const mapTrim = html.slice(trimStart, trimEnd);
  assert.ok(mapTrim.includes('mesh.castShadow = false') && mapTrim.includes('mesh.receiveShadow = false'),
    'non-colliding map trim does not add decorative shadow passes');
  assert.ok(!mapTrim.includes('raycastTargets.push(mesh)'),
    'non-colliding map trim cannot intercept bullets, melee, portals, or C4 rays');
  const flashStart = html.indexOf('function createFlashbangMesh()');
  const smokeStart = html.indexOf('function createSmokebombMesh()', flashStart);
  const grenadeStart = html.indexOf('function createGrenadeMesh()', smokeStart);
  assert.ok(html.slice(flashStart, smokeStart).includes('addGrenadeGripRibs(group,0.049,10)'),
    'flashbang has an instanced casing grip');
  assert.ok(html.slice(smokeStart, grenadeStart).includes('addGrenadeGripRibs(group,0.056,12)'),
    'smoke grenade has an instanced casing grip');
  const ribHelperStart = html.indexOf('function addGrenadeGripRibs(');
  const ribHelperEnd = html.indexOf('function ', ribHelperStart + 24);
  const ribHelper = html.slice(ribHelperStart, ribHelperEnd);
  assert.ok(ribHelper.includes('new THREE.InstancedMesh') && ribHelper.includes('StaticDrawUsage'),
    'grenade casing detail is batched into one static draw');
  assert.ok(html.includes('sharedMapGeometries.add(grenadeRibGeometry)'),
    'thrown projectile cleanup preserves the shared rib geometry');
  const rocketStart = html.indexOf('function launchRocket()');
  const rocketEnd = html.indexOf('function fireDrillPiercing()', rocketStart);
  const rocketFlow = html.slice(rocketStart, rocketEnd);
  const rocketTickStart = rocketFlow.indexOf('const tick=setInterval');
  const rocketCollisionStart = rocketFlow.indexOf('const firstHit=hits[0]', rocketTickStart);
  assert.ok(rocketFlow.includes('intersectObjects(getShotRaycastTargets(),true,hitResults)'),
    'rocket raycasts reuse a result array');
  assert.ok(rocketTickStart !== -1 && rocketCollisionStart > rocketTickStart &&
    !/\.clone\(\)|new THREE\./.test(rocketFlow.slice(rocketTickStart, rocketCollisionStart)),
    'rocket ticks reuse motion vectors instead of allocating per step');
  assert.ok(rocketFlow.includes('rocketMaterial.userData.transient=true') && rocketFlow.includes('disposeTransientObject(rocket)'),
    'rocket geometry and material are released when its flight ends');
  const combatFlowStart = html.indexOf('function addCombatFlowLayout');
  const combatFlow = html.slice(combatFlowStart, html.indexOf('let currentSelectedMap', combatFlowStart));
  assert.ok(combatFlow.includes("['map4','map5','map8'].includes(mapId)"),
    'bespoke layouts must not receive the generic mirrored cover pass');
  assert.ok(html.includes("if (mapId === 'map5') return; // keep the alpine snowfield free of artificial perimeter lights"),
    'the alpine snowfield avoids generic neon edge lights');
  assert.ok(html.includes("d.type==='player_died'&&d.playerId===mpPlayerId){playerHp=0;updateUI();handlePlayerDeath();return;}"),
    'multiplayer deaths run the normal countdown overlay');
  assert.ok(html.includes("const mapId=d.mapId||currentSelectedMap;if(mapId!==currentSelectedMap)loadMap(mapId);else placePlayerAtRandomSpawn(mapId);document.getElementById('respawn-overlay').style.display='none';"),
    'multiplayer respawns use the selected map spawn and dismiss the overlay');

  const c4PlantStart = html.indexOf('function plantC4()');
  const c4PlantEnd = html.indexOf('function detonateC4()', c4PlantStart);
  const c4Plant = html.slice(c4PlantStart, c4PlantEnd);
  assert.ok(c4Plant.includes('c4Mesh.userData.velocity') && c4Plant.includes('c4Mesh.userData.lastPosition'),
    'planted C4 initializes the projectile physics state');
  const clearMapStart = html.indexOf('function clearCurrentMap()');
  const clearMapEnd = html.indexOf('function ', clearMapStart + 20);
  assert.ok(html.slice(clearMapStart, clearMapEnd).includes('activeC4List.forEach(c4=>disposeTransientObject(c4))'),
    'map changes remove planted C4 and release its geometry');
  const c4TickStart = html.indexOf('if (activeC4List && activeC4List.length)');
  const c4TickEnd = html.indexOf('renderer.render(scene, camera)', c4TickStart);
  assert.ok(c4TickStart !== -1 && c4TickEnd > c4TickStart);
  assert.ok(!html.slice(c4TickStart, c4TickEnd).includes('c4.position.clone()'),
    'C4 motion reuses its per-frame displacement vector');

  const movementStart = html.indexOf('function processPlayerMovement(');
  const movementEnd = html.indexOf('camera.position.copy(nextPos);', movementStart);
  const dummiesStart = html.indexOf('function updateDummies(', movementStart);
  const dummiesEnd = html.indexOf('function botAttackPlayer(', dummiesStart);
  assert.ok(!/new THREE\.(?:Vector3|Euler|Box3)\(/.test(html.slice(movementStart, movementEnd)),
    'player movement reuses frame scratch objects');
  assert.ok(!/new THREE\.Vector3\(/.test(html.slice(dummiesStart, dummiesEnd)),
    'dummy movement reuses frame scratch vectors');
  assert.ok(!html.slice(dummiesStart, dummiesEnd).includes('dummyTargets.forEach'),
    'dummy updates avoid a per-frame callback allocation');
  assertRampMeetsPlatform(map4, -20, 24);
  assertRampMeetsPlatform(map4, 20, 22);
  assertRampMeetsPlatform(map5, -40, 10);
  assertRampMeetsPlatform(map5, 40, 39);

  const spawnMatch = html.match(/\bmap5:\s*(\[\[[^\n]+\]\])/);
  assert.ok(spawnMatch, 'map 5 has spawn points');
  const spawns = vm.runInNewContext(spawnMatch[1]);
  const driftMatch = map5.match(/(\[\[[\s\S]*?\]\])\.forEach\(v=>addSnowDrift/);
  const pineMatch = map5.match(/const pines=(\[\[[^\n]+\]\])/);
  assert.ok(driftMatch && pineMatch, 'snow drifts and spruce positions are declared');
  const drifts = vm.runInNewContext(driftMatch[1]);
  const pines = vm.runInNewContext(pineMatch[1]);
  const blockers = [
    ...callsIn(map5, 'createWallBlock').map(({ args }) => ({ x:Number(args[0]), z:Number(args[2]), w:Number(args[3]), d:Number(args[5]), h:Number(args[4]) })),
    ...callsIn(map5, 'createMapLaneBarrier').map(({ args }) => ({ x:Number(args[0]), z:Number(args[1]), w:Number(args[2]), d:Number(args[3]), h:Number(args[4]) })),
    ...callsIn(map5, 'createWoodCrate').map(({ args }) => ({ x:Number(args[0]), z:Number(args[2]), w:Number(args[3]), d:Number(args[3]), h:Number(args[3]) })),
    ...drifts.map(([x,z,w,d,h,rotation=0]) => ({
      x,z,w:Math.abs(Math.cos(rotation))*w+Math.abs(Math.sin(rotation))*d,
      d:Math.abs(Math.sin(rotation))*w+Math.abs(Math.cos(rotation))*d,h:h*.86
    })),
    ...pines.map(([x,z,height]) => ({x,z,w:.72,d:.72,h:height*.22}))
  ];
  for (const [x,z] of spawns) {
    const overlaps = blockers.find(item => item.h > 0 &&
      Math.abs(x-item.x) < (item.w/2)+.3 && Math.abs(z-item.z) < (item.d/2)+.3);
    assert.ok(!overlaps, `map 5 spawn (${x}, ${z}) is clear of static cover`);
  }
});
