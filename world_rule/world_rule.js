import * as THREE from "three";
import "../src/site-header.css";
import { finishSiteLoading, setSiteLoadingProgress } from "../src/site-ui.js";
import { applyWorldConfigFromChain, chunkSize } from "../src/world/config.js";
import { currentWorldSeed, getGeneratedBlock, setWorldSeed, terrainProfile } from "../src/world/generator.js";
import { setCanonicalWorldConfig } from "../src/world/canonicalResource.js";
import { createWorldState } from "../src/world/state.js";
import { createChunkGroup } from "../src/world/chunks.js";
import { chunkKey } from "../src/world/keys.js";
import { defaultWorldSeed, normalizeSeed, persistPlayWorldSeed, readPlayWorldSeed } from "../src/world/seedStorage.js";
import {
  updateProceduralMaterialSeed,
  updateProceduralMaterialTime,
} from "../src/render/proceduralMaterials.js";
import { createWorldGeometryByType, createWorldMaterials } from "../src/world/rendering.js";
import { getWorldAlgorithmSpec } from "../src/data/worldAlgorithmRules.js";
import { initWorldRuleI18n, worldRuleT } from "./i18n.js";

const canvas = document.querySelector("#worldPreview");
const seedInput = document.querySelector("#seedInput");
const randomSeedButton = document.querySelector("#randomSeed");
const renderSeedButton = document.querySelector("#renderSeed");
const previewStats = document.querySelector("#previewStats");
const previewSeedLabel = document.querySelector("#previewSeedLabel");
const previewCoordinates = document.querySelector("#previewCoordinates");
const algorithmLayout = document.querySelector(".world-algorithm-layout");
const algorithmPane = document.querySelector("#algorithmPane");
const algorithmToggle = document.querySelector("#algorithmToggle");
const ruleList = document.querySelector("#ruleList");
const pipelineList = document.querySelector("#pipelineList");
const biomeStrip = document.querySelector("#biomeStrip");
const seedStorageKey = "nicechunk.worldRule.seed";
const previewViewStorageKey = "nicechunk.worldRule.view.v1";
const algorithmCollapsedStorageKey = "nicechunk.worldRule.algorithmCollapsed.v1";
const previewViewVersion = 2;
const previewRenderDistance = 6;
const previewDetailRenderDistance = 1;
const previewPreloadDistance = previewRenderDistance + 3;
const initialChunkRadius = 1;
const chunkBuildBudget = 6;
const chunkBuildBudgetMs = 10;
const chunkRefreshBudget = 2;
const preloadChunkBuildBudget = 2;
const previewViewSaveMs = 350;
const caveSearchRadius = 192;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc8e8);
scene.fog = new THREE.Fog(0x8fc8e8, 70, 230);

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const hemi = new THREE.HemisphereLight(0xf4fbff, 0x526f39, 2.35);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff0bd, 2.15);
sun.position.set(-38, 62, 28);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -80;
sun.shadow.camera.right = 80;
sun.shadow.camera.top = 80;
sun.shadow.camera.bottom = -80;
scene.add(sun);

const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
const waterGeometry = new THREE.PlaneGeometry(1, 1);
waterGeometry.rotateX(-Math.PI / 2);
const geometryByType = createWorldGeometryByType({ THREE, cubeGeometry, waterGeometry });
const materials = createWorldMaterials({ THREE });

let worldState = createWorldState();
let generatedChunks = new Map();
let preloadedChunks = new Map();
let pendingChunkKeys = [];
let pendingPreloadChunkKeys = [];
let pendingChunkRefreshKeys = [];
let targetChunkCount = 0;
let yaw = Math.PI * 0.25;
let pitch = -0.35;
let dragging = false;
let lastPointerX = 0;
let lastPointerY = 0;
let lastViewSaveAt = 0;
let lastPreviewCoordinateText = "";

const keys = new Set();
const clock = new THREE.Clock();
const world = new THREE.Group();
scene.add(world);

setSiteLoadingProgress(28);
await initWorldRuleI18n();
setSiteLoadingProgress(54);
renderRules();
const startupSeed = initialWorldRuleSeed();
seedInput.value = startupSeed;
applySeed(seedInput.value);
setAlgorithmPaneCollapsed(loadAlgorithmCollapsedState(), false);
resize();
updatePreviewCoordinates();
animate();
finishSiteLoading();
syncSeedFromPlayWorldConfig(startupSeed);

