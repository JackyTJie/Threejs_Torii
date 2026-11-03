// 材质库：六大类材质（木材 / 石材 / 水体 / 叶片 / 树皮 / 泥土）+ 底座 / 青苔 / 茎枝 / 薄雾。
//
// 三条硬规则（踩过的坑，别再犯）：
// 1) 带 map 的材质 color 一律中性白：色相由贴图生成器的 palette 参数决定，
//    若 color 也填 palette 会被乘两次、整片发暗。需要压暗时用中性灰乘。
// 2) 贴图按 key 缓存、多个材质共享同一个 Texture 对象 ⇒ 材质层绝不改 texture.repeat。
//    大面积表面（地形 / 参道泥地）由资产层把 uv 按米生成，repeat 保持 1。
// 3) 带着色器注入的材质禁止 clone()（clone 复制 onBeforeCompile 闭包，闭包里的
//    material 仍指向父材质，uniform 表也会串台）。要变体就再调一次工厂。
//
// 资产模块只从本库取材质；鸟居这类「同一规格、不同实例各自老化」的用工厂现做。
import * as THREE from 'three';
import { PALETTE, ANIM } from './config.js';
import {
  setBanding, applyWeathering, applyMossAttachment, applyLeafTranslucency,
  applyShadowLift, applyLeafFlutter, applyWaterFlow
} from './toon.js';
import {
  woodTexture, weatheredPaintTexture, barkTexture, gravelTexture, stoneTexture,
  soilTexture, sandTexture, mossTexture, waterDetailTexture, mistVeilTexture
} from './textures.js';

/** 卡通材质快捷构造：三渲二渐变带在这里统一挂上 */
function toon(options = {}) {
  const { band = 'mid', color = 0xffffff, map = null, ...rest } = options;
  const material = new THREE.MeshToonMaterial({ color, map, ...rest });
  setBanding(material, band);
  return material;
}

/** 物理材质快捷构造（水体 / 湿石高光） */
function physical(options = {}) {
  const { color = 0xffffff, map = null, ...rest } = options;
  return new THREE.MeshPhysicalMaterial({ color, map, ...rest });
}

/** name 走 ...rest 不可靠（MeshToonMaterial 构造里 name 不是参数），显式命名 */
function named(material, name) {
  material.name = name;
  return material;
}

/**
 * 叶片材质：纯色 + 双面 + 软阶带 + 逆光透光。
 * 绝对不给 map —— primitives.leafSheetGeometry / leafBladeGeometry 只产出
 * position 与法线，没有 uv，挂 map 等于什么都不会发生（静默无贴图）。
 * flutter 只对 InstancedMesh 有意义，蕨叶 / 地面落叶 / 草不挂（静谧优先，只让树与灌丛动）。
 */
function leaf(name, color, {
  tint = 0x9fd6a0, strength = 0.4, power = 2.6, band = 'soft', flutterPeriod = 0
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

/** 石阶按高度分三区：applyMossAttachment 的 height 是绝对世界 Y 上限，一份共享材质跟不住 32 级台阶 */
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
    wearAmount: 0.44,
    dustAmount: 0.18
  });
  applyMossAttachment(material, {
    color: PALETTE.mossWet,
    height: mossHeight,
    band: 0.95,
    amount: mossAmount
  });
  applyShadowLift(material, { lift: 0.1, knee: 0.4 });
  return material;
}

/** 树皮：纵向裂纹贴图 + 老化；基部苔壳另给一份带 moss 附着的变体 */
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
    band: 1.1,
    wearAmount: 0.34,
    dustAmount: 0.12
  });
  return material;
}

/** 茎 / 枝：细木，木纹贴图 + 轻微老化，保留描边 */
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

