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
  pathShoulder: 0.1, // 右路肩高出参道坡面
  rightHillTop: 2.4, // 右坡林地顶（底座边缘处，高出参道坡面）
  leftRidgeLow: 1.58, // 左脊高出谷底（前缘）
  leftRidgeHigh: 2.1 // 左脊高出谷底（后缘）
};

/** 调色板（LAYOUT_PLAN §9）—— 六大材质类明确区分 */
export const PALETTE = {
  // 底座：纯色深灰哑光，仅极轻噪点，不描边
  padTop: 0x3a3d40,
  padEdge: 0x2b2e30,
  padHighlight: 0x474b4f,

  // 木材 · 鸟居朱红漆（画面唯一高饱和焦点）
  toriiVermilion: 0xd8451f,
  toriiVermilionDeep: 0xb23418,
  toriiVermilionFade: 0xc9603a, // 日晒褪色面
  toriiLacquerLoss: 0x9a5a3c, // 掉漆处露出的底漆/木色
  toriiBlack: 0x22242a, // 笠木 / 眉木
  toriiBlackFade: 0x3a3d44,
  toriiWoodBare: 0x8a6a48,
  wood: 0x7a5f42,
  woodDark: 0x55402c,
  woodWeathered: 0x6b5a46,

  // 树皮
  barkKusunoki: 0x5a4a3a,
  barkSakaki: 0x6b5c48,
  barkKaede: 0x554536,
  barkCrack: 0x2f2620,

  // 叶片：深林低饱和浓绿，枫只作少量秋色点缀
  leafEvergreen: 0x2f5a3a,
  leafEvergreenDeep: 0x1f4229,
  leafEvergreenLight: 0x4a7a48,
  leafSakaki: 0x356b3f,
  leafSakakiDeep: 0x24502e,
  leafMaple: 0x8f4a2c,
  leafMapleDeep: 0x6d3524,
  leafMapleLight: 0xb0683a,
  shrub: 0x3f6136,
  shrubDeep: 0x2c4726,
  shrubLight: 0x5a7c44,
  fern: 0x4a7440,
  fernDeep: 0x33552d,
  fernTip: 0x7a9a52,

  // 青苔
  moss: 0x4a6b3c,
  mossWet: 0x35522c,
  mossDamp: 0x2b4224,

  // 地面落叶层（雨后偏暗偏潮，不是秋日金黄）
  groundLeaf: 0x6b5a3a,
  groundLeafDeep: 0x4a3d28,
  groundLeafLight: 0x8a7448,
  groundLeafRust: 0x7a4a30,

  // 泥土
  soil: 0x3b3229,
  soilDark: 0x272119,
  soilWet: 0x2e2620,

  // 石材 · 石阶与湿石
  slate: 0x6a6f72,
  slateDark: 0x4c5154,
  slateLight: 0x878d90,
  stone: 0x767a7c,
  stoneDark: 0x54585c,
  stoneLight: 0x949a9c,
  stoneWet: 0x5f6568,

  // 水体：浅、近透明、向水底石色偏移（偏蓝偏灰会读成塑料）
  streamBed: 0x6d6a60,
  streamSand: 0x8a8578,
  water: 0xa8bdb6,
  waterShallow: 0xbccdc6,
  waterDeep: 0x6f8a84,

  // 天空 / 雾 / 描边
  skyTop: 0x8fa6b4,
  skyMid: 0xb9c8cc,
  skyHorizon: 0xd6dcd6,
  outline: 0x1d2126
};

/** 渲染器 */
export const RENDER = {
  antialias: true,
  multisample: 4,
  pixelRatioMax: 2,
  toneMapping: 'ACESFilmicToneMapping',
  toneMappingExposure: 1.02,
  shadowMapEnabled: true,
  shadowType: 'PCFSoftShadowMap',
  alpha: false,
  stencil: false,
  depth: true
};

