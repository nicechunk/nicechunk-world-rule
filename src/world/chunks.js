import { chunkSize, cloudMinHeight, cloudSectorSize, seaLevel } from "./config.js";
import { currentWorldSeed, getGeneratedBlock, getBlockByDepth, surfaceWaterLevel, terrainHeight, terrainProfile, treeDensityAt } from "./generator.js";
import { WorldMapBlock, renderTypeForBlock } from "./blocks.js";
import { blockKey, parseCellKey } from "./keys.js";
import { isSolidCell } from "./state.js";

const waterSurfaceOffset = 0.56;
const waterVisualHeightScale = 2 / 3;
const waterVisualCenterOffset = -1 / 6;

export function createChunkGroup({ THREE, chunkX, chunkZ, state, geometryByType, materials, detailMode = "full" }) {
  const group = new THREE.Group();
  group.name = `chunk:${chunkX},${chunkZ}`;
  group.userData.detailMode = detailMode;
  group.userData.solidKeys = new Set();
  const fullDetail = detailMode === "full";
  const treeDetail = detailMode !== "surface";
  const terrainColumnDepth = fullDetail ? 5 : 2;

  const matrices = {
    grass: [],
    dirt: [],
    stone: [],
    deepStone: [],
    sand: [],
    sandstone: [],
    gravel: [],
    clay: [],
    mud: [],
    dryDirt: [],
    saltFlat: [],
    snow: [],
    ice: [],
    frozenSoil: [],
    basalt: [],
    ash: [],
    bedrock: [],
    water: [],
    swampWater: [],
    toxicWater: [],
    lava: [],
    quicksand: [],
    trunk: [],
    trunkDark: [],
    pineTrunk: [],
    deadWood: [],
    giantRoot: [],
    leaves: [],
    leavesDark: [],
    leavesLight: [],
    leavesTeal: [],
    leavesWarm: [],
    pineLeaves: [],
    snowLeaves: [],
    flowerStem: [],
    flowerRed: [],
    flowerYellow: [],
    flowerBlue: [],
    flowerWhite: [],
    grassPlant: [],
    dryGrass: [],
    bush: [],
    deadBush: [],
    cactus: [],
    reed: [],
    swampGrass: [],
    snowBush: [],
    thorn: [],
    moss: [],
    lichen: [],
    vine: [],
    glowMycelium: [],
    mushroom: [],
    seaweed: [],
    aquaticPlant: [],
    coral: [],
    deadCoral: [],
    shellBed: [],
    pebble: [],
    shoreDamp: [],
    shoreFoam: [],
    reedStem: [],
    reedTip: [],
    mushroomStem: [],
    mushroomCap: [],
  };

  const transform = new THREE.Matrix4();
  const scale = new THREE.Vector3(1, 1, 1);
  const waterScale = new THREE.Vector3(1, waterVisualHeightScale, 1);
  const rotation = new THREE.Quaternion();
  const decorationBudget = {
    grassTuft: 4,
    dryGrassTuft: 6,
    pebble: 18,
    shoreDamp: 30,
    shoreFoam: 22,
    reed: 10,
    mushroom: 1,
    fallenLog: 2,
  };

  const sourceFluidCells = new Map();
  for (let localZ = 0; localZ < chunkSize; localZ++) {
    for (let localX = 0; localX < chunkSize; localX++) {
      const x = chunkX * chunkSize + localX;
      const z = chunkZ * chunkSize + localZ;
      const profile = terrainProfile(x, z);
      const height = profile.height;
      const topType = renderTypeForBlock(profile.terrain) ?? profile.surfaceType;
      const waterFloorHeight = profile.noise.waterFloorHeight;
      const columnStart = Math.min(
        exposedColumnStart(x, z, height, terrainColumnDepth),
        waterFloorHeight === null || waterFloorHeight === undefined ? height : waterFloorHeight,
      );

      if (fullDetail) {
        pushBlock(state, matrices.bedrock, "bedrock", x, 0, z, transform, rotation, scale, THREE, group.userData.solidKeys);
      }

      for (let y = Math.max(1, columnStart); y <= height; y++) {
        const block = y === height ? profile.terrain : getBlockByDepth(y, height, profile.biome, profile.noise, x, z);
        const type = renderTypeForBlock(block);
        const key = blockKey(x, y, z);
        if (type && matrices[type] && !(state.placedBlocks.has(key) && !state.removedBlocks.has(key))) {
          pushBlock(state, matrices[type], type, x, y, z, transform, rotation, scale, THREE, group.userData.solidKeys);
        }
      }

      if (profile.fluid) {
        const fluidType = renderTypeForBlock(profile.fluid ?? WorldMapBlock.Water) ?? "water";
        const waterY = surfaceWaterLevel(x, z, profile) ?? (height < seaLevel ? seaLevel : height);
        const fluidKey = `${fluidType}:${waterY}`;
        if (!sourceFluidCells.has(fluidKey)) sourceFluidCells.set(fluidKey, { fluidType, waterY, cells: [] });
        sourceFluidCells.get(fluidKey).cells.push([localX, localZ]);
        if (fullDetail) addWaterEdgeDetail(matrices, decorationBudget, x, z, waterY, transform, THREE);
      }

      const surfaceSupportVisible = isSurfaceSupportVisible(state, x, height, z);
      let treeCell = false;
      if (treeDetail && surfaceSupportVisible) {
        treeCell = canGrowTree(profile) && isTreeCell(x, z, profile);
        if (treeCell) {
          if (fullDetail) {
            addTreeMatrices(state, matrices, x, height + 1, z, profile.tree, transform, rotation, scale, THREE, group.userData.solidKeys);
          } else {
            addDistantTreeMatrices(state, matrices, x, height + 1, z, profile.tree, transform, rotation, scale, THREE, group.userData.solidKeys);
          }
        } else if (fullDetail && profile.vegetation && height > 3) {
          addVegetationDecoration(matrices, x, height, z, profile.vegetation, transform, rotation, scale, THREE);
        }

        if (fullDetail) addSurfaceDetail(matrices, decorationBudget, x, height, z, profile, treeCell, transform, THREE);
      }
    }
  }

  for (const { fluidType, waterY, cells } of sourceFluidCells.values()) {
    if (cells.length && matrices[fluidType]) pushSourceWaterRects(matrices[fluidType], chunkX, chunkZ, cells, waterY, transform, rotation, THREE);
  }

  for (const key of state.dynamicWater) {
    const [x, y, z] = parseCellKey(key);
    if (Math.floor(x / chunkSize) !== chunkX || Math.floor(z / chunkSize) !== chunkZ) continue;
    if (isSolidCell(state, x, y, z)) continue;
    pushWaterVisualMatrix(matrices.water, x, y, z, transform, rotation, waterScale, THREE);
  }

  for (const [key, type] of state.placedBlocks) {
    const [x, y, z] = parseCellKey(key);
    if (Math.floor(x / chunkSize) !== chunkX || Math.floor(z / chunkSize) !== chunkZ) continue;
    if (!matrices[type]) continue;
    pushBlock(state, matrices[type], type, x, y, z, transform, rotation, scale, THREE, group.userData.solidKeys);
  }

  const instanceColor = new THREE.Color();
  for (const [type, list] of Object.entries(matrices)) {
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(geometryByType[type], materials[type], list.length);
    let hasInstanceColors = false;
    list.forEach((entry, index) => {
      mesh.setMatrixAt(index, entry.matrix);
      if (!entry.tint) return;
      mesh.setColorAt(index, instanceColor.setRGB(entry.tint[0], entry.tint[1], entry.tint[2]));
      hasInstanceColors = true;
    });
    if (hasInstanceColors && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    const interactive = list.some((entry) => entry.block);
    mesh.castShadow = type !== "water" && type !== "shoreDamp" && type !== "shoreFoam";
    mesh.receiveShadow = type !== "shoreDamp" && type !== "shoreFoam";
    if (!interactive) mesh.raycast = () => {};
    mesh.userData.blocks = list.map((entry) => entry.block);
    group.add(mesh);
  }

  return group;
}

export function createCloudSectorGroup({ THREE, sectorX, sectorZ, geometry, material }) {
  const lobes = [];
  addCloudCluster(lobes, sectorX, sectorZ);

  if (!lobes.length) return null;

  const group = new THREE.Group();
  group.name = `cloud:${sectorX},${sectorZ}`;
  const mesh = new THREE.InstancedMesh(geometry, material, lobes.length);
  const transform = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  let index = 0;

  for (const lobe of lobes) {
    transform.compose(new THREE.Vector3(lobe.x, lobe.y, lobe.z), rotation, new THREE.Vector3(lobe.rx, lobe.ry, lobe.rz));
    mesh.setMatrixAt(index, transform);
    index++;
  }

  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.userData.blocks = Array.from({ length: lobes.length }, () => null);
  group.add(mesh);
  return group;
}

function exposedColumnStart(x, z, height, maxDepth = 5) {
  const neighborFloor = Math.min(
    terrainHeight(x + 1, z),
    terrainHeight(x - 1, z),
    terrainHeight(x, z + 1),
    terrainHeight(x, z - 1),
    terrainHeight(x + 1, z + 1),
    terrainHeight(x - 1, z - 1),
    terrainHeight(x + 1, z - 1),
    terrainHeight(x - 1, z + 1),
  );
  return Math.max(0, Math.min(height - maxDepth, neighborFloor + 1));
}

function isSurfaceSupportVisible(state, x, y, z) {
  const key = blockKey(x, y, z);
  if (state.removedBlocks.has(key)) return false;
  return true;
}

function subsurfaceType(surfaceType, y, height) {
  if (surfaceType === "sand" && y >= height - 2) return "sand";
  if (surfaceType === "sandstone" && y >= height - 3) return "sandstone";
  if (surfaceType === "snow" && y === height - 1) return "snow";
  if (surfaceType === "snow" && y >= height - 4) return "sandstone";
  if (surfaceType === "grass" && y >= height - 2) return "dirt";
  return "stone";
}

function canGrowTree(profile) {
  return (
    [WorldMapBlock.Grass, WorldMapBlock.Mud, WorldMapBlock.Snow, WorldMapBlock.FrozenSoil, WorldMapBlock.Stone].includes(profile.terrain) &&
    profile.slope <= 3 &&
    profile.height > 4 &&
    profile.biome !== undefined
  );
}

export function generatedBlockTypeAt(x, y, z) {
  const treeType = generatedTreeBlockTypeAt(x, y, z);
  if (treeType) return treeType;

  const generated = getGeneratedBlock(x, y, z);
  return renderTypeForBlock(generated?.vegetation ?? generated?.terrain ?? generated?.fluid) ?? null;
}

function generatedTreeBlockTypeAt(x, y, z) {
  for (let treeZ = z - 4; treeZ <= z + 4; treeZ++) {
    for (let treeX = x - 4; treeX <= x + 4; treeX++) {
      const profile = terrainProfile(treeX, treeZ);
      if (!canGrowTree(profile) || !isTreeCell(treeX, treeZ, profile)) continue;
      const type = treeBlockTypeAt(treeX, profile.height + 1, treeZ, profile.tree, x, y, z);
      if (type) return type;
    }
  }
  return null;
}

function treeBlockTypeAt(treeX, baseY, treeZ, tree, x, y, z) {
  if (tree.type === "pine") {
    const trunkHeight = 5 + Math.floor(random2(treeX - 83, treeZ + 111) * 3);
    if (x === treeX && z === treeZ && y >= baseY && y < baseY + trunkHeight) return tree.trunkType;

    const top = baseY + trunkHeight;
    if (leafLayerContains(treeX, top - 4, treeZ, x, y, z, 2, 0.62)) return tree.leafType;
    if (leafLayerContains(treeX, top - 3, treeZ, x, y, z, 2, 0.74)) return tree.leafType;
    if (leafLayerContains(treeX, top - 2, treeZ, x, y, z, 1, 0.86)) return tree.leafType;
    if (leafLayerContains(treeX, top - 1, treeZ, x, y, z, 1, 0.72)) return leafAccentType(tree.leafType, treeX - 5, treeZ + 13);
    if (leafLayerContains(treeX, top, treeZ, x, y, z, 1, 0.54)) return tree.leafType;
    if (x === treeX && y === top + 1 && z === treeZ) return tree.leafType;
    return null;
  }

  const trunkHeight = 4 + Math.floor(random2(treeX + 101, treeZ - 71) * 3);
  if (x === treeX && z === treeZ && y >= baseY && y < baseY + trunkHeight) return tree.trunkType;

  const top = baseY + trunkHeight;
  if (leafLayerContains(treeX, top - 2, treeZ, x, y, z, 2, 0.68)) return tree.leafType;
  if (leafLayerContains(treeX, top - 1, treeZ, x, y, z, 2, 0.84)) return tree.leafType;
  if (leafLayerContains(treeX, top, treeZ, x, y, z, 2, 0.58)) return leafAccentType(tree.leafType, treeX, treeZ);
  if (leafLayerContains(treeX, top + 1, treeZ, x, y, z, 1, 0.76)) return leafAccentType(tree.leafType, treeX + 7, treeZ - 11);
  return leafLobeBlockTypeAt(treeX, top - 1, treeZ, tree.leafType, x, y, z);
}

function leafLobeBlockTypeAt(treeX, y, treeZ, leafType, x, targetY, z) {
  const lobeCount = 2 + Math.floor(random2(treeX - 127, treeZ + 149) * 3);
  const accent = leafAccentType(leafType, treeX + 17, treeZ - 19);
  for (let i = 0; i < lobeCount; i++) {
    const angle = random2(treeX + i * 37, treeZ - i * 41) * Math.PI * 2;
    const offset = 1 + Math.floor(random2(treeX - i * 43, treeZ + i * 47) * 2);
    const lx = treeX + Math.round(Math.cos(angle) * offset);
    const lz = treeZ + Math.round(Math.sin(angle) * offset);
    const ly = y + Math.floor(random2(treeX + i * 53, treeZ - i * 59) * 2);
    const type = i % 2 === 0 ? leafType : accent;
    if (leafLayerContains(lx, ly, lz, x, targetY, z, 1, 0.62)) return type;
  }
  return null;
}

function leafLayerContains(centerX, centerY, centerZ, x, y, z, radius, density) {
  if (y !== centerY) return false;
  const dx = x - centerX;
  const dz = z - centerZ;
  if (Math.abs(dx) > radius || Math.abs(dz) > radius) return false;
  const distance = Math.abs(dx) + Math.abs(dz);
  const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
  const edge = Math.max(Math.abs(dx), Math.abs(dz)) === radius;
  const roll = random2(centerX + dx * 23 + centerY * 5, centerZ + dz * 29 - centerY * 7);
  if (corner && roll < 0.7) return false;
  if (distance > radius + 1 && roll < 0.48) return false;
  if (edge && roll > density) return false;
  return true;
}

function addTreeMatrices(state, matrices, x, y, z, tree, transform, rotation, scale, THREE, solidKeys) {
  if (tree.type === "pine") {
    addPineTreeMatrices(state, matrices, x, y, z, tree, transform, rotation, scale, THREE, solidKeys);
    return;
  }

  const trunkHeight = 4 + Math.floor(random2(x + 101, z - 71) * 3);
  for (let i = 0; i < trunkHeight; i++) {
    pushBlock(state, matrices[tree.trunkType], tree.trunkType, x, y + i, z, transform, rotation, scale, THREE, solidKeys);
  }

  const top = y + trunkHeight;
  addTreeRoots(matrices, x, y, z, tree.trunkType, transform, THREE, 2);
  addBranches(matrices, x, y + Math.max(2, trunkHeight - 2), z, tree.trunkType, transform, THREE);
  addLeafLayer(state, matrices, x, top - 2, z, 2, 0.68, tree.leafType, transform, rotation, scale, THREE, solidKeys);
  addLeafLayer(state, matrices, x, top - 1, z, 2, 0.84, tree.leafType, transform, rotation, scale, THREE, solidKeys);
  addLeafLayer(state, matrices, x, top, z, 2, 0.58, leafAccentType(tree.leafType, x, z), transform, rotation, scale, THREE, solidKeys);
  addLeafLayer(state, matrices, x, top + 1, z, 1, 0.76, leafAccentType(tree.leafType, x + 7, z - 11), transform, rotation, scale, THREE, solidKeys);
  addLeafLobes(state, matrices, x, top - 1, z, tree.leafType, transform, rotation, scale, THREE, solidKeys);
}

function addDistantTreeMatrices(state, matrices, x, y, z, tree, transform, rotation, scale, THREE, solidKeys) {
  const trunkHeight = tree.type === "pine" ? 4 : 3;
  for (let i = 0; i < trunkHeight; i++) {
    pushBlock(state, matrices[tree.trunkType], tree.trunkType, x, y + i, z, transform, rotation, scale, THREE, solidKeys);
  }

  const top = y + trunkHeight;
  if (tree.type === "pine") {
    addDistantLeafCross(state, matrices, x, top - 2, z, tree.leafType, 1, transform, rotation, scale, THREE, solidKeys);
    addDistantLeafCross(state, matrices, x, top - 1, z, tree.leafType, 1, transform, rotation, scale, THREE, solidKeys);
    pushBlock(state, matrices[tree.leafType], tree.leafType, x, top, z, transform, rotation, scale, THREE, solidKeys);
    return;
  }

  addDistantLeafCross(state, matrices, x, top - 1, z, tree.leafType, 1, transform, rotation, scale, THREE, solidKeys);
  addDistantLeafCross(state, matrices, x, top, z, leafAccentType(tree.leafType, x, z), 1, transform, rotation, scale, THREE, solidKeys);
  pushBlock(state, matrices[tree.leafType], tree.leafType, x, top + 1, z, transform, rotation, scale, THREE, solidKeys);
}

function addDistantLeafCross(state, matrices, x, y, z, leafType, radius, transform, rotation, scale, THREE, solidKeys) {
  pushBlock(state, matrices[leafType], leafType, x, y, z, transform, rotation, scale, THREE, solidKeys);
  pushBlock(state, matrices[leafType], leafType, x + radius, y, z, transform, rotation, scale, THREE, solidKeys);
  pushBlock(state, matrices[leafType], leafType, x - radius, y, z, transform, rotation, scale, THREE, solidKeys);
  pushBlock(state, matrices[leafType], leafType, x, y, z + radius, transform, rotation, scale, THREE, solidKeys);
  pushBlock(state, matrices[leafType], leafType, x, y, z - radius, transform, rotation, scale, THREE, solidKeys);
}

function addPineTreeMatrices(state, matrices, x, y, z, tree, transform, rotation, scale, THREE, solidKeys) {
  const trunkHeight = 5 + Math.floor(random2(x - 83, z + 111) * 3);
  for (let i = 0; i < trunkHeight; i++) {
    pushBlock(state, matrices[tree.trunkType], tree.trunkType, x, y + i, z, transform, rotation, scale, THREE, solidKeys);
  }

  const top = y + trunkHeight;
  addTreeRoots(matrices, x, y, z, tree.trunkType, transform, THREE, 1);
  addBranches(matrices, x, y + Math.max(2, trunkHeight - 3), z, tree.trunkType, transform, THREE);
  addLeafLayer(state, matrices, x, top - 4, z, 2, 0.62, tree.leafType, transform, rotation, scale, THREE, solidKeys);
  addLeafLayer(state, matrices, x, top - 3, z, 2, 0.74, tree.leafType, transform, rotation, scale, THREE, solidKeys);
  addLeafLayer(state, matrices, x, top - 2, z, 1, 0.86, tree.leafType, transform, rotation, scale, THREE, solidKeys);
  addLeafLayer(state, matrices, x, top - 1, z, 1, 0.72, leafAccentType(tree.leafType, x - 5, z + 13), transform, rotation, scale, THREE, solidKeys);
  addLeafLayer(state, matrices, x, top, z, 1, 0.54, tree.leafType, transform, rotation, scale, THREE, solidKeys);
  pushBlock(state, matrices[tree.leafType], tree.leafType, x, top + 1, z, transform, rotation, scale, THREE, solidKeys);
}

function addLeafLayer(state, matrices, x, y, z, radius, density, leafType, transform, rotation, scale, THREE, solidKeys) {
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const distance = Math.abs(dx) + Math.abs(dz);
      const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
      const edge = Math.max(Math.abs(dx), Math.abs(dz)) === radius;
      const roll = random2(x + dx * 23 + y * 5, z + dz * 29 - y * 7);
      if (corner && roll < 0.7) continue;
      if (distance > radius + 1 && roll < 0.48) continue;
      if (edge && roll > density) continue;
      pushBlock(state, matrices[leafType], leafType, x + dx, y, z + dz, transform, rotation, scale, THREE, solidKeys);
    }
  }
}

