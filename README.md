# 3D Flight Brief

A standalone Cesium-based 3D flight brief app, built separately from `terrain-map-app`.

## What it does

- Accepts one waypoint per line
- Supports direct `lat, lon` input plus name / airport-code geocoding via OpenStreetMap Nominatim
- Plots waypoints in order and connects them with a yellow route line
- Shows a helicopter placeholder that can be replaced with a Huey `.glb` or `.gltf` later
- Plays a simple 30-second briefing animation
  - first 5 seconds: full area overview
  - then 5 seconds per leg by default
- Works as a static site, suitable for GitHub Pages

## Quick start

```bash
cd flight-brief-3d
npm install
npm run dev
```

Then open the local URL Vite prints.

## Build

```bash
npm run build
npm run preview
```

## Cesium terrain token

The app works without a token, but uses Cesium's default globe imagery fallback. For real Cesium World Terrain:

1. Get a Cesium ion token.
2. Edit `public/config.js`.
3. Set `cesiumIonToken: 'YOUR_TOKEN'`.

## Helicopter model swap

Right now the app uses `public/models/helicopter-placeholder.svg` as a legal placeholder.

To switch to a better model later:

1. Drop a Huey or other helicopter `.glb` / `.gltf` into `public/models/`
2. Update `helicopterModelUrl` inside `public/config.js`
3. If you want to use a real 3D model instead of the billboard placeholder, update `createAircraftEntity()` in `src/main.js` to use Cesium's `model` property with that asset path

## Video capture / export path

In-browser export is not implemented. The practical path is:

- Plot the route
- Click **Play brief**
- Use macOS screen recording, Windows Game Bar, OBS, or QuickTime to capture the 30-second run
- Trim if needed afterward

This keeps the app simple while still giving you reliable video output.

## GitHub Pages

A Pages workflow is included at `.github/workflows/deploy.yml`.

Typical setup:

1. Push repo to GitHub
2. In GitHub repo settings, enable Pages with GitHub Actions as the source
3. Push to `main` to trigger deployment

## Notes

- Geocoding depends on internet access and OpenStreetMap Nominatim availability
- This repo is intentionally separate from `terrain-map-app`
- If GitHub push or Pages enablement is blocked locally, the remaining blocker is likely GitHub auth or missing repo permissions