window.addEventListener("resize", resize);
window.addEventListener("beforeunload", () => savePreviewView(true));
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") savePreviewView(true);
});
window.addEventListener("keydown", (event) => {
  if (isEditableKeyboardTarget(event.target)) return;
  keys.add(event.code);
});
window.addEventListener("keyup", (event) => {
  if (isEditableKeyboardTarget(event.target)) return;
  keys.delete(event.code);
});
canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerup", handlePointerUp);
canvas.addEventListener("pointercancel", handlePointerUp);
renderSeedButton.addEventListener("click", () => submitSeedInput());
randomSeedButton.addEventListener("click", () => {
  seedInput.value = randomSeed();
  submitSeedInput();
});
algorithmToggle?.addEventListener("click", () => {
  setAlgorithmPaneCollapsed(!algorithmLayout?.classList.contains("algorithm-collapsed"));
});
seedInput.addEventListener("keydown", (event) => {
  if (event.code !== "Enter") return;
  event.preventDefault();
  submitSeedInput();
});
window.addEventListener("nicechunk:worldrulelanguagechange", () => {
  renderRules();
  updateAlgorithmToggleText();
  updatePreviewCoordinates(true);
});

function applySeed(seed) {
  const nextSeed = normalizeSeed(seed);
  seedInput.value = nextSeed;
  if (previewSeedLabel) previewSeedLabel.textContent = nextSeed;
  localStorage.setItem(seedStorageKey, nextSeed);
  setWorldSeed(nextSeed);
  setCanonicalWorldConfig({ worldSeedHex: nextSeed });
  updateProceduralMaterialSeed(materials, currentWorldSeed());
  clearWorld();
  worldState = createWorldState();
  const focused = previewFocusFromUrl();
  const saved = focused ? null : loadSavedPreviewView(nextSeed);
  const start = saved?.position ?? focused ?? defaultPreviewStart();
  camera.position.set(start.x, start.y, start.z);
  yaw = saved?.yaw ?? Math.PI * 0.25;
  pitch = saved?.pitch ?? -0.38;
  updateCameraRotation();
  pendingChunkKeys = [];
  pendingPreloadChunkKeys = [];
  pendingChunkRefreshKeys = [];
  targetChunkCount = 0;
  savePreviewView(true);
}

function initialWorldRuleSeed() {
  return readPlayWorldSeed() ?? defaultWorldSeed;
}

async function syncSeedFromPlayWorldConfig(startupSeed) {
  const chainSeed = await loadPlayWorldSeedFromChain();
  if (!chainSeed) return;
  if (normalizeSeed(seedInput.value) !== normalizeSeed(startupSeed)) return;
  if (normalizeSeed(seedInput.value) === chainSeed) return;
  seedInput.value = chainSeed;
  applySeed(chainSeed);
}

async function loadPlayWorldSeedFromChain() {
  try {
    const { loadGlobalConfig } = await import("../src/chain/nicechunkChain.js");
    const config = await withTimeout(loadGlobalConfig(), 8000, "world-rule-global-config");
    applyWorldConfigFromChain(config);
    setCanonicalWorldConfig(config);
    const seed = config.worldSeedHex ?? bytesToHex(config.worldSeed);
    if (!seed) return null;
    persistPlayWorldSeed(seed);
    return normalizeSeed(seed);
  } catch (error) {
    console.warn("Failed to load NiceChunk world config for world rule preview", error);
    return null;
  }
}

function withTimeout(promise, timeoutMs, label) {
  let timeoutId = 0;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
  });
}

function bytesToHex(value) {
  if (!value) return "";
  return Array.from(value, (byte) => Number(byte).toString(16).padStart(2, "0")).join("");
}

function submitSeedInput() {
  applySeed(seedInput.value);
  seedInput.blur();
  keys.clear();
}

function isEditableKeyboardTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

function defaultPreviewStart() {
  return { x: 0, y: terrainProfile(0, 0).height + 15, z: 0 };
}

function previewFocusFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const rawX = params.get("x");
  const rawZ = params.get("z");
  if (rawX === null || rawZ === null) return null;
  const x = Number(rawX);
  const z = Number(rawZ);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const cellX = Math.round(x);
  const cellZ = Math.round(z);
  return { x: cellX, y: terrainProfile(cellX, cellZ).height + 15, z: cellZ };
}