function addLeafLobes(state, matrices, x, y, z, leafType, transform, rotation, scale, THREE, solidKeys) {
  const lobeCount = 2 + Math.floor(random2(x - 127, z + 149) * 3);
  const accent = leafAccentType(leafType, x + 17, z - 19);
  for (let i = 0; i < lobeCount; i++) {
    const angle = random2(x + i * 37, z - i * 41) * Math.PI * 2;
    const offset = 1 + Math.floor(random2(x - i * 43, z + i * 47) * 2);
    const lx = x + Math.round(Math.cos(angle) * offset);
    const lz = z + Math.round(Math.sin(angle) * offset);
    const ly = y + Math.floor(random2(x + i * 53, z - i * 59) * 2);
    addLeafLayer(state, matrices, lx, ly, lz, 1, 0.62, i % 2 === 0 ? leafType : accent, transform, rotation, scale, THREE, solidKeys);
  }
}

function addBranches(matrices, x, y, z, trunkType, transform, THREE) {
  const count = 2 + Math.floor(random2(x + 211, z - 233) * 2);
  for (let i = 0; i < count; i++) {
    const yaw = Math.round(random2(x + i * 67, z - i * 71) * 3) * (Math.PI / 2);
    const length = 0.58 + random2(x - i * 79, z + i * 83) * 0.34;
    const px = x + Math.sin(yaw) * 0.34;
    const pz = z + Math.cos(yaw) * 0.34;
    pushDecorationOrientedBox(matrices[trunkType], px, y + i * 0.34, pz, transform, THREE, 0.18, 0.18, length, yaw);
  }
}

