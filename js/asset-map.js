// 资产名 -> 工厂函数 对照表（供 tools/asset-check.mjs 与 tools/scene-audit.mjs 使用）
// 与 docs/ASSET_INDEX.md 一致；scene-assembly.js 负责实际组装与放置。
// 逐个资产落地时在此登记，使 asset-check 能在编写阶段就把关。
// 键名即 root.name，layout.js 用它查 PATH_SYSTEM / WATER_SYSTEM / ATMOSPHERE_SYSTEM 白名单：
// 命中白名单可豁免对应的参道/水面/鸟居净空判据；不在白名单（如 fern / twig）也合法，
// 但必须完整通过 R1–R6（底座范围、参道净空、水面净空、鸟居净空、接地与宿主包含）。
import { createBasePad } from './assets/base-pad.js';
import { createTerrain } from './assets/terrain.js';
import { createStoneSteps } from './assets/stone-steps.js';
import { createUpperPath } from './assets/upper-path.js';
import { createPathSoil } from './assets/path-soil.js';
import { createStreamWater, createStreamBed } from './assets/stream.js';
import { createTorii } from './assets/torii.js';
import { createStreamStones } from './assets/stream-stones.js';
import { createWetRock } from './assets/wet-rock.js';
import { createMossPatch } from './assets/moss-patch.js';
import { createPuddle } from './assets/puddle.js';
import { createKaedeGrove } from './assets/tree-kaede.js';
import { createKusunokiGrove } from './assets/tree-kusunoki.js';
import { createSakakiGrove } from './assets/tree-sakaki.js';
import { createShrubPatch } from './assets/tree-shrub.js';
import createFernPatch from './assets/fern.js';

export default {
  basePad: createBasePad,
  terrain: createTerrain,
  stoneSteps: createStoneSteps,
  upperPath: createUpperPath,
  pathSoil: createPathSoil,
  streamWater: createStreamWater,
  streamBed: createStreamBed,
  toriiFront: (M) => createTorii(M, { id: 'front' }),
  toriiRear: (M) => createTorii(M, { id: 'rear' }),
  streamStones: createStreamStones,
  wetRock: createWetRock,
  mossPatch: createMossPatch,
  puddle: createPuddle,
  treeKaede: createKaedeGrove,
  treeKusunoki: createKusunokiGrove,
  treeSakaki: createSakakiGrove,
  shrub: createShrubPatch,
  fern: createFernPatch
};
