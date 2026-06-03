import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './styles.css';

const app = document.querySelector('#app');
app.innerHTML = `
  <div class="seatback-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Airliner Seatback Mode</p>
        <h1>Flight Brief 3D</h1>
      </div>
      <div class="topbar-actions">
        <button id="editorModeBtn" class="ghost active">Setup</button>
        <button id="presentModeBtn" class="ghost">Present</button>
      </div>
    </header>

    <section class="layout">
      <aside id="editorPanel" class="editor-panel active">
        <div class="panel-card intro-card">
          <h2>Route editor</h2>
          <p>Build the route here, then switch into passenger-facing playback.</p>
        </div>

        <div class="panel-card">
          <label class="field">
            <span>Waypoints</span>
            <textarea id="waypoints" spellcheck="false" placeholder="JFK\n51.4700, -0.4543\nDXB\nSIN"></textarea>
          </label>

          <div class="grid two">
            <label class="field">
              <span>Journey seconds</span>
              <input id="timelineSeconds" type="number" min="20" max="180" step="5" value="55" />
            </label>
            <label class="field">
              <span>Minimum leg seconds</span>
              <input id="legSeconds" type="number" min="4" max="45" step="1" value="10" />
            </label>
          </div>

          <div class="actions">
            <button id="plotBtn">Build route</button>
            <button id="resetBtn" class="secondary">Reset camera</button>
          </div>
        </div>

        <div class="panel-card compact">
          <h3>Resolved route</h3>
          <ol id="resolvedList" class="resolved-list"></ol>
        </div>

        <div class="panel-card compact">
          <h3>Journey timing</h3>
          <div id="timelineSummary" class="timeline-summary"></div>
        </div>

        <details class="panel-card compact details">
          <summary>Terrain, token, and aircraft asset setup</summary>
          <p>Add a Cesium ion token in <code>public/config.js</code> for terrain. Drop a <code>.glb</code> or <code>.gltf</code> aircraft asset into <code>public/models/</code> and set <code>helicopterModelUrl</code> to replace the placeholder.</p>
        </details>
      </aside>

      <main class="viewer-stage">
        <div id="cesiumContainer"></div>

        <div id="presentationHud" class="presentation-hud hidden">
          <div class="hud-row hud-top">
            <div class="hud-chip hud-flight"><span id="flightBadge">SEATBACK MODE</span></div>
            <div class="hud-chip"><span id="viewBadge">Overview</span></div>
          </div>

          <div class="hud-center">
            <div class="hero-block">
              <p class="hero-kicker">Now flying</p>
              <h2 id="heroRoute">Awaiting route</h2>
              <p id="heroSubline">Build a route in setup mode to begin playback.</p>
            </div>
          </div>

          <div class="hud-bottom-grid">
            <section class="hud-card itinerary-card">
              <p class="card-label">Itinerary</p>
              <div id="itineraryStrip" class="itinerary-strip"></div>
            </section>

            <section class="hud-card status-card">
              <p class="card-label">Playback</p>
              <div class="metric"><span>Phase</span><strong id="phaseValue">Idle</strong></div>
              <div class="metric"><span>Progress</span><strong id="progressValue">0%</strong></div>
              <div class="metric"><span>Camera</span><strong id="cameraValue">Overview</strong></div>
            </section>

            <section class="hud-card controls-card">
              <p class="card-label">Presentation controls</p>
              <div class="actions stacked">
                <button id="playBtn">Play journey</button>
                <div class="split-actions">
                  <button id="pauseBtn" class="secondary">Pause</button>
                  <button id="resumeBtn" class="secondary">Resume</button>
                </div>
                <div class="split-actions">
                  <button data-view="overview" class="view-btn secondary">Overview</button>
                  <button data-view="follow" class="view-btn secondary">Follow</button>
                  <button data-view="wing" class="view-btn secondary">Wing</button>
                  <button data-view="arrival" class="view-btn secondary">Arrival</button>
                </div>
              </div>
            </section>
          </div>
        </div>

        <div id="status" class="status-banner">Ready for route setup.</div>
      </main>
    </section>
  </div>
`;