function addTreeRoots(matrices, x, y, z, trunkType, transform, THREE, extraCount = 0) {
  const count = 2 + extraCount + Math.floor(random2(x - 271, z + 281) * 2);
  for (let i = 0; i < count; i++) {
    const yaw = (Math.round(random2(x + i * 89, z - i * 97) * 4) * Math.PI) / 2 + random2(x - i * 101, z + i * 103) * 0.35;
    const length = 0.52 + random2(x + i * 107, z - i * 109) * 0.36;
    const px = x + Math.sin(yaw) * (0.24 + length * 0.28);
    const pz = z + Math.cos(yaw) * (0.24 + length * 0.28);
    pushDecorationOrientedBox(matrices[trunkType], px, y + 0.12, pz, transform, THREE, 0.16, 0.14, length, yaw);
  }
}

function leafAccentType(leafType, x, z) {
  if (leafType === "snowLeaves") return random2(x + 307, z - 311) > 0.5 ? "snowLeaves" : "pineLeaves";
  if (leafType === "pineLeaves") return random2(x + 313, z - 317) > 0.5 ? "leavesTeal" : "pineLeaves";
  if (leafType === "leavesDark") return random2(x + 331, z - 337) > 0.5 ? "leaves" : "leavesTeal";
  if (leafType === "leavesLight") return random2(x + 347, z - 349) > 0.5 ? "leavesWarm" : "leaves";
  if (leafType === "leavesWarm") return random2(x + 353, z - 359) > 0.5 ? "leavesLight" : "leaves";
  return random2(x + 367, z - 373) > 0.5 ? "leavesLight" : "leavesDark";
}

