import { blockKey } from "./keys.js";
import { getGeneratedBlock, terrainHeight } from "./generator.js";
import { WorldMapBlock } from "./blocks.js";

export function createWorldState() {
  return {
    solidBlocks: new Set(),
    generatedSolidRefs: new Map(),
    removedBlocks: new Set(),
    placedBlocks: new Map(),
    dynamicWater: new Set(),
    blockDamage: new Map(),
  };
}

export function isSolidCell(state, x, y, z) {
  const key = blockKey(x, y, z);
  return state.solidBlocks.has(key) && !state.removedBlocks.has(key);
}

export function surfaceHeight(state, x, z) {
  const blockX = Math.round(x);
  const blockZ = Math.round(z);
  let top = terrainHeight(blockX, blockZ);
  for (const [key] of state.placedBlocks) {
    const [px, py, pz] = key.split(",").map(Number);
    if (px === blockX && pz === blockZ && py > top && !state.removedBlocks.has(key)) top = py;
  }
  for (let y = top; y >= 0; y--) {
    const key = blockKey(blockX, y, blockZ);
    if (state.placedBlocks.has(key) && !state.removedBlocks.has(key)) return y;
    if (state.removedBlocks.has(key)) continue;
    const block = getGeneratedBlock(blockX, y, blockZ);
    if (block?.terrain && !isWaterTerrain(block.terrain)) return y;
  }
  return 0;
}

function isWaterTerrain(block) {
  return block === WorldMapBlock.Water || block === WorldMapBlock.SwampWater || block === WorldMapBlock.ToxicWater || block === WorldMapBlock.Ice;
}