const runtimeConfig = window.FLIGHT_BRIEF_3D_CONFIG ?? {};
const cameraConfig = {
  pitchDegrees: runtimeConfig.camera?.pitchDegrees ?? -28,
  legAltitudeMeters: runtimeConfig.camera?.legAltitudeMeters ?? 180000,
  overviewAltitudeMeters: runtimeConfig.camera?.overviewAltitudeMeters ?? 2400000,
  arrivalAltitudeMeters: runtimeConfig.camera?.arrivalAltitudeMeters ?? 120000
};

if (runtimeConfig.cesiumIonToken) {
  Cesium.Ion.defaultAccessToken = runtimeConfig.cesiumIonToken;
}

const ui = {
  status: document.getElementById('status'),
  resolvedList: document.getElementById('resolvedList'),
  timelineSummary: document.getElementById('timelineSummary'),
  waypoints: document.getElementById('waypoints'),
  timelineSeconds: document.getElementById('timelineSeconds'),
  legSeconds: document.getElementById('legSeconds'),
  editorPanel: document.getElementById('editorPanel'),
  presentationHud: document.getElementById('presentationHud'),
  editorModeBtn: document.getElementById('editorModeBtn'),
  presentModeBtn: document.getElementById('presentModeBtn'),
  heroRoute: document.getElementById('heroRoute'),
  heroSubline: document.getElementById('heroSubline'),
  itineraryStrip: document.getElementById('itineraryStrip'),
  phaseValue: document.getElementById('phaseValue'),
  progressValue: document.getElementById('progressValue'),
  cameraValue: document.getElementById('cameraValue'),
  viewBadge: document.getElementById('viewBadge'),
  flightBadge: document.getElementById('flightBadge')
};

const coordinatePattern = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/;
const airportCodePattern = /^[A-Z0-9]{3,4}$/;
const defaultCenter = Cesium.Cartesian3.fromDegrees(-30, 35, 12000000);
const modeState = { current: 'editor', selectedView: 'overview' };
let routePoints = [];
let routeEntity;
let glowRouteEntity;
let aircraftEntity;
let waypointEntities = [];
let activeFlightPlan = null;
let animationState = null;

const viewer = new Cesium.Viewer('cesiumContainer', {
  animation: false,
  timeline: false,
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  infoBox: false,
  selectionIndicator: false,
  fullscreenButton: false,
  shouldAnimate: true,
  terrain: runtimeConfig.cesiumIonToken ? Cesium.Terrain.fromWorldTerrain() : undefined
});

viewer.scene.globe.depthTestAgainstTerrain = false;
viewer.scene.skyAtmosphere.brightnessShift = -0.2;
viewer.scene.skyAtmosphere.saturationShift = -0.15;
viewer.scene.skyBox.show = true;
viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#020814');
viewer.clock.shouldAnimate = false;
viewer.scene.requestRenderMode = true;
viewer.scene.maximumRenderTimeChange = Infinity;
viewer._cesiumWidget._creditContainer.style.display = 'none';
viewer.camera.setView({ destination: defaultCenter });

setupScene();
wireUi();
seedRoute();

function setupScene() {
  viewer.entities.removeAll();
  routeEntity = null;
  glowRouteEntity = null;
  aircraftEntity = null;
  waypointEntities = [];
  viewer.scene.requestRender();
}

function seedRoute() {
  ui.waypoints.value = 'JFK\nLHR\nDXB\nSIN';
}

