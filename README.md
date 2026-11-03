# Fushimi Inari Mountain Shrine — Stylized 3D Diorama (Three.js)

An interactive, real-time 3D miniature diorama of a secluded Japanese Myōjin Torii sando (sacred mountain path) nestled deep within a post-rain cedar and maple forest, built with **Three.js** and custom **GLSL WebGL shaders**.

The scene blends **anime-inspired cel-shaded aesthetics (3D-to-2D Toon Shading)** with **physically grounded atmospheric scattering, shallow-water hydrodynamics, and volumetric lighting**—all self-contained with zero external image or model dependencies.

## Key Features

### 1. Procedural Rayleigh & Mie Atmospheric Sky & 5-Layer Parallax Mountains
- **Full 24-Hour Rayleigh/Mie Scattering Sky Shader**: Real-time physical sky evaluation supporting seamless transitions across **Deep Night** (indigo cosmos with rotating starfield and Milky Way band), **Blue Hour** (cobalt zenith with violet-pink and amber horizon glow), **Sunrise / Golden Sunset** (low-angle golden-orange-red solar disc fading through rose-magenta into cobalt blue), **Noon** (bright cyan-cerulean sky above a cool shaded forest), and **Moonlight Night** (silver-blue lunar illumination with phase modulation).
- **Dual-Layer Procedural Volumetric Clouds**: High-altitude wispy cirrus and low-altitude stratocumulus clouds with temporal drift, time-of-day coverage variation, and sunlit/moonlit silver-gold rim scattering.
- **5-Layer Atmospheric Perspective Mountains with Parallax**: Five procedural mountain ridges between the sky dome and mid-ground forest following atmospheric perspective laws (progressive desaturation, luminance lift, and horizon blending), camera-driven parallax scrolling, and microscopic warm-red lantern/Torii light points nestled in distant valleys evoking the thousand Torii gates (*Senbon Torii*) of Mount Inari.

### 2. Volumetric Lighting, God Rays, GI Color Bounce & Shrine Lanterns
- **Celestial Master Light System**: Synchronized solar and lunar trajectories driving directional light angles, color temperatures, shadow softness, and sky-sampled hemisphere fill light.
- **Forest Volumetric God Rays & Floating Dust Motes**: Screen-space radial volumetric light shafts combined with 3D noise fog scattering, complete with sunlit floating dust motes and a golden sunset "light tunnel" piercing through the Torii crossbeams.
- **3D Noise-Driven Volumetric Fog**: Altitude-layered 3D FBM volumetric mist that pools thickly along the lower stone steps and stream valley, drifts along the sando, parts naturally around Torii pillars and tree trunks, and scatters warm spherical halos around the shrine lanterns.
- **Global Illumination (GI) Color Bounce & Lattice Gobo Projection**: Subtle vermilion bounce light from the Torii onto adjacent stone steps and lower tree trunks, cool green canopy shadow tinting, and symmetrical **Kasuga-style vermilion wooden shrine lanterns** (`木造朱塗灯籠`) that automatically ignite at dusk and project **3×3 lattice light patterns** onto the wet stone steps.

### 3. Zoned Mountain Stream Hydrodynamics (2D Shallow Water Equations + Multi-Regime Wave Solver)
- **Ping-Pong GPGPU Shallow Water Equations (SWE)**: Real-time height and velocity field PDE simulation (`js/water/swe-simulator.js`) with interactive pointer raycast ripples, screen-space riverbed refraction, Snell's window caustics, and planar reflection of the forest canopy and vermilion Torii.
- **Six Hydrodynamic Regimes**:
  1. **Calm Pools**: Mirror-clear central pools revealing submerged sand, gravel bars, and stratified boulders.
  2. **Rapid Chutes**: Bernoulli-accelerated riffles where the channel narrows.
  3. **Bank & Rock Shimmering Wavelets**: High-frequency capillary wavelets and sunlit specular sparkles concentrated along the stream banks and around boulders.
  4. **Upstream Bow-Wave Cushions**: Dynamic water pillows and whitewater splash on the upstream faces of boulders.
  5. **Lateral 8-Shaped Split-Flow**: Potential-flow doublet bifurcation wakes around stones.
  6. **Waterfall Plunge Pools & Kármán Vortex Streets**: Six multi-tiered stone weir cascades with feathered water curtains, hydraulic jump foam, and downstream alternating vortices where fallen maple leaves orbit and drift.

### 4. Four-Layer Composite Century-Worn Stone Steps & Granular Soil-Backed Moss
- **4-Layer Composite Stone Steps**:
  1. **Base Layer**: Natural blue-grey slate and andesite with geological fissures and color variation.
  2. **Century-Worn Center Tread**: Smooth, higher-reflectivity polished center zone worn by generations of visitors' footsteps.
  3. **Crevice Soil & Granular Moss**: Organic soil accumulation and matte, micro-speckled dark-green moss cushions over a grey-brown earth substrate—thickest on shaded risers and the stream-facing (-X) side.
  4. **Rainwater Puddles & Natural Scatter**: Recessed step puddles reflecting the sky and Torii with concentric ripples, accompanied by scattered fallen leaves, 3D pinecones, and weathered stone spalls.

### 5. Interactive Weather System (Easter Egg) & Cyan-Green Glassmorphic Control Panel
- **Three Switchable Weather Modes**:
  - **Post-Rain Clear (`雨后初霁`)**: Crisp forest air, dappled sunbeams, and gentle valley mist.
  - **Rain (`细雨霏霏`)**: Falling rain streaks, ground splash ripple rings, global wet-surface darkening and specular boost, and thickened mountain mist.
  - **Heavy Fog (`深山浓雾`)**: Low-visibility deep mountain fog where only the nearby Torii and warm glowing lanterns emerge from the mist.