function addVegetationDecoration(matrices, x, height, z, vegetation, transform, rotation, scale, THREE) {
  const type = renderTypeForBlock(vegetation);
  if (!type || !matrices[type]) return;

  if (vegetation === WorldMapBlock.Cactus) {
    const cactusHeight = 1.4 + random2(x + 601, z - 607) * 1.2;
    pushDecorationBox(matrices.cactus, x, height + 0.5 + cactusHeight * 0.5, z, transform, THREE, 0.42, cactusHeight, 0.42);
    return;
  }

  if (vegetation === WorldMapBlock.Bush || vegetation === WorldMapBlock.DeadBush || vegetation === WorldMapBlock.SnowBush) {
    addBushCluster(matrices, x, height, z, type, vegetation, transform, THREE);
    return;
  }

  if (vegetation === WorldMapBlock.GiantRoot || vegetation === WorldMapBlock.DeadWood) {
    const yaw = random2(x + 617, z - 619) * Math.PI;
    pushDecorationOrientedBox(matrices[type], x, height + 0.64, z, transform, THREE, 0.32, 0.26, 1.45, yaw);
    return;
  }

  if (vegetation === WorldMapBlock.Reed) {
    addReedCluster(matrices, x, z, height + 0.5, transform, THREE);
    return;
  }

  if (vegetation === WorldMapBlock.Mushroom) {
    addMushroomCluster(matrices, x, height, z, transform, THREE);
    return;
  }

  if (vegetation === WorldMapBlock.Coral || vegetation === WorldMapBlock.DeadCoral) {
    const count = 2 + Math.floor(random2(x - 631, z + 641) * 3);
    for (let i = 0; i < count; i++) {
      const px = x + randomOffset(x, z, 61 + i * 2) * 0.72;
      const pz = z + randomOffset(x, z, 62 + i * 2) * 0.72;
      const sy = 0.34 + random2(x + i * 643, z - i * 647) * 0.34;
      pushDecorationBox(matrices[type], px, height + 0.52 + sy * 0.5, pz, transform, THREE, 0.18, sy, 0.18);
    }
    return;
  }

  if (vegetation === WorldMapBlock.Vine) {
    const yaw = random2(x + 653, z - 659) * Math.PI;
    pushDecorationFlatPlane(matrices.vine, x + randomOffset(x, z, 63), height + 0.54, z + randomOffset(x, z, 64), transform, THREE, 0.42, 0.9, yaw);
    return;
  }

  if (vegetation === WorldMapBlock.Seaweed || vegetation === WorldMapBlock.AquaticPlant || vegetation === WorldMapBlock.SwampGrass) {
    addTuft(matrices[type], x, height, z, transform, THREE, 0.52, 0.42);
    return;
  }

  if (vegetation === WorldMapBlock.ShellBed || vegetation === WorldMapBlock.Moss || vegetation === WorldMapBlock.Lichen || vegetation === WorldMapBlock.GlowMycelium) {
    addGroundPatch(matrices[type], x, height, z, transform, THREE, 0.58, 0.32, 67);
    return;
  }

  if (vegetation === WorldMapBlock.Thorn) {
    const yaw = random2(x + 661, z - 673) * Math.PI;
    pushDecorationOrientedBox(matrices.thorn, x, height + 0.78, z, transform, THREE, 0.1, 0.72, 0.48, yaw);
    return;
  }

  addTuft(matrices[type], x, height, z, transform, THREE, 0.46, 0.34);
}