function wireUi() {
  document.getElementById('plotBtn').addEventListener('click', plotRoute);
  document.getElementById('resetBtn').addEventListener('click', () => applyCameraPreset(modeState.selectedView, routePoints, 0));
  document.getElementById('playBtn').addEventListener('click', startPlayback);
  document.getElementById('pauseBtn').addEventListener('click', pausePlayback);
  document.getElementById('resumeBtn').addEventListener('click', resumePlayback);
  ui.editorModeBtn.addEventListener('click', () => setMode('editor'));
  ui.presentModeBtn.addEventListener('click', () => setMode('presentation'));
  document.querySelectorAll('.view-btn').forEach((button) => {
    button.addEventListener('click', () => {
      modeState.selectedView = button.dataset.view;
      if (routePoints.length) applyCameraPreset(modeState.selectedView, routePoints, animationState?.smoothedProgress ?? 0);
      syncViewBadges(labelForView(modeState.selectedView));
    });
  });
}

function setMode(mode) {
  modeState.current = mode;
  const presenting = mode === 'presentation';
  ui.editorPanel.classList.toggle('active', !presenting);
  ui.presentationHud.classList.toggle('hidden', !presenting);
  ui.editorModeBtn.classList.toggle('active', !presenting);
  ui.presentModeBtn.classList.toggle('active', presenting);
  if (presenting && routePoints.length) {
    hydratePresentation(routePoints);
    applyCameraPreset(modeState.selectedView, routePoints, animationState?.smoothedProgress ?? 0);
  }
  setStatus(presenting ? 'Presentation mode ready.' : 'Setup mode ready.');
}

async function plotRoute() {
  const lines = ui.waypoints.value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    setStatus('Enter at least one waypoint.', true);
    return;
  }

  cancelPlayback(false);
  setStatus('Resolving waypoints...');
  ui.resolvedList.innerHTML = '';
  ui.timelineSummary.textContent = '';

  const resolved = [];
  const failures = [];

  for (let index = 0; index < lines.length; index += 1) {
    const input = lines[index];
    try {
      const point = await resolveWaypoint(input);
      const waypoint = { ...point, order: index + 1 };
      resolved.push(waypoint);
      appendResolved(waypoint);
    } catch (error) {
      failures.push(`${index + 1}. ${input} (${error.message})`);
    }
  }

  if (!resolved.length) {
    routePoints = [];
    drawRoute();
    hydratePresentation([]);
    setStatus(`Could not resolve any waypoints. ${failures.join(' | ')}`, true);
    return;
  }

  routePoints = resolved;
  drawRoute();
  activeFlightPlan = buildFlightPlan(routePoints);
  renderTimelineSummary(activeFlightPlan);
  hydratePresentation(routePoints);
  modeState.selectedView = 'overview';
  applyCameraPreset('overview', routePoints, 0);
  setStatus(
    failures.length
      ? `Built ${resolved.length} waypoint(s). Unresolved: ${failures.join(' | ')}`
      : `Built ${resolved.length} waypoint(s). Switch to Present when ready.`,
    failures.length > 0
  );
}

async function resolveWaypoint(input) {
  const coordinateMatch = input.match(coordinatePattern);
  if (coordinateMatch) {
    const lat = Number(coordinateMatch[1]);
    const lon = Number(coordinateMatch[2]);
    validateCoordinates(lat, lon);
    return { label: input, lat, lon, source: 'coordinates' };
  }

  if (airportCodePattern.test(input)) {
    try {
      const airportResult = await geocode(`${input} airport`);
      if (airportResult) return { ...airportResult, label: input.toUpperCase() };
    } catch {
      // continue to generic search
    }
  }

  const generic = await geocode(input);
  if (!generic) throw new Error('not found');
  return generic;
}

async function geocode(query) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', query);

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`geocoder ${response.status}`);
  const data = await response.json();
  if (!data.length) return null;

  const result = data[0];
  const lat = Number(result.lat);
  const lon = Number(result.lon);
  validateCoordinates(lat, lon);
  return {
    label: tidyLabel(query, result.display_name),
    lat,
    lon,
    source: 'geocoded'
  };
}

function validateCoordinates(lat, lon) {
  if (Number.isNaN(lat) || Number.isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('invalid coordinates');
  }
}