function clearWorld() {
  for (const group of generatedChunks.values()) {
    world.remove(group);
    disposeGroup(group);
  }
  for (const group of preloadedChunks.values()) {
    disposeGroup(group);
  }
  generatedChunks = new Map();
  preloadedChunks = new Map();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.04);
  updateProceduralMaterialTime(materials, clock.elapsedTime);
  updateFlight(dt);
  generateAroundCamera();
  buildPendingChunks();
  savePreviewView();
  updatePreviewCoordinates();
  renderer.render(scene, camera);
}

function updateFlight(dt) {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const direction = new THREE.Vector3();

  if (keys.has("KeyW")) direction.add(forward);
  if (keys.has("KeyS")) direction.sub(forward);
  if (keys.has("KeyD")) direction.add(right);
  if (keys.has("KeyA")) direction.sub(right);
  if (keys.has("Space") || keys.has("KeyE")) direction.add(up);
  if (keys.has("KeyC") || keys.has("KeyQ")) direction.sub(up);

  if (direction.lengthSq() === 0) return;
  direction.normalize();
  const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 150 : 54;
  camera.position.addScaledVector(direction, speed * dt);
}

function generateAroundCamera() {
  const cx = Math.floor(camera.position.x / chunkSize);
  const cz = Math.floor(camera.position.z / chunkSize);
  const visibleKeys = collectChunkKeys(cx, cz, previewRenderDistance);
  const preloadKeys = collectChunkKeys(cx, cz, previewPreloadDistance);
  const nextPending = [];
  const nextPreload = [];
  const buildInitialArea = generatedChunks.size === 0 && preloadedChunks.size === 0;

  for (let z = cz - previewRenderDistance; z <= cz + previewRenderDistance; z++) {
    for (let x = cx - previewRenderDistance; x <= cx + previewRenderDistance; x++) {
      const key = chunkKey(x, z);
      const generated = generatedChunks.get(key);
      if (generated) {
        queueChunkDetailRefreshIfNeeded(key, generated, previewChunkDetailMode(x, z));
        continue;
      }
      const preloaded = preloadedChunks.get(key);
      if (preloaded) {
        attachPreloadedChunk(key, preloaded, previewChunkDetailMode(x, z));
        continue;
      }
      if (buildInitialArea && Math.abs(x - cx) <= initialChunkRadius && Math.abs(z - cz) <= initialChunkRadius) {
        generatedChunks.set(key, createPreviewChunk(x, z, true, previewChunkDetailMode(x, z)));
        continue;
      }
      nextPending.push(key);
    }
  }

  targetChunkCount = visibleKeys.size;
  pendingChunkKeys = mergePendingChunkKeys(pendingChunkKeys, nextPending, visibleKeys, cx, cz);

  for (const [key, group] of generatedChunks) {
    if (visibleKeys.has(key)) continue;
    world.remove(group);
    generatedChunks.delete(key);
    disposeGroup(group);
  }

  for (const key of preloadKeys) {
    if (visibleKeys.has(key) || generatedChunks.has(key) || preloadedChunks.has(key)) continue;
    nextPreload.push(key);
  }
  pendingPreloadChunkKeys = mergePendingChunkKeys(pendingPreloadChunkKeys, nextPreload, preloadKeys, cx, cz);

  for (const [key, group] of preloadedChunks) {
    if (preloadKeys.has(key) && !visibleKeys.has(key)) continue;
    preloadedChunks.delete(key);
    if (!generatedChunks.has(key)) disposeGroup(group);
  }

  previewStats.textContent = worldRuleT("preview.chunks", { active: generatedChunks.size, total: targetChunkCount });
}

