import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './styles.css';

const app = document.querySelector('#app');
app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <h1>3D Flight Brief</h1>
      <p class="subtitle">Plot a route, preview a 30 second brief animation, then screen-capture the run for a quick video.</p>

      <label class="field">
        <span>Waypoints</span>
        <textarea id="waypoints" spellcheck="false" placeholder="KASE\n39.1911, -106.8175\nLeadville, CO\nKTEX"></textarea>
      </label>

      <div class="grid two">
        <label class="field">
          <span>Timeline seconds</span>
          <input id="timelineSeconds" type="number" min="10" max="120" step="5" value="30" />
        </label>
        <label class="field">
          <span>Leg seconds</span>
          <input id="legSeconds" type="number" min="3" max="30" step="1" value="5" />
        </label>
      </div>

      <div class="actions">
        <button id="plotBtn">Plot route</button>
        <button id="playBtn" class="secondary">Play brief</button>
        <button id="resetBtn" class="secondary">Reset view</button>
      </div>

      <details class="details">
        <summary>Token and model setup</summary>
        <p>Add a Cesium ion token in <code>public/config.js</code> for world terrain. Drop a Huey <code>.glb</code> or <code>.gltf</code> into <code>public/models/</code> and set <code>helicopterModelUrl</code> to swap out the placeholder.</p>
      </details>

      <div id="status" class="status">Ready.</div>
      <ol id="resolvedList" class="resolved-list"></ol>
      <div id="timelineSummary" class="timeline-summary"></div>
    </aside>
    <main class="viewer-panel">
      <div id="cesiumContainer"></div>
    </main>
  </div>