function tidyLabel(input, displayName) {
  const shortName = displayName.split(',').slice(0, 2).join(',').trim();
  return input.length <= 5 ? input.toUpperCase() : shortName || input;
}

function drawRoute() {
  viewer.entities.removeAll();
  waypointEntities = routePoints.map((point) => {
    const position = Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 0);
    return viewer.entities.add({
      position,
      point: {
        pixelSize: 7,
        color: Cesium.Color.fromCssColorString('#8bd8ff'),
        outlineColor: Cesium.Color.fromCssColorString('#08101d'),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: sparseLabelForPoint(point),
        font: point.order === 1 || point.order === routePoints.length ? '600 16px Inter' : '500 13px Inter',
        fillColor: Cesium.Color.fromCssColorString('#f8fbff'),
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Cesium.Color.fromCssColorString('#06101d'),
        outlineWidth: 4,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
  });

  if (routePoints.length >= 2) {
    const positions = routePoints.map((point) => Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 12000));
    glowRouteEntity = viewer.entities.add({
      polyline: {
        positions,
        width: 14,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.16,
          color: Cesium.Color.fromCssColorString('#4fd1ff').withAlpha(0.35)
        }),
        clampToGround: false
      }
    });
    routeEntity = viewer.entities.add({
      polyline: {
        positions,
        width: 4,
        material: Cesium.Color.fromCssColorString('#d8eefc'),
        clampToGround: false
      }
    });
  }

  aircraftEntity = createAircraftEntity(routePoints[0]);
  viewer.scene.requestRender();
}

function sparseLabelForPoint(point) {
  if (point.order === 1 || point.order === routePoints.length) return point.label;
  return `${point.order}`;
}

