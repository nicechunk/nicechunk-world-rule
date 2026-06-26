import { chunkSize, detailRenderDistance, landBaseHeight, renderDistance, seaLevel } from "../world/config.js";
import { bedrockMaxY, deepStoneStartY, maxVisualWaterDepth } from "../world/generator.js";

export const worldAlgorithmRuleSet = "nicechunk-world-generation-v1";

export const worldAlgorithmPipelineStepIds = [
  "hashSeed",
  "sampleFields",
  "buildHeight",
  "chooseBiome",
  "answerBlocks",
];

export const worldAlgorithmBiomePriorityIds = [
  "ocean",
  "river",
  "lake",
  "beach",
  "volcano",
  "snowfield",
  "mountain",
  "swamp",
  "wetland",
  "tundra",
  "desert",
  "rainforest",
  "forest",
  "plains",
];

export const worldAlgorithmRuleSections = [
  { id: "generation", titleKey: "rules.generationTitle" },
  { id: "blocks", titleKey: "rules.blockTitle" },
];

export function getWorldAlgorithmSpec() {
  const preloadRenderDistance = renderDistance + 3;
  return {
    ruleSet: worldAlgorithmRuleSet,
    pipelineStepIds: worldAlgorithmPipelineStepIds,
    biomePriorityIds: worldAlgorithmBiomePriorityIds,
    sections: worldAlgorithmRuleSections,
    rules: {
      generation: [
        {
          id: "deterministicSeed",
          code: "worldSeed = hashSeed(seed)\nrandom2(x, z) = hash(x, z, worldSeed)\ncache.clear() when seed changes",
        },
        {
          id: "noiseToolkit",
          code: "valueNoise = smoothed grid random\nfbm = layered valueNoise\nridgeNoise = 1 - abs(valueNoise)\nsmoothstep = soft threshold",
        },
        {
          id: "columnProfile",
          code: "profile(x, z):\n  groundHeight = rawTerrainHeight(x, z)\n  slope = max(neighbor height delta)\n  sample = climate + erosion + weirdness + volcanic + corruption\n  biome = chooseBiome(...)\n  terrain/fluid/vegetation = surface rules",
        },
        {
          id: "continentOceanMask",
          code: "continent = oceanBasins * 0.78 + detail * 0.34 + coastalWarp + 0.12\nshelf = smoothstep(-0.36, 0.14, continent)\ninland = smoothstep(-0.06, 0.56, continent)",
        },
        {
          id: "baseLandHeight",
          code: `oceanFloor = seaLevel - 10 + seabedNoise\ncoastHeight = seaLevel - 1 + shelf * (landBaseHeight - seaLevel + 1)\nlandHeight = landBaseHeight + inland * 4 + lowlandRelief + dunes\n\nchunkSize = ${chunkSize}, seaLevel = ${seaLevel}, landBaseHeight = ${landBaseHeight}`,
        },
        {
          id: "lowlandRelief",
          code: "lowlandRelief = inland * (plains + lowHills + rollingRelief + dryWash + microRidges)",
        },
        {
          id: "desertDunes",
          code: "desert = smoothstep(-0.46, 0.18, desertMass * 1.25 + temperature * 0.44 - moisture * 0.28)\ndunes = inland * smoothstep(0.24, 0.72, desert) * duneNoise",
        },
        {
          id: "riverCanyonLakeCarving",
          code: "riverCut = smoothstep(0.9, 0.985, riverAt(x, z))\ncanyonCut = smoothstep(0.72, 0.94, canyonAt(x, z)) * inland\nlakeCarve = smoothstep(0.78, 0.96, lakeAt(x, z)) * basinDepth",
        },
        {
          id: "mountainCells",
          code: "cellSize = 192\npresence = random2(cellX + 811, cellZ - 433)\nif presence < 0.36: no mountain\nsearch nearby cells for overlapping mountains",
        },
        {
          id: "mountainShape",
          code: "longRadius = radius * random(0.78..1.60)\nshortRadius = radius * random(0.38..0.84)\nangle = random * PI\nwarp = radius * random(0.035..0.11)",
        },
        {
          id: "mountainHeightTexture",
          code: "radius starts 72..168 and can grow up to 8 times\nheight starts 12..27 and can grow up to 520 one-block attempts\nlocalHeight = base + height * (shoulder + spine + crag + summitNoise)",
        },
        {
          id: "slopeLimiter",
          code: "allowedStep = manhattanDistance * lerp(1.05, 4.4 + roughness * 1.4, mountainWeight)\nconstrainedHeight = min(rawHeight, neighborRaw + allowedStep)",
        },
        {
          id: "heightNormalization",
          code: "if rawHeight < seaLevel: keep underwater height\nelse if rawHeight < landBaseHeight: clamp to at least seaLevel + 1\nelse clamp to at least landBaseHeight",
        },
        {
          id: "climateSampling",
          code: "temperature = fbm(0.0032 scale) + broad sine/cosine bands\nmoisture = fbm(0.0038 scale) + broad sine/cosine bands\nvalues are clamped to -1..1",
        },
        {
          id: "biomePriority",
          code: "Ocean -> River -> Lake -> Ocean edge -> Beach -> Volcano -> Snowfield -> Mountain -> Swamp -> Wetland -> Tundra -> Desert -> Rainforest -> Forest -> Plains",
        },
        {
          id: "waterProfile",
          code: "surfaceFluid = getSurfaceFluidBlock(...)\nwaterSurfaceHeight = seaLevel for ocean/underwater\nwaterFloorHeight = surface - visualDepth\nwaterLevel may rise above terrain for lake/river/swamp/wetland",
        },
        {
          id: "caveCells",
          code: `if y >= surfaceHeight - 3 or y <= bedrock: no cave\ncaveNoise = ridgeNoise(x * 0.052 + y * 0.013, z * 0.052 - y * 0.017)\nthreshold = depth > 18 ? 0.72 : 0.84\n\nbedrockMaxY = ${bedrockMaxY}`,
          action: { id: "findNearestCave" },
        },
        {
          id: "chunkRenderingStrategy",
          code: `visible radius = ${renderDistance} chunks\nnear radius = ${detailRenderDistance} chunk full detail\nfar visible chunks = distant detail\npreload radius = ${preloadRenderDistance} chunks surface detail`,
        },
      ],
      blocks: [
        {
          id: "depthLayers",
          code: `y <= ${bedrockMaxY} -> bedrock\ny < ${deepStoneStartY} -> deepStone with low-frequency coal seams\ny < surfaceY - 6 -> stone or basalt\nnear surface -> biome subsurface\nsurfaceY -> biome surface`,
        },
        {
          id: "waterEdgeSurfaces",
          code: "Ocean: shellBed/clay/sand/gravel\nBeach: shellBed/gravel/sand\nRiver: gravel/clay/sand\nLake: clay/sand/gravel",
        },
        {
          id: "volcanoSurface",
          code: "if volcanic > 0.96 and roll > 0.92 -> lava\nelse basalt / ash / stone",
        },
        {
          id: "coldMountainSurfaces",
          code: "Mountain: high/cold -> snow or stone, steep -> gravel or stone, gentle -> grass or stone\nSnowfield: snow/frozenSoil/ice\nTundra: frozenSoil/snow",
        },
        {
          id: "desertSurface",
          code: "if roll > 0.52 or weirdness < -0.68 -> quicksand\nelse saltFlat / dryDirt / sand",
        },
        {
          id: "swampWetlandSurfaces",
          code: "Swamp: toxicWater / swampWater / mud / clay\nWetland: clay / mud / grass",
        },
        {
          id: "landSurfaces",
          code: "Rainforest: mud or grass, rare moss\nForest: grass, rare moss when humid\nPlains: grass, with dryDirt or clay when humidity is extreme",
        },
        {
          id: "subsurfaceRules",
          code: "Desert/Beach -> sand/gravel/stone\nWet biomes -> clay/mud/stone\nSnow/Tundra -> frozenSoil/stone\nVolcano -> basalt/lava/stone\nDefault -> dirt/gravel/clay",
        },
        {
          id: "naturalFluids",
          code: "Volcano vent -> lava\nRiver/Lake -> water\nSwamp -> swampWater\nWetland chance -> water\nunder seaLevel -> water/ice/toxicWater/swampWater",
        },
        {
          id: "fluidHeight",
          code: "Lava level = terrain height\nOcean/underwater level = seaLevel\nLake level = height + 2..4\nRiver level = height + 1..2\nSwamp/Wetland level = height + 1",
        },
        {
          id: "waterDepthRendering",
          code: `Ocean depth = clamp(seaLevel - groundHeight, 1, ${maxVisualWaterDepth})\nRiver depth grows near erosion center\nLake depth grows near basin center\nSwamp/Wetland depth = 1`,
        },
        {
          id: "aquaticDecoration",
          code: "Ocean: warm shallow water can spawn coral\nOcean: cold/corrupted water can spawn dead coral\nSwamp/Wetland/River/Lake: rare reeds",
        },
        {
          id: "dryHotVegetation",
          code: "Desert on sand/dryDirt/ash:\n  cactus, deadBush, thorn, dryGrass by roll thresholds",
        },
        {
          id: "wetForestVegetation",
          code: "Swamp/Wetland: moss, vine, reed, rare mushroom\nRainforest: giantRoot, moss, vine, rare mushroom, bush\nForest: bush, vine, rare mushroom, grassPlant",
        },
        {
          id: "coldMountainVegetation",
          code: "Snowfield/Tundra: snowBush or lichen\nMountain: snowBush when cold, otherwise lichen or bush\nslope > 4 blocks most non-mountain vegetation",
        },
        {
          id: "treeDensity",
          code: "treeDensity = forestFloor * (1 - altitudePenalty) + meadowTrees + biomeBoost\nblocked if biome cannot grow trees, slope > 3, or height <= 4",
        },
        {
          id: "treeTypeLeaves",
          code: "pine when cold/high/mountain/snow or seed roll says evergreen\ntrunkType = pineTrunk / giantRoot / deadWood / trunk\nleafType = pine, snow, teal, dark, light, warm, or normal leaves",
        },
        {
          id: "caveWallBlocks",
          code: `adjacent open cave -> cave wall\nif y < ${deepStoneStartY} -> deep cave\nrare lava in deep or volcanic caves\nrare toxic water in corrupted caves\nwall = coal seam, deepStone, or stone, sometimes gravel`,
        },
        {
          id: "caveDecoration",
          code: "deep cave and floorNoise > 0.45 -> glowMycelium\nhumid rare roll -> mushroom\notherwise lichen or moss by floorNoise and humidity",
        },
        {
          id: "generatedBlockQuery",
          code: "getGeneratedBlock(x, y, z):\n  water above surface when inside fluid level\n  null above terrain and above seaLevel\n  cave cells return null\n  cave-adjacent cells return cave walls\n  otherwise return terrain by depth",
        },
      ],
    },
  };
}