function buildPendingChunks() {
  const start = performance.now();
  let built = 0;
  while (pendingChunkKeys.length && built < chunkBuildBudget && performance.now() - start < chunkBuildBudgetMs) {
    const key = pendingChunkKeys.shift();
    if (generatedChunks.has(key) || !isChunkKeyInRenderRange(key)) continue;
    const [chunkX, chunkZ] = key.split(",").map(Number);
    generatedChunks.set(key, createPreviewChunk(chunkX, chunkZ, true, previewChunkDetailMode(chunkX, chunkZ)));
    built++;
  }

  let refreshed = 0;
  while (
    pendingChunkRefreshKeys.length &&
    refreshed < chunkRefreshBudget &&
    performance.now() - start < chunkBuildBudgetMs
  ) {
    const key = pendingChunkRefreshKeys.shift();
    if (!isChunkKeyInRenderRange(key)) continue;
    const current = generatedChunks.get(key);
    if (!current) continue;
    const [chunkX, chunkZ] = key.split(",").map(Number);
    const detailMode = previewChunkDetailMode(chunkX, chunkZ);
    if (current.userData.detailMode === detailMode) continue;
    world.remove(current);
    disposeGroup(current);
    generatedChunks.delete(key);
    generatedChunks.set(key, createPreviewChunk(chunkX, chunkZ, true, detailMode));
    refreshed++;
  }

  let preloaded = 0;
  while (
    !pendingChunkKeys.length &&
    !pendingChunkRefreshKeys.length &&
    pendingPreloadChunkKeys.length &&
    preloaded < preloadChunkBuildBudget &&
    performance.now() - start < chunkBuildBudgetMs
  ) {
    const key = pendingPreloadChunkKeys.shift();
    if (generatedChunks.has(key) || preloadedChunks.has(key) || !isChunkKeyInPreloadRange(key)) continue;
    const [chunkX, chunkZ] = key.split(",").map(Number);
    preloadedChunks.set(key, createPreviewChunk(chunkX, chunkZ, false, "surface"));
    preloaded++;
  }
}

function collectChunkKeys(centerChunkX, centerChunkZ, radius) {
  const keys = new Set();
  for (let z = centerChunkZ - radius; z <= centerChunkZ + radius; z++) {
    for (let x = centerChunkX - radius; x <= centerChunkX + radius; x++) {
      keys.add(chunkKey(x, z));
    }
  }
  return keys;
}

function createPreviewChunk(chunkX, chunkZ, attach, detailMode) {
  const group = createChunkGroup({ THREE, chunkX, chunkZ, state: worldState, geometryByType, materials, detailMode });
  if (attach) world.add(group);
  return group;
}

function attachPreloadedChunk(key, group, detailMode) {
  preloadedChunks.delete(key);
  world.add(group);
  generatedChunks.set(key, group);
  queueChunkDetailRefreshIfNeeded(key, group, detailMode);
}

function queueChunkDetailRefreshIfNeeded(key, group, detailMode) {
  if (group.userData.detailMode === detailMode) return;
  if (pendingChunkRefreshKeys.includes(key)) return;
  pendingChunkRefreshKeys.push(key);
}

function previewChunkDetailMode(chunkX, chunkZ) {
  const centerChunkX = Math.floor(camera.position.x / chunkSize);
  const centerChunkZ = Math.floor(camera.position.z / chunkSize);
  return Math.abs(chunkX - centerChunkX) <= previewDetailRenderDistance && Math.abs(chunkZ - centerChunkZ) <= previewDetailRenderDistance
    ? "full"
    : "distant";
}

function isChunkKeyInRenderRange(key) {
  const [chunkX, chunkZ] = key.split(",").map(Number);
  return isChunkInRange(chunkX, chunkZ, previewRenderDistance);
}

function isChunkKeyInPreloadRange(key) {
  const [chunkX, chunkZ] = key.split(",").map(Number);
  return isChunkInRange(chunkX, chunkZ, previewPreloadDistance);
}

function isChunkInRange(chunkX, chunkZ, radius) {
  const centerChunkX = Math.floor(camera.position.x / chunkSize);
  const centerChunkZ = Math.floor(camera.position.z / chunkSize);
  return Math.abs(chunkX - centerChunkX) <= radius && Math.abs(chunkZ - centerChunkZ) <= radius;
}

function renderRules() {
  const spec = getWorldAlgorithmSpec();
  renderPipeline();
  renderBiomeStrip();
  const nodes = [];

  for (const section of spec.sections) {
    const heading = document.createElement("h2");
    heading.className = "rule-section-title";
    heading.textContent = worldRuleT(section.titleKey);
    nodes.push(heading);

    for (const rule of spec.rules[section.id] ?? []) {
      const article = document.createElement("article");
      const ruleTitle = document.createElement("h2");
      const code = document.createElement("code");
      const description = document.createElement("p");
      ruleTitle.textContent = worldRuleT(`rules.items.${rule.id}.title`);
      code.className = "rule-code";
      code.textContent = rule.code;
      description.textContent = worldRuleT(`rules.items.${rule.id}.description`);
      article.append(ruleTitle, code, description);
      if (rule.action?.id === "findNearestCave") {
        const actions = document.createElement("div");
        const button = document.createElement("button");
        const action = localizedRuleAction(rule.action.id);
        actions.className = "rule-actions";
        button.className = "rule-action-button";
        button.type = "button";
        button.textContent = action.label;
        button.addEventListener("click", () => handleFindNearestCave(button, action));
        actions.append(button);
        article.append(actions);
      }
      nodes.push(article);
    }
  }

  ruleList.replaceChildren(...nodes);
}