function createAircraftEntity(firstPoint) {
  if (!firstPoint) return null;
  const position = Cesium.Cartesian3.fromDegrees(firstPoint.lon, firstPoint.lat, 30000);
  const assetUrl = runtimeConfig.helicopterModelUrl ?? './models/helicopter-placeholder.svg';
  const use3dModel = /\.(gltf|glb)$/i.test(assetUrl);
  return viewer.entities.add({
    position,
    orientation: Cesium.Transforms.headingPitchRollQuaternion(position, new Cesium.HeadingPitchRoll(0, 0, 0)),
    ...(use3dModel
      ? {
          model: {
            uri: assetUrl,
            minimumPixelSize: 72,
            maximumScale: 220,
            scale: 1
          }
        }
      : {
          billboard: {
            image: assetUrl,
            scale: 0.25,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        })
  });
}

function buildFlightPlan(points) {
  const totalTimelineSeconds = Math.max(Number(ui.timelineSeconds.value) || 55, 20);
  const minimumLegSeconds = Math.max(Number(ui.legSeconds.value) || 10, 4);
  const legCount = Math.max(points.length - 1, 0);
  const overviewSeconds = Math.min(8, totalTimelineSeconds * 0.22);
  const arrivalSeconds = legCount > 0 ? Math.min(7, totalTimelineSeconds * 0.16) : 0;
  const cruiseBudget = Math.max(totalTimelineSeconds - overviewSeconds - arrivalSeconds, 0);

  const legDistances = [];
  let totalDistance = 0;
  for (let index = 0; index < legCount; index += 1) {
    const distance = distanceKm(points[index], points[index + 1]);
    legDistances.push(distance);
    totalDistance += distance;
  }

  let currentTime = overviewSeconds;
  const legs = [];
  for (let index = 0; index < legCount; index += 1) {
    const proportionalSeconds = totalDistance > 0 ? (legDistances[index] / totalDistance) * cruiseBudget : cruiseBudget / Math.max(legCount, 1);
    const durationSeconds = Math.max(minimumLegSeconds, proportionalSeconds || minimumLegSeconds);
    const cameraSequence = index === legCount - 1 ? ['follow', 'wing', 'arrival'] : ['follow', 'wing'];
    const keyframes = buildLegKeyframes(currentTime, durationSeconds, cameraSequence);
    legs.push({
      from: points[index],
      to: points[index + 1],
      distanceKm: legDistances[index],
      startSeconds: currentTime,
      endSeconds: currentTime + durationSeconds,
      durationSeconds,
      cameraSequence,
      keyframes
    });
    currentTime += durationSeconds;
  }

  const totalUsed = legCount > 0 ? currentTime + arrivalSeconds : overviewSeconds;
  return {
    overviewSeconds,
    arrivalSeconds,
    totalSeconds: totalUsed,
    legs,
    totalDistanceKm: totalDistance
  };
}

function buildLegKeyframes(startSeconds, durationSeconds, cameraSequence) {
  const segmentLength = durationSeconds / cameraSequence.length;
  return cameraSequence.map((view, index) => ({
    view,
    start: startSeconds + segmentLength * index,
    end: startSeconds + segmentLength * (index + 1)
  }));
}

function renderTimelineSummary(plan) {
  if (!plan) {
    ui.timelineSummary.textContent = '';
    return;
  }

  const legText = plan.legs.length
    ? plan.legs.map((leg, index) => `${index + 1}. ${leg.from.label} → ${leg.to.label}, ${leg.durationSeconds.toFixed(1)}s, ${Math.round(leg.distanceKm)} km`).join('\n')
    : 'Single waypoint, ambient overview only.';

  ui.timelineSummary.textContent = `Overview: ${plan.overviewSeconds.toFixed(1)}s\nArrival: ${plan.arrivalSeconds.toFixed(1)}s\nDistance: ${Math.round(plan.totalDistanceKm)} km\n${legText}`;
}

function hydratePresentation(points) {
  if (!points.length) {
    ui.heroRoute.textContent = 'Awaiting route';
    ui.heroSubline.textContent = 'Build a route in setup mode to begin playback.';
    ui.itineraryStrip.innerHTML = '';
    ui.phaseValue.textContent = 'Idle';
    ui.progressValue.textContent = '0%';
    ui.cameraValue.textContent = labelForView(modeState.selectedView);
    syncViewBadges(labelForView(modeState.selectedView));
    return;
  }

  ui.heroRoute.textContent = `${points[0].label} to ${points.at(-1).label}`;
  ui.heroSubline.textContent = `${points.length - 1 || 0} leg${points.length - 1 === 1 ? '' : 's'} • premium route playback`;
  ui.itineraryStrip.innerHTML = points.map((point, index) => `
    <div class="stop ${index === 0 || index === points.length - 1 ? 'major' : ''}">
      <span class="stop-index">${index + 1}</span>
      <strong>${point.label}</strong>
    </div>
  `).join('');
  ui.flightBadge.textContent = `${points[0].label} → ${points.at(-1).label}`;
  ui.cameraValue.textContent = labelForView(modeState.selectedView);
  syncViewBadges(labelForView(modeState.selectedView));
}

function startPlayback() {
  if (!routePoints.length) {
    setStatus('Build a route first.', true);
    return;
  }

  setMode('presentation');
  cancelPlayback(false);
  activeFlightPlan = buildFlightPlan(routePoints);
  renderTimelineSummary(activeFlightPlan);
  animationState = {
    startTimestamp: 0,
    pausedAt: 0,
    pauseStartedAt: 0,
    totalPausedMs: 0,
    playing: true,
    smoothedProgress: 0
  };
  setStatus('Starting seatback playback...');
  requestAnimationFrame(playbackTick);
}

function pausePlayback() {
  if (!animationState?.playing || animationState.pauseStartedAt) return;
  animationState.pauseStartedAt = performance.now();
  animationState.playing = false;
  setStatus('Playback paused.');
}

function resumePlayback() {
  if (!animationState || !animationState.pauseStartedAt) return;
  animationState.totalPausedMs += performance.now() - animationState.pauseStartedAt;
  animationState.pauseStartedAt = 0;
  animationState.playing = true;
  setStatus('Playback resumed.');
  requestAnimationFrame(playbackTick);
}

function cancelPlayback(resetStatus = true) {
  animationState = null;
  if (resetStatus) setStatus('Playback stopped.');
}

function playbackTick(timestamp) {
  if (!animationState || !activeFlightPlan) return;
  if (!animationState.startTimestamp) animationState.startTimestamp = timestamp;
  if (animationState.pauseStartedAt) return;

  const elapsed = Math.min((timestamp - animationState.startTimestamp - animationState.totalPausedMs) / 1000, activeFlightPlan.totalSeconds);
  updateAnimation(elapsed, activeFlightPlan);
  viewer.scene.requestRender();

  if (elapsed < activeFlightPlan.totalSeconds && animationState?.playing) {
    requestAnimationFrame(playbackTick);
  } else if (elapsed >= activeFlightPlan.totalSeconds) {
    animationState = null;
    ui.phaseValue.textContent = 'Complete';
    ui.progressValue.textContent = '100%';
    setStatus('Seatback playback complete.');
  }
}

function updateAnimation(elapsedSeconds, plan) {
  if (!aircraftEntity || !routePoints.length) return;

  const normalized = plan.totalSeconds > 0 ? elapsedSeconds / plan.totalSeconds : 0;
  const smoothedProgress = easeInOutCubic(normalized);
  if (animationState) animationState.smoothedProgress = smoothedProgress;
  ui.progressValue.textContent = `${Math.round(smoothedProgress * 100)}%`;

  if (elapsedSeconds <= plan.overviewSeconds || !plan.legs.length) {
    const anchor = routePoints[0];
    aircraftEntity.position = Cesium.Cartesian3.fromDegrees(anchor.lon, anchor.lat, 30000);
    aircraftEntity.orientation = orientationForLeg(anchor, routePoints[1] ?? anchor);
    ui.phaseValue.textContent = 'Overview';
    applyCameraPreset('overview', routePoints, smoothedProgress);
    return;
  }

  const currentLeg = plan.legs.find((leg) => elapsedSeconds >= leg.startSeconds && elapsedSeconds <= leg.endSeconds) ?? plan.legs.at(-1);
  const legProgress = Cesium.Math.clamp((elapsedSeconds - currentLeg.startSeconds) / currentLeg.durationSeconds, 0, 1);
  const easedLegProgress = easeInOutSine(legProgress);
  const arcHeight = Math.max(60000, currentLeg.distanceKm * 22);
  const lon = Cesium.Math.lerp(currentLeg.from.lon, currentLeg.to.lon, easedLegProgress);
  const lat = Cesium.Math.lerp(currentLeg.from.lat, currentLeg.to.lat, easedLegProgress);
  const altitude = 25000 + Math.sin(easedLegProgress * Math.PI) * arcHeight;
  const position = Cesium.Cartesian3.fromDegrees(lon, lat, altitude);
  aircraftEntity.position = position;
  aircraftEntity.orientation = orientationForLeg(currentLeg.from, currentLeg.to, position);

  const activeKeyframe = currentLeg.keyframes.find((frame) => elapsedSeconds >= frame.start && elapsedSeconds <= frame.end) ?? currentLeg.keyframes.at(-1);
  const preferredView = activeKeyframe?.view ?? 'follow';
  const chosenView = modeState.selectedView === 'overview' ? preferredView : modeState.selectedView;
  ui.phaseValue.textContent = `${currentLeg.from.label} → ${currentLeg.to.label}`;
  applyCameraPreset(chosenView, [currentLeg.from, currentLeg.to], easedLegProgress, currentLeg);
}

function applyCameraPreset(viewName, points, progress = 0, leg = null) {
  if (!points.length) return;
  const label = labelForView(viewName);
  syncViewBadges(label);
  ui.cameraValue.textContent = label;

  if (viewName === 'overview' || points.length < 2) {
    focusOverview(points);
    return;
  }

  const from = leg?.from ?? points[0];
  const to = leg?.to ?? points.at(-1);
  const lon = Cesium.Math.lerp(from.lon, to.lon, progress);
  const lat = Cesium.Math.lerp(from.lat, to.lat, progress);
  const heading = Cesium.Math.toRadians(bearingDegrees(from.lat, from.lon, to.lat, to.lon));

  const presets = {
    follow: {
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, cameraConfig.legAltitudeMeters),
      orientation: { heading, pitch: Cesium.Math.toRadians(-24), roll: 0 }
    },
    wing: {
      destination: Cesium.Cartesian3.fromDegrees(lon - 5, lat + 2.5, cameraConfig.legAltitudeMeters * 0.9),
      orientation: { heading: heading + Cesium.Math.toRadians(24), pitch: Cesium.Math.toRadians(-16), roll: 0 }
    },
    arrival: {
      destination: Cesium.Cartesian3.fromDegrees(to.lon, to.lat, cameraConfig.arrivalAltitudeMeters),
      orientation: { heading, pitch: Cesium.Math.toRadians(-38), roll: 0 }
    }
  };

  const preset = presets[viewName] ?? presets.follow;
  viewer.camera.setView(preset);
}