/** 灯光（LAYOUT_PLAN §10）—— 雨后阴天柔和漫射，主光是唯一投影光源 */
export const LIGHT = {
  sunAzimuthDeg: 155, // 右后上方来的漫射主光
  sunElevationDeg: 38,
  sunColor: 0xe8eef2,
  sunIntensity: 1.9,
  shadowMapSize: 4096,
  // 阴影正交视锥由「底座正方形 + 场景高度」投影到光空间反算（见 lighting.shadowFrustum）。
  shadowDistance: 52,
  shadowSceneTop: 19, // 实测最高树冠 18.14 m（香樟 scale 1.3）+ 余量；鸟居笠木顶仅 8.90
  shadowSceneBottom: -1.6,
  shadowFitMargin: 0.8,
  shadowBias: -0.0004,
  shadowNormalBias: 0.02,
  shadowRadius: 3.5,

  hemiSky: 0xa8bcc8,
  hemiGround: 0x3f4638,
  hemiIntensity: 0.75, // 阴天：暗部主要靠半球光抬起来

  rimColor: 0xcfe0d2,
  rimIntensity: 0.6,
  rimAzimuthDeg: 335, // 主光对侧，给鸟居与树冠一层冷边光
  rimElevationDeg: 16,

  ambientColor: 0x3f4a44,
  ambientIntensity: 0.22,

  fogColor: 0x8fa39a,
  fogDensity: 0.016 // 纵深空气感：后段参道自然隐没
};

/** 受限观景相机（LAYOUT_PLAN §13）：只允许旋转 + 无极缩放，禁自由平移 */
export const CAMERA = {
  fov: 46,
  near: 0.08,
  far: 420,
  target: { x: 0.3, y: 3.6, z: -0.9 },
  radius: 24,
  radiusMin: 3.2, // 最近：贴近最下段石阶，看清台阶纹理
  radiusMax: 46, // 最远：鸟居 + 两侧山林全景，底座完整可见
  azimuthDeg: 90, // 正对参道
  azimuthMin: 60, // 左右 ±30°，禁止转到场景背面
  azimuthMax: 120,
  elevationDeg: 26,
  elevationMin: -10, // 避免穿入地面
  elevationMax: 45, // 避免露出过多空白天空
  damping: 6.5,
  zoomSpeed: 0.0011,
  dragSpeed: 0.0055,
  panEnabled: false, // 禁用自由平移
  collideWithScene: false
};

/** 后处理管线 */
export const POST = {
  enabled: true,
  halfResolution: true,
  outline: {
    enabled: true,
    color: PALETTE.outline,
    edgeStrength: 0.55,
    // 相对深度差阈值：邻域深度跳变除以该处观察距离，近处远处同一把尺子。
    // 0.012 对应「30 m 处约 0.36 m 以上的深度台阶」，缓坡地形只有 0.002 → 不描。
    edgeThreshold: 0.012,
    // 深度边缘这一路的距离权重。收细而不是关掉（远处自然收细、不能断裂）。
    // 距离拐点与反向壳体共用 OUTLINE.nearDistance / farDistance —— 两路必须同一条曲线。
    edgeNearWeight: 1.0,
    edgeFarWeight: 0.45
  },
  bloom: {
    enabled: true,
    // 阈值在离屏缓冲的线性 HDR 空间比较（离屏不做色调映射，受光面可达 2~4）
    threshold: 1.35, // 阴天无自发光体：只让湿石/水面最亮的高光进泛光
    knee: 0.9,
    strength: 0.22,
    radius: 1.4
  },
  dof: {
    enabled: true,
    // 焦点距离运行时由 post-pipeline 按「相机 → DOF 焦点」重算（见 layout.DOF_FOCUS），
    // 这里的数值只作为未接管时的兜底与调试基准。
    focusDistance: 24,
    focusRange: 2.6, // 焦内深度容差（m）：保住鸟居对（前后 2.5 m 间距）整体锐利
    maxBlurPx: 14, // 最大弥散半径，1080p 基准像素（管线按实际高度缩放）
    nearWeight: 0.6, // 前景（底座前缘石阶）轻微虚化
    farWeight: 1.0, // 远景（深林）中等虚化
    depthFalloff: 0.035,
    taps: 16,
    followFocusTarget: true // 焦点落在鸟居对中心，不跟随相机注视点（缩放不会把焦点带走）
  },
  grade: {
    exposure: 1.02, // 由输出级独占（渲染器侧 toneMappingExposure 不再参与）
    contrast: 1.06,
    saturation: 1.02, // 自然低饱和；鸟居朱红靠色相本身而不是后期拉饱和
    lift: 0.03, // 雨后阴天：暗部抬起保住层次
    gain: 1.0,
    warmth: -0.02, // 冷调（秋日暖 0.055 → 雨后阴天 −0.02）
    lutStrength: 0.8, // 阴天三段 LUT 的混合强度
    highlightSoftening: 0.08,
    vignette: 0.28,
    vignetteSoftness: 0.42,
    grain: 0.018
  }
};