function addSurfacePlants(matrices, x, height, z, transform, THREE) {
  const moisture = random2(Math.floor(x / 6) + 31, Math.floor(z / 6) - 43);
  const flowerRoll = random2(x - 211, z + 587);

  if (flowerRoll > 0.78 && moisture > 0.14) {
    const flowerTypes = ["flowerRed", "flowerYellow", "flowerBlue", "flowerWhite"];
    const type = flowerTypes[Math.floor(random2(x + 17, z + 23) * flowerTypes.length)];
    const px = x + randomOffset(x, z, 1);
    const pz = z + randomOffset(x, z, 2);
    pushDecorationBox(matrices.flowerStem, px, height + 0.82, pz, transform, THREE, 0.14, 0.72, 0.14);
    pushDecorationBox(matrices[type], px, height + 1.25, pz, transform, THREE, 0.38, 0.38, 0.38);
  }
}

function addSurfaceDetail(matrices, budget, x, height, z, profile, treeCell, transform, THREE) {
  if ((profile.terrain === WorldMapBlock.Grass || profile.terrain === WorldMapBlock.Mud) && profile.slope <= 2 && height > 3 && !treeCell) {
    const tuftRoll = random2(x + 149, z - 173);
    const forestBoost = profile.forest > 0.55 ? 0.08 : 0;
    if (tuftRoll > 0.985 - forestBoost * 0.25 && budget.grassTuft > 0) {
      addTuft(matrices.grassPlant, x, height, z, transform, THREE, 0.46, 0.34);
      budget.grassTuft--;
    } else if (tuftRoll < 0.025 && budget.dryGrassTuft > 0) {
      addTuft(matrices.dryGrass, x, height, z, transform, THREE, 0.34, 0.26);
      budget.dryGrassTuft--;
    }

    if (profile.forest > 0.62 && budget.dryGrassTuft > 0 && random2(x - 1487, z + 1511) > 0.985) {
      addGroundPatch(matrices.dryGrass, x, height, z, transform, THREE, 0.5, 0.22, 17);
      budget.dryGrassTuft--;
    }

    if (budget.mushroom > 0 && profile.forest > 0.5 && random2(x + 2221, z - 2237) > 0.99 && isMushroomClusterCell(x, z, profile)) {
      addMushroomCluster(matrices, x, height, z, transform, THREE);
      budget.mushroom--;
    }

    if (budget.fallenLog > 0 && profile.forest > 0.74 && profile.slope <= 1 && random2(x + 1931, z - 1949) > 0.47) {
      addFallenLog(matrices, x, height, z, transform, THREE);
      budget.fallenLog--;
    }
  }

  const stonySurface = [WorldMapBlock.Stone, WorldMapBlock.DeepStone, WorldMapBlock.Gravel, WorldMapBlock.Basalt, WorldMapBlock.Ash].includes(profile.terrain);
  const sandySurface = [WorldMapBlock.Sand, WorldMapBlock.DryDirt, WorldMapBlock.SaltFlat, WorldMapBlock.Quicksand].includes(profile.terrain);
  if ((sandySurface || stonySurface) && budget.pebble > 0) {
    const shardChance = stonySurface ? 0.43 - Math.min(profile.slope, 5) * 0.018 : 1;
    const pebbleChance = stonySurface ? 0.45 : 0.495;
    if (!sandySurface && random2(x + 2099, z - 2111) > shardChance) {
      addRockShard(matrices.pebble, x, height, z, profile, transform, THREE);
      budget.pebble--;
    } else if (random2(x - 509, z + 419) > pebbleChance) {
      addPebble(matrices.pebble, x, height, z, transform, THREE);
      budget.pebble--;
    }
  }

  if (stonySurface && profile.slope <= 1 && budget.grassTuft > 0) {
    if (random2(x + 1559, z - 1571) > 0.49) {
      addGroundPatch(matrices.lichen, x, height, z, transform, THREE, 0.28, 0.2, 19);
      budget.grassTuft--;
    }
  }

  if ((profile.terrain === WorldMapBlock.Snow || profile.terrain === WorldMapBlock.FrozenSoil) && profile.slope <= 3 && budget.shoreFoam > 0 && random2(x - 1607, z + 1613) > 0.9) {
    addGroundPatch(matrices.shoreFoam, x, height, z, transform, THREE, 0.62, 0.16, 23);
    budget.shoreFoam--;
  }

  if (profile.terrain === WorldMapBlock.Sand && budget.shoreDamp > 0 && isNearWater(x, z)) {
    addShoreDamp(matrices.shoreDamp, x, height, z, transform, THREE);
    budget.shoreDamp--;
  }

  if ((profile.terrain === WorldMapBlock.Sand || profile.terrain === WorldMapBlock.Mud || profile.terrain === WorldMapBlock.Clay) && budget.reed > 0 && isNearWater(x, z)) {
    if (random2(x + 1811, z - 1823) > 0.42) {
      addReedCluster(matrices, x, z, height + 0.5, transform, THREE);
      budget.reed--;
    }
  }
}

function addWaterEdgeDetail(matrices, budget, x, z, waterY, transform, THREE) {
  if (!isNearLand(x, z)) return;

  if (budget.shoreFoam > 0 && random2(x + 1291, z - 1301) >= 0.22) {
    const sx = 0.44 + random2(x - 1319, z + 1321) * 0.34;
    const sz = 0.16 + random2(x + 1327, z - 1361) * 0.16;
    const px = x + randomOffset(x, z, 13) * 0.5;
    const pz = z + randomOffset(x, z, 14) * 0.5;
    pushDecorationFlatPlane(matrices.shoreFoam, px, waterY + waterSurfaceOffset + 0.012, pz, transform, THREE, sx, sz, random2(x + 1367, z - 1373) * Math.PI);
    budget.shoreFoam--;
  }

  if (budget.reed > 0 && random2(x - 1709, z + 1721) > 0.42) {
    addReedCluster(matrices, x, z, waterY + waterSurfaceOffset + 0.04, transform, THREE);
    budget.reed--;
  }
}

function addReedCluster(matrices, x, z, baseY, transform, THREE) {
  const count = 1 + Math.floor(random2(x + 1733, z - 1741) * 3);
  for (let i = 0; i < count; i++) {
    const px = x + randomOffset(x, z, 25 + i * 2) * 0.72;
    const pz = z + randomOffset(x, z, 26 + i * 2) * 0.72;
    const height = 0.72 + random2(x + i * 1753, z - i * 1759) * 0.5;
    pushDecorationBox(matrices.reedStem, px, baseY + height * 0.5, pz, transform, THREE, 0.08, height, 0.08);
    if (random2(x - i * 1777, z + i * 1783) > 0.38) {
      pushDecorationBox(matrices.reedTip, px, baseY + 0.06 + height, pz, transform, THREE, 0.12, 0.18, 0.12);
    }
  }
}

