// 材质库：六大类材质（木材 / 石材 / 水体 / 叶片 / 树皮 / 泥土）+ 底座 / 青苔 / 茎枝 / 薄雾 / 注连绳纸垂。
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
    dustAmount: 0.22,
    roughnessVar: 0.22
  });
  applyMossAttachment(material, {
    color: PALETTE.mossWet,
    height: mossHeight,
    band: 1.15,
    amount: mossAmount * 1.28
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

  const lacquerRule = (material, roughnessVar = 0.46) => {
    applyWeathering(material, {
      wear: PALETTE.toriiLacquerLoss,
      dust: PALETTE.soilWet,
      start: baseY,
      band: 1.35,
      wearAmount: 0.46,
      dustAmount: 0.16,
      roughnessVar
    });
    applyShadowLift(material, { lift: 0.08, knee: 0.38 });
    return material;
  };

  const T = {};
  T.lacquer = lacquerRule(named(toon({
    color: tintHex,
    band: 'mid',
    map: paint(PALETTE.toriiVermilion, 0)
  }), 'toriiLacquer'), 0.48);
  applyMossAttachment(T.lacquer, {
    color: PALETTE.mossWet,
    height: baseY + 2.88,
    band: 0.45,
    amount: 0.28
  });

  T.post = lacquerRule(named(toon({
    color: tintHex,
    band: 'mid',
    map: paint(PALETTE.toriiVermilion, 7)
  }), 'toriiPost'), 0.52);
  applyMossAttachment(T.post, {
    color: PALETTE.mossWet,
    height: baseY + 0.65,
    band: 0.95,
    amount: 0.54
  });

  T.deep = lacquerRule(named(toon({
    color: PALETTE.toriiVermilionDeep, band: 'soft'
  }), 'toriiVermilionDeep'), 0.35);

  T.fade = lacquerRule(named(toon({
    color: PALETTE.toriiVermilionFade, band: 'mid'
  }), 'toriiVermilionFade'), 0.32);

  T.black = lacquerRule(named(toon({
    color: 0xffffff, band: 'mid', map: paint(PALETTE.toriiBlack, 13)
  }), 'toriiBlack'), 0.38);

  T.blackFade = lacquerRule(named(toon({
    color: PALETTE.toriiBlackFade, band: 'soft'
  }), 'toriiBlackFade'), 0.25);

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
    height: baseY + 0.32,
    band: 0.85,
    amount: 0.58
  });

  // 注连绳（しめ縄）：粗编稻草绳材质，带自然草茎纹理与微润风化
  T.shimenawa = named(toon({
    color: tintHex,
    band: 'mid',
    map: woodTexture({
      size: 512,
      base: 0xc8ae74,
      dark: 0x826b3e,
      light: 0xe3cb96,
      planks: 12,
      seed: seed + 43
    })
  }), 'toriiShimenawa');
  applyWeathering(T.shimenawa, {
    wear: 0x6b5630,
    dust: PALETTE.soilWet,
    start: baseY + 2.4,
    band: 0.65,
    wearAmount: 0.32,
    dustAmount: 0.14,
    roughnessVar: 0.18
  });
  applyShadowLift(T.shimenawa, { lift: 0.18, knee: 0.48 });

  // 纸垂（紙垂 / しで）：神圣奉书纸材质，暖白微透光，轮廓鲜明
  T.shide = named(toon({
    color: 0xf4f0e4,
    band: 'soft',
    side: THREE.DoubleSide
  }), 'toriiShide');
  applyLeafTranslucency(T.shide, { color: 0xfff8e6, strength: 0.28, power: 2.2 });
  applyShadowLift(T.shide, { lift: 0.26, knee: 0.56 });

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
    map: soilTexture({ size: 1024, base: 0x453628, dark: 0x2c2218, wet: 0x36291e, seed: 131 })
  }), 'soilBank');
  applySubmergedCaustics(M.soilBank);
  M.soilStreamBed = named(toon({
    color: 0xffffff, band: 'soft',
    map: sandTexture({
      size: 1024,
      base: 0x3b3024,
      dark: 0x241d15,
      stone: 0x585045,
      seed: 113
    })
  }), 'soilStreamBed');
  applyShadowLift(M.soilStreamBed, { lift: 0.22, knee: 0.52 });
  applySubmergedCaustics(M.soilStreamBed);

  // 弯曲河道中心专属暖褐砂砾河床材质（仅贴在溪流内部弯曲河槽，绝不外露到岸上）
  M.riverbedSand = named(toon({
    color: 0xffffff, band: 'soft',
    map: sandTexture({
      size: 1024,
      base: 0x6e5d48,
      dark: 0x463a2c,
      stone: 0x8e8372,
      seed: 157
    })
  }), 'riverbedSand');
  applyShadowLift(M.riverbedSand, { lift: 0.30, knee: 0.60 });
  applySubmergedCaustics(M.riverbedSand);
  M.soilCut = named(toon({
    color: 0xffffff, band: 'mid',
    map: soilTexture({ size: 1024, base: PALETTE.soilDark, seed: 139 })
  }), 'soilCut');

  /* ---------------- 石材（三渲二天然山石与河石材质：层次分明、棱角清晰、部分石头覆自然青苔） ---------------- */
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
      size: 512, base: 0x626e74, dark: 0x3e474b,
      light: 0x829096, seed: 25
    })
  }), 'stoneStepWet');
  applyWeathering(M.stoneStepWet, {
    wear: 0x363e42, dust: PALETTE.soilWet, start: 0, band: 1.2,
    wearAmount: 0.32, dustAmount: 0.16, roughnessVar: 0.28
  });
  applyMossAttachment(M.stoneStepWet, {
    color: PALETTE.mossWet, height: 3.2, band: 1.8, amount: 0.42
  });
  applyShadowLift(M.stoneStepWet, { lift: 0.22, knee: 0.52 });

  // 1) 天然风化山石（明快灰褐/青灰花岗安山岩，折面明暗清晰，顶面局部带青苔斑块）
  M.stoneRock = named(toon({
    color: 0xffffff, band: 'mid',
    map: stoneTexture({
      size: 512, base: 0x868d8c, dark: 0x585f60,
      light: 0xa8b0af, seed: 29
    })
  }), 'stoneRock');
  applyWeathering(M.stoneRock, {
    wear: 0x484e50, dust: 0x5c5042, start: 0, band: 0.75,
    wearAmount: 0.22, dustAmount: 0.12
  });
  applyMossAttachment(M.stoneRock, { color: 0x3b6326, height: 0.28, band: 0.45, amount: 0.35 });
  applyShadowLift(M.stoneRock, { lift: 0.32, knee: 0.62 });

  // 2) 溪畔与雨淋湿润山石（中明度青灰岩体，带局部翠绿湿苔，绝不死黑）
  M.stoneRockWet = named(toon({
    color: 0xffffff, band: 'mid',
    map: stoneTexture({
      size: 512, base: 0x788184, dark: 0x4e5659,
      light: 0x9aa4a8, seed: 31
    })
  }), 'stoneRockWet');
  applyWeathering(M.stoneRockWet, {
    wear: 0x3e4548, dust: 0x4f4337, start: 0, band: 0.7,
    wearAmount: 0.24, dustAmount: 0.12
  });
  applyMossAttachment(M.stoneRockWet, { color: 0x385e24, height: 0.32, band: 0.5, amount: 0.42 });
  applyShadowLift(M.stoneRockWet, { lift: 0.34, knee: 0.64 });

  // 3) 覆苔山石（仅在顶面平台生长自然森林青苔垫，侧面露出清晰灰褐岩面）
  M.stoneRockMossy = named(toon({
    color: 0xffffff, band: 'mid',
    map: stoneTexture({
      size: 512, base: 0x808682, dark: 0x525854,
      light: 0xa0a8a3, seed: 35
    })
  }), 'stoneRockMossy');
  applyMossAttachment(M.stoneRockMossy, { color: 0x3e6929, height: 0.36, band: 0.55, amount: 0.62 });
  applyShadowLift(M.stoneRockMossy, { lift: 0.34, knee: 0.64 });
  applySubmergedCaustics(M.stoneRockMossy);

  // 4) 溪内与水下河石（温润灰白/浅灰褐溪石，水下清晰可见，出水折面立体）
  M.stoneStream = named(toon({
    color: 0xffffff, band: 'mid',
    map: stoneTexture({
      size: 512, base: 0x8e918a, dark: 0x60645e,
      light: 0xb2b5ac, seed: 37
    })
  }), 'stoneStream');
  applyWeathering(M.stoneStream, {
    wear: 0x4e524f, dust: 0x5a4e40, start: 0, band: 0.65,
    wearAmount: 0.20, dustAmount: 0.10
  });
  applyMossAttachment(M.stoneStream, { color: 0x3a6125, height: 0.25, band: 0.4, amount: 0.24 });
  applyShadowLift(M.stoneStream, { lift: 0.35, knee: 0.65 });
  applySubmergedCaustics(M.stoneStream);

  // 5) 层理劈理岩（暖灰石英砂岩色阶，与冷灰石形成自然地质对比）
  M.stoneRockStratified = named(toon({
    color: 0xffffff, band: 'hard',
    map: stoneTexture({
      size: 512, base: 0x8e897d, dark: 0x5e5a52,
      light: 0xb2ada0, seed: 43
    })
  }), 'stoneRockStratified');
  applyWeathering(M.stoneRockStratified, {
    wear: 0x4a4740, dust: 0x5c5042, start: 0, band: 0.9,
    wearAmount: 0.24, dustAmount: 0.14
  });
  applyMossAttachment(M.stoneRockStratified, { color: 0x446e2c, height: 0.65, band: 0.9, amount: 0.28 });
  applyShadowLift(M.stoneRockStratified, { lift: 0.34, knee: 0.64 });
  applySubmergedCaustics(M.stoneRockStratified);

  // 6) 棱角碎石与浅色河砾（Scree & River Cobble Chips）
  M.stoneChip = named(toon({
    color: 0xffffff, band: 'hard',
    map: stoneTexture({
      size: 512, base: 0x9c978b, dark: 0x6c685e,
      light: 0xbcb7aa, seed: 51
    })
  }), 'stoneChip');
  applyShadowLift(M.stoneChip, { lift: 0.36, knee: 0.65 });
  applySubmergedCaustics(M.stoneChip);

  M.stonePebble = named(toon({
    color: 0xffffff, band: 'mid',
    map: gravelTexture({
      size: 512, stone: 0x968f80, dust: 0xb5ae9e,
      shade: 0x635e54, density: 34
    })
  }), 'stonePebble');
  applyShadowLift(M.stonePebble, { lift: 0.34, knee: 0.64 });
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
  // 溪面漂浮落叶专用材质（暖金黄 / 琥珀橙 / 枫红，带柔和透光与暗部提亮，随水波起伏漂流）
  M.leafSheetFloatingGold = leaf('leafSheetFloatingGold', 0xe6b43c, {
    tint: 0xf7d56e, strength: 0.36, power: 2.2
  });
  applyShadowLift(M.leafSheetFloatingGold, { lift: 0.35, knee: 0.65 });
  M.leafSheetFloatingAmber = leaf('leafSheetFloatingAmber', 0xd6742b, {
    tint: 0xf09b48, strength: 0.32, power: 2.4
  });
  applyShadowLift(M.leafSheetFloatingAmber, { lift: 0.32, knee: 0.62 });
  M.leafSheetFloatingCrimson = leaf('leafSheetFloatingCrimson', 0xc24329, {
    tint: 0xe36646, strength: 0.28, power: 2.5
  });
  applyShadowLift(M.leafSheetFloatingCrimson, { lift: 0.30, knee: 0.60 });
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
    map: mossTexture({ size: 512, base: 0x4b7834, wet: 0x355924, seed: 71 })
  }), 'mossPatch');
  applyShadowLift(M.mossPatch, { lift: 0.28, knee: 0.58 });
  M.mossWet = named(toon({
    color: 0xffffff, band: 'soft',
    map: mossTexture({ size: 512, base: 0x3d6629, wet: 0x4e7c37, seed: 73 })
  }), 'mossWet');
  applyShadowLift(M.mossWet, { lift: 0.28, knee: 0.58 });
  M.mossDamp = named(toon({
    color: 0xffffff, band: 'soft',
    map: mossTexture({ size: 512, base: 0x335722, wet: 0x467330, seed: 77 })
  }), 'mossDamp');
  applyShadowLift(M.mossDamp, { lift: 0.28, knee: 0.58 });
  M.mossStone = named(toon({
    color: 0xffffff, band: 'mid',
    map: mossTexture({ size: 512, base: 0x467330, wet: 0x325421, seed: 83 })
  }), 'mossStone');
  applyMossAttachment(M.mossStone, { color: PALETTE.mossWet, height: 2.2, band: 1.2, amount: 0.4 });
  applyShadowLift(M.mossStone, { lift: 0.28, knee: 0.58 });

  /* ---------------- 水体 ---------------- */
  M.waterSurface = water('waterSurface', {
    color: PALETTE.water,
    opacity: 0.22,
    envMapIntensity: 0.65,
    roughness: 0.04,
    clearcoat: 0.88,
    clearcoatRoughness: 0.05,
    depthWrite: true,
    flow: { speed: 0.22, scale: 0.85, strength: 1.15, overlayMode: 0 }
  });
  M.waterfallFoam = water('waterCascadeFoam', {
    color: 0x628e80,
    opacity: 0.36,
    envMapIntensity: 0.35,
    roughness: 0.14,
    clearcoat: 0.45,
    clearcoatRoughness: 0.12,
    flow: { speed: 0.42, scale: 1.25, strength: 1.1, overlayMode: 1 }
  });
  M.waterEddy = water('waterEddyFoam', {
    color: 0x4e7b6d,
    opacity: 0.28,
    envMapIntensity: 0.25,
    roughness: 0.16,
    clearcoat: 0.35,
    clearcoatRoughness: 0.14,
    flow: { speed: 0.24, scale: 1.0, strength: 1.0, overlayMode: 2 }
  });
  M.puddleWater = water('puddleWater', {
    color: PALETTE.waterShallow,
    opacity: 0.36,
    envMapIntensity: 0.42,
    roughness: 0.08,
    clearcoat: 0.65,
    clearcoatRoughness: 0.1,
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