function focusOverview(points) {
  if (!points.length) {
    viewer.camera.setView({ destination: defaultCenter });
    return;
  }

  const rectangle = Cesium.Rectangle.fromCartesianArray(points.map((point) => Cesium.Cartesian3.fromDegrees(point.lon, point.lat)));
  const destination = viewer.camera.getRectangleCameraCoordinates(rectangle);
  if (!destination) return;
  const destinationCartographic = Cesium.Cartographic.fromCartesian(destination);
  destinationCartographic.height = Math.max(destinationCartographic.height * 1.15, cameraConfig.overviewAltitudeMeters);
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromRadians(
      destinationCartographic.longitude,
      destinationCartographic.latitude,
      destinationCartographic.height
    ),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(cameraConfig.pitchDegrees),
      roll: 0
    }
  });
}

function orientationForLeg(from, to, positionOverride) {
  const heading = Cesium.Math.toRadians(bearingDegrees(from.lat, from.lon, to.lat, to.lon));
  const position = positionOverride ?? Cesium.Cartesian3.fromDegrees(from.lon, from.lat, 30000);
  return Cesium.Transforms.headingPitchRollQuaternion(position, new Cesium.HeadingPitchRoll(heading, 0, 0));
}

function bearingDegrees(lat1, lon1, lat2, lon2) {
  const phi1 = Cesium.Math.toRadians(lat1);
  const phi2 = Cesium.Math.toRadians(lat2);
  const lambda = Cesium.Math.toRadians(lon2 - lon1);
  const y = Math.sin(lambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda);
  return (Cesium.Math.toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function distanceKm(from, to) {
  const geodesic = new Cesium.EllipsoidGeodesic(
    Cesium.Cartographic.fromDegrees(from.lon, from.lat),
    Cesium.Cartographic.fromDegrees(to.lon, to.lat)
  );
  return geodesic.surfaceDistance / 1000;
}

function easeInOutSine(value) {
  return -(Math.cos(Math.PI * value) - 1) / 2;
}

function easeInOutCubic(value) {
  return value < 0.5 ? 4 * value * value * value : 1 - ((-2 * value + 2) ** 3) / 2;
}

function labelForView(viewName) {
  return ({ overview: 'Overview', follow: 'Follow', wing: 'Wing', arrival: 'Arrival' }[viewName] ?? 'Overview');
}

function syncViewBadges(label) {
  ui.viewBadge.textContent = label;
}

function appendResolved(point) {
  const item = document.createElement('li');
  item.textContent = `${point.order}. ${point.label} • ${point.lat.toFixed(3)}, ${point.lon.toFixed(3)}`;
  ui.resolvedList.appendChild(item);
}

function setStatus(message, isError = false) {
  ui.status.textContent = message;
  ui.status.classList.toggle('error', isError);
}
