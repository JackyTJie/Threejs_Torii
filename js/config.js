// 全局配置：尺度 / 调色 / 渲染 / 灯光 / 相机 / 后期 / 动画参数
// 所有可调参数集中于此，资产与动画模块只读取、不硬编码数值。
// 数值与 docs/LAYOUT_PLAN.md 严格一致（1 单位 = 1 m）。

/** 底座：规整正方形纯色深灰哑光平板（LAYOUT_PLAN §1） */
export const PAD = {
  size: 32,
  half: 16,
  thickness: 1.5,
  topY: 0,
  chamfer: 0.14,
  lip: 0.05
};

/** 标高表（LAYOUT_PLAN §2）。随 z 变化的标高以「相对参道坡面」的偏移量表达 */
export const LEVEL = {
  pad: 0.0,
  pathBase: 0.16, // 第 1 级踏面顶
  pathTop: 4.8, // 第 32 级踏面顶
  valleyFloor: 0.3, // 溪谷谷底（z = 11.6 处；随 z 抬升，见 layout.valleyLevel）
  streamBedOffset: -0.16, // 溪床 = 谷底 − 0.16
  waterOffset: -0.05, // 水面 = 谷底 − 0.05（护岸顶净空 0.05）
  pathShoulder: 0.16, // 右路肩高出参道坡面
  rightHillTop: 3.4, // 右坡林地顶（陡坡抬升，围合右侧参道）
  leftRidgeLow: 2.1, // 左脊高出谷底（前缘）
  leftRidgeHigh: 3.2 // 左脊高出谷底（后缘）
};

/** 调色板（LAYOUT_PLAN §9）—— 六大材质类明确区分，1:1 还原参考图雨后幽深浓绿与鲜明朱红鸟居 */
export const PALETTE = {
  // 底座：纯色深灰哑光，仅极轻噪点，不描边
  padTop: 0x222527,
  padEdge: 0x181a1c,
  padHighlight: 0x2e3235,

  // 木材 · 鸟居朱红漆（画面唯一高饱和焦点，鲜明浓郁朱砂红橙，带雨水冲刷深色竖痕）
  toriiVermilion: 0xe63b19,
  toriiVermilionDeep: 0x9e210b,
  toriiVermilionFade: 0xf25829,
  toriiLacquerLoss: 0x632512,
  toriiBlack: 0x181b20, // 笠木 / 根巻 / 楔
  toriiBlackFade: 0x252a30,
  toriiWoodBare: 0x6e472b,
  wood: 0x4a3828,
  woodDark: 0x2e2218,
  woodWeathered: 0x3d2e20,

  // 树皮：雨后潮湿深褐黑树干，带青苔与树皮裂纹层次（避免在线性空间被压成死黑）
  barkKusunoki: 0x332d26,
  barkSakaki: 0x38322a,
  barkKaede: 0x2e2923,
  barkCrack: 0x1c1814,

  // 叶片：1:1 还原参考图明暗层次（前景/两侧深翠墨绿画框 → 中景浓绿 → 鸟居上方逆光鲜亮黄绿/嫩绿）
  leafEvergreen: 0x264f27,
  leafEvergreenDeep: 0x18361a,
  leafEvergreenLight: 0x3a6e36,
  leafSakaki: 0x2a542b,
  leafSakakiDeep: 0x1b3b1d,
  // 鸟居正上方透光林冠：受阴天漫射天光穿透的鲜亮嫩绿/黄绿
  leafMaple: 0x5c9636,
  leafMapleDeep: 0x3b6924,
  leafMapleLight: 0x86bf4e,
  // 灌丛：前景与两侧深翠画框（保留叶片明暗阶梯，不糊成死黑）
  shrub: 0x244a25,
  shrubDeep: 0x163018,
  shrubLight: 0x366634,
  // 蕨类与溪畔长草：湿润鲜翠绿
  fern: 0x386b2c,
  fernDeep: 0x24471e,
  fernTip: 0x568f3e,

  // 青苔：潮湿翠绿苔
  moss: 0x3b6329,
  mossWet: 0x29471d,
  mossDamp: 0x1f3816,

  // 地面落叶与腐殖层（雨后紅褐潮湿腐叶，点缀在青灰石阶与深褐泥坡上）
  groundLeaf: 0x523420,
  groundLeafDeep: 0x362214,
  groundLeafLight: 0x6b452a,
  groundLeafRust: 0x633219,

  // 泥土：雨后浸水深褐腐殖土
  soil: 0x30251c,
  soilDark: 0x201812,
  soilWet: 0x261d16,

  // 石材 · 潮湿石阶与溪谷乱石（冷青灰湿石，踏面微反天光、立面深暗）
  slate: 0x566268,
  slateDark: 0x343c40,
  slateLight: 0x728087,
  stone: 0x4f5a5e,
  stoneDark: 0x30373b,
  stoneLight: 0x6a767c,
  stoneWet: 0x3f484c,

  // 水体：清澈幽暗山涧溪水，透出底部湿泥卵石，局部泛起翠绿波光与柔和瀑沫（绝不刺眼像镜子）
  streamBed: 0x26201a,
  streamSand: 0x362e25,
  water: 0x1a362d,
  waterShallow: 0x2d5446,
  waterDeep: 0x0e211b,

  // 远山森林天穹 / 雾 / 描边（以幽深森林群山替代空白灰白天空）
  skyTop: 0x3b5446,
  skyMid: 0x293f33,
  skyHorizon: 0x13241b,
  outline: 0x0c100d
};