/** 描边（反向壳体）参数 */
export const OUTLINE = {
  color: PALETTE.outline,
  opacity: 0.94,
  thickness: 0.011,
  maxThickness: 0.03,
  // 屏幕线宽自适应：近处略粗、远处自然收细，不能抖动、断裂。
  // 壳体在世界空间的厚度 = 目标线宽 × 距离 / 像素尺度，因此「收细」是屏幕上的收细，
  // 世界厚度反而随距离变厚 —— 固定世界厚度会让远处描边缩到看不见（那就是断裂）。
  nearPx: 1.6,
  farPx: 0.7,
  nearDistance: 14, // 该距离以内保持 nearPx
  farDistance: 60, // 该距离以外收细到 farPx（14→60 m 之间线性过渡）
  capFactor: 3.0, // 世界厚度上限 = 构件自身描边厚度 × 该系数
  farKeep: 0.78 // 远处壳体只减淡不淡出（描边不能断裂）
};

/**
 * 不描边的材质名前缀（单一来源，反向壳体与阴影策略共用）。
 * 匹配规则见 outline.matchesNoOutlinePrefix：全等，或前缀之后紧跟大写 / '_' / '-'。
 * 只列真实存在的材质名（LAYOUT_PLAN §10「不描边」清单）。
 */
export const NO_OUTLINE_PREFIXES = [
  'pad', // padTop / padEdge：底座本身不需要轮廓，描边会让展台边缘变粗一圈
  'water', // water / waterSurface / puddle：水面描边会读成「塑料膜边」
  'puddle', // 积水洼（贴地水面）
  'leafSheet', // 全部叶片薄片（InstancedMesh 承载，反向壳体只会复制出一份基准几何）
  'mist', // 薄雾面片（加色/半透明，描边会显出矩形边界）
  'glow', // 任何加色面片
  'soil' // 泥土 / 地形表面：大面积缓坡描边会变成脏线
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
    /** 灌丛共用 treeSway 通道，幅度 ×0.6（低矮丛比乔木更钝） */
    shrubScale: 0.6,
    /** GPU 侧单片叶微振（shaders/leaf-vertex.js）：叠在 CPU 构件组摆动之上 */
    leafFlutter: {
      amplitude: 0.01,
      periodMin: 3.0,
      periodMax: 4.6
    }
  },
  stream: {
    // 溪流：**细碎波纹**，不是海浪 —— 位移 0.016 m 对 0.7–1.3 m 波长，陡度 ~3%，
    // 读作水面被河床摩擦出的碎波。上限受护岸顶净空（0.05 m）约束，岸列权重为 0。
    displacementMax: 0.016,
    // 波长下限受水面网格采样率约束：站点间距 ≈0.25 m，λ < 0.7 m 会欠采样成「乱抖」
    wavelengthMin: 0.7,
    wavelengthMax: 1.3,
    speed: 0.22,
    rippleSpeed: 0.9
  },
  puddleRipple: {
    // 地面积水：几乎静止的轻微扰动，周期极慢，不做传播波
    amplitudeMax: 0.004,
    periodMin: 3.4,
    periodMax: 6.2
  },
  mist: {
    // 林间薄雾：慢到察觉不到单帧位移，只感到空气在流动
    driftSpeedMin: 0.01,
    driftSpeedMax: 0.02,
    opacityMin: 0.1,
    opacityMax: 0.18,
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

/** 场景整体预算提示（用于审计参考） */
export const BUDGET = {
  // 地面落叶薄片：32×32 底座扣掉参道走廊 / 溪流 / 鸟居 / 树冠占位后有效面 ≈ 620 m²，
  // 2600 片 × 0.12 m² ≈ 50% 覆盖率 —— 深林地面要读成「铺满的腐叶层」而不是裸土。
  // 实例化承载（每片独立变换），不是网格合并。
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