## Project Architecture

The codebase strictly follows a modular ES Module architecture where `index.html` serves solely as the entry canvas host and every asset, shader, animation, and post-processing stage resides in its own dedicated module:

```text
Jp_Torii/
├── index.html                  # Minimal entry point (ImportMap + <canvas id="stage">)
├── js/
│   ├── main.js                 # Application bootstrap, rAF loop, pointer raycast ripples
│   ├── config.js               # Palette, camera bounds, lighting, post-processing constants
│   ├── layout.js               # Parametric terrain heightfield, curved sando, stream spline
│   ├── scene.js                # Scene container, procedural sky dome & PMREM environment
│   ├── camera.js               # Bounded third-person orbit/zoom rig with anti-clipping lock
│   ├── lighting.js             # Sun/Moon directional key, hemisphere fill, rim & lantern lights
│   ├── day-night.js            # 24-hour celestial interpolation & atmospheric state machine
│   ├── weather.js              # Switchable weather system (Post-Rain / Rainy / Heavy Fog)
│   ├── materials.js            # Toon & physical material library with custom shader hooks
│   ├── textures.js             # 100% procedural CanvasTexture / DataTexture generators
│   ├── toon.js                 # Shader injection (4-layer steps, granular moss, GI bounce, Torii aging)
│   ├── outline.js              # Distance-adaptive inverted-hull cel outlines
│   ├── post-pipeline.js        # Offscreen pipeline (SWE, Sky/Mountains, SSAO, 3D Volumetric Fog, God Rays, DOF, Bloom, Grade)
│   ├── ui-panel.js             # Collapsible cyan-green glassmorphic atmosphere & weather control panel
│   ├── primitives.js           # Procedural geometry builders (sweeps, rocks, leaves, triplanar UVs)
│   ├── tree-kit.js             # 360° Golden-Angle branching & instanced foliage canopies
│   ├── scene-assembly.js       # Master scene graph assembly & animation binding
│   ├── water/
│   │   └── swe-simulator.js    # WebGL 2D Shallow Water Equations Ping-Pong FBO solver
│   ├── shaders/
│   │   ├── toon-shading.js     # GLSL chunks for cel shading, 4-layer steps, moss, GI & Torii aging
│   │   ├── water-shader.js     # GLSL chunks for zoned stream waves, bank/rock shimmer & caustics
│   │   ├── ssao-shader.js      # GLSL Rayleigh sky, 5-layer mountains, SSAO, 3D volumetric fog & God Rays
│   │   ├── outline-shader.js   # GLSL inverted-hull & depth-edge outline shaders
│   │   ├── dof-shader.js       # GLSL separable Circle-of-Confusion Depth of Field
│   │   ├── bloom-shader.js     # GLSL dual-pass soft bloom
│   │   └── grade-shader.js     # GLSL ACES Filmic tone mapping & color grading
│   ├── assets/                 # 22 independent 3D asset modules (Torii, lanterns, stone steps, stream, trees, ferns, moss, etc.)
│   └── animations/             # Modular animation controllers (stream flow, tree sway, puddles, mist, sun flicker)
└── tools/                      # Offline validation, smoke test, geometry audit & software rasterizer preview tools
```

## How to Run

### 1. Run in Browser (Local Static Server)
Because the project uses native ES Modules (`<script type="module">`), serve the root directory with any static HTTP server:

```bash
# Using Python 3
python3 -m http.server 8080

# Or using Node.js (npx serve)
npx serve -l 8080 .
```

Then open `http://localhost:8080` in any modern WebGL2-capable browser:
- **Orbit Camera**: Left-click + drag (bounded within the scenic viewing corridor).
- **Zoom**: Scroll wheel / trackpad pinch (smoothly coupled with focal target).
- **Interactive Stream Ripples**: Move or click the cursor over the mountain stream to disturb the 2D Shallow Water Equations solver in real time.
- **Atmosphere, Time-of-Day & Weather Panel**: Click the cyan-green orb button in the bottom-right corner to switch time presets (`深夜 / 蓝调 / 清晨 / 雨后 / 正午 / 黄昏 / 月夜`), toggle the 24h auto-cycle, switch weather modes (`雨后初霁 / 细雨霏霏 / 深山浓雾`), or fine-tune lantern brightness, volumetric fog, God Rays, SSAO, DOF, and wind sway.

### 2. Run Validation & Offline Audit Suite
```bash
node tools/validate.mjs
node tools/smoke.mjs
node tools/scene-audit.mjs
node tools/asset-check.mjs
```

## Credits & Acknowledgments

### AI Models & Engineering Credits
- **Gemini 4 Argon**
- **Strata-Qwen 3.8 flash next**

### Open-Source Projects Referenced & Adopted
- **[Three.js](https://github.com/mrdoob/three.js)** (`r160`, MIT License) — Core 3D WebGL engine, `PMREMGenerator`, and inspiration from the official `webgl_gpgpu_water` GPGPU heightfield water example.
- **[jeantimex/threejs-water](https://github.com/jeantimex/threejs-water) & [jeantimex/webgpu-water](https://github.com/jeantimex/webgpu-water)** (ported from [Evan Wallace's WebGL Water](https://madebyevan.com/webgl-water/)) — Referenced and adapted for real-time heightfield wave propagation, interactive surface ripples, raytraced reflections/refractions, and underwater caustics.
- **[danielsofran/threejs-water-shader](https://github.com/danielsofran/threejs-water-shader)** — Referenced and adapted for optical water surface Fresnel reflection/refraction blending and shoreline foam transitions.
- **[VictorZakharov/beautiful-water](https://github.com/VictorZakharov/beautiful-water)** — Referenced for shallow-water equation (SWE) state packing, depth-based Beer-Lambert absorption, and micro-surface wave normal perturbation.