/** 渲染器 */
export const RENDER = {
  antialias: true,
  multisample: 4,
  pixelRatioMax: 2,
  toneMapping: 'ACESFilmicToneMapping',
  toneMappingExposure: 1.0,
  shadowMapEnabled: true,
  shadowType: 'PCFSoftShadowMap',
  alpha: false,
  stencil: false,
  depth: true
};

/** 灯光（LAYOUT_PLAN §10）—— 雨后阴天柔和漫射，凸显高处天光、鸟居朱红与前景幽暗画框的明暗层次 */
export const LIGHT = {
  sunAzimuthDeg: 145,
  sunElevationDeg: 46,
  sunColor: 0xe2ede5,
  sunIntensity: 1.72,
  shadowMapSize: 4096,
  shadowDistance: 52,
  shadowSceneTop: 21,
  shadowSceneBottom: -1.6,
  shadowFitMargin: 0.8,
  shadowBias: -0.0004,
  shadowNormalBias: 0.02,
  shadowRadius: 3.5,

  hemiSky: 0x9ab3a2,
  hemiGround: 0x1e2920,
  hemiIntensity: 0.68,

  rimColor: 0xbad4c0,
  rimIntensity: 0.48,
  rimAzimuthDeg: 335,
  rimElevationDeg: 18,

  ambientColor: 0x223026,
  ambientIntensity: 0.24,

  fogColor: 0x1b2d23,
  fogDensity: 0.013
};

/**
 * 受限观景相机（支持在参道旁侧观察 + 受限横向/纵向平移空间）：
 * 默认机位设在参道左侧溪谷畔（azimuth 98.8°，相机位于 x ≈ -2.55, z ≈ 14.4），
 * 从路旁斜向望向弧形拾级而上的石阶、双鸟居及向右绕入山后的上段山路，完美复现参考图构图！
 * 同时放宽水平旋转至 [45°, 135°] 并开启受限横向/纵向平移（panLimitX / panLimitZ），
 * 支持用户在路旁、溪畔与林间横向移动观察。
 */
