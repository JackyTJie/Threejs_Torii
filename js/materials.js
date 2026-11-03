// 材质库：六大类材质（木材 / 石材 / 水体 / 叶片 / 树皮 / 泥土）+ 底座 / 青苔 / 茎枝 / 薄雾。
import * as THREE from 'three';
import { PALETTE, ANIM } from './config.js';
import {
  setBanding, applyWeathering, applyMossAttachment, applyLeafTranslucency,
  applyShadowLift, applyLeafFlutter, applyWaterFlow, applySubmergedCaustics
} from './toon.js';
import {
  woodTexture, weatheredPaintTexture, barkTexture, gravelTexture, stoneTexture,
  soilTexture, sandTexture, mossTexture, mistVeilTexture
} from './textures.js';

function toon(options = {}) {
  const { band = 'mid', color = 0xffffff, map = null, ...rest } = options;
  const material = new THREE.MeshToonMaterial({ color, map, ...rest });
  setBanding(material, band);
  return material;
}

function physical(options = {}) {
  const { color = 0xffffff, map = null, ...rest } = options;
  return new THREE.MeshPhysicalMaterial({ color, map, ...rest });
}

function named(material, name) {
  material.name = name;
  return material;
}

function leaf(name, color, {
  tint = 0x9fd6a0, strength = 0.25, power = 2.6, band = 'soft', flutterPeriod = 0
} = {}) {
  const material = named(toon({ color, band, side: THREE.DoubleSide }), name);
  applyLeafTranslucency(material, { color: tint, strength, power });
  if (flutterPeriod > 0) {
    applyLeafFlutter(material, {
      amplitude: ANIM.treeSway.leafFlutter.amplitude,
      period: flutterPeriod
    });
  }
  return material;
}

function stoneStepZone(name, { seed, mossHeight, mossAmount, wearStart, wearBand }) {
  const material = named(toon({
    color: 0xffffff,
    band: 'mid',
    map: stoneTexture({
      size: 512,
      base: PALETTE.slate,
      dark: PALETTE.slateDark,
      light: PALETTE.slateLight,
      seed
    })
  }), name);
  applyWeathering(material, {
    wear: PALETTE.slateDark,
    dust: PALETTE.soilWet,
    start: wearStart,
    band: wearBand,
    wearAmount: 0.48,
    dustAmount: 0.22
  });
  applyMossAttachment(material, {
    color: PALETTE.mossWet,
    height: mossHeight,
    band: 0.95,
    amount: mossAmount
  });
  applyShadowLift(material, { lift: 0.08, knee: 0.38 });
  return material;
}

function bark(name, { size = 1024, base, crack = PALETTE.barkCrack, light, seed }) {
  const material = named(toon({
    color: 0xffffff,
    band: 'mid',
    map: barkTexture({ size, base, crack, light, seed })
  }), name);
  applyWeathering(material, {
    wear: PALETTE.barkCrack,
    dust: PALETTE.soilDark,
    start: 0,
    band: 1.4,
    wearAmount: 0.4,
    dustAmount: 0.16
  });
  applyMossAttachment(material, {
    color: PALETTE.mossWet,
    height: 6.5,
    band: 4.5,
    amount: 0.38
  });
  return material;
}

function stem(name, { color, seed, planks = 6, wear = 0.3 }) {
  const material = named(toon({
    color,
    band: 'mid',
    map: woodTexture({
      size: 512,
      base: PALETTE.wood,
      dark: PALETTE.woodDark,
      light: PALETTE.woodWeathered,
      planks,
      seed
    })
  }), name);
  applyWeathering(material, {
    wear: PALETTE.woodDark,
    dust: PALETTE.soilWet,
    start: 0,
    band: 0.7,
    wearAmount: wear,
    dustAmount: 0.1
  });
  return material;
}

function water(name, {
  color, opacity, roughness = 0.12, clearcoat = 0.18, clearcoatRoughness = 0.16,
  envMapIntensity = 0.08, depthWrite = false, flow
}) {
  const material = named(physical({
    color,
    roughness,
    metalness: 0,
    ior: 1.333,
    envMapIntensity,
    transparent: true,
    opacity,
    depthWrite,
    clearcoat,
    clearcoatRoughness,
    side: THREE.DoubleSide
  }), name);
  applyWaterFlow(material, flow);
  return material;
}