/** 水体：近透明 + 低粗糙 + 薄清漆，顺流亮带由 applyWaterFlow 提供 */
function water(name, { color, opacity, roughness, clearcoat, clearcoatRoughness, flow }) {
  const material = named(physical({
    color,
    roughnessMap: waterDetailTexture({ size: 512, seed: 97 }),
    transmission: 0.9,
    thickness: 0.25,
    roughness,
    metalness: 0,
    ior: 1.33,
    transparent: true,
    opacity,
    clearcoat,
    clearcoatRoughness,
    side: THREE.DoubleSide
  }), name);
  applyWaterFlow(material, flow);
  return material;
}

/**
 * 鸟居材质工厂：两座同规格鸟居各自现做一份。
 * baseY 决定老化起算面（前座 3.785 / 后座 4.510），seed 决定漆面斑驳与掉漆分布，
 * 于是两座鸟居的褪色痕迹不会像复制粘贴。
 */
function makeToriiMaterials({ seed = 23, baseY = 0 } = {}) {
  const paint = (palette, extraSeed, size = 1024) => weatheredPaintTexture({
    size,
    paint: palette,
    bare: PALETTE.toriiWoodBare,
    moss: PALETTE.mossWet,
    seed: seed + extraSeed
  });

  const lacquerRule = (material) => {
    applyWeathering(material, {
      wear: PALETTE.toriiLacquerLoss,
      dust: PALETTE.soilWet,
      start: baseY,
      band: 1.2,
      wearAmount: 0.55,
      dustAmount: 0.16
    });
    applyShadowLift(material, { lift: 0.13, knee: 0.44 });
    return material;
  };

  const T = {};
  // 主朱漆面：貫 / 島木 / 中柱 / 額束
  T.lacquer = lacquerRule(named(toon({
    color: 0xffffff, band: 'mid', map: paint(PALETTE.toriiVermilion, 0)
  }), 'toriiLacquer'));
  // 立柱：单独一份（受雨最重、掉漆最多），带基部青苔附着
  T.post = lacquerRule(named(toon({
    color: 0xffffff, band: 'mid', map: paint(PALETTE.toriiVermilion, 7)
  }), 'toriiPost'));
  applyMossAttachment(T.post, {
    color: PALETTE.mossWet,
    height: baseY + 0.55,
    band: 0.9,
    amount: 0.5
  });
  // 凹陷面 / 背阴面：更深的朱红
  T.deep = lacquerRule(named(toon({
    color: PALETTE.toriiVermilionDeep, band: 'soft'
  }), 'toriiVermilionDeep'));
  // 顶面：日晒褪色朱红
  T.fade = lacquerRule(named(toon({
    color: PALETTE.toriiVermilionFade, band: 'mid'
  }), 'toriiVermilionFade'));
  // 笠木 / 眉木：近黑
  T.black = lacquerRule(named(toon({
    color: 0xffffff, band: 'mid', map: paint(PALETTE.toriiBlack, 13)
  }), 'toriiBlack'));
  // 貫：黑漆褪色
  T.blackFade = lacquerRule(named(toon({
    color: PALETTE.toriiBlackFade, band: 'soft'
  }), 'toriiBlackFade'));
  // 掉漆处 / 木栓：裸木
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
  // 石基（石島木）：湿石 + 青苔
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
    amount: 0.6
  });
  return T;
}

/**
 * 建立材质库。每个物件类别一个独立材质对象，不共用、不合并。
 */