export const CAMERA = {
  fov: 45,
  near: 0.08,
  far: 420,
  target: { x: -0.15, y: 4.25, z: -0.8 },
  radius: 15.4,
  radiusMin: 3.2,
  radiusMax: 46,
  azimuthDeg: 98.8, // 位于参道左侧溪畔旁观，而非死板正中对称视角
  azimuthMin: 45, // 放宽左右横向观察角度（±45°），禁止转到场景背面
  azimuthMax: 135,
  elevationDeg: 1.2,
  elevationMin: -10,
  elevationMax: 45,
  damping: 6.5,
  zoomSpeed: 0.0011,
  dragSpeed: 0.0055,
  panEnabled: true, // 开启受限范围内横向/纵向平移，允许在路旁自由观察
  panSpeed: 0.012,
  panLimitX: 3.8,
  panLimitZ: 4.5,
  collideWithScene: false
};

/** 后处理管线 */
export const POST = {
  enabled: true,
  halfResolution: true,
  outline: {
    enabled: true,
    color: PALETTE.outline,
    edgeStrength: 0.62,
    edgeThreshold: 0.012,
    edgeNearWeight: 1.0,
    edgeFarWeight: 0.45
  },
  bloom: {
    enabled: true,
    threshold: 1.25,
    knee: 0.85,
    strength: 0.22,
    radius: 1.4
  },
  dof: {
    enabled: true,
    focusDistance: 16.0,
    focusRange: 3.6,
    maxBlurPx: 12,
    nearWeight: 0.6,
    farWeight: 0.8,
    depthFalloff: 0.032,
    taps: 16,
    followFocusTarget: true
  },
  grade: {
    exposure: 0.96,
    contrast: 1.06,
    saturation: 1.06,
    lift: 0.02,
    gain: 1.0,
    warmth: -0.01,
    lutStrength: 0.82,
    highlightSoftening: 0.08,
    vignette: 0.34,
    vignetteSoftness: 0.42,
    grain: 0.014
  }
};

/** 描边（反向壳体）参数 */
export const OUTLINE = {
  color: PALETTE.outline,
  opacity: 0.94,
  thickness: 0.01,
  maxThickness: 0.028,
  nearPx: 1.5,
  farPx: 0.68,
  nearDistance: 12,
  farDistance: 56,
  capFactor: 2.8,
  farKeep: 0.78
};

/** 不描边的材质名前缀 */
export const NO_OUTLINE_PREFIXES = [
  'pad',
  'water',
  'puddle',
  'leafSheet',
  'mist',
  'glow',
  'soil'
];

/** 动画参数（LAYOUT_PLAN §12，柔和克制，不破坏静谧感） */
export const ANIM = {
  treeSway: {
    branchAmplitude: 0.028,
    branchPeriodMin: 5.0,
    branchPeriodMax: 8.5,
    clusterAmplitude: 0.042,
    clusterPeriodMin: 3.2,
    clusterPeriodMax: 5.2,
    windGust: 0.14,
    windGustPeriod: 21,
    shrubScale: 0.6,
    leafFlutter: {
      amplitude: 0.01,
      periodMin: 3.0,
      periodMax: 4.6
    }
  },
  stream: {
    displacementMax: 0.016,
    wavelengthMin: 0.7,
    wavelengthMax: 1.3,
    speed: 0.22,
    rippleSpeed: 0.9
  },
  puddleRipple: {
    amplitudeMax: 0.004,
    periodMin: 3.4,
    periodMax: 6.2
  },
  mist: {
    driftSpeedMin: 0.01,
    driftSpeedMax: 0.02,
    opacityMin: 0.05,
    opacityMax: 0.12,
    periodMin: 60,
    periodMax: 110
  }
};

/** 三渲二渐变带（色阶数量决定硬/软） */
export const TOON_BANDS = {
  hard: 3,
  mid: 4,
  soft: 6,
  flat: 2
};

/** 场景整体预算提示 */
export const BUDGET = {
  groundLeafSheets: 2600,
  groundLeafLayers: 3,
  trees: 26,
  shrubs: 22,
  ferns: 26,
  mossPatches: 30,
  wetRocks: 24,
  puddles: 18,
  twigs: 14,
  meshesApprox: 3200
};
