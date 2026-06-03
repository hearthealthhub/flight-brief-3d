# Seatback Rebuild Checklist

## Phase 1, structure and mode separation
- [x] Split the app into Setup and Present modes
- [x] Keep route input, timing controls, and resolved waypoint review in Setup mode
- [x] Move passenger-facing playback and camera controls into a dedicated presentation HUD

## Phase 2, seatback visual system
- [x] Replace the generic tool layout with a dark premium shell
- [x] Simplify route rendering with a glow track and sparse waypoint labels
- [x] Add a cleaner overlay with itinerary, playback state, and route hero text

## Phase 3, camera choreography
- [x] Add preset cinematic views: Overview, Follow, Wing, Arrival
- [x] Drive playback through per-leg camera keyframes
- [x] Keep manual preset switching available during presentation mode

## Phase 4, smoother animation engine
- [x] Rebuild leg timing around proportional distance-based durations
- [x] Add eased interpolation for global playback and each route leg
- [x] Move the aircraft on a smoother altitude arc instead of simple point-to-point stepping

## Finish and ship
- [x] Build and verify production output
- [x] Commit cleanly
- [x] Push to GitHub
- [x] GitHub Pages workflow already existed, no update needed