function addBushCluster(matrices, x, height, z, leafType, vegetation, transform, THREE) {
  const centerX = x + randomOffset(x, z, 51) * 0.8;
  const centerZ = z + randomOffset(x, z, 52) * 0.8;
  const branchType = vegetation === WorldMapBlock.SnowBush ? "pineTrunk" : vegetation === WorldMapBlock.DeadBush ? "deadWood" : "trunkDark";
  const branchCount = 3 + Math.floor(random2(x + 1649, z - 1657) * 3);

  for (let i = 0; i < branchCount; i++) {
    const yaw = random2(x + i * 1663, z - i * 1667) * Math.PI * 2;
    const pitch = -0.28 + random2(x - i * 1693, z + i * 1697) * 0.56;
    const length = 0.42 + random2(x + i * 1709, z - i * 1721) * 0.34;
    const spread = 0.08 + random2(x - i * 1723, z + i * 1733) * 0.18;
    pushDecorationAngledBox(
      matrices[branchType],
      centerX + Math.sin(yaw) * spread,
      height + 0.58 + random2(x + i * 1741, z - i * 1747) * 0.24,
      centerZ + Math.cos(yaw) * spread,
      transform,
      THREE,
      0.075,
      0.085,
      length,
      yaw,
      pitch,
    );
  }

  const leafCount = vegetation === WorldMapBlock.DeadBush ? 2 : 4 + Math.floor(random2(x - 1753, z + 1759) * 2);
  for (let i = 0; i < leafCount; i++) {
    const yaw = (i / leafCount) * Math.PI * 2 + random2(x + i * 1787, z - i * 1789) * 0.42;
    const spread = random2(x - i * 1801, z + i * 1811) * 0.18;
    const width = (vegetation === WorldMapBlock.SnowBush ? 0.46 : 0.52) + random2(x + i * 1817, z - i * 1823) * 0.18;
    const leafHeight = (vegetation === WorldMapBlock.DeadBush ? 0.34 : 0.46) + random2(x - i * 1831, z + i * 1847) * 0.18;
    pushDecorationAngledBox(
      matrices[leafType],
      centerX + Math.sin(yaw) * spread,
      height + 0.78 + random2(x + i * 1861, z - i * 1867) * 0.18,
      centerZ + Math.cos(yaw) * spread,
      transform,
      THREE,
      width,
      leafHeight,
      0.08,
      yaw,
      -0.08 + random2(x - i * 1871, z + i * 1877) * 0.16,
    );
  }
}

function addMushroomCluster(matrices, x, height, z, transform, THREE) {
  const count = 1 + Math.floor(random2(x + 1871, z - 1877) * 3);
  for (let i = 0; i < count; i++) {
    const px = x + randomOffset(x, z, 31 + i * 2) * 0.76;
    const pz = z + randomOffset(x, z, 32 + i * 2) * 0.76;
    const stemHeight = 0.16 + random2(x + i * 1889, z - i * 1901) * 0.12;
    const capWidth = 0.22 + random2(x - i * 1907, z + i * 1913) * 0.12;
    pushDecorationBox(matrices.mushroomStem, px, height + 0.52 + stemHeight * 0.5, pz, transform, THREE, 0.08, stemHeight, 0.08);
    pushDecorationBox(matrices.mushroomCap, px, height + 0.56 + stemHeight, pz, transform, THREE, capWidth, 0.1, capWidth);
  }
}

function addFallenLog(matrices, x, height, z, transform, THREE) {
  const yaw = Math.round(random2(x - 1951, z + 1973) * 7) * (Math.PI / 4);
  const length = 1.35 + random2(x + 1979, z - 1987) * 0.85;
  const px = x + randomOffset(x, z, 37) * 0.42;
  const pz = z + randomOffset(x, z, 38) * 0.42;
  const trunkType = random2(x - 1993, z + 1997) > 0.78 ? "trunkDark" : "trunk";
  pushDecorationOrientedBox(matrices[trunkType], px, height + 0.62, pz, transform, THREE, 0.28, 0.28, length, yaw);
  if (random2(x + 2003, z - 2011) > 0.36) {
    const capOffset = length * 0.52;
    pushDecorationBox(
      matrices.mushroomCap,
      px + Math.sin(yaw) * capOffset,
      height + 0.72,
      pz + Math.cos(yaw) * capOffset,
      transform,
      THREE,
      0.2,
      0.08,
      0.2,
    );
  }
}

function isMushroomClusterCell(x, z, profile) {
  const cellSize = profile.forest > 0.74 ? 10 : 14;
  const cellX = Math.floor(x / cellSize);
  const cellZ = Math.floor(z / cellSize);
  if (random2(cellX + 2027, cellZ - 2029) < (profile.forest > 0.74 ? 0.9958 : 0.9964)) return false;
  const inner = Math.max(1, cellSize - 4);
  const clusterX = cellX * cellSize + 2 + Math.floor(random2(cellX - 2039, cellZ + 2053) * inner);
  const clusterZ = cellZ * cellSize + 2 + Math.floor(random2(cellX + 2063, cellZ - 2069) * inner);
  return Math.abs(x - clusterX) <= 1 && Math.abs(z - clusterZ) <= 1 && random2(x - 2081, z + 2083) > 0.24;
}

function addTuft(list, x, height, z, transform, THREE, width, depth) {
  const px = x + randomOffset(x, z, 7) * 0.72;
  const pz = z + randomOffset(x, z, 8) * 0.72;
  const yaw = random2(x + 701, z - 733) * Math.PI;
  pushDecorationFlatPlane(list, px, height + 0.516, pz, transform, THREE, width, depth, yaw);
}

function addGroundPatch(list, x, height, z, transform, THREE, width, depth, salt) {
  const px = x + randomOffset(x, z, salt) * 0.78;
  const pz = z + randomOffset(x, z, salt + 1) * 0.78;
  const yaw = random2(x + salt * 79, z - salt * 83) * Math.PI;
  pushDecorationFlatPlane(list, px, height + 0.516, pz, transform, THREE, width, depth, yaw);
}

function addPebble(list, x, height, z, transform, THREE) {
  const px = x + randomOffset(x, z, 9) * 0.88;
  const pz = z + randomOffset(x, z, 10) * 0.88;
  const sx = 0.12 + random2(x + 941, z - 967) * 0.13;
  const sy = 0.06 + random2(x - 983, z + 997) * 0.06;
  const sz = 0.1 + random2(x + 1013, z - 1031) * 0.12;
  pushDecorationBox(list, px, height + 0.5 + sy * 0.5, pz, transform, THREE, sx, sy, sz);
}