function makeToriiMaterials({ seed = 23, baseY = 0, shade = 1.0 } = {}) {
  const paint = (palette, extraSeed, size = 1024) => weatheredPaintTexture({
    size,
    paint: palette,
    bare: PALETTE.toriiWoodBare,
    moss: PALETTE.mossWet,
    seed: seed + extraSeed
  });

  const sByte = Math.max(0, Math.min(255, Math.round(shade * 255)));
  const tintHex = (sByte << 16) | (sByte << 8) | sByte;

  const lacquerRule = (material) => {
    applyWeathering(material, {
      wear: PALETTE.toriiLacquerLoss,
      dust: PALETTE.soilWet,
      start: baseY,
      band: 1.25,
      wearAmount: 0.42,
      dustAmount: 0.14
    });
    applyShadowLift(material, { lift: 0.08, knee: 0.38 });
    return material;
  };

  const T = {};
  T.lacquer = lacquerRule(named(toon({
    color: tintHex,
    band: 'mid',
    map: paint(PALETTE.toriiVermilion, 0)
  }), 'toriiLacquer'));

  T.post = lacquerRule(named(toon({
    color: tintHex,
    band: 'mid',
    map: paint(PALETTE.toriiVermilion, 7)
  }), 'toriiPost'));
  applyMossAttachment(T.post, {
    color: PALETTE.mossWet,
    height: baseY + 0.42,
    band: 0.75,
    amount: 0.42
  });

  T.deep = lacquerRule(named(toon({
    color: PALETTE.toriiVermilionDeep, band: 'soft'
  }), 'toriiVermilionDeep'));

  T.fade = lacquerRule(named(toon({
    color: PALETTE.toriiVermilionFade, band: 'mid'
  }), 'toriiVermilionFade'));

  T.black = lacquerRule(named(toon({
    color: 0xffffff, band: 'mid', map: paint(PALETTE.toriiBlack, 13)
  }), 'toriiBlack'));

  T.blackFade = lacquerRule(named(toon({
    color: PALETTE.toriiBlackFade, band: 'soft'
  }), 'toriiBlackFade'));

  T.woodBare = named(toon({
    color: 0xffffff,
    band: 'mid',
    map: woodTexture({
      size: 512,
      base: PALETTE.toriiWoodBare,
      dark: PALETTE.woodDark,
      light: PALETTE.toriiVermilionFade,
      planks: 4,
      seed: seed + 19
    })
  }), 'toriiWoodBare');
  applyWeathering(T.woodBare, {
    wear: PALETTE.woodDark,
    dust: PALETTE.soilWet,
    start: baseY - 0.3,
    band: 1.0,
    wearAmount: 0.5,
    dustAmount: 0.2
  });

  T.stoneBase = named(toon({
    color: 0xffffff,
    band: 'mid',
    map: stoneTexture({
      size: 512,
      base: PALETTE.stoneWet,
      dark: PALETTE.stoneDark,
      light: PALETTE.stone,
      seed: seed + 31
    })
  }), 'toriiStoneBase');
  applyWeathering(T.stoneBase, {
    wear: PALETTE.stoneDark,
    dust: PALETTE.soilWet,
    start: baseY - 0.34,
    band: 0.8,
    wearAmount: 0.4,
    dustAmount: 0.22
  });
  applyMossAttachment(T.stoneBase, {
    color: PALETTE.moss,
    height: baseY + 0.2,
    band: 0.7,
    amount: 0.45
  });
  return T;
}