function renderPipeline() {
  if (!pipelineList) return;
  const steps = getWorldAlgorithmSpec().pipelineStepIds;
  pipelineList.replaceChildren(
    ...steps.map((stepId, index) => {
      const item = document.createElement("li");
      const number = document.createElement("b");
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      const body = document.createElement("p");
      number.textContent = String(index + 1).padStart(2, "0");
      title.textContent = worldRuleT(`pipeline.steps.${stepId}.title`);
      body.textContent = worldRuleT(`pipeline.steps.${stepId}.body`);
      copy.append(title, body);
      item.append(number, copy);
      return item;
    }),
  );
}

function renderBiomeStrip() {
  if (!biomeStrip) return;
  biomeStrip.replaceChildren(
    ...getWorldAlgorithmSpec().biomePriorityIds.map((biomeId) => {
      const item = document.createElement("span");
      item.textContent = worldRuleT(`biomes.items.${biomeId}`);
      return item;
    }),
  );
}

function localizedRuleAction(actionId) {
  return {
    id: actionId,
    label: worldRuleT(`rules.actions.${actionId}.label`),
    searching: worldRuleT(`rules.actions.${actionId}.searching`),
    notFound: worldRuleT(`rules.actions.${actionId}.notFound`),
  };
}

function mergePendingChunkKeys(current, next, visibleKeys, centerChunkX, centerChunkZ) {
  const merged = [];
  const seen = new Set();
  for (const key of [...current, ...next]) {
    if (seen.has(key) || generatedChunks.has(key) || preloadedChunks.has(key) || !visibleKeys.has(key)) continue;
    seen.add(key);
    merged.push(key);
  }
  merged.sort((a, b) => chunkDistanceScore(a, centerChunkX, centerChunkZ) - chunkDistanceScore(b, centerChunkX, centerChunkZ));
  return merged;
}

function chunkDistanceScore(key, centerChunkX, centerChunkZ) {
  const [chunkX, chunkZ] = key.split(",").map(Number);
  return Math.hypot(chunkX - centerChunkX, chunkZ - centerChunkZ);
}