function addRockShard(list, x, height, z, profile, transform, THREE) {
  const px = x + randomOffset(x, z, 41) * 0.82;
  const pz = z + randomOffset(x, z, 42) * 0.82;
  const yaw = random2(x - 2131, z + 2137) * Math.PI;
  const longSide = 0.22 + random2(x + 2141, z - 2143) * 0.22;
  const shortSide = 0.08 + random2(x - 2153, z + 2161) * 0.08;
  const heightScale = 0.08 + Math.min(profile.slope, 5) * 0.012 + random2(x + 2179, z - 2203) * 0.04;
  pushDecorationOrientedBox(list, px, height + 0.5 + heightScale * 0.5, pz, transform, THREE, shortSide, heightScale, longSide, yaw);
}

function addShoreDamp(list, x, height, z, transform, THREE) {
  const roll = random2(x + 1109, z - 1151);
  const sx = 0.58 + roll * 0.28;
  const sz = 0.42 + random2(x - 1171, z + 1187) * 0.28;
  const px = x + randomOffset(x, z, 11) * 0.42;
  const pz = z + randomOffset(x, z, 12) * 0.42;
  pushDecorationFlatPlane(list, px, height + 0.516, pz, transform, THREE, sx, sz, random2(x + 1201, z - 1213) * Math.PI);
}

function isNearWater(x, z) {
  return (
    hasSurfaceWater(x + 1, z) ||
    hasSurfaceWater(x - 1, z) ||
    hasSurfaceWater(x, z + 1) ||
    hasSurfaceWater(x, z - 1)
  );
}

function isNearLand(x, z) {
  return (
    !hasSurfaceWater(x + 1, z) ||
    !hasSurfaceWater(x - 1, z) ||
    !hasSurfaceWater(x, z + 1) ||
    !hasSurfaceWater(x, z - 1)
  );
}

function hasSurfaceWater(x, z) {
  const profile = terrainProfile(x, z);
  return (
    profile.height < seaLevel ||
    profile.fluid === WorldMapBlock.Water ||
    profile.fluid === WorldMapBlock.SwampWater ||
    profile.fluid === WorldMapBlock.ToxicWater ||
    profile.fluid === WorldMapBlock.Ice
  );
}

function isTreeCell(x, z, profile) {
  const density = treeDensityAt(x, z);
  if (density <= 0) return false;
  const cellSize = density > 0.62 ? 7 : 9;
  const cellX = Math.floor(x / cellSize);
  const cellZ = Math.floor(z / cellSize);
  const originX = cellX * cellSize;
  const originZ = cellZ * cellSize;
  const inner = Math.max(1, cellSize - 2);
  const treeX = originX + 1 + Math.floor(random2(cellX + 19, cellZ - 31) * inner);
  const treeZ = originZ + 1 + Math.floor(random2(cellX - 41, cellZ + 53) * inner);
  return x === treeX && z === treeZ && random2(cellX + 71, cellZ - 83) < density * 0.72 && canGrowTree(profile);
}

function randomOffset(x, z, salt) {
  return (random2(x + salt * 101, z - salt * 131) - 0.5) * 0.52;
}

function addCloudCluster(lobes, seedX, seedZ) {
  const seed = random2(seedX, seedZ);
  if (seed < 0.48) return;

  const centerX = seedX * cloudSectorSize + 12 + random2(seedX + 19, seedZ - 11) * (cloudSectorSize - 24);
  const centerZ = seedZ * cloudSectorSize + 12 + random2(seedX - 23, seedZ + 31) * (cloudSectorSize - 24);
  const baseY = cloudMinHeight + 4 + Math.floor(seed * 7);
  const mainRx = 11 + random2(seedX + 43, seedZ + 5) * 10;
  const mainRz = 8 + random2(seedX - 7, seedZ + 47) * 8;

  lobes.push({
    x: centerX,
    y: baseY,
    z: centerZ,
    rx: mainRx,
    ry: 4.2 + random2(seedX + 3, seedZ - 5) * 2.4,
    rz: mainRz,
  });

  const sideLobes = 5 + Math.floor(random2(seedX - 71, seedZ + 79) * 3);
  for (let i = 0; i < sideLobes; i++) {
    const angle = random2(seedX + i * 13, seedZ - i * 17) * Math.PI * 2;
    const offset = 7 + random2(seedX - i * 29, seedZ + i * 31) * 15;
    const size = 0.48 + random2(seedX + i * 37, seedZ + i * 41) * 0.38;
    lobes.push({
      x: centerX + Math.cos(angle) * offset,
      y: baseY - 1.2 + random2(seedX + i * 53, seedZ - i * 59) * 4,
      z: centerZ + Math.sin(angle) * offset,
      rx: mainRx * size,
      ry: 3.2 + random2(seedX - i * 43, seedZ - i * 47) * 2.5,
      rz: mainRz * (0.52 + random2(seedX + i * 61, seedZ + i * 67) * 0.32),
    });
  }
}

function pushBlock(state, list, type, x, y, z, transform, rotation, scale, THREE, solidKeys) {
  const key = blockKey(x, y, z);
  if (state.removedBlocks.has(key)) return;
  if (!isNonSolidVisualType(type)) trackGeneratedSolidKey(state, solidKeys, key);
  const visualY = isShortWaterVisualType(type) ? y + waterVisualCenterOffset : y;
  const visualScale = isShortWaterVisualType(type) ? new THREE.Vector3(1, waterVisualHeightScale, 1) : scale;
  list.push({
    matrix: composeMatrix(x, visualY, z, transform, rotation, visualScale, THREE),
    block: { x, y, z, type, key },
    tint: blockTint(type, x, y, z),
  });
}

function isNonSolidVisualType(type) {
  return type === "water" || type === "swampWater" || type === "toxicWater";
}

function isShortWaterVisualType(type) {
  return type === "water" || type === "swampWater" || type === "toxicWater";
}

function trackGeneratedSolidKey(state, solidKeys, key) {
  state.solidBlocks.add(key);
  if (!solidKeys) return;
  if (solidKeys.has(key)) return;
  solidKeys.add(key);
  if (!state.generatedSolidRefs) return;
  state.generatedSolidRefs.set(key, (state.generatedSolidRefs.get(key) ?? 0) + 1);
}

function pushMatrix(list, x, y, z, transform, rotation, scale, THREE) {
  const matrixScale = scale ?? new THREE.Vector3(1, 1, 1);
  list.push({
    matrix: composeMatrix(x, y, z, transform, rotation, matrixScale, THREE),
    block: null,
  });
}

function pushWaterVisualMatrix(list, x, y, z, transform, rotation, scale, THREE) {
  list.push({
    matrix: composeMatrix(x, y + waterVisualCenterOffset, z, transform, rotation, scale, THREE),
    block: null,
    tint: blockTint("water", x, y, z),
  });
}

function pushDecorationBox(list, x, y, z, transform, THREE, sx, sy, sz) {
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3(sx, sy, sz);
  list.push({
    matrix: composeMatrix(x, y, z, transform, rotation, scale, THREE),
    block: null,
  });
}