`;

const runtimeConfig = window.FLIGHT_BRIEF_3D_CONFIG ?? {};
const cameraConfig = {
  pitchDegrees: runtimeConfig.camera?.pitchDegrees ?? -35,
  legAltitudeMeters: runtimeConfig.camera?.legAltitudeMeters ?? 1800,
  overviewAltitudeMeters: runtimeConfig.camera?.overviewAltitudeMeters ?? 18000
};

if (runtimeConfig.cesiumIonToken) {
  Cesium.Ion.defaultAccessToken = runtimeConfig.cesiumIonToken;
}

const statusEl = document.getElementById('status');
const resolvedListEl = document.getElementById('resolvedList');
const timelineSummaryEl = document.getElementById('timelineSummary');
const waypointsEl = document.getElementById('waypoints');
const timelineSecondsEl = document.getElementById('timelineSeconds');
const legSecondsEl = document.getElementById('legSeconds');
const coordinatePattern = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/;
const airportCodePattern = /^[A-Z0-9]{3,4}$/;
const defaultCenter = Cesium.Cartesian3.fromDegrees(-106.5, 39.1, 250000);
let routePoints = [];
let routeEntity;
let helicopterEntity;
let waypointEntities = [];
let animationHandle = null;
let activeFlightPlan = null;

const viewer = new Cesium.Viewer('cesiumContainer', {
  animation: false,
  timeline: false,
  baseLayerPicker: true,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  infoBox: false,
  selectionIndicator: false,
  shouldAnimate: true,
  terrain: runtimeConfig.cesiumIonToken ? Cesium.Terrain.fromWorldTerrain() : undefined
});

viewer.scene.globe.depthTestAgainstTerrain = false;
viewer.camera.setView({ destination: defaultCenter });
viewer.clock.shouldAnimate = false;
viewer.scene.requestRenderMode = true;
viewer.scene.maximumRenderTimeChange = Infinity;

setupScene();
wireUi();

function setupScene() {
  viewer.entities.removeAll();
  routeEntity = null;
  helicopterEntity = null;
  waypointEntities = [];
  viewer.scene.requestRender();
}

function wireUi() {
  document.getElementById('plotBtn').addEventListener('click', plotRoute);
  document.getElementById('playBtn').addEventListener('click', playBriefAnimation);
  document.getElementById('resetBtn').addEventListener('click', () => focusOverview(routePoints));
}

async function plotRoute() {
  const lines = waypointsEl.value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    setStatus('Enter at least one waypoint.', true);
    return;
  }

  setStatus('Resolving waypoints...');
  resolvedListEl.innerHTML = '';
  timelineSummaryEl.textContent = '';

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
    setStatus(`Could not resolve any waypoints. ${failures.join(' | ')}`, true);
    return;
  }

  routePoints = resolved;
  drawRoute();
  focusOverview(routePoints);
  activeFlightPlan = buildFlightPlan(routePoints);
  renderTimelineSummary(activeFlightPlan);
  setStatus(
    failures.length
      ? `Plotted ${resolved.length} waypoint(s). Unresolved: ${failures.join(' | ')}`
      : `Plotted ${resolved.length} waypoint(s).`,
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
      // fall through
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
        pixelSize: 10,
        color: Cesium.Color.fromCssColorString('#ff3b30'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: `${point.order}. ${point.label}`,
        font: '15px sans-serif',
        fillColor: Cesium.Color.WHITE,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Cesium.Color.fromCssColorString('#0f172a'),
        outlineWidth: 4,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
  });

  if (routePoints.length >= 2) {
    routeEntity = viewer.entities.add({
      polyline: {
        positions: routePoints.map((point) => Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 300)),
        width: 5,
        material: Cesium.Color.fromCssColorString('#facc15'),
        clampToGround: false
      }
    });
  }

  helicopterEntity = createAircraftEntity(routePoints[0]);
  viewer.scene.requestRender();
}

function createAircraftEntity(firstPoint) {
  if (!firstPoint) return null;
  const position = Cesium.Cartesian3.fromDegrees(firstPoint.lon, firstPoint.lat, 900);
  const assetUrl = runtimeConfig.helicopterModelUrl ?? './models/helicopter-placeholder.svg';
  const use3dModel = /\.(gltf|glb)$/i.test(assetUrl);
  const entity = viewer.entities.add({
    position,
    orientation: Cesium.Transforms.headingPitchRollQuaternion(
      position,
      new Cesium.HeadingPitchRoll(0, 0, 0)
    ),
    ...(use3dModel
      ? {
          model: {
            uri: assetUrl,
            minimumPixelSize: 72,
            maximumScale: 240,
            scale: 1.0
          }
        }
      : {
          billboard: {
            image: assetUrl,
            scale: 0.35,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        })
  });

  return entity;
}

function buildFlightPlan(points) {
  const totalTimelineSeconds = Math.max(Number(timelineSecondsEl.value) || 30, 10);
  const requestedLegSeconds = Math.max(Number(legSecondsEl.value) || 5, 3);
  const legCount = Math.max(points.length - 1, 0);
  const overviewSeconds = Math.min(5, totalTimelineSeconds);
  const usableLegSeconds = legCount > 0 ? Math.max(Math.min(requestedLegSeconds, (totalTimelineSeconds - overviewSeconds) / legCount), 1) : 0;
  const totalUsed = overviewSeconds + usableLegSeconds * legCount;

  const legs = [];
  let startTime = overviewSeconds;
  for (let index = 0; index < legCount; index += 1) {
    legs.push({
      from: points[index],
      to: points[index + 1],
      startSeconds: startTime,
      endSeconds: startTime + usableLegSeconds,
      durationSeconds: usableLegSeconds
    });
    startTime += usableLegSeconds;
  }

  return {
    overviewSeconds,
    legSeconds: usableLegSeconds,
    totalSeconds: totalUsed,
    legs
  };
}

function renderTimelineSummary(plan) {
  if (!plan) {
    timelineSummaryEl.textContent = '';
    return;
  }

  const legText = plan.legs.length
    ? plan.legs.map((leg, index) => `Leg ${index + 1}: ${leg.from.label} → ${leg.to.label} (${leg.durationSeconds.toFixed(1)}s)`).join('\n')
    : 'Single waypoint, overview only.';

  timelineSummaryEl.textContent = `Brief timeline\nOverview: ${plan.overviewSeconds.toFixed(1)}s\n${legText}\nTotal used: ${plan.totalSeconds.toFixed(1)}s`;
}

async function playBriefAnimation() {
  if (!routePoints.length) {
    setStatus('Plot a route first.', true);
    return;
  }

  if (animationHandle) {
    cancelAnimationFrame(animationHandle);
    animationHandle = null;
  }

  activeFlightPlan = buildFlightPlan(routePoints);
  renderTimelineSummary(activeFlightPlan);
  setStatus('Playing brief animation...');
  viewer.clock.shouldAnimate = false;

  const start = performance.now();
  const tick = (now) => {
    const elapsed = Math.min((now - start) / 1000, activeFlightPlan.totalSeconds);
    updateAnimation(elapsed, activeFlightPlan);
    viewer.scene.requestRender();

    if (elapsed < activeFlightPlan.totalSeconds) {
      animationHandle = requestAnimationFrame(tick);
    } else {
      animationHandle = null;
      setStatus('Brief animation finished. Use OS screen capture to record if you need a video.');
    }
  };

  animationHandle = requestAnimationFrame(tick);
}

function updateAnimation(elapsedSeconds, plan) {
  if (!helicopterEntity || !routePoints.length) return;

  if (elapsedSeconds <= plan.overviewSeconds || !plan.legs.length) {
    const overviewTarget = routePoints[Math.min(routePoints.length - 1, 1)] ?? routePoints[0];
    helicopterEntity.position = Cesium.Cartesian3.fromDegrees(routePoints[0].lon, routePoints[0].lat, 900);
    helicopterEntity.orientation = orientationForLeg(routePoints[0], overviewTarget);
    focusOverview(routePoints, false);
    return;
  }

  const currentLeg = plan.legs.find((leg) => elapsedSeconds >= leg.startSeconds && elapsedSeconds <= leg.endSeconds) ?? plan.legs.at(-1);
  const progress = Cesium.Math.clamp((elapsedSeconds - currentLeg.startSeconds) / currentLeg.durationSeconds, 0, 1);
  const lon = Cesium.Math.lerp(currentLeg.from.lon, currentLeg.to.lon, progress);
  const lat = Cesium.Math.lerp(currentLeg.from.lat, currentLeg.to.lat, progress);
  const position = Cesium.Cartesian3.fromDegrees(lon, lat, cameraConfig.legAltitudeMeters * 0.5);
  helicopterEntity.position = position;
  helicopterEntity.orientation = orientationForLeg(currentLeg.from, currentLeg.to, position);
  focusLeg(currentLeg.from, currentLeg.to, progress);
}

function orientationForLeg(from, to, positionOverride) {
  const heading = Cesium.Math.toRadians(bearingDegrees(from.lat, from.lon, to.lat, to.lon));
  const position = positionOverride ?? Cesium.Cartesian3.fromDegrees(from.lon, from.lat, cameraConfig.legAltitudeMeters * 0.5);
  return Cesium.Transforms.headingPitchRollQuaternion(position, new Cesium.HeadingPitchRoll(heading, 0, 0));
}

function focusOverview(points, fly = true) {
  if (!points.length) {
    viewer.camera.flyTo({ destination: defaultCenter, duration: fly ? 1.2 : 0 });
    return;
  }

  const rectangle = Cesium.Rectangle.fromCartesianArray(points.map((point) => Cesium.Cartesian3.fromDegrees(point.lon, point.lat)));
  const destination = viewer.camera.getRectangleCameraCoordinates(rectangle);
  if (!destination) return;
  const destinationCartographic = Cesium.Cartographic.fromCartesian(destination);
  destinationCartographic.height = Math.max(destinationCartographic.height, cameraConfig.overviewAltitudeMeters);
  const finalDestination = Cesium.Cartesian3.fromRadians(destinationCartographic.longitude, destinationCartographic.latitude, destinationCartographic.height);

  const options = {
    destination: finalDestination,
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(cameraConfig.pitchDegrees),
      roll: 0
    },
    duration: fly ? 1.5 : 0
  };

  fly ? viewer.camera.flyTo(options) : viewer.camera.setView(options);
}

function focusLeg(from, to, progress) {
  const midpointLon = Cesium.Math.lerp(from.lon, to.lon, progress);
  const midpointLat = Cesium.Math.lerp(from.lat, to.lat, progress);
  const destination = Cesium.Cartesian3.fromDegrees(midpointLon, midpointLat, cameraConfig.legAltitudeMeters);
  viewer.camera.setView({
    destination,
    orientation: {
      heading: Cesium.Math.toRadians(bearingDegrees(from.lat, from.lon, to.lat, to.lon)),
      pitch: Cesium.Math.toRadians(cameraConfig.pitchDegrees),
      roll: 0
    }
  });
}

function bearingDegrees(lat1, lon1, lat2, lon2) {
  const phi1 = Cesium.Math.toRadians(lat1);
  const phi2 = Cesium.Math.toRadians(lat2);
  const lambda = Cesium.Math.toRadians(lon2 - lon1);
  const y = Math.sin(lambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda);
  return (Cesium.Math.toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function appendResolved(point) {
  const item = document.createElement('li');
  item.textContent = `${point.order}. ${point.label} → ${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`;
  resolvedListEl.appendChild(item);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}