export function createMaterialLibrary() {
  const M = {};
  M.toon = toon;
  M.physical = physical;
  M.makeToriiMaterials = makeToriiMaterials;

  /* ---------------- 展台底座：规整正方形纯色深灰，不描边、无贴图 ---------------- */
  M.padTop = named(toon({ color: PALETTE.padTop, band: 'soft' }), 'padTop');
  M.padEdge = named(toon({ color: PALETTE.padEdge, band: 'soft' }), 'padEdge');
  M.padChamfer = named(toon({ color: PALETTE.padHighlight, band: 'soft' }), 'padChamfer');

  /* ---------------- 泥土：soil 前缀 ⇒ 不描边（泥地是连续面，描边会读出硬边） ---------------- */
  M.soilTerrain = named(toon({
    color: 0xffffff, band: 'soft',
    map: soilTexture({ size: 2048, seed: 101 })
  }), 'soilTerrain');
  M.soilTerrainShade = named(toon({
    color: 0xc8c8c8, band: 'soft',
    map: soilTexture({ size: 2048, base: PALETTE.soilDark, seed: 107 })
  }), 'soilTerrainShade');
  M.soilPath = named(toon({
    color: 0xffffff, band: 'mid',
    map: soilTexture({ size: 1024, seed: 113 })
  }), 'soilPath');
  M.soilPathWet = named(toon({
    color: 0xb9b9b9, band: 'mid',
    map: soilTexture({ size: 1024, base: PALETTE.soilWet, seed: 127 })
  }), 'soilPathWet');
  M.soilBank = named(toon({
    color: 0xffffff, band: 'mid',
    map: soilTexture({ size: 1024, base: PALETTE.soil, seed: 131 })
  }), 'soilBank');
  M.soilStreamBed = named(toon({
    color: 0xffffff, band: 'soft',
    map: sandTexture({ size: 1024, seed: 113 })
  }), 'soilStreamBed');
  M.soilCut = named(toon({
    color: 0xffffff, band: 'mid',
    map: soilTexture({ size: 1024, base: PALETTE.soilDark, seed: 139 })
  }), 'soilCut');

  /* ---------------- 石材：石阶三区 + 上段石板 + 湿石高光 ---------------- */
  M.stoneStepLower = stoneStepZone('stoneStepLower', {
    seed: 13, mossHeight: 1.75, mossAmount: 0.62, wearStart: 0.16, wearBand: 1.6
  });
  M.stoneStepMid = stoneStepZone('stoneStepMid', {
    seed: 17, mossHeight: 3.35, mossAmount: 0.45, wearStart: 1.75, wearBand: 1.6
  });
  M.stoneStepUpper = stoneStepZone('stoneStepUpper', {
    seed: 19, mossHeight: 5.0, mossAmount: 0.3, wearStart: 3.35, wearBand: 1.6
  });
  M.stoneSlab = stoneStepZone('stoneSlab', {
    seed: 23, mossHeight: 5.6, mossAmount: 0.5, wearStart: 4.4, wearBand: 1.8
  });
  // 湿石：低粗糙 + 薄清漆 = 雨后那层水亮
  M.stoneStepWet = named(physical({
    color: PALETTE.stoneWet, roughness: 0.34, metalness: 0,
    clearcoat: 0.55, clearcoatRoughness: 0.28
  }), 'stoneStepWet');
  M.stoneRock = named(toon({
    color: 0xffffff, band: 'mid',
    map: stoneTexture({
      size: 512, base: PALETTE.stone, dark: PALETTE.stoneDark,
      light: PALETTE.stoneLight, seed: 29
    })
  }), 'stoneRock');
  applyWeathering(M.stoneRock, {
    wear: PALETTE.stoneDark, dust: PALETTE.soilWet, start: 0, band: 0.9,
    wearAmount: 0.36, dustAmount: 0.16
  });
  applyMossAttachment(M.stoneRock, { color: PALETTE.moss, height: 1.4, band: 1.1, amount: 0.5 });
  M.stoneRockWet = named(physical({
    color: PALETTE.stoneWet, roughness: 0.26, metalness: 0,
    clearcoat: 0.7, clearcoatRoughness: 0.2,
    map: stoneTexture({
      size: 512, base: PALETTE.stoneWet, dark: PALETTE.stoneDark,
      light: PALETTE.stoneLight, seed: 31
    })
  }), 'stoneRockWet');
  // 水下石块：颜色被水滤过，压暗、去高光
  M.stoneStream = named(physical({
    color: PALETTE.streamBed, roughness: 0.52, metalness: 0,
    clearcoat: 0.2, clearcoatRoughness: 0.4,
    map: stoneTexture({
      size: 512, base: PALETTE.streamBed, dark: PALETTE.stoneDark,
      light: PALETTE.streamSand, seed: 37
    })
  }), 'stoneStream');
  M.stonePebble = named(toon({
    color: 0xffffff, band: 'mid',
    map: gravelTexture({
      size: 512, stone: PALETTE.stone, dust: PALETTE.stoneLight,
      shade: PALETTE.stoneDark, density: 34
    })
  }), 'stonePebble');

  /* ---------------- 树皮：三种树各一份 + 根部板片 + 苔斑 ---------------- */
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
    color: PALETTE.mossWet, height: 1.3, band: 1.4, amount: 0.55
  });

  /* ---------------- 叶片：无 map、双面、软阶带、逆光透光 ---------------- */
  // 樟（常绿）—— 深林主色
  M.leafSheetEvergreen = leaf('leafSheetEvergreen', PALETTE.leafEvergreen, {
    tint: 0x8fd0a0, strength: 0.42, flutterPeriod: 3.1
  });
  M.leafSheetEvergreenDeep = leaf('leafSheetEvergreenDeep', PALETTE.leafEvergreenDeep, {
    tint: 0x6fae86, strength: 0.34, power: 3.0, flutterPeriod: 3.5
  });
  M.leafSheetEvergreenLight = leaf('leafSheetEvergreenLight', PALETTE.leafEvergreenLight, {
    tint: 0xb6e0b0, strength: 0.48, power: 2.3, flutterPeriod: 4.1
  });
  // 榊（常绿、叶面更亮）
  M.leafSheetSakaki = leaf('leafSheetSakaki', PALETTE.leafSakaki, {
    tint: 0x9adfa4, strength: 0.45, flutterPeriod: 3.7
  });
  M.leafSheetSakakiDeep = leaf('leafSheetSakakiDeep', PALETTE.leafSakakiDeep, {
    tint: 0x74b487, strength: 0.32, power: 3.0, flutterPeriod: 4.3
  });
  // 枫（少量秋色点缀，透光偏暖）
  M.leafSheetMaple = leaf('leafSheetMaple', PALETTE.leafMaple, {
    tint: 0xd8965f, strength: 0.44, flutterPeriod: 3.3
  });
  M.leafSheetMapleDeep = leaf('leafSheetMapleDeep', PALETTE.leafMapleDeep, {
    tint: 0xb8794d, strength: 0.3, power: 3.1, flutterPeriod: 4.5
  });
  M.leafSheetMapleLight = leaf('leafSheetMapleLight', PALETTE.leafMapleLight, {
    tint: 0xe8b878, strength: 0.5, power: 2.2, flutterPeriod: 3.9
  });
  // 灌丛
  M.leafSheetShrub = leaf('leafSheetShrub', PALETTE.shrub, {
    tint: 0x93cf9a, strength: 0.4, flutterPeriod: 3.4
  });
  M.leafSheetShrubDeep = leaf('leafSheetShrubDeep', PALETTE.shrubDeep, {
    tint: 0x6ba377, strength: 0.28, power: 3.0, flutterPeriod: 4.0
  });
  M.leafSheetShrubLight = leaf('leafSheetShrubLight', PALETTE.shrubLight, {
    tint: 0xaeddab, strength: 0.46, power: 2.4, flutterPeriod: 4.6
  });
  // 蕨：细裂叶，透光弱一些（薄叶过亮会读出荧光绿）
  M.leafSheetFern = leaf('leafSheetFern', PALETTE.fern, {
    tint: 0x8fc98a, strength: 0.34, power: 2.8
  });
  M.leafSheetFernDeep = leaf('leafSheetFernDeep', PALETTE.fernDeep, {
    tint: 0x69976f, strength: 0.25, power: 3.2
  });
  M.leafSheetFernTip = leaf('leafSheetFernTip', PALETTE.fernTip, {
    tint: 0xb6d99a, strength: 0.4, power: 2.4
  });
  // 地面落叶：雨后偏暗偏潮，透光很弱（贴地叶不是逆光主角）
  M.leafSheetGround = leaf('leafSheetGround', PALETTE.groundLeaf, {
    tint: 0xbfa87a, strength: 0.18, power: 3.4
  });
  M.leafSheetGroundDeep = leaf('leafSheetGroundDeep', PALETTE.groundLeafDeep, {
    tint: 0x9c8a63, strength: 0.12, power: 3.6
  });
  M.leafSheetGroundLight = leaf('leafSheetGroundLight', PALETTE.groundLeafLight, {
    tint: 0xd6c096, strength: 0.2, power: 3.0
  });
  M.leafSheetGroundRust = leaf('leafSheetGroundRust', PALETTE.groundLeafRust, {
    tint: 0xc98a5e, strength: 0.16, power: 3.4
  });
  M.leafSheetGroundWet = leaf('leafSheetGroundWet', PALETTE.groundLeafDeep, {
    tint: 0x8fa07f, strength: 0.1, power: 3.8
  });
  // 草叶 / 苔间小草
  M.leafSheetGrass = leaf('leafSheetGrass', PALETTE.moss, {
    tint: 0x9fd6a0, strength: 0.3, power: 2.8
  });
  M.leafSheetGrassDeep = leaf('leafSheetGrassDeep', PALETTE.fernDeep, {
    tint: 0x74b487, strength: 0.22, power: 3.2
  });
  // 藤蔓
  M.leafSheetVine = leaf('leafSheetVine', PALETTE.leafEvergreenLight, {
    tint: 0xa8dca4, strength: 0.38, flutterPeriod: 4.4
  });

  /* ---------------- 茎 / 枝：保留描边 ---------------- */
  M.fernStem = named(toon({ color: PALETTE.fernTip, band: 'mid' }), 'fernStem');
  M.fernDry = named(toon({ color: PALETTE.groundLeaf, band: 'mid' }), 'fernDry');
  M.shrubStem = named(toon({ color: PALETTE.woodDark, band: 'mid' }), 'shrubStem');
  M.shrubStemLive = named(toon({ color: PALETTE.shrubDeep, band: 'mid' }), 'shrubStemLive');
  M.shrubTwigDead = named(toon({ color: PALETTE.woodWeathered, band: 'mid' }), 'shrubTwigDead');
  M.twigBark = stem('twigBark', { color: 0xffffff, seed: 71, planks: 3 });
  M.twigDead = stem('twigDead', { color: 0xd8d8d8, seed: 73, planks: 3, wear: 0.42 });
  M.vineStem = stem('vineStem', { color: 0xffffff, seed: 77, planks: 2, wear: 0.24 });
  M.woodWeathered = stem('woodWeathered', { color: 0xffffff, seed: 79, planks: 5, wear: 0.46 });
  applyMossAttachment(M.woodWeathered, { color: PALETTE.mossDamp, height: 1.1, band: 0.9, amount: 0.45 });

  /* ---------------- 青苔：柔软地面苔壳由资产层标 noOutline ---------------- */
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

  /* ---------------- 水体：不描边（water / puddle 前缀） ---------------- */
  M.waterSurface = water('waterSurface', {
    color: PALETTE.water, opacity: 0.62,
    roughness: 0.14, clearcoat: 0.2, clearcoatRoughness: 0.22,
    flow: { speed: 0.1, scale: 0.5, strength: 0.7 }
  });
  M.puddleWater = water('puddleWater', {
    color: PALETTE.waterShallow, opacity: 0.55,
    roughness: 0.1, clearcoat: 0.35, clearcoatRoughness: 0.16,
    flow: { speed: 0.03, scale: 0.9, strength: 0.35 }
  });

  /* ---------------- 林间薄雾：加色面片，自动不投影不受光 ---------------- */
  M.mistBand = named(new THREE.MeshBasicMaterial({
    color: PALETTE.skyMid,
    map: mistVeilTexture({ size: 512, seed: 131 }),
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  }), 'mistBand');

  return M;
}