function pushDecorationOrientedBox(list, x, y, z, transform, THREE, sx, sy, sz, yaw = 0) {
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const scale = new THREE.Vector3(sx, sy, sz);
  list.push({
    matrix: composeMatrix(x, y, z, transform, rotation, scale, THREE),
    block: null,
  });
}

function pushDecorationAngledBox(list, x, y, z, transform, THREE, sx, sy, sz, yaw = 0, pitch = 0) {
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
  const scale = new THREE.Vector3(sx, sy, sz);
  list.push({
    matrix: composeMatrix(x, y, z, transform, rotation, scale, THREE),
    block: null,
  });
}

function pushDecorationFlatPlane(list, x, y, z, transform, THREE, sx, sz, yaw = 0) {
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const scale = new THREE.Vector3(sx, 1, sz);
  list.push({
    matrix: composeMatrix(x, y, z, transform, rotation, scale, THREE),
    block: null,
  });
}

function pushSourceWaterRects(list, chunkX, chunkZ, sourceWaterCells, waterY, transform, rotation, THREE) {
  const water = Array.from({ length: chunkSize }, () => Array(chunkSize).fill(false));
  for (const [localX, localZ] of sourceWaterCells) water[localZ][localX] = true;

  const used = Array.from({ length: chunkSize }, () => Array(chunkSize).fill(false));
  for (let localZ = 0; localZ < chunkSize; localZ++) {
    for (let localX = 0; localX < chunkSize; localX++) {
      if (!water[localZ][localX] || used[localZ][localX]) continue;

      let width = 1;
      while (localX + width < chunkSize && water[localZ][localX + width] && !used[localZ][localX + width]) {
        width++;
      }

      let depth = 1;
      let canGrow = true;
      while (localZ + depth < chunkSize && canGrow) {
        for (let dx = 0; dx < width; dx++) {
          if (!water[localZ + depth][localX + dx] || used[localZ + depth][localX + dx]) {
            canGrow = false;
            break;
          }
        }
        if (canGrow) depth++;
      }

      for (let dz = 0; dz < depth; dz++) {
        for (let dx = 0; dx < width; dx++) {
          used[localZ + dz][localX + dx] = true;
        }
      }

      pushWaterRect(
        list,
        chunkX,
        chunkZ,
        localX,
        localZ,
        localX + width - 1,
        localZ + depth - 1,
        waterY,
        transform,
        rotation,
        THREE,
      );
    }
  }
}

function pushWaterRect(list, chunkX, chunkZ, startX, startZ, endX, endZ, waterY, transform, rotation, THREE) {
  const width = endX - startX + 1;
  const depth = endZ - startZ + 1;
  const centerX = chunkX * chunkSize + startX + (width - 1) * 0.5;
  const centerZ = chunkZ * chunkSize + startZ + (depth - 1) * 0.5;
  const scale = new THREE.Vector3(width, 1, depth);
  list.push({
    matrix: composeMatrix(centerX, waterY + waterSurfaceOffset, centerZ, transform, rotation, scale, THREE),
    block: null,
  });
}

function composeMatrix(x, y, z, transform, rotation, scale, THREE) {
  transform.compose(new THREE.Vector3(x, y, z), rotation, scale);
  return transform.clone();
}

function random2(x, z) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(currentWorldSeed() | 0, 2246822519);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export function blockTint(type, x, y, z) {
  const tone = random2(x + y * 17, z - y * 31);
  const fleck = random2(x - y * 7 + 311, z + y * 13 - 197);
  let shade = 0.965 + tone * 0.07;
  let warm = 1;
  let cool = 1;

  if (type === "water" || type === "swampWater" || type === "toxicWater") {
    const profile = terrainProfile(x, z);
    const waterSurface = profile.noise.waterSurfaceHeight;
    const waterFloor = profile.noise.waterFloorHeight;
    const depth = waterSurface !== null && waterFloor !== null ? Math.max(1, waterSurface - waterFloor) : 1;
    const depthFactor = Math.min(1, (depth - 1) / 3);
    shade = 1.05 - depthFactor * 0.34 + tone * 0.035;
    warm = 0.9 - depthFactor * 0.28;
    cool = 1.08 + depthFactor * 0.18 + fleck * 0.025;
  } else if (type === "sand" || type === "sandstone" || type === "quicksand") {
    warm = 0.985 + fleck * 0.045;
    cool = 0.965 + tone * 0.035;
    if (type === "quicksand") {
      shade = 0.9 + tone * 0.065;
      warm = 0.9 + fleck * 0.045;
      cool = 0.82 + tone * 0.04;
    }
  } else if (type === "saltFlat") {
    shade = 0.98 + tone * 0.05;
    warm = 1.02 + fleck * 0.025;
    cool = 0.96 + tone * 0.025;
  } else if (type === "grass" || type.includes("leaves")) {
    warm = 0.94 + tone * 0.055;
    cool = 0.96 + fleck * 0.08;
    shade = 0.95 + tone * 0.09;
  } else if (type === "snow" || type === "ice") {
    warm = 0.96 + tone * 0.035;
    cool = type === "ice" ? 1.08 + fleck * 0.08 : 1.015 + fleck * 0.055;
    shade = 0.97 + tone * 0.055;
  } else if (type === "frozenSoil") {
    shade = 0.92 + tone * 0.08;
    warm = 0.86 + fleck * 0.04;
    cool = 1.02 + tone * 0.06;
  } else if (type === "stone" || type === "deepStone" || type === "gravel" || type === "basalt" || type === "ash" || type === "bedrock") {
    shade = 0.93 + tone * 0.11;
    warm = 0.97 + fleck * 0.035;
    cool = 0.97 + tone * 0.06;
    if (type === "deepStone") {
      warm = 0.86 + fleck * 0.03;
      cool = 1.06 + tone * 0.08;
    } else if (type === "basalt" || type === "bedrock") {
      shade = 0.86 + tone * 0.1;
      warm = 0.9 + fleck * 0.03;
      cool = 1.02 + tone * 0.04;
    } else if (type === "ash") {
      shade = 0.98 + tone * 0.08;
      warm = 1.0 + fleck * 0.035;
      cool = 0.94 + tone * 0.04;
    } else if (type === "gravel") {
      shade = 0.9 + tone * 0.14;
    }
  } else if (type === "clay") {
    shade = 0.94 + tone * 0.08;
    warm = 1.05 + fleck * 0.04;
    cool = 0.88 + tone * 0.04;
  } else if (type === "mud") {
    shade = 0.82 + tone * 0.09;
    warm = 0.9 + fleck * 0.035;
    cool = 0.78 + tone * 0.035;
  } else if (type === "dryDirt") {
    shade = 0.94 + tone * 0.08;
    warm = 1.08 + fleck * 0.05;
    cool = 0.82 + tone * 0.03;
  } else if (type.startsWith("trunk")) {
    shade = 0.91 + tone * 0.12;
    warm = 1.01 + fleck * 0.055;
    cool = 0.91 + tone * 0.035;
  }

  return [shade * warm, shade, shade * cool];
}