export function createMaterialLibrary() {
  const M = {};
  M.toon = toon;
  M.physical = physical;
  M.makeToriiMaterials = makeToriiMaterials;

  /* ---------------- 展台底座 ---------------- */
  M.padTop = named(toon({ color: PALETTE.padTop, band: 'soft' }), 'padTop');
  M.padEdge = named(toon({ color: PALETTE.padEdge, band: 'soft' }), 'padEdge');
  M.padChamfer = named(toon({ color: PALETTE.padHighlight, band: 'soft' }), 'padChamfer');

  /* ---------------- 泥土 ---------------- */
  M.soilTerrain = named(toon({
    color: 0xffffff, band: 'soft',
    map: soilTexture({ size: 2048, seed: 101 })
  }), 'soilTerrain');
  M.soilTerrainShade = named(toon({
    color: 0xb8b8b8, band: 'soft',
    map: soilTexture({ size: 2048, base: PALETTE.soilDark, seed: 107 })
  }), 'soilTerrainShade');
  M.soilPath = named(toon({
    color: 0xffffff, band: 'mid',
    map: soilTexture({ size: 1024, seed: 113 })
  }), 'soilPath');
  M.soilPathWet = named(toon({
    color: 0xa8a8a8, band: 'mid',
    map: soilTexture({ size: 1024, base: PALETTE.soilWet, seed: 127 })
  }), 'soilPathWet');
  M.soilBank = named(toon({
    color: 0xffffff, band: 'mid',
    map: soilTexture({ size: 1024, base: PALETTE.soil, seed: 131 })
  }), 'soilBank');
  applySubmergedCaustics(M.soilBank);
  M.soilStreamBed = named(toon({
    color: 0xffffff, band: 'soft',
    map: sandTexture({ size: 1024, seed: 113 })
  }), 'soilStreamBed');
  applySubmergedCaustics(M.soilStreamBed);
  M.soilCut = named(toon({
    color: 0xffffff, band: 'mid',
    map: soilTexture({ size: 1024, base: PALETTE.soilDark, seed: 139 })
  }), 'soilCut');

  /* ---------------- 石材（三渲二哑光/微润天然山石材质，彻底消除翡翠玻璃反光与假绿染） ---------------- */
  M.stoneStepLower = stoneStepZone('stoneStepLower', {
    seed: 13, mossHeight: 1.75, mossAmount: 0.36, wearStart: 0.16, wearBand: 1.6
  });
  M.stoneStepMid = stoneStepZone('stoneStepMid', {
    seed: 17, mossHeight: 3.35, mossAmount: 0.30, wearStart: 1.75, wearBand: 1.6
  });
  M.stoneStepUpper = stoneStepZone('stoneStepUpper', {
    seed: 19, mossHeight: 5.0, mossAmount: 0.24, wearStart: 3.35, wearBand: 1.6
  });
  M.stoneSlab = stoneStepZone('stoneSlab', {
    seed: 23, mossHeight: 5.6, mossAmount: 0.32, wearStart: 4.4, wearBand: 1.8
  });
  M.stoneStepWet = named(toon({
    color: 0xffffff, band: 'mid',
    map: stoneTexture({
      size: 512, base: PALETTE.stoneWet, dark: PALETTE.slateDark,
      light: PALETTE.slate, seed: 25
    })
  }), 'stoneStepWet');
  applyWeathering(M.stoneStepWet, {
    wear: PALETTE.slateDark, dust: PALETTE.soilWet, start: 0, band: 1.2,
    wearAmount: 0.45, dustAmount: 0.2
  });
  applyShadowLift(M.stoneStepWet, { lift: 0.08, knee: 0.38 });

  // 干/微润山石（冷灰安山岩，棱角分明，仅根部极轻微暗苔）
  M.stoneRock = named(toon({
    color: 0xffffff, band: 'mid',
    map: stoneTexture({
      size: 512, base: 0x586166, dark: 0x32383c,
      light: 0x737e84, seed: 29
    })
  }), 'stoneRock');
  applyWeathering(M.stoneRock, {
    wear: 0x282d30, dust: PALETTE.soilWet, start: 0, band: 0.9,
    wearAmount: 0.46, dustAmount: 0.20
  });
  applyMossAttachment(M.stoneRock, { color: 0x2c3e24, height: 0.45, band: 0.65, amount: 0.14 });
  applyShadowLift(M.stoneRock, { lift: 0.08, knee: 0.38 });

  // 溪畔与雨淋深色湿石（三渲二哑光深青灰板岩，无 clearcoat 镜面高光，绝不发绿像翡翠）
  M.stoneRockWet = named(toon({
    color: 0xffffff, band: 'mid',
    map: stoneTexture({
      size: 512, base: 0x424a4e, dark: 0x24292c,
      light: 0x5a6469, seed: 31
    })
  }), 'stoneRockWet');
  applyWeathering(M.stoneRockWet, {
    wear: 0x1e2326, dust: PALETTE.soilWet, start: 0, band: 0.85,
    wearAmount: 0.50, dustAmount: 0.22
  });
  applyMossAttachment(M.stoneRockWet, { color: 0x263820, height: 0.38, band: 0.55, amount: 0.12 });
  applyShadowLift(M.stoneRockWet, { lift: 0.08, knee: 0.38 });

  // 溪内与水下乱石（冷灰褐河石，仅在水线以下受微弱水底焦散，出水部分保持自然灰石本色）
  M.stoneStream = named(toon({
    color: 0xffffff, band: 'mid',
    map: stoneTexture({
      size: 512, base: 0x4a5154, dark: 0x2a2f32,
      light: 0x626b70, seed: 37
    })
  }), 'stoneStream');
  applyWeathering(M.stoneStream, {
    wear: 0x222629, dust: PALETTE.soilWet, start: 0, band: 0.8,
    wearAmount: 0.44, dustAmount: 0.18
  });
  applyShadowLift(M.stoneStream, { lift: 0.08, knee: 0.38 });
  applySubmergedCaustics(M.stoneStream);

  // 层理劈理岩（用于伴生副石、挑出石板与石堰叠石，丰富石群色差）
  M.stoneRockStratified = named(toon({
    color: 0xffffff, band: 'hard',
    map: stoneTexture({
      size: 512, base: 0x4e5559, dark: 0x2b3033,
      light: 0x687177, seed: 43
    })
  }), 'stoneRockStratified');
  applyWeathering(M.stoneRockStratified, {
    wear: 0x23272a, dust: PALETTE.soilWet, start: 0, band: 0.9,
    wearAmount: 0.48, dustAmount: 0.20
  });
  applyShadowLift(M.stoneRockStratified, { lift: 0.08, knee: 0.38 });

  // 棱角碎石片（Scree Chips）
  M.stoneChip = named(toon({
    color: 0xffffff, band: 'hard',
    map: stoneTexture({
      size: 512, base: 0x5d6569, dark: 0x363c3f,
      light: 0x778187, seed: 51
    })
  }), 'stoneChip');
  applyShadowLift(M.stoneChip, { lift: 0.08, knee: 0.38 });

  M.stonePebble = named(toon({
    color: 0xffffff, band: 'mid',
    map: gravelTexture({
      size: 512, stone: PALETTE.stone, dust: PALETTE.stoneLight,
      shade: PALETTE.stoneDark, density: 34
    })
  }), 'stonePebble');
  applySubmergedCaustics(M.stonePebble);

  /* ---------------- 树皮 ---------------- */
  M.barkKusunoki = bark('barkKusunoki', {
    base: PALETTE.barkKusunoki, light: PALETTE.woodWeathered, seed: 41
  });
  M.barkSakaki = bark('barkSakaki', {
    base: PALETTE.barkSakaki, light: PALETTE.wood, seed: 47
  });
  M.barkKaede = bark('barkKaede', {
    base: PALETTE.barkKaede, light: PALETTE.woodWeathered, seed: 53
  });
  M.barkFlare = bark('barkFlare', {
    base: PALETTE.barkCrack, light: PALETTE.barkKusunoki, seed: 59
  });
  M.barkFlake = bark('barkFlake', {
    size: 512, base: PALETTE.barkCrack, light: PALETTE.barkSakaki, seed: 61
  });
  M.barkMoss = named(toon({
    color: 0xffffff, band: 'mid',
    map: barkTexture({
      size: 512, base: PALETTE.barkKusunoki, crack: PALETTE.barkCrack,
      light: PALETTE.moss, seed: 67
    })
  }), 'barkMoss');
  applyMossAttachment(M.barkMoss, {
    color: PALETTE.mossWet, height: 2.2, band: 1.8, amount: 0.58
  });

  /* ---------------- 叶片 ---------------- */
  M.leafSheetEvergreen = leaf('leafSheetEvergreen', PALETTE.leafEvergreen, {
    tint: 0x4b8749, strength: 0.14, flutterPeriod: 3.1
  });
  M.leafSheetEvergreenDeep = leaf('leafSheetEvergreenDeep', PALETTE.leafEvergreenDeep, {
    tint: 0x264d29, strength: 0.06, power: 3.2, flutterPeriod: 3.5
  });
  M.leafSheetEvergreenLight = leaf('leafSheetEvergreenLight', PALETTE.leafEvergreenLight, {
    tint: 0x6ea85e, strength: 0.24, power: 2.4, flutterPeriod: 4.1
  });
  M.leafSheetSakaki = leaf('leafSheetSakaki', PALETTE.leafSakaki, {
    tint: 0x457d44, strength: 0.12, flutterPeriod: 3.7
  });
  M.leafSheetSakakiDeep = leaf('leafSheetSakakiDeep', PALETTE.leafSakakiDeep, {
    tint: 0x244726, strength: 0.05, power: 3.2, flutterPeriod: 4.3
  });
  M.leafSheetMaple = leaf('leafSheetMaple', PALETTE.leafMaple, {
    tint: 0x7ab856, strength: 0.38, flutterPeriod: 3.3
  });
  M.leafSheetMapleDeep = leaf('leafSheetMapleDeep', PALETTE.leafMapleDeep, {
    tint: 0x4c8238, strength: 0.2, power: 2.8, flutterPeriod: 4.5
  });
  M.leafSheetMapleLight = leaf('leafSheetMapleLight', PALETTE.leafMapleLight, {
    tint: 0x9cd46e, strength: 0.52, power: 2.1, flutterPeriod: 3.9
  });
  M.leafSheetShrub = leaf('leafSheetShrub', PALETTE.shrub, {
    tint: 0x356135, strength: 0.08, flutterPeriod: 3.4
  });
  M.leafSheetShrubDeep = leaf('leafSheetShrubDeep', PALETTE.shrubDeep, {
    tint: 0x1b381d, strength: 0.04, power: 3.4, flutterPeriod: 4.0
  });
  M.leafSheetShrubLight = leaf('leafSheetShrubLight', PALETTE.shrubLight, {
    tint: 0x4a7a44, strength: 0.14, power: 2.6, flutterPeriod: 4.6
  });
  M.leafSheetFern = leaf('leafSheetFern', PALETTE.fern, {
    tint: 0x5c8f4c, strength: 0.16, power: 2.8
  });
  M.leafSheetFernDeep = leaf('leafSheetFernDeep', PALETTE.fernDeep, {
    tint: 0x365c2e, strength: 0.08, power: 3.2
  });
  M.leafSheetFernTip = leaf('leafSheetFernTip', PALETTE.fernTip, {
    tint: 0x7eb362, strength: 0.24, power: 2.4
  });
  M.leafSheetGround = leaf('leafSheetGround', PALETTE.groundLeaf, {
    tint: 0x4d3c28, strength: 0.04, power: 3.6
  });
  M.leafSheetGroundDeep = leaf('leafSheetGroundDeep', PALETTE.groundLeafDeep, {
    tint: 0x33271a, strength: 0.02, power: 3.8
  });
  M.leafSheetGroundLight = leaf('leafSheetGroundLight', PALETTE.groundLeafLight, {
    tint: 0x634d34, strength: 0.05, power: 3.4
  });
  M.leafSheetGroundRust = leaf('leafSheetGroundRust', PALETTE.groundLeafRust, {
    tint: 0x593722, strength: 0.04, power: 3.6
  });
  M.leafSheetGroundWet = leaf('leafSheetGroundWet', PALETTE.groundLeafDeep, {
    tint: 0x2b3326, strength: 0.02, power: 3.8
  });
  M.leafSheetGrass = leaf('leafSheetGrass', PALETTE.fernTip, {
    tint: 0x72ab58, strength: 0.2, power: 2.6
  });
  M.leafSheetGrassDeep = leaf('leafSheetGrassDeep', PALETTE.fern, {
    tint: 0x49783c, strength: 0.12, power: 3.0
  });
  M.leafSheetVine = leaf('leafSheetVine', PALETTE.leafEvergreenLight, {
    tint: 0x5e9652, strength: 0.18, flutterPeriod: 4.4
  });

  /* ---------------- 茎 / 枝 ---------------- */
  M.fernStem = named(toon({ color: PALETTE.fernDeep, band: 'mid' }), 'fernStem');
  M.fernDry = named(toon({ color: PALETTE.groundLeaf, band: 'mid' }), 'fernDry');
  M.shrubStem = named(toon({ color: PALETTE.woodDark, band: 'mid' }), 'shrubStem');
  M.shrubStemLive = named(toon({ color: PALETTE.shrubDeep, band: 'mid' }), 'shrubStemLive');
  M.shrubTwigDead = named(toon({ color: PALETTE.woodWeathered, band: 'mid' }), 'shrubTwigDead');
  M.twigBark = stem('twigBark', { color: 0xffffff, seed: 71, planks: 3 });
  M.twigDead = stem('twigDead', { color: 0xb8b8b8, seed: 73, planks: 3, wear: 0.42 });
  M.vineStem = stem('vineStem', { color: 0xffffff, seed: 77, planks: 2, wear: 0.24 });
  M.woodWeathered = stem('woodWeathered', { color: 0xffffff, seed: 79, planks: 5, wear: 0.46 });
  applyMossAttachment(M.woodWeathered, { color: PALETTE.mossDamp, height: 1.1, band: 0.9, amount: 0.45 });

  /* ---------------- 青苔 ---------------- */
  M.mossPatch = named(toon({
    color: 0xffffff, band: 'soft',
    map: mossTexture({ size: 512, base: PALETTE.moss, wet: PALETTE.mossWet, seed: 71 })
  }), 'mossPatch');
  M.mossWet = named(toon({
    color: 0xffffff, band: 'soft',
    map: mossTexture({ size: 512, base: PALETTE.mossWet, wet: PALETTE.moss, seed: 73 })
  }), 'mossWet');
  M.mossDamp = named(toon({
    color: 0xffffff, band: 'soft',
    map: mossTexture({ size: 512, base: PALETTE.mossDamp, wet: PALETTE.moss, seed: 77 })
  }), 'mossDamp');
  M.mossStone = named(toon({
    color: 0xffffff, band: 'mid',
    map: mossTexture({ size: 512, base: PALETTE.moss, wet: PALETTE.mossDamp, seed: 83 })
  }), 'mossStone');
  applyMossAttachment(M.mossStone, { color: PALETTE.mossWet, height: 2.2, band: 1.2, amount: 0.4 });

  /* ---------------- 水体 ---------------- */
  M.waterSurface = water('waterSurface', {
    color: PALETTE.water,
    opacity: 0.24,
    envMapIntensity: 0.06,
    roughness: 0.14,
    clearcoat: 0.16,
    clearcoatRoughness: 0.18,
    flow: { speed: 0.16, scale: 0.72, strength: 0.92, overlayMode: 0 }
  });
  M.waterfallFoam = water('waterCascadeFoam', {
    color: 0x568274,
    opacity: 0.42,
    envMapIntensity: 0.06,
    roughness: 0.24,
    clearcoat: 0.1,
    clearcoatRoughness: 0.24,
    flow: { speed: 0.36, scale: 1.25, strength: 1.1, overlayMode: 1 }
  });
  M.waterEddy = water('waterEddyFoam', {
    color: 0x487365,
    opacity: 0.34,
    envMapIntensity: 0.06,
    roughness: 0.22,
    clearcoat: 0.1,
    clearcoatRoughness: 0.22,
    flow: { speed: 0.22, scale: 1.0, strength: 1.0, overlayMode: 2 }
  });
  M.puddleWater = water('puddleWater', {
    color: PALETTE.waterShallow,
    opacity: 0.36,
    envMapIntensity: 0.12,
    roughness: 0.14,
    clearcoat: 0.22,
    clearcoatRoughness: 0.18,
    flow: { speed: 0.04, scale: 0.9, strength: 0.38, overlayMode: 0 }
  });

  /* ---------------- 林间薄雾 ---------------- */
  M.mistBand = named(new THREE.MeshBasicMaterial({
    color: PALETTE.skyMid,
    map: mistVeilTexture({ size: 512, seed: 131 }),
    transparent: true,
    opacity: 0.1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  }), 'mistBand');

  return M;
}
