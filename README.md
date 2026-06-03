# Flight Brief 3D, Seatback Mode

A Cesium-based airliner seatback-style route visualizer and playback app.

## What changed

- Setup mode is now separate from passenger-facing Present mode
- Route editing still supports airport codes, names, and `lat, lon` entries
- Presentation mode uses a darker premium HUD, sparse labels, and a cleaner route treatment
- Playback now uses smoother eased timing with cinematic camera presets: Overview, Follow, Wing, and Arrival

## Quick start

```bash
cd flight-brief-3d
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Cesium terrain token

Edit `public/config.js` and set `cesiumIonToken` if you want Cesium World Terrain.

## Aircraft asset swap

Drop a `.glb` or `.gltf` file into `public/models/` and update `helicopterModelUrl` in `public/config.js`.

## GitHub Pages

The app still builds as a static site suitable for GitHub Pages deployment.