function handleFindNearestCave(button, action) {
  const originalLabel = action.label;
  button.disabled = true;
  button.textContent = action.searching ?? originalLabel;
  requestAnimationFrame(() => {
    try {
      const cave = findNearestCaveFromCamera();
      if (!cave) {
        window.alert(action.notFound ?? action.label);
        return;
      }
      moveCameraToCave(cave);
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
}

function findNearestCaveFromCamera() {
  const originX = Math.round(camera.position.x);
  const originZ = Math.round(camera.position.z);
  for (let radius = 0; radius <= caveSearchRadius; radius++) {
    let best = null;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (radius > 0 && Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const x = originX + dx;
        const z = originZ + dz;
        const cave = findCaveInColumn(x, z, originX, originZ);
        if (!cave) continue;
        if (!best || cave.score < best.score) best = cave;
      }
    }
    if (best) return best;
  }
  return null;
}

function findCaveInColumn(x, z, originX, originZ) {
  const profile = terrainProfile(x, z);
  const topY = Math.floor(profile.height) - 4;
  if (topY <= 1) return null;
  let best = null;
  for (let y = topY; y > 1; y--) {
    if (getGeneratedBlock(x, y, z) !== null) continue;
    const clearance = getGeneratedBlock(x, y + 1, z) === null ? 0.35 : 0;
    const horizontalDistance = Math.hypot(x - originX, z - originZ);
    const depthPreference = (profile.height - y) * 0.002;
    const score = horizontalDistance - clearance + depthPreference;
    if (!best || score < best.score) best = { x, y, z, score };
  }
  return best;
}

function moveCameraToCave(cave) {
  camera.position.set(cave.x, cave.y + 0.6, cave.z);
  yaw = Math.PI * 0.25;
  pitch = -0.08;
  updateCameraRotation();
  pendingChunkKeys = [];
  pendingPreloadChunkKeys = [];
  pendingChunkRefreshKeys = [];
  savePreviewView(true);
  updatePreviewCoordinates(true);
}

function updatePreviewCoordinates(force = false) {
  if (!previewCoordinates) return;
  const text = worldRuleT("preview.coordinatesValue", {
    x: formatCoordinate(camera.position.x),
    y: formatCoordinate(camera.position.y),
    z: formatCoordinate(camera.position.z),
  });
  if (!force && text === lastPreviewCoordinateText) return;
  lastPreviewCoordinateText = text;
  previewCoordinates.textContent = text;
}

function formatCoordinate(value) {
  return Number(value).toFixed(1);
}

function loadAlgorithmCollapsedState() {
  try {
    return localStorage.getItem(algorithmCollapsedStorageKey) === "1";
  } catch {
    return false;
  }
}

function setAlgorithmPaneCollapsed(collapsed, persist = true) {
  if (!algorithmLayout) return;
  algorithmLayout.classList.toggle("algorithm-collapsed", collapsed);
  algorithmPane?.setAttribute("aria-hidden", String(collapsed));
  algorithmToggle?.setAttribute("aria-expanded", String(!collapsed));
  updateAlgorithmToggleText(collapsed);
  if (persist) {
    try {
      localStorage.setItem(algorithmCollapsedStorageKey, collapsed ? "1" : "0");
    } catch {
      // Ignore storage failures; the panel should still respond for this session.
    }
  }
  requestAnimationFrame(resize);
}

function updateAlgorithmToggleText(collapsed = algorithmLayout?.classList.contains("algorithm-collapsed") ?? false) {
  if (!algorithmToggle) return;
  const label = worldRuleT(collapsed ? "algorithm.expand" : "algorithm.collapse");
  const labelNode = algorithmToggle.querySelector("span");
  if (labelNode) labelNode.textContent = label;
  algorithmToggle.title = label;
}

function handlePointerDown(event) {
  event.preventDefault();
  dragging = true;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  canvas.setPointerCapture?.(event.pointerId);
}

function handlePointerMove(event) {
  if (!dragging) return;
  event.preventDefault();
  const dx = event.clientX - lastPointerX;
  const dy = event.clientY - lastPointerY;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  yaw -= dx * 0.0055;
  pitch = THREE.MathUtils.clamp(pitch - dy * 0.0035, -1.25, 1.05);
  updateCameraRotation();
  savePreviewView();
}

function handlePointerUp(event) {
  if (!dragging) return;
  event.preventDefault();
  dragging = false;
}

function updateCameraRotation() {
  camera.rotation.order = "YXZ";
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

function loadSavedPreviewView(seed) {
  try {
    const saved = JSON.parse(localStorage.getItem(previewViewStorageKey) || "null");
    if (!saved || saved.version !== previewViewVersion || saved.seed !== seed) return null;
    const position = saved.position;
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return null;
    const savedYaw = Number(saved.yaw);
    const savedPitch = Number(saved.pitch);
    if (!Number.isFinite(savedYaw) || !Number.isFinite(savedPitch)) return null;
    return {
      position: new THREE.Vector3(position.x, position.y, position.z),
      yaw: savedYaw,
      pitch: THREE.MathUtils.clamp(savedPitch, -1.25, 1.05),
    };
  } catch {
    return null;
  }
}

function savePreviewView(force = false) {
  const now = performance.now();
  if (!force && now - lastViewSaveAt < previewViewSaveMs) return;
  lastViewSaveAt = now;
  try {
    localStorage.setItem(
      previewViewStorageKey,
      JSON.stringify({
        version: previewViewVersion,
        seed: seedInput.value,
        position: {
          x: Number(camera.position.x.toFixed(3)),
          y: Number(camera.position.y.toFixed(3)),
          z: Number(camera.position.z.toFixed(3)),
        },
        yaw: Number(yaw.toFixed(6)),
        pitch: Number(pitch.toFixed(6)),
        savedAt: Date.now(),
      }),
    );
  } catch {
    // Ignore storage failures so preview navigation remains uninterrupted.
  }
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / Math.max(1, rect.height);
  camera.updateProjectionMatrix();
}

function randomSeed() {
  const timePart = Date.now().toString(36);
  const randomPart = Math.floor(Math.random() * 0xffffff)
    .toString(36)
    .padStart(4, "0");
  return `nicechunk-${timePart}-${randomPart}`;
}

function disposeGroup(group) {
  group.clear();
}
