import { Buffer } from "buffer";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionExpiredBlockheightExceededError,
  TransactionInstruction,
} from "@solana/web3.js";
import { EMPTY_BLOCK, WorldMapBlock, renderTypeForBlock } from "../world/blocks.js";
import { canonicalBlockIdAt, isCanonicalMineableBlockId } from "../world/canonicalResource.js";
import { chunkSize, minBuildY } from "../world/config.js";
import { resourceDropRules, resourceDropRuleSet } from "../data/resourceDropRules.js";
import { createNicechunkRpcFetch, getNicechunkRpcUrl, reportRpcError, rpcConfigChangedEventName } from "../rpcConfig.js";
import { assertNicechunkWalletNetwork, solanaClusterLabel } from "../solanaNetwork.js";

if (!globalThis.Buffer) globalThis.Buffer = Buffer;

const coreProgramId = new PublicKey("9EhMCRYMJej1F21KzaA5Zao3khGGc5aJbDGbnxaogQHu");
const playerProgramId = new PublicKey("oeaRMVnPoV4iENnGCCtaEeRxU5be515s4YYe6aXQuKe");
const gameProgramId = new PublicKey("6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7");
const gameNamespaceBackpack = 1;
const gameNamespaceChunk = 2;
const gameNamespaceSmelting = 3;
const gameNamespaceMarket = 4;
const globalConfigSeed = "global-config";
const playerSeed = "player";
const playerSessionSeed = "session";
const chunkBrokenSeed = "chunk-broken";
const resourceDropTableSeed = "resource-drops-v2";
const playerProgressSeed = "player-progress";
const backpackSeed = "backpack";
const marketListingSeed = "listing";
const marketAuthoritySeed = "market-authority";
const smeltingRecipeTableSeed = "smelting-recipes";
const smeltingAuthoritySeed = "smelting-authority";
const smeltingDefaultRecipeTableId = 20n;
const globalConfigLength = 293;
const globalConfigMagic = "NCKCFG01";
const worldConfigStorageKey = "nicechunk.worldConfig.v1";
const legacyPlayerProfileLength = 417;
const playerProfileLength = 449;
const playerLoadoutSeed = "loadout";
const playerLoadoutMagic = "NCKLOD01";
const playerLoadoutSlotCount = 8;
const playerLoadoutSlotRightHand = 7;
const playerLoadoutSlotCodeMaxLength = 1248;
const playerLoadoutHeaderLength = 128;
const playerLoadoutSlotHeaderLength = 8;
const playerLoadoutSlotRecordLength = playerLoadoutSlotHeaderLength + playerLoadoutSlotCodeMaxLength;
const playerLoadoutLength = playerLoadoutHeaderLength + playerLoadoutSlotCount * playerLoadoutSlotRecordLength;
const chunkBrokenMagic = "NCBK";
const chunkBrokenHeaderLength = 16;
const chunkBrokenRecordLength = 3;
const resourceDropRuleLength = 23;
const resourceDropTableHeaderLength = 16;
const playerProgressMagic = "NCKPRG01";
const playerProgressLength = 128;
const playerProgressPrecisionXpOffset = 76;
const playerProgressSmeltingXpOffset = 108;
const playerProgressExplorationXpOffset = 116;
const backpackMagic = "NCKBPK01";
const backpackLegacyVersion = 1;
const backpackVersion = 2;
const backpackDefaultCapacity = 50;
const backpackMaxCapacity = 99;
const backpackHeaderLength = 128;
const backpackLegacyRecordLength = 10;
const backpackSlotRecordLength = 64;
const backpackRecordLength = backpackSlotRecordLength;
const backpackLegacyAccountLength = backpackHeaderLength + backpackMaxCapacity * backpackLegacyRecordLength;
const backpackAccountLength = backpackHeaderLength + backpackMaxCapacity * backpackRecordLength;
const backpackSlotKindBlock = 1;
const backpackSlotKindItem = 2;
const backpackPackedYBits = 9;
const backpackPackedYMask = (1 << backpackPackedYBits) - 1;
const marketListingMagic = "NCKMKT01";
const marketListingLength = 216;
const marketListingStateOffset = 11;
const marketListingSellerOffset = 12;
const marketListingCategoryOffset = 52;
const marketListingCurrencyOffset = 53;
const marketListingSourceKindOffset = 54;
const marketAssetMagic = "NCKAST01";
const marketAssetPayloadLength = 96;
const marketAssetLength = 256;
const marketStateNames = new Map([
  [1, "active"],
  [2, "canceled"],
  [3, "sold"],
]);
const marketStateCodes = new Map(Array.from(marketStateNames.entries()).map(([code, key]) => [key, code]));
const marketCategoryCodes = new Map([
  ["raw", 1],
  ["equipment", 2],
  ["building", 3],
  ["clothing", 4],
]);
const marketCategoryNames = new Map(Array.from(marketCategoryCodes.entries()).map(([key, code]) => [code, key]));
const marketCurrencyCodes = new Map([
  ["NCK", 1],
  ["SOL", 2],
]);
const marketCurrencyNames = new Map(Array.from(marketCurrencyCodes.entries()).map(([key, code]) => [code, key]));
const marketSourceKindCodes = new Map([
  ["backpack", 1],
  ["asset", 2],
]);
const marketSourceKindNames = new Map(Array.from(marketSourceKindCodes.entries()).map(([key, code]) => [code, key]));
const marketDynamicAssetItemCode = 65535;
const marketAssetItemCodes = new Map([
  ["iron_pickaxe", 1],
  ["dirt", 2],
  ["stone", 3],
  ["sand", 4],
  ["trunk", 5],
  ["leaves", 6],
  ["red_flower", 7],
  ["forged_item", 8],
  ["backpack_resource", 9],
]);
const marketAssetItemIds = new Map(Array.from(marketAssetItemCodes.entries()).map(([key, code]) => [code, key]));
const marketCurrencyDecimals = new Map([
  ["NCK", 6],
  ["SOL", 9],
]);
const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const nckMint = new PublicKey("HSnWF5kjkWVrceW2SaSskScuLveUZE4gpthZ2ZXRPQPo");
const marketTreasury = new PublicKey("CtPV2vmqNNwUSfMu5nz58ZtMPy6ZvxL4LyNdPHVW7WvF");
const storageWalletKey = "nicechunk.walletAddress";
const chainSyncStorageKey = "nicechunk.chainSync";
const equippedBackpackStorageKeyPrefix = "nicechunk.equippedBackpack.v1.";
const sessionStorageKeyPrefix = "nicechunk.session.v1.";
const sessionFundingStorageKeyPrefix = "nicechunk.sessionFundingLamports.v1.";
const sessionFundingAcknowledgedKeyPrefix = "nicechunk.sessionFundingAcknowledged.v1.";
const sessionDurationSeconds = 8 * 60 * 60;
const sessionRefreshSkewSeconds = 15 * 60;
const lamportsPerSol = 1_000_000_000;
const minimumSessionFundingLamports = 100_000_000;
const sessionMinimumMiningLamports = 8_000_000;
const sessionAllowedActions = (1 << 1) | (1 << 2);
const sessionMaxActions = 10_000;
const miningComputeUnitLimit = 1_400_000;
const transactionConfirmationPollMs = 500;
const transactionBlockHeightPollMs = 1_000;
const transactionConfirmationTimeoutMs = 60_000;
const treeFellMaxChunkCount = 4;
const treeFellLeafRadius = 2;
const supportCollapseMaxOnChainBlocks = 48;
const chunkDeltaCacheTtlMs = 60_000;
const gameplaySessionStatusCacheTtlMs = 60_000;
const gameplaySessionReadyCacheTtlMs = 5 * 60_000;
const resourceDropTableCacheTtlMs = 10 * 60_000;
const chunkDeltaCache = new Map();
const initializedChunkBrokenCache = new Set();
const gameplaySessionStatusCache = new Map();
const gameplaySessionReadyCache = new Map();
const resourceDropTableReadyAtByProgram = new Map();
let resourceDropTableReadyPromise = null;

const blockIdByRenderType = new Map([
  ["grass", WorldMapBlock.Grass],
  ["dirt", WorldMapBlock.Dirt],
  ["stone", WorldMapBlock.Stone],
  ["deepStone", WorldMapBlock.DeepStone],
  ["coal", WorldMapBlock.Coal],
  ["sand", WorldMapBlock.Sand],
  ["sandstone", WorldMapBlock.Sand],
  ["gravel", WorldMapBlock.Gravel],
  ["clay", WorldMapBlock.Clay],
  ["mud", WorldMapBlock.Mud],
  ["dryDirt", WorldMapBlock.DryDirt],
  ["saltFlat", WorldMapBlock.SaltFlat],
  ["snow", WorldMapBlock.Snow],
  ["ice", WorldMapBlock.Ice],
  ["frozenSoil", WorldMapBlock.FrozenSoil],
  ["basalt", WorldMapBlock.Basalt],
  ["ash", WorldMapBlock.Ash],
  ["bedrock", WorldMapBlock.Bedrock],
  ["water", WorldMapBlock.Water],
  ["swampWater", WorldMapBlock.SwampWater],
  ["toxicWater", WorldMapBlock.ToxicWater],
  ["lava", WorldMapBlock.Lava],
  ["quicksand", WorldMapBlock.Quicksand],
  ["trunk", WorldMapBlock.Trunk],
  ["trunkDark", WorldMapBlock.Trunk],
  ["leaves", WorldMapBlock.Leaves],
  ["leavesDark", WorldMapBlock.Leaves],
  ["leavesLight", WorldMapBlock.Leaves],
  ["leavesTeal", WorldMapBlock.Leaves],
  ["leavesWarm", WorldMapBlock.Leaves],
  ["pineTrunk", WorldMapBlock.PineTrunk],
  ["pineLeaves", WorldMapBlock.PineLeaves],
  ["deadWood", WorldMapBlock.DeadWood],
  ["giantRoot", WorldMapBlock.GiantRoot],
  ["grassPlant", WorldMapBlock.GrassPlant],
  ["dryGrass", WorldMapBlock.DryGrass],
  ["bush", WorldMapBlock.Bush],
  ["deadBush", WorldMapBlock.DeadBush],
  ["cactus", WorldMapBlock.Cactus],
  ["reed", WorldMapBlock.Reed],
  ["swampGrass", WorldMapBlock.SwampGrass],
  ["snowBush", WorldMapBlock.SnowBush],
  ["thorn", WorldMapBlock.Thorn],
  ["moss", WorldMapBlock.Moss],
  ["lichen", WorldMapBlock.Lichen],
  ["vine", WorldMapBlock.Vine],
  ["glowMycelium", WorldMapBlock.GlowMycelium],
  ["mushroom", WorldMapBlock.Mushroom],
  ["seaweed", WorldMapBlock.Seaweed],
  ["aquaticPlant", WorldMapBlock.AquaticPlant],
  ["coral", WorldMapBlock.Coral],
  ["deadCoral", WorldMapBlock.DeadCoral],
  ["shellBed", WorldMapBlock.ShellBed],
]);
const renderTypeByBlockId = new Map(
  Array.from(blockIdByRenderType.entries()).map(([renderType, blockId]) => [blockId, renderType]),
);

let connection = null;
let connectionRpcUrl = "";
let globalConfigPda = null;

export function getNicechunkConnection() {
  const rpcUrl = getNicechunkRpcUrl();
  if (!connection || connectionRpcUrl !== rpcUrl) {
    connection = new Connection(rpcUrl, {
      commitment: "confirmed",
      fetch: createNicechunkRpcFetch("nicechunk-chain"),
    });
    connectionRpcUrl = rpcUrl;
  }
  return connection;
}

if (typeof window !== "undefined") {
  window.addEventListener(rpcConfigChangedEventName, () => {
    connection = null;
    connectionRpcUrl = "";
    clearChainReadCaches();
  });
}

function clearChainReadCaches() {
  chunkDeltaCache.clear();
  initializedChunkBrokenCache.clear();
  gameplaySessionStatusCache.clear();
  gameplaySessionReadyCache.clear();
  resourceDropTableReadyAtByProgram.clear();
  resourceDropTableReadyPromise = null;
}

export function deriveGlobalConfigPda() {
  if (!globalConfigPda) {
    [globalConfigPda] = PublicKey.findProgramAddressSync([Buffer.from(globalConfigSeed)], coreProgramId);
  }
  return globalConfigPda;
}

export async function loadGlobalConfig({ useCache = true } = {}) {
  const globalConfig = deriveGlobalConfigPda();
  try {
    const account = await getNicechunkConnection().getAccountInfo(globalConfig, "confirmed");
    if (!account?.data?.length) throw new Error("GlobalConfig account was not found.");
    const decoded = decodeGlobalConfig(account.data);
    const config = {
      ...decoded,
      programId: coreProgramId.toBase58(),
      globalConfig: globalConfig.toBase58(),
      loadedAt: Date.now(),
    };
    if (hasLocalStorage()) {
      localStorage.setItem(worldConfigStorageKey, JSON.stringify(serializeGlobalConfigForStorage(config)));
    }
    return config;
  } catch (error) {
    reportRpcError(error, "global-config");
    if (!useCache) throw error;
    const cached = loadCachedGlobalConfig();
    if (cached) return { ...cached, fromCache: true, loadError: error };
    throw error;
  }
}

export function loadCachedGlobalConfig() {
  try {
    if (!hasLocalStorage()) return null;
    const raw = localStorage.getItem(worldConfigStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.magic !== globalConfigMagic || !parsed.worldSeedHex) return null;
    return {
      ...parsed,
      worldSeed: Buffer.from(parsed.worldSeedHex, "hex"),
      fromCache: true,
    };
  } catch {
    return null;
  }
}

function hasLocalStorage() {
  return typeof localStorage !== "undefined";
}

export function derivePlayerProfilePda(owner) {
  return PublicKey.findProgramAddressSync([Buffer.from(playerSeed), owner.toBuffer()], playerProgramId);
}

export function derivePlayerLoadoutPda(owner) {
  return PublicKey.findProgramAddressSync([Buffer.from(playerLoadoutSeed), owner.toBuffer()], playerProgramId);
}

export function derivePlayerSessionPda(owner, sessionAuthority) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(playerSessionSeed), owner.toBuffer(), sessionAuthority.toBuffer()],
    playerProgramId,
  );
}

function deriveChunkBrokenPdaForProgram(chunkX, chunkZ, programId = gameProgramId) {
  const chunkXBytes = Buffer.alloc(4);
  const chunkZBytes = Buffer.alloc(4);
  chunkXBytes.writeInt32LE(chunkX, 0);
  chunkZBytes.writeInt32LE(chunkZ, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(chunkBrokenSeed), deriveGlobalConfigPda().toBuffer(), chunkXBytes, chunkZBytes],
    programId,
  );
}

export function deriveChunkBrokenPda(chunkX, chunkZ) {
  return deriveChunkBrokenPdaForProgram(chunkX, chunkZ, gameProgramId);
}

export function deriveGameChunkBrokenPda(chunkX, chunkZ) {
  return deriveChunkBrokenPdaForProgram(chunkX, chunkZ, gameProgramId);
}

function deriveResourceDropTablePdaForProgram(programId = gameProgramId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(resourceDropTableSeed), deriveGlobalConfigPda().toBuffer()],
    programId,
  );
}

function derivePlayerProgressPdaForProgram(owner, programId = gameProgramId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(playerProgressSeed), deriveGlobalConfigPda().toBuffer(), owner.toBuffer()],
    programId,
  );
}

export function deriveResourceDropTablePda() {
  return deriveResourceDropTablePdaForProgram(gameProgramId);
}

export function deriveGameResourceDropTablePda() {
  return deriveResourceDropTablePdaForProgram(gameProgramId);
}

export function derivePlayerProgressPda(owner) {
  return derivePlayerProgressPdaForProgram(owner, gameProgramId);
}

function deriveBackpackPdaForProgram(owner, backpackId, programId = gameProgramId) {
  const backpackIdBytes = Buffer.alloc(8);
  backpackIdBytes.writeBigUInt64LE(BigInt(backpackId), 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(backpackSeed), owner.toBuffer(), backpackIdBytes],
    programId,
  );
}

export function deriveBackpackPda(owner, backpackId) {
  return deriveBackpackPdaForProgram(owner, backpackId, gameProgramId);
}

export function deriveGameBackpackPda(owner, backpackId) {
  return deriveBackpackPdaForProgram(owner, backpackId, gameProgramId);
}

function deriveMarketListingPdaForProgram(seller, listingId, programId = gameProgramId) {
  const listingIdBytes = Buffer.alloc(8);
  listingIdBytes.writeBigUInt64LE(BigInt(listingId), 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(marketListingSeed), seller.toBuffer(), listingIdBytes],
    programId,
  );
}

export function deriveMarketListingPda(seller, listingId) {
  return deriveMarketListingPdaForProgram(seller, listingId, gameProgramId);
}

export function deriveGameMarketListingPda(seller, listingId) {
  return deriveMarketListingPdaForProgram(seller, listingId, gameProgramId);
}

function deriveMarketAssetPdaForProgram(owner, assetId, programId = gameProgramId) {
  const assetIdBytes = Buffer.alloc(8);
  assetIdBytes.writeBigUInt64LE(BigInt(assetId), 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("asset"), owner.toBuffer(), assetIdBytes],
    programId,
  );
}

export function deriveMarketAssetPda(owner, assetId) {
  return deriveMarketAssetPdaForProgram(owner, assetId, gameProgramId);
}

export function deriveGameMarketAssetPda(owner, assetId) {
  return deriveMarketAssetPdaForProgram(owner, assetId, gameProgramId);
}

function deriveMarketAuthorityPdaForProgram(programId = gameProgramId) {
  return PublicKey.findProgramAddressSync([Buffer.from(marketAuthoritySeed)], programId);
}

export function deriveMarketAuthorityPda() {
  return deriveMarketAuthorityPdaForProgram(gameProgramId);
}

export function deriveGameMarketAuthorityPda() {
  return deriveMarketAuthorityPdaForProgram(gameProgramId);
}

function deriveSmeltingRecipeTablePdaForProgram(tableId = smeltingDefaultRecipeTableId, programId = gameProgramId) {
  const tableIdBytes = Buffer.alloc(8);
  tableIdBytes.writeBigUInt64LE(BigInt(tableId), 0);
  return PublicKey.findProgramAddressSync([Buffer.from(smeltingRecipeTableSeed), tableIdBytes], programId);
}

export function deriveSmeltingRecipeTablePda(tableId = smeltingDefaultRecipeTableId) {
  return deriveSmeltingRecipeTablePdaForProgram(tableId, gameProgramId);
}

export function deriveGameSmeltingRecipeTablePda(tableId = smeltingDefaultRecipeTableId) {
  return deriveSmeltingRecipeTablePdaForProgram(tableId, gameProgramId);
}

function deriveSmeltingAuthorityPdaForProgram(programId = gameProgramId) {
  return PublicKey.findProgramAddressSync([Buffer.from(smeltingAuthoritySeed)], programId);
}

export function deriveSmeltingAuthorityPda() {
  return deriveSmeltingAuthorityPdaForProgram(gameProgramId);
}

export function deriveGameSmeltingAuthorityPda() {
  return deriveSmeltingAuthorityPdaForProgram(gameProgramId);
}

const gameContext = Object.freeze({
  isUnifiedGame: true,
  programId: gameProgramId,
  chunkProgramId: gameProgramId,
  backpackProgramId: gameProgramId,
  marketProgramId: gameProgramId,
  smeltingProgramId: gameProgramId,
});

function contextInstructionData(context, namespace, data) {
  return context?.isUnifiedGame ? Buffer.concat([Buffer.from([namespace]), data]) : data;
}

function deriveChunkBrokenPdaForContext(chunkX, chunkZ, context = gameContext) {
  return deriveChunkBrokenPdaForProgram(chunkX, chunkZ, context.chunkProgramId);
}

function deriveResourceDropTablePdaForContext(context = gameContext) {
  return deriveResourceDropTablePdaForProgram(context.chunkProgramId);
}

function derivePlayerProgressPdaForContext(owner, context = gameContext) {
  return derivePlayerProgressPdaForProgram(owner, context.chunkProgramId);
}

function deriveBackpackPdaForContext(owner, backpackId, context = gameContext) {
  return deriveBackpackPdaForProgram(owner, backpackId, context.backpackProgramId);
}

function deriveMarketListingPdaForContext(seller, listingId, context = gameContext) {
  return deriveMarketListingPdaForProgram(seller, listingId, context.marketProgramId);
}

function deriveMarketAssetPdaForContext(owner, assetId, context = gameContext) {
  return deriveMarketAssetPdaForProgram(owner, assetId, context.marketProgramId);
}

function deriveMarketAuthorityPdaForContext(context = gameContext) {
  return deriveMarketAuthorityPdaForProgram(context.marketProgramId);
}

function deriveSmeltingRecipeTablePdaForContext(tableId = smeltingDefaultRecipeTableId, context = gameContext) {
  return deriveSmeltingRecipeTablePdaForProgram(tableId, context.smeltingProgramId);
}

function deriveSmeltingAuthorityPdaForContext(context = gameContext) {
  return deriveSmeltingAuthorityPdaForProgram(context.smeltingProgramId);
}

export async function executeSmeltingOnChain({
  recipeId,
  recipeTableId = smeltingDefaultRecipeTableId,
  inputIndexes = [],
  fuelIndexes = [],
  batchMultiplier = 1,
  backpackAddress = null,
} = {}) {
  const provider = await connectedWalletProvider({ prompt: true });
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  const normalizedInputIndexes = normalizeBackpackIndexes(inputIndexes);
  const normalizedFuelIndexes = normalizeBackpackIndexes(fuelIndexes);
  if (!BigInt(recipeId || 0) || !normalizedInputIndexes.length || !normalizedFuelIndexes.length) {
    return { submitted: false, reason: "invalid-smelting-inputs" };
  }
  const conn = getNicechunkConnection();
  const backpack = backpackAddress
    ? new PublicKey(backpackAddress)
    : (await loadEquippedBackpackForOwner(provider.publicKey, conn))?.publicKey;
  if (!backpack) return { submitted: false, reason: "no-backpack" };
  const backpackAccount = await fetchBackpack(backpack);
  if (!backpackAccount?.publicKey) return { submitted: false, reason: "no-backpack" };
  const context = gameContext;
  const [recipeTable] = deriveSmeltingRecipeTablePdaForContext(recipeTableId, context);
  const recipeTableAccount = await conn.getAccountInfo(recipeTable, "confirmed");
  if (!recipeTableAccount?.data?.length) {
    return { submitted: false, reason: "smelting-table-uninitialized", recipeTable: recipeTable.toBase58() };
  }
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 340_000 }));
  tx.add(createExecuteSmeltingInstruction({
    owner: provider.publicKey,
    recipeTable,
    backpack,
    recipeId,
    inputIndexes: normalizedInputIndexes,
    fuelIndexes: normalizedFuelIndexes,
    batchMultiplier,
    context,
  }));
  const signature = await signAndSendWalletTransaction(provider, tx, conn);
  return {
    submitted: true,
    signature,
    backpack: backpack.toBase58(),
    recipeId: BigInt(recipeId).toString(),
    inputIndexes: normalizedInputIndexes,
    fuelIndexes: normalizedFuelIndexes,
    batchMultiplier,
    recipeTable: recipeTable.toBase58(),
    recipeTableId: BigInt(recipeTableId).toString(),
    programId: context.smeltingProgramId.toBase58(),
  };
}

export async function createMarketListingOnChain({
  item,
  category,
  currency,
  price,
  quantity = 1,
  backpackAddress = null,
}) {
  const provider = await connectedWalletProvider({ prompt: true });
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };

  const listingId = createMarketListingId();
  const normalizedCurrency = String(currency || "NCK").toUpperCase();
  const priceBaseUnits = parseMarketPriceBaseUnits(price, normalizedCurrency);
  const sourceKind = item?.source === "backpack" ? "backpack" : "asset";
  const sourceRecord = item?.source === "backpack" ? item?.slot?.record : null;
  const backpackSource = sourceKind === "backpack"
    ? await fetchBackpack(backpackAddress || item?.backpack).catch(() => null)
    : null;
  const context = gameContext;
  const [listing] = deriveMarketListingPdaForContext(provider.publicKey, listingId, context);
  const assetDetails = sourceKind === "asset" ? createMarketAssetDetails(item, quantity) : null;
  const itemHash = await createMarketItemHash({ item, category, currency: normalizedCurrency, quantity, assetDetails });
  const assetId = sourceKind === "asset" ? createMarketAssetId() : null;
  const [asset] = sourceKind === "asset" ? deriveMarketAssetPdaForContext(provider.publicKey, assetId, context) : [null];
  const sourceInventory = sourceKind === "backpack"
    ? backpackSource?.publicKey ?? backpackAddress ?? item?.backpack
    : asset.toBase58();
  if (item?.source === "backpack" && (!backpackSource?.publicKey || !sourceInventory || !sourceRecord)) {
    return { submitted: false, reason: "listing-unavailable" };
  }
  const tx = new Transaction();
  if (sourceKind === "asset") {
    tx.add(createInitializeMarketAssetInstruction({
      owner: provider.publicKey,
      asset,
      assetId,
      category,
      quantity,
      itemHash,
      assetDetails,
      context,
    }));
  }
  tx.add(createMarketListingInstruction({
    seller: provider.publicKey,
    listing,
    listingId,
    category,
    currency: normalizedCurrency,
    sourceKind,
    sourceIndex: Number.isInteger(item?.slotIndex) ? item.slotIndex : 0,
    quantity,
    priceBaseUnits,
    itemHash,
    sourceInventory,
    sourceRecord,
    context,
  }));

  const conn = getNicechunkConnection();
  const signature = await signAndSendWalletTransaction(provider, tx, conn);
  return {
    submitted: true,
    signature,
    listing: listing.toBase58(),
    listingId: listingId.toString(),
    seller: provider.publicKey.toBase58(),
    priceBaseUnits: priceBaseUnits.toString(),
    sourceInventory,
    sourceKind,
    asset: asset?.toBase58() ?? null,
    assetId: assetId?.toString() ?? null,
    programId: context.marketProgramId.toBase58(),
  };
}

export async function cancelMarketListingOnChain({
  listing,
  listingId,
  source = null,
  sourceInventory = null,
}) {
  const provider = await connectedWalletProvider({ prompt: true });
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  const listingPublicKey = listing
    ? new PublicKey(listing)
    : deriveMarketListingPdaForContext(provider.publicKey, BigInt(listingId), gameContext)[0];
  const context = gameContext;
  const tx = new Transaction().add(createCancelMarketListingInstruction({
    seller: provider.publicKey,
    listing: listingPublicKey,
    source,
    sourceInventory,
    context,
  }));
  const signature = await signAndSendWalletTransaction(provider, tx, getNicechunkConnection());
  return {
    submitted: true,
    signature,
    listing: listingPublicKey.toBase58(),
    programId: context.marketProgramId.toBase58(),
  };
}

export async function buyMarketListingOnChain({ listing, buyerBackpackAddress = null }) {
  const provider = await connectedWalletProvider({ prompt: true });
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  if (!listing?.listing || !listing?.seller) return { submitted: false, reason: "listing-unavailable" };

  const listingPublicKey = new PublicKey(listing.listing);
  const seller = new PublicKey(listing.seller);
  if (seller.equals(provider.publicKey)) return { submitted: false, reason: "self-purchase" };

  const currency = String(listing.currency || "NCK").toUpperCase();
  if (listing.source === "backpack" && !buyerBackpackAddress) {
    return { submitted: false, reason: "no-backpack" };
  }
  const conn = getNicechunkConnection();
  const context = gameContext;
  if (listing.source === "backpack") {
    const buyerBackpack = await fetchBackpack(buyerBackpackAddress);
    if (!buyerBackpack?.publicKey) return { submitted: false, reason: "no-backpack" };
    if (buyerBackpack.itemCount >= buyerBackpack.capacity) return { submitted: false, reason: "backpack-full" };
  }
  const tx = new Transaction();
  if (currency === "NCK") {
    const buyerNckToken = getAssociatedTokenAddressSync(nckMint, provider.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const sellerNckToken = getAssociatedTokenAddressSync(nckMint, seller, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const treasuryNckToken = getAssociatedTokenAddressSync(nckMint, marketTreasury, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const [buyerNckAccount, sellerNckAccount, treasuryNckAccount] = await Promise.all([
      conn.getAccountInfo(buyerNckToken, "confirmed"),
      conn.getAccountInfo(sellerNckToken, "confirmed"),
      conn.getAccountInfo(treasuryNckToken, "confirmed"),
    ]);
    if (!buyerNckAccount?.data?.length) return { submitted: false, reason: "nck-token-missing" };
    if (!sellerNckAccount?.data?.length) {
      tx.add(createAssociatedTokenAccountInstruction(
        provider.publicKey,
        sellerNckToken,
        seller,
        nckMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ));
    }
    if (!treasuryNckAccount?.data?.length) {
      tx.add(createAssociatedTokenAccountInstruction(
        provider.publicKey,
        treasuryNckToken,
        marketTreasury,
        nckMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ));
    }
    tx.add(createBuyMarketListingInstruction({
      buyer: provider.publicKey,
      seller,
      listing: listingPublicKey,
      currency,
      buyerNckToken,
      sellerNckToken,
      treasuryNckToken,
      source: listing.source,
      sourceInventory: listing.sourceInventory,
      buyerBackpackAddress,
      context,
    }));
  } else if (currency === "SOL") {
    tx.add(createBuyMarketListingInstruction({
      buyer: provider.publicKey,
      seller,
      listing: listingPublicKey,
      currency,
      source: listing.source,
      sourceInventory: listing.sourceInventory,
      buyerBackpackAddress,
      context,
    }));
  } else {
    throw new Error(`Unsupported market currency: ${currency}`);
  }

  const signature = await signAndSendWalletTransaction(provider, tx, conn);
  return {
    submitted: true,
    signature,
    listing: listingPublicKey.toBase58(),
    buyer: provider.publicKey.toBase58(),
    seller: seller.toBase58(),
    currency,
    programId: context.marketProgramId.toBase58(),
  };
}

export async function fetchMarketListingsOnChain({
  seller = null,
  state = null,
  category = "all",
  currency = "all",
  source = null,
  query = "",
  sort = "newest",
} = {}) {
  const filters = [{ dataSize: marketListingLength }];
  if (seller) {
    const sellerKey = typeof seller === "string" ? new PublicKey(seller) : seller;
    filters.push({ memcmp: { offset: marketListingSellerOffset, bytes: sellerKey.toBase58() } });
  }
  const stateCode = state ? marketStateCodes.get(String(state).toLowerCase()) : null;
  if (stateCode) {
    filters.push(createSingleByteMemcmpFilter(marketListingStateOffset, stateCode));
  }
  const categoryCode = category && category !== "all" ? marketCategoryCodes.get(String(category).toLowerCase()) : null;
  if (categoryCode) {
    filters.push(createSingleByteMemcmpFilter(marketListingCategoryOffset, categoryCode));
  }
  const currencyCode = currency && currency !== "all" ? marketCurrencyCodes.get(String(currency).toUpperCase()) : null;
  if (currencyCode) {
    filters.push(createSingleByteMemcmpFilter(marketListingCurrencyOffset, currencyCode));
  }
  const sourceCode = source ? marketSourceKindCodes.get(String(source).toLowerCase()) : null;
  if (sourceCode) {
    filters.push(createSingleByteMemcmpFilter(marketListingSourceKindOffset, sourceCode));
  }
  const conn = getNicechunkConnection();
  const accounts = (await conn.getProgramAccounts(gameProgramId, {
    commitment: "confirmed",
    filters,
  })).map((entry) => ({ ...entry, programId: gameProgramId }));
  const listings = accounts
    .map(({ pubkey, account, programId }) => {
      try {
        return { ...decodeMarketListing(account.data), listing: pubkey.toBase58(), programId: programId.toBase58() };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const assetLookups = listings
    .map((listing, index) => listing.source === "asset" && listing.sourceInventory
      ? { index, publicKey: new PublicKey(listing.sourceInventory) }
      : null)
    .filter(Boolean);
  if (assetLookups.length) {
    const assetAccounts = await conn.getMultipleAccountsInfo(
      assetLookups.map((lookup) => lookup.publicKey),
      "confirmed",
    );
    assetAccounts.forEach((account, lookupIndex) => {
      if (!account?.data?.length) return;
      try {
        listings[assetLookups[lookupIndex].index].asset = decodeMarketAsset(account.data);
      } catch {
        // Listing data is still usable without client-side asset metadata.
      }
    });
  }
  return filterAndSortMarketListings(listings, { state, category, currency, source, query, sort });
}

export async function fetchMarketListingsPageOnChain({
  page = 1,
  pageSize = 20,
  ...filters
} = {}) {
  const listings = await fetchMarketListingsOnChain(filters);
  const normalizedPageSize = Math.max(1, Math.min(500, Math.floor(Number(pageSize) || 20)));
  const total = listings.length;
  const totalPages = Math.max(1, Math.ceil(total / normalizedPageSize));
  const currentPage = Math.min(Math.max(1, Math.floor(Number(page) || 1)), totalPages);
  const startIndex = total ? (currentPage - 1) * normalizedPageSize : 0;
  const endIndex = total ? Math.min(total, startIndex + normalizedPageSize) : 0;
  return {
    items: listings.slice(startIndex, endIndex),
    pageInfo: {
      page: currentPage,
      pageSize: normalizedPageSize,
      total,
      totalPages,
      start: total ? startIndex + 1 : 0,
      end: endIndex,
    },
  };
}

function createSingleByteMemcmpFilter(offset, value) {
  const byte = Number(value);
  if (!Number.isInteger(byte) || byte < 0 || byte >= base58Alphabet.length) {
    throw new Error(`Invalid single-byte memcmp value: ${value}`);
  }
  return { memcmp: { offset, bytes: base58Alphabet[byte] } };
}

function filterAndSortMarketListings(listings, {
  state = null,
  category = "all",
  currency = "all",
  source = null,
  query = "",
  sort = "newest",
} = {}) {
  const normalizedState = state ? String(state).toLowerCase() : null;
  const normalizedCategory = String(category || "all").toLowerCase();
  const normalizedCurrency = String(currency || "all").toUpperCase();
  const normalizedSource = source ? String(source).toLowerCase() : null;
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const filtered = listings.filter((listing) => {
    if (normalizedState && listing.stateLabel !== normalizedState) return false;
    if (normalizedCategory !== "all" && listing.category !== normalizedCategory) return false;
    if (normalizedCurrency !== "ALL" && listing.currency !== normalizedCurrency) return false;
    if (normalizedSource && listing.source !== normalizedSource) return false;
    if (!normalizedQuery) return true;
    return marketListingSearchText(listing).includes(normalizedQuery);
  });
  return filtered.sort((a, b) => {
    if (sort === "oldest") return marketListingCreatedAt(a) - marketListingCreatedAt(b);
    if (sort === "price-asc") return marketListingPriceValue(a) - marketListingPriceValue(b);
    if (sort === "price-desc") return marketListingPriceValue(b) - marketListingPriceValue(a);
    return marketListingCreatedAt(b) - marketListingCreatedAt(a);
  });
}

function marketListingCreatedAt(listing) {
  const value = Number(listing?.createdAt || 0);
  return Number.isFinite(value) ? value : 0;
}

function marketListingPriceValue(listing) {
  const value = Number(listing?.price || 0);
  return Number.isFinite(value) ? value : 0;
}

function marketListingSearchText(listing) {
  const record = listing?.sourceRecord;
  const asset = listing?.asset;
  return [
    listing?.listing,
    listing?.listingId,
    listing?.seller,
    listing?.category,
    listing?.currency,
    listing?.source,
    listing?.sourceInventory,
    listing?.price,
    record ? `${record.worldX},${record.worldY},${record.worldZ}` : "",
    asset?.itemId,
    asset?.itemCode,
  ]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .map((part) => String(part))
    .join(" ")
    .toLowerCase();
}

export async function loadChunkBlockDeltas(chunkX, chunkZ) {
  if (!isNicechunkChainSyncEnabled()) return [];
  const key = chunkCacheKey(chunkX, chunkZ);
  const cached = readFreshChunkDeltaCache(key);
  if (cached) return cached;
  const deltasByChunk = await loadChunkBlockDeltasBatch([{ chunkX, chunkZ }], { batchSize: 1 });
  return deltasByChunk.get(key) ?? [];
}

export async function loadChunkBlockDeltasBatch(chunks, { batchSize = 50 } = {}) {
  if (!isNicechunkChainSyncEnabled() || !Array.isArray(chunks) || !chunks.length) return new Map();
  const results = new Map();
  const uniqueChunks = dedupeChunks(chunks);
  const pendingReads = [];
  const chunksToFetch = [];
  for (const chunk of uniqueChunks) {
    const key = chunkCacheKey(chunk.chunkX, chunk.chunkZ);
    const cached = readFreshChunkDeltaCache(key);
    if (cached) {
      results.set(key, cached);
      continue;
    }
    const entry = chunkDeltaCache.get(key);
    if (entry?.promise) {
      pendingReads.push(entry.promise.then((deltas) => results.set(key, deltas ?? [])));
      continue;
    }
    chunksToFetch.push(chunk);
  }
  if (!chunksToFetch.length) {
    if (pendingReads.length) await Promise.all(pendingReads);
    return results;
  }
  const conn = getNicechunkConnection();

  for (let start = 0; start < chunksToFetch.length; start += batchSize) {
    const batch = chunksToFetch.slice(start, start + batchSize);
    const accounts = batch.map((chunk) => deriveChunkBrokenPdaForContext(chunk.chunkX, chunk.chunkZ, gameContext)[0]);
    const batchPromise = conn.getMultipleAccountsInfo(accounts, "confirmed")
      .then((infos) => {
        const loadedAt = Date.now();
        const batchResults = new Map();
        for (let index = 0; index < batch.length; index += 1) {
          const chunk = batch[index];
          const key = chunkCacheKey(chunk.chunkX, chunk.chunkZ);
          const brokenAccount = infos[index];
          const exists = Boolean(brokenAccount?.data?.length);
          const deltas = exists ? decodeChunkBrokenDeltas(brokenAccount.data, chunk.chunkX, chunk.chunkZ) : [];
          chunkDeltaCache.set(key, { deltas, exists, loadedAt, promise: null });
          if (exists) initializedChunkBrokenCache.add(chunkProgramCacheKey(gameContext, chunk.chunkX, chunk.chunkZ));
          batchResults.set(key, deltas);
        }
        return batchResults;
      })
      .catch((error) => {
        for (const chunk of batch) chunkDeltaCache.delete(chunkCacheKey(chunk.chunkX, chunk.chunkZ));
        reportRpcError(error, "chunk-delta-batch");
        throw error;
      });
    for (const chunk of batch) {
      const key = chunkCacheKey(chunk.chunkX, chunk.chunkZ);
      chunkDeltaCache.set(key, {
        deltas: [],
        loadedAt: 0,
        promise: batchPromise.then((batchResults) => batchResults.get(key) ?? []),
      });
    }
    let infos;
    try {
      infos = await batchPromise;
    } catch (error) {
      throw error;
    }
    for (const [key, deltas] of infos) results.set(key, deltas);
  }
  if (pendingReads.length) await Promise.all(pendingReads);
  return results;
}

export async function recordBlockBreakOnChain(block, toolSlot = 0, options = {}) {
  if (!isNicechunkChainSyncEnabled()) {
    return { submitted: false, reason: "chain-sync-disabled" };
  }
  try {
    const provider = await connectedWalletProvider();
    if (!provider) return { submitted: false, reason: "wallet-unavailable" };

    const canonicalBlock = await resolveCanonicalMinedBlock(block);
    if (!isCanonicalMineableBlockId(canonicalBlock.blockId)) {
      return { submitted: false, reason: "unmineable-block", blockId: canonicalBlock.blockId };
    }

    if (await isBlockAlreadyBrokenOnChain(block)) {
      return { submitted: false, reason: "already-mined" };
    }

    const session = await getOrCreateGameplaySession(provider);
    const tx = new Transaction();
    const conn = getNicechunkConnection();
    const equippedBackpack = options?.backpackAddress
      ? {
          publicKey: new PublicKey(options.backpackAddress),
          itemCount: Number(options.backpackItemCount),
          capacity: Number(options.backpackCapacity),
        }
      : await loadEquippedBackpackForOwner(provider.publicKey, conn);
    if (!equippedBackpack?.publicKey) {
      return { submitted: false, reason: "no-backpack" };
    }
    const loadedBackpack = await fetchBackpack(equippedBackpack.publicKey).catch(() => null);
    if (!loadedBackpack?.publicKey) return { submitted: false, reason: "no-backpack" };
    if (!Number.isFinite(equippedBackpack.itemCount) && Number.isFinite(loadedBackpack.itemCount)) {
      equippedBackpack.itemCount = Number(loadedBackpack.itemCount);
    }
    if (!Number.isFinite(equippedBackpack.capacity) && Number.isFinite(loadedBackpack.capacity)) {
      equippedBackpack.capacity = Number(loadedBackpack.capacity);
    }
    const context = gameContext;
    if (
      Number.isFinite(equippedBackpack.itemCount) &&
      Number.isFinite(equippedBackpack.capacity) &&
      equippedBackpack.itemCount >= equippedBackpack.capacity
    ) {
      return { submitted: false, reason: "backpack-full" };
    }
    await ensureMiningAccountsInitialized(conn, session.keypair, blockChunkX(canonicalBlock.x), blockChunkZ(canonicalBlock.z), context);
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: miningComputeUnitLimit }));
    tx.add(createMineBlockWithRewardsInstruction({
      authority: session.keypair.publicKey,
      block,
      owner: provider.publicKey,
      backpack: equippedBackpack.publicKey,
      expectedBlockId: canonicalBlock.blockId,
      context,
    }));

    const signature = await signAndSendKeypairTransaction(session.keypair, tx, conn);
    invalidateChunkDeltaCache(blockChunkX(canonicalBlock.x), blockChunkZ(canonicalBlock.z));
    return {
      submitted: true,
      signature,
      backpack: equippedBackpack?.publicKey?.toBase58?.() ?? null,
      block: canonicalBlock,
      blockId: canonicalBlock.blockId,
      type: canonicalBlock.type,
      programId: context.chunkProgramId.toBase58(),
    };
  } catch (error) {
    reportRpcError(error, "mine-block");
    throw error;
  }
}

export async function recordTreeFellOnChain(block, toolSlot = 0, options = {}) {
  if (!isNicechunkChainSyncEnabled()) {
    return { submitted: false, reason: "chain-sync-disabled" };
  }
  try {
    const provider = await connectedWalletProvider();
    if (!provider) return { submitted: false, reason: "wallet-unavailable" };

    const canonicalBlock = await resolveCanonicalMinedBlock(block);
    if (!isTreeTrunkBlockId(canonicalBlock.blockId)) {
      return { submitted: false, reason: "not-tree-trunk", blockId: canonicalBlock.blockId };
    }

    if (await isBlockAlreadyBrokenOnChain(block)) {
      return { submitted: false, reason: "already-mined" };
    }

    const session = await getOrCreateGameplaySession(provider);
    const tx = new Transaction();
    const conn = getNicechunkConnection();
    const equippedBackpack = options?.backpackAddress
      ? {
          publicKey: new PublicKey(options.backpackAddress),
          itemCount: Number(options.backpackItemCount),
          capacity: Number(options.backpackCapacity),
        }
      : await loadEquippedBackpackForOwner(provider.publicKey, conn);
    if (!equippedBackpack?.publicKey) {
      return { submitted: false, reason: "no-backpack" };
    }
    const loadedBackpack = await fetchBackpack(equippedBackpack.publicKey).catch(() => null);
    if (!loadedBackpack?.publicKey) return { submitted: false, reason: "no-backpack" };
    const context = gameContext;

    const chunks = treeFellCandidateChunks(canonicalBlock);
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: miningComputeUnitLimit }));
    tx.add(createFellTreeWithRewardsInstruction({
      authority: session.keypair.publicKey,
      block: canonicalBlock,
      owner: provider.publicKey,
      backpack: equippedBackpack.publicKey,
      expectedBlockId: canonicalBlock.blockId,
      chunks,
      context,
    }));

    const signature = await signAndSendKeypairTransaction(session.keypair, tx, conn);
    chunks.forEach((chunk) => invalidateChunkDeltaCache(chunk.chunkX, chunk.chunkZ));
    return {
      submitted: true,
      signature,
      backpack: equippedBackpack?.publicKey?.toBase58?.() ?? null,
      block: canonicalBlock,
      blockId: canonicalBlock.blockId,
      type: canonicalBlock.type,
      chunks,
      programId: context.chunkProgramId.toBase58(),
    };
  } catch (error) {
    reportRpcError(error, "fell-tree");
    throw error;
  }
}

export async function recordSupportCollapseOnChain(block, options = {}) {
  if (!isNicechunkChainSyncEnabled()) {
    return { submitted: false, reason: "chain-sync-disabled" };
  }
  try {
    const provider = await connectedWalletProvider();
    if (!provider) return { submitted: false, reason: "wallet-unavailable" };

    const canonicalBlock = await resolveCanonicalMinedBlock(block);
    if (!isCanonicalMineableBlockId(canonicalBlock.blockId)) {
      return { submitted: false, reason: "unmineable-block", blockId: canonicalBlock.blockId };
    }
    if (await isBlockAlreadyBrokenOnChain(block)) {
      return { submitted: false, reason: "already-mined" };
    }

    const conn = getNicechunkConnection();
    const session = await getOrCreateGameplaySession(provider);
    const equippedBackpack = options?.backpackAddress
      ? {
          publicKey: new PublicKey(options.backpackAddress),
          itemCount: Number(options.backpackItemCount),
          capacity: Number(options.backpackCapacity),
        }
      : await loadEquippedBackpackForOwner(provider.publicKey, conn);
    if (!equippedBackpack?.publicKey) return { submitted: false, reason: "no-backpack" };

    const loadedBackpack = await fetchBackpack(equippedBackpack.publicKey).catch(() => null);
    if (!loadedBackpack?.publicKey) return { submitted: false, reason: "no-backpack" };
    if (!Number.isFinite(equippedBackpack.itemCount) && Number.isFinite(loadedBackpack.itemCount)) {
      equippedBackpack.itemCount = Number(loadedBackpack.itemCount);
    }
    if (!Number.isFinite(equippedBackpack.capacity) && Number.isFinite(loadedBackpack.capacity)) {
      equippedBackpack.capacity = Number(loadedBackpack.capacity);
    }
    if (
      Number.isFinite(equippedBackpack.itemCount) &&
      Number.isFinite(equippedBackpack.capacity) &&
      equippedBackpack.itemCount >= equippedBackpack.capacity
    ) {
      return { submitted: false, reason: "backpack-full" };
    }

    const context = gameContext;
    const primaryKey = minedBlockKey(canonicalBlock);
    const collapseBlocks = await resolveCanonicalCollapseBlocks(options.collapseBlocks, primaryKey);
    const rewardKeySet = new Set((options.rewardBlocks ?? []).map((rewardBlock) => minedBlockKey(rewardBlock)));
    const availableRewardSlots = Number.isFinite(equippedBackpack.capacity) && Number.isFinite(equippedBackpack.itemCount)
      ? Math.max(0, equippedBackpack.capacity - equippedBackpack.itemCount - 1)
      : supportCollapseMaxOnChainBlocks;
    const rewardBlocks = collapseBlocks
      .filter((collapseBlock) => rewardKeySet.has(minedBlockKey(collapseBlock)))
      .slice(0, availableRewardSlots);

    const chunks = dedupeChunks([
      { chunkX: blockChunkX(canonicalBlock.x), chunkZ: blockChunkZ(canonicalBlock.z) },
      ...collapseBlocks.map((collapseBlock) => ({
        chunkX: blockChunkX(collapseBlock.x),
        chunkZ: blockChunkZ(collapseBlock.z),
      })),
    ]);
    for (const chunk of chunks) {
      await ensureMiningAccountsInitialized(conn, session.keypair, chunk.chunkX, chunk.chunkZ, context);
    }

    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: miningComputeUnitLimit }));
    tx.add(createMineBlockWithRewardsInstruction({
      authority: session.keypair.publicKey,
      block: canonicalBlock,
      owner: provider.publicKey,
      backpack: equippedBackpack.publicKey,
      expectedBlockId: canonicalBlock.blockId,
      context,
    }));
    for (const collapseBlock of collapseBlocks) {
      tx.add(createMineBlockInstruction({
        authority: session.keypair.publicKey,
        block: collapseBlock,
        owner: provider.publicKey,
        expectedBlockId: collapseBlock.blockId,
        context,
      }));
    }
    if (rewardBlocks.length) {
      tx.add(createAppendMinedResourcesBatchInstruction({
        owner: provider.publicKey,
        sessionAuthority: session.keypair.publicKey,
        backpack: equippedBackpack.publicKey,
        blocks: rewardBlocks,
        context,
      }));
    }

    const signature = await signAndSendKeypairTransaction(session.keypair, tx, conn);
    chunks.forEach((chunk) => invalidateChunkDeltaCache(chunk.chunkX, chunk.chunkZ));
    return {
      submitted: true,
      signature,
      backpack: equippedBackpack?.publicKey?.toBase58?.() ?? null,
      block: canonicalBlock,
      blockId: canonicalBlock.blockId,
      type: canonicalBlock.type,
      collapseBlocks,
      rewardBlocks,
      programId: context.chunkProgramId.toBase58(),
    };
  } catch (error) {
    reportRpcError(error, "support-collapse");
    throw error;
  }
}

async function ensureChunkBrokenInitialized(conn, sessionKeypair, chunkX, chunkZ, context = gameContext) {
  const key = chunkProgramCacheKey(context, chunkX, chunkZ);
  if (initializedChunkBrokenCache.has(key)) return null;
  const [chunkBrokenPda] = deriveChunkBrokenPdaForContext(chunkX, chunkZ, context);
  const account = await conn.getAccountInfo(chunkBrokenPda, "confirmed");
  if (account?.data?.length) {
    initializedChunkBrokenCache.add(key);
    return null;
  }
  const tx = new Transaction().add(createInitializeChunkBrokenInstruction({
    authority: sessionKeypair.publicKey,
    chunkX,
    chunkZ,
    context,
  }));
  const signature = await signAndSendKeypairTransaction(sessionKeypair, tx, conn);
  initializedChunkBrokenCache.add(key);
  invalidateChunkDeltaCache(chunkX, chunkZ);
  return signature;
}

async function ensureMiningAccountsInitialized(conn, sessionKeypair, chunkX, chunkZ, context = gameContext) {
  const key = chunkProgramCacheKey(context, chunkX, chunkZ);
  const needsChunkCheck = !initializedChunkBrokenCache.has(key);
  const needsDropCheck = !isResourceDropTableReady(context);
  if (!needsChunkCheck && !needsDropCheck) return null;
  if (resourceDropTableReadyPromise) await resourceDropTableReadyPromise;

  const [chunkBrokenPda] = deriveChunkBrokenPdaForContext(chunkX, chunkZ, context);
  const [resourceDropTable] = deriveResourceDropTablePdaForContext(context);
  const pubkeys = [];
  const labels = [];
  let chunkExists = !needsChunkCheck;
  let dropExists = !needsDropCheck;
  if (needsChunkCheck) {
    pubkeys.push(chunkBrokenPda);
    labels.push("chunk");
  }
  if (needsDropCheck) {
    pubkeys.push(resourceDropTable);
    labels.push("drops");
  }

  if (pubkeys.length) {
    const infos = await conn.getMultipleAccountsInfo(pubkeys, "confirmed");
    for (let index = 0; index < labels.length; index += 1) {
      if (labels[index] === "chunk") chunkExists = Boolean(infos[index]?.data?.length);
      if (labels[index] === "drops") dropExists = Boolean(infos[index]?.data?.length);
    }
  }

  if (chunkExists) initializedChunkBrokenCache.add(key);
  if (dropExists) markResourceDropTableReady(context);
  if (chunkExists && dropExists) return null;

  const tx = new Transaction();
  if (!chunkExists) {
    tx.add(createInitializeChunkBrokenInstruction({
      authority: sessionKeypair.publicKey,
      chunkX,
      chunkZ,
      context,
    }));
  }
  if (!dropExists) {
    tx.add(createInitializeResourceDropTableInstruction({
      authority: sessionKeypair.publicKey,
      rules: resourceDropRules,
      context,
    }));
  }
  const signature = await signAndSendKeypairTransaction(sessionKeypair, tx, conn);
  if (!chunkExists) {
    initializedChunkBrokenCache.add(key);
    invalidateChunkDeltaCache(chunkX, chunkZ);
  }
  if (!dropExists) markResourceDropTableReady(context);
  return signature;
}

async function ensureResourceDropTableInitialized(conn, sessionKeypair, context = gameContext) {
  if (isResourceDropTableReady(context)) return null;
  if (resourceDropTableReadyPromise) return resourceDropTableReadyPromise;
  const [resourceDropTable] = deriveResourceDropTablePdaForContext(context);
  resourceDropTableReadyPromise = (async () => {
    const account = await conn.getAccountInfo(resourceDropTable, "confirmed");
    if (account?.data?.length) {
      markResourceDropTableReady(context);
      return null;
    }
    const tx = new Transaction().add(createInitializeResourceDropTableInstruction({
      authority: sessionKeypair.publicKey,
      rules: resourceDropRules,
      context,
    }));
    const signature = await signAndSendKeypairTransaction(sessionKeypair, tx, conn);
    markResourceDropTableReady(context);
    return signature;
  })().finally(() => {
    resourceDropTableReadyPromise = null;
  });
  return resourceDropTableReadyPromise;
}

export async function purchaseDefaultBackpack() {
  const provider = await connectedWalletProvider({ prompt: true });
  if (!provider) return { purchased: false, reason: "wallet-unavailable" };
  const [playerProfile] = derivePlayerProfilePda(provider.publicKey);
  const conn = getNicechunkConnection();
  const playerAccount = await conn.getAccountInfo(playerProfile, "confirmed");
  if (playerAccount?.data?.length) {
    const profile = decodePlayerProfile(playerAccount.data);
    if (profile.equippedBackpack && profile.equippedBackpack !== PublicKey.default.toBase58()) {
      const equippedAccount = await conn.getAccountInfo(new PublicKey(profile.equippedBackpack), "confirmed").catch(() => null);
      if (equippedAccount?.owner?.equals(gameProgramId) && isCurrentBackpackAccountData(equippedAccount?.data)) {
        return {
          purchased: false,
          reason: "backpack-already-bound",
          backpack: profile.equippedBackpack,
        };
      }
    }
  }
  const backpackId = createBackpackId();
  const context = gameContext;
  const [backpack] = deriveBackpackPdaForContext(provider.publicKey, backpackId, context);
  const tx = new Transaction();
  if (!playerAccount?.data?.length) {
    tx.add(createInitializePlayerInstruction(provider.publicKey, playerProfile));
  }
  tx.add(createInitializeBackpackInstruction({
    owner: provider.publicKey,
    playerProfile,
    backpack,
    backpackId,
    capacity: backpackDefaultCapacity,
    context,
  }));
  tx.add(createSetEquippedBackpackInstruction({
    authority: provider.publicKey,
    playerProfile,
    backpack,
  }));
  const signature = await signAndSendWalletTransaction(provider, tx, conn);
  const record = {
    backpack: backpack.toBase58(),
    backpackId: backpackId.toString(),
    owner: provider.publicKey.toBase58(),
    equippedAt: Date.now(),
    programId: context.backpackProgramId.toBase58(),
  };
  storeEquippedBackpackRecord(provider.publicKey, record);
  return { purchased: true, signature, ...record };
}

export async function getEquippedBackpackStatus({ prompt = false } = {}) {
  const provider = await connectedWalletProvider({ prompt });
  const owner = provider?.publicKey ?? storedWalletPublicKey();
  if (!owner) return { walletAvailable: false, equipped: false, backpack: null };
  const equippedBackpack = await loadEquippedBackpackForOwner(owner);
  if (!equippedBackpack?.publicKey) {
    return { walletAvailable: Boolean(provider), owner: owner.toBase58(), equipped: false, backpack: null };
  }
  return { walletAvailable: Boolean(provider), owner: owner.toBase58(), equipped: true, backpack: equippedBackpack };
}

export async function forgeEquipmentOnChain({
  code,
  materialInputs = [],
} = {}) {
  const provider = await connectedWalletProvider({ prompt: true });
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  const normalizedCode = String(code || "").trim();
  if (!normalizedCode) return { submitted: false, reason: "empty-code" };
  const codeBytes = new TextEncoder().encode(normalizedCode);
  if (codeBytes.length > playerLoadoutSlotCodeMaxLength) {
    return {
      submitted: false,
      reason: "code-too-large",
      byteLength: codeBytes.length,
      maxByteLength: playerLoadoutSlotCodeMaxLength,
    };
  }
  const normalizedMaterialInputs = normalizeForgingMaterialInputs(materialInputs);
  if (!normalizedMaterialInputs.length) {
    return { submitted: false, reason: "no-material-inputs" };
  }

  const conn = getNicechunkConnection();
  const backpack = (await loadEquippedBackpackForOwner(provider.publicKey, conn))?.publicKey;
  if (!backpack) return { submitted: false, reason: "no-backpack" };
  const backpackAccountInfo = await conn.getAccountInfo(backpack, "confirmed");
  if (!backpackAccountInfo?.data?.length) return { submitted: false, reason: "no-backpack" };
  const backpackAccount = {
    ...decodeBackpack(backpackAccountInfo.data),
    publicKey: backpack.toBase58(),
  };
  const materialMismatch = normalizedMaterialInputs.find((input) => {
    const slotRecord = backpackAccount.slots[input.slotIndex];
    return !slotRecord || !backpackSlotMatchesForgingInput(slotRecord, input);
  });
  if (materialMismatch) {
    return { submitted: false, reason: "material-mismatch", material: materialMismatch };
  }
  const session = await getOrCreateGameplaySession(provider);
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 260_000 }));
  tx.add(createRemoveBackpackResourcesInstruction({
    owner: provider.publicKey,
    sessionAuthority: session.keypair.publicKey,
    backpack,
    indexes: normalizedMaterialInputs.map((input) => input.slotIndex),
    context: gameContext,
  }));
  const signature = await signAndSendWalletTransaction(provider, tx, conn, [session.keypair]);
  return {
    submitted: true,
    signature,
    owner: provider.publicKey.toBase58(),
    backpack: backpack.toBase58(),
    byteLength: codeBytes.length,
    consumedIndexes: normalizedMaterialInputs.map((input) => input.slotIndex),
    destination: "hotbar",
    programId: gameContext.backpackProgramId.toBase58(),
  };
}

function normalizeForgingMaterialInputs(inputs = []) {
  const seen = new Set();
  const normalized = [];
  for (const input of inputs ?? []) {
    const slotIndex = Number(input?.slotIndex);
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 98 || seen.has(slotIndex)) continue;
    seen.add(slotIndex);
    normalized.push({
      slotIndex,
      itemCode: Number(input?.itemCode) || 0,
      itemId: String(input?.itemId ?? "0"),
      itemPda: String(input?.itemPda ?? ""),
      volumeMm3: Number(input?.volumeMm3) || 0,
      quantity: Number(input?.quantity) || 0,
      materialId: String(input?.materialId ?? ""),
    });
  }
  return normalized;
}

function backpackSlotMatchesForgingInput(slot, input) {
  if (slot.kind !== "item") return false;
  if (Number(slot.itemCode) !== input.itemCode) return false;
  if (String(slot.itemId ?? "0") !== input.itemId) return false;
  if (String(slot.itemPda ?? "") !== input.itemPda) return false;
  if (Number(slot.volumeMm3 || 0) !== input.volumeMm3) return false;
  if (Number(slot.quantity || 0) !== input.quantity) return false;
  return true;
}

export async function fetchPlayerLoadout(ownerAddress = null) {
  const provider = ownerAddress ? null : await connectedWalletProvider();
  const owner = ownerAddress ? new PublicKey(ownerAddress) : (provider?.publicKey ?? storedWalletPublicKey());
  if (!owner) return null;
  const [playerLoadout] = derivePlayerLoadoutPda(owner);
  const account = await getNicechunkConnection().getAccountInfo(playerLoadout, "confirmed");
  if (!account?.data?.length) return null;
  const decoded = decodePlayerLoadout(account.data);
  if (decoded.owner !== owner.toBase58()) return null;
  return {
    ...decoded,
    publicKey: playerLoadout.toBase58(),
    programId: playerProgramId.toBase58(),
  };
}

export { playerLoadoutSlotRightHand };

export async function discardBackpackResourceAt({ backpackAddress = null, index = null } = {}) {
  const provider = await connectedWalletProvider();
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  const resourceIndex = Number(index);
  if (!Number.isInteger(resourceIndex) || resourceIndex < 0 || resourceIndex > 98) {
    return { submitted: false, reason: "invalid-backpack-index" };
  }
  const session = await getOrCreateGameplaySession(provider);
  const backpack = backpackAddress
    ? new PublicKey(backpackAddress)
    : (await loadEquippedBackpackForOwner(provider.publicKey))?.publicKey;
  if (!backpack) return { submitted: false, reason: "no-backpack" };
  const backpackAccount = await fetchBackpack(backpack).catch(() => null);
  if (!backpackAccount?.publicKey) return { submitted: false, reason: "no-backpack" };
  const context = gameContext;
  const tx = new Transaction().add(createRemoveBackpackResourceInstruction({
    owner: provider.publicKey,
    sessionAuthority: session.keypair.publicKey,
    backpack,
    index: resourceIndex,
    context,
  }));
  const conn = getNicechunkConnection();
  const signature = await signAndSendKeypairTransaction(session.keypair, tx, conn);
  return {
    submitted: true,
    signature,
    backpack: backpack.toBase58(),
    index: resourceIndex,
    programId: context.backpackProgramId.toBase58(),
  };
}

export async function discardBackpackResourcesAt({ backpackAddress = null, indexes = [] } = {}) {
  const provider = await connectedWalletProvider();
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  const resourceIndexes = normalizeBackpackIndexes(indexes);
  if (!resourceIndexes.length) {
    return { submitted: false, reason: "invalid-backpack-index" };
  }
  const session = await getOrCreateGameplaySession(provider);
  const backpack = backpackAddress
    ? new PublicKey(backpackAddress)
    : (await loadEquippedBackpackForOwner(provider.publicKey))?.publicKey;
  if (!backpack) return { submitted: false, reason: "no-backpack" };
  const backpackAccount = await fetchBackpack(backpack).catch(() => null);
  if (!backpackAccount?.publicKey) return { submitted: false, reason: "no-backpack" };
  const context = gameContext;
  const tx = new Transaction().add(createRemoveBackpackResourcesInstruction({
    owner: provider.publicKey,
    sessionAuthority: session.keypair.publicKey,
    backpack,
    indexes: resourceIndexes,
    context,
  }));
  const conn = getNicechunkConnection();
  const signature = await signAndSendKeypairTransaction(session.keypair, tx, conn);
  return {
    submitted: true,
    signature,
    backpack: backpack.toBase58(),
    indexes: resourceIndexes,
    count: resourceIndexes.length,
    programId: context.backpackProgramId.toBase58(),
  };
}

function normalizeBackpackIndexes(indexes = []) {
  return Array.from(new Set((indexes ?? [])
    .map((index) => Number(index))
    .filter((index) => Number.isInteger(index) && index >= 0 && index <= 98)));
}

export async function fetchBackpack(backpackAddress) {
  if (!backpackAddress) return null;
  const publicKey = typeof backpackAddress === "string" ? new PublicKey(backpackAddress) : backpackAddress;
  const account = await getNicechunkConnection().getAccountInfo(publicKey, "confirmed");
  if (!account?.data?.length) return null;
  if (!account.owner.equals(gameProgramId)) return null;
  const decoded = decodeBackpack(account.data);
  return {
    ...decoded,
    publicKey: publicKey.toBase58(),
    programId: account.owner.toBase58(),
  };
}

export async function fetchPlayerProgress(ownerAddress) {
  if (!ownerAddress) return null;
  const owner = typeof ownerAddress === "string" ? new PublicKey(ownerAddress) : ownerAddress;
  const [playerProgress] = derivePlayerProgressPdaForContext(owner, gameContext);
  const account = await getNicechunkConnection().getAccountInfo(playerProgress, "confirmed");
  if (!account?.data?.length) {
    return {
      publicKey: playerProgress.toBase58(),
      owner: owner.toBase58(),
      precisionGatheringXp: 0,
      smeltingXp: 0,
      explorationXp: 0,
    };
  }
  if (!account.owner.equals(gameContext.chunkProgramId)) return null;
  const data = account.data;
  if (data.length !== playerProgressLength || data.subarray(0, 8).toString("utf8") !== playerProgressMagic) return null;
  return {
    publicKey: playerProgress.toBase58(),
    owner: owner.toBase58(),
    precisionGatheringXp: Number(data.readBigUInt64LE(playerProgressPrecisionXpOffset)),
    smeltingXp: Number(data.readBigUInt64LE(playerProgressSmeltingXpOffset)),
    explorationXp: Number(data.readBigUInt64LE(playerProgressExplorationXpOffset)),
    programId: account.owner.toBase58(),
  };
}

export function getMinimumGameplaySessionFundingSol() {
  return minimumSessionFundingLamports / lamportsPerSol;
}

export function getConfiguredGameplaySessionFundingSol(owner = null) {
  return getConfiguredGameplaySessionFundingLamports(owner) / lamportsPerSol;
}

export function setConfiguredGameplaySessionFundingSol(value, owner = null) {
  const parsed = Number(value);
  const lamports = Number.isFinite(parsed)
    ? Math.max(minimumSessionFundingLamports, Math.ceil(parsed * lamportsPerSol))
    : minimumSessionFundingLamports;
  if (hasLocalStorage()) localStorage.setItem(sessionFundingStorageKey(owner), String(lamports));
  return lamports / lamportsPerSol;
}

export function hasAcknowledgedGameplaySessionFunding(owner = null) {
  return hasLocalStorage() && localStorage.getItem(sessionFundingAcknowledgedKey(owner)) === "1";
}

export function acknowledgeGameplaySessionFunding(owner = null) {
  if (hasLocalStorage()) localStorage.setItem(sessionFundingAcknowledgedKey(owner), "1");
}

export async function getGameplaySessionStatus({ force = false } = {}) {
  const provider = await connectedWalletProvider();
  if (!provider) {
    return {
      walletAvailable: false,
      acknowledged: false,
      configuredFundingLamports: getConfiguredGameplaySessionFundingLamports(null),
      minimumFundingLamports: minimumSessionFundingLamports,
      balanceLamports: null,
      publicKey: null,
      expiresAt: null,
    };
  }

  const owner = provider.publicKey;
  const ownerKey = owner.toBase58();
  const cached = gameplaySessionStatusCache.get(ownerKey);
  if (!force && cached && Date.now() - cached.loadedAt < gameplaySessionStatusCacheTtlMs) {
    return { ...cached.status };
  }
  const stored = loadStoredGameplaySession(owner);
  const configuredFundingLamports = getConfiguredGameplaySessionFundingLamports(owner);
  if (!stored) {
    const status = {
      walletAvailable: true,
      owner: ownerKey,
      acknowledged: hasAcknowledgedGameplaySessionFunding(owner),
      configuredFundingLamports,
      minimumFundingLamports: minimumSessionFundingLamports,
      balanceLamports: null,
      publicKey: null,
      expiresAt: null,
    };
    gameplaySessionStatusCache.set(ownerKey, { status, loadedAt: Date.now() });
    return status;
  }

  let balanceLamports = null;
  try {
    balanceLamports = await getNicechunkConnection().getBalance(stored.keypair.publicKey, "confirmed");
  } catch (error) {
    reportRpcError(error, "session-balance");
    throw error;
  }

  const status = {
    walletAvailable: true,
    owner: ownerKey,
    acknowledged: hasAcknowledgedGameplaySessionFunding(owner),
    configuredFundingLamports,
    minimumFundingLamports: minimumSessionFundingLamports,
    balanceLamports,
    balanceSol: balanceLamports / lamportsPerSol,
    publicKey: stored.keypair.publicKey.toBase58(),
    expiresAt: stored.expiresAt,
  };
  gameplaySessionStatusCache.set(ownerKey, { status, loadedAt: Date.now() });
  return status;
}

export async function ensureGameplaySessionFunded() {
  try {
    const provider = await connectedWalletProvider({ prompt: true });
    if (!provider) return { funded: false, reason: "wallet-unavailable" };
    const session = await getOrCreateGameplaySession(provider);
    const balanceLamports = await getNicechunkConnection().getBalance(session.keypair.publicKey, "confirmed");
    updateGameplaySessionStatusCache(provider.publicKey, {
      walletAvailable: true,
      owner: provider.publicKey.toBase58(),
      acknowledged: hasAcknowledgedGameplaySessionFunding(provider.publicKey),
      configuredFundingLamports: getConfiguredGameplaySessionFundingLamports(provider.publicKey),
      minimumFundingLamports: minimumSessionFundingLamports,
      balanceLamports,
      balanceSol: balanceLamports / lamportsPerSol,
      publicKey: session.keypair.publicKey.toBase58(),
      expiresAt: session.expiresAt,
    });
    return {
      funded: true,
      balanceLamports,
      balanceSol: balanceLamports / lamportsPerSol,
      publicKey: session.keypair.publicKey.toBase58(),
      expiresAt: session.expiresAt,
    };
  } catch (error) {
    reportRpcError(error, "session-funding");
    return {
      funded: false,
      reason: "session-funding-failed",
      error,
      message: readableErrorMessage(error),
    };
  }
}

function dedupeChunks(chunks) {
  const seen = new Set();
  const unique = [];
  for (const chunk of chunks) {
    const chunkX = Number(chunk?.chunkX);
    const chunkZ = Number(chunk?.chunkZ);
    if (!Number.isInteger(chunkX) || !Number.isInteger(chunkZ)) continue;
    const key = `${chunkX},${chunkZ}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ chunkX, chunkZ });
  }
  return unique;
}

function chunkCacheKey(chunkX, chunkZ) {
  return `${chunkX},${chunkZ}`;
}

function chunkProgramCacheKey(context, chunkX, chunkZ) {
  return `${context.chunkProgramId.toBase58()}:${chunkCacheKey(chunkX, chunkZ)}`;
}

function resourceDropProgramCacheKey(context) {
  return context.chunkProgramId.toBase58();
}

function isResourceDropTableReady(context) {
  const loadedAt = resourceDropTableReadyAtByProgram.get(resourceDropProgramCacheKey(context)) || 0;
  return Boolean(loadedAt && Date.now() - loadedAt < resourceDropTableCacheTtlMs);
}

function markResourceDropTableReady(context) {
  resourceDropTableReadyAtByProgram.set(resourceDropProgramCacheKey(context), Date.now());
}

function readFreshChunkDeltaCache(key) {
  const entry = chunkDeltaCache.get(key);
  if (!entry || entry.promise) return null;
  return Date.now() - entry.loadedAt < chunkDeltaCacheTtlMs ? entry.deltas : null;
}

function invalidateChunkDeltaCache(chunkX, chunkZ) {
  chunkDeltaCache.delete(chunkCacheKey(chunkX, chunkZ));
}

function updateGameplaySessionStatusCache(owner, status) {
  const ownerKey = owner?.toBase58?.() ?? String(owner ?? "");
  if (!ownerKey || !status) return;
  gameplaySessionStatusCache.set(ownerKey, { status, loadedAt: Date.now() });
}

function accountLamports(account) {
  const value = Number(account?.lamports);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function gameplaySessionReadyKey(owner, sessionAuthority) {
  const ownerKey = owner?.toBase58?.() ?? String(owner ?? "");
  const sessionKey = sessionAuthority?.toBase58?.() ?? String(sessionAuthority ?? "");
  return ownerKey && sessionKey ? `${ownerKey}:${sessionKey}` : "";
}

function markGameplaySessionReady(owner, sessionAuthority, balanceLamports = null) {
  const key = gameplaySessionReadyKey(owner, sessionAuthority);
  if (!key) return;
  gameplaySessionReadyCache.set(key, {
    loadedAt: Date.now(),
    balanceLamports: Number.isFinite(balanceLamports) ? Math.floor(balanceLamports) : null,
  });
}

function isGameplaySessionReadyCached(owner, sessionAuthority) {
  const key = gameplaySessionReadyKey(owner, sessionAuthority);
  if (!key) return false;
  const cached = gameplaySessionReadyCache.get(key);
  return Boolean(cached && Date.now() - cached.loadedAt < gameplaySessionReadyCacheTtlMs);
}

export async function recordBlockPlacementOnChain(_target, _renderType, _toolSlot = 0) {
  return { submitted: false, reason: "chain-placement-disabled" };
}


export function blockChunkX(x) {
  return Math.floor(x / chunkSize);
}

export function blockChunkZ(z) {
  return Math.floor(z / chunkSize);
}

export function blockLocalX(x) {
  return positiveModulo(x, chunkSize);
}

export function blockLocalZ(z) {
  return positiveModulo(z, chunkSize);
}

function treeFellCandidateChunks(block) {
  const xs = [
    blockChunkX(Number(block.x) - treeFellLeafRadius),
    blockChunkX(Number(block.x) + treeFellLeafRadius),
  ];
  const zs = [
    blockChunkZ(Number(block.z) - treeFellLeafRadius),
    blockChunkZ(Number(block.z) + treeFellLeafRadius),
  ];
  const chunks = [];
  const seen = new Set();
  for (const chunkX of xs) {
    for (const chunkZ of zs) {
      const key = chunkCacheKey(chunkX, chunkZ);
      if (seen.has(key)) continue;
      seen.add(key);
      chunks.push({ chunkX, chunkZ });
    }
  }
  return chunks.slice(0, treeFellMaxChunkCount);
}

export function blockRenderTypeId(type) {
  return blockIdByRenderType.get(type) ?? EMPTY_BLOCK;
}

export function renderTypeForBlockId(blockId) {
  return renderTypeForBlock(blockId) ?? renderTypeByBlockId.get(blockId) ?? null;
}

export function isTreeTrunkBlockId(blockId) {
  return Number(blockId) === WorldMapBlock.Trunk || Number(blockId) === WorldMapBlock.PineTrunk;
}

async function resolveCanonicalMinedBlock(block) {
  const config = loadCachedGlobalConfig() ?? await loadGlobalConfig({ useCache: true });
  const blockId = canonicalBlockIdAt({
    config,
    x: block.x,
    y: block.y,
    z: block.z,
  });
  return {
    ...block,
    blockId,
    type: renderTypeForBlockId(blockId) ?? block.type ?? "stone",
  };
}

async function resolveCanonicalCollapseBlocks(blocks = [], primaryKey = "") {
  const normalized = [];
  const seen = new Set([primaryKey]);
  for (const block of blocks ?? []) {
    if (normalized.length >= supportCollapseMaxOnChainBlocks) break;
    if (!Number.isFinite(block?.x) || !Number.isFinite(block?.y) || !Number.isFinite(block?.z)) continue;
    const key = minedBlockKey(block);
    if (!key || seen.has(key)) continue;
    const resolved = await resolveCanonicalMinedBlock(block);
    if (!isCanonicalMineableBlockId(resolved.blockId)) continue;
    seen.add(key);
    normalized.push(resolved);
  }
  return normalized;
}

function minedBlockKey(block) {
  if (!Number.isFinite(block?.x) || !Number.isFinite(block?.y) || !Number.isFinite(block?.z)) return "";
  return `${Math.trunc(block.x)},${Math.trunc(block.y)},${Math.trunc(block.z)}`;
}

export function isNicechunkChainSyncEnabled() {
  return localStorage.getItem(chainSyncStorageKey) !== "0";
}

function decodeChunkBrokenDeltas(data, chunkX, chunkZ) {
  if (data.length < chunkBrokenHeaderLength) return [];
  if (data.subarray(0, 4).toString("utf8") !== chunkBrokenMagic) return [];
  const count = data.readUInt16LE(6);
  const capacity = data.readUInt16LE(8);
  const minY = data.readInt16LE(10);
  if (count > capacity || data.length !== chunkBrokenHeaderLength + capacity * chunkBrokenRecordLength) return [];

  const deltas = [];
  for (let index = 0; index < count; index += 1) {
    const offset = chunkBrokenHeaderLength + index * chunkBrokenRecordLength;
    const packed = data.readUIntLE(offset, chunkBrokenRecordLength);
    const localX = packed & 0x0f;
    const localZ = (packed >> 4) & 0x0f;
    const yOffset = (packed >> 8) & 0x01ff;
    deltas.push({
      sequence: index + 1,
      x: chunkX * chunkSize + localX,
      y: minY + yOffset,
      z: chunkZ * chunkSize + localZ,
      localX,
      localZ,
      previousBlockId: null,
      newBlockId: EMPTY_BLOCK,
      action: 1,
      toolSlot: 0,
      packed: data.subarray(offset, offset + chunkBrokenRecordLength).toString("hex"),
    });
  }
  return deltas;
}

function decodeBackpack(data) {
  if (data.length !== backpackAccountLength && data.length !== backpackLegacyAccountLength) {
    throw new Error(`Invalid Backpack length: expected ${backpackAccountLength} or ${backpackLegacyAccountLength}, got ${data.length}.`);
  }
  if (data.subarray(0, 8).toString("utf8") !== backpackMagic) {
    throw new Error("Invalid Backpack magic.");
  }
  const version = data.readUInt16LE(8);
  const recordLength = version === backpackLegacyVersion ? backpackLegacyRecordLength : backpackSlotRecordLength;
  const capacity = data.readUInt8(52);
  const itemCount = data.readUInt8(53);
  const readableCount = Math.min(itemCount, capacity, backpackMaxCapacity);
  const records = [];
  const slots = [];
  for (let index = 0; index < readableCount; index += 1) {
    const offset = backpackHeaderLength + index * recordLength;
    const slot = recordLength === backpackLegacyRecordLength
      ? decodeLegacyBackpackSlot(data, offset)
      : decodeBackpackSlot(data, offset);
    slot.index = index;
    slots.push(slot);
    if (slot.kind === "block") records.push(slot.resource);
  }
  return {
    magic: backpackMagic,
    version,
    bump: data.readUInt8(10),
    initialized: data.readUInt8(11) === 1,
    backpackId: data.readBigUInt64LE(12).toString(),
    owner: new PublicKey(data.subarray(20, 52)).toBase58(),
    capacity,
    itemCount,
    state: data.readUInt8(54),
    flags: data.readUInt8(55),
    placed: {
      x: data.readInt32LE(56),
      y: data.readInt16LE(60),
      z: data.readInt32LE(62),
    },
    createdSlot: data.readBigUInt64LE(66).toString(),
    updatedSlot: data.readBigUInt64LE(74).toString(),
    createdAt: data.readBigInt64LE(82).toString(),
    records,
    slots,
  };
}

function decodeLegacyBackpackSlot(data, offset) {
  const resource = decodeBackpackResource(data, offset);
  return {
    kind: "block",
    kindCode: backpackSlotKindBlock,
    category: 0,
    quantity: 1,
    resource,
  };
}

function decodeBackpackSlot(data, offset) {
  const kindCode = data.readUInt8(offset);
  const resource = decodeBackpackResource(data, offset + 8);
  const itemPda = new PublicKey(data.subarray(offset + 28, offset + 60)).toBase58();
  return {
    kind: kindCode === backpackSlotKindItem ? "item" : "block",
    kindCode,
    category: data.readUInt8(offset + 1),
    flags: data.readUInt16LE(offset + 2),
    quantity: data.readUInt32LE(offset + 4),
    resource,
    itemCode: data.readUInt16LE(offset + 18),
    itemId: data.readBigUInt64LE(offset + 20).toString(),
    itemPda,
    volumeMm3: data.readUInt32LE(offset + 60),
  };
}

function decodeBackpackResource(data, offset) {
  const decodedY = decodeBackpackPackedY(data.readInt16LE(offset + 4));
  return {
    worldX: data.readInt32LE(offset),
    worldY: decodedY.worldY,
    worldZ: data.readInt32LE(offset + 6),
    blockId: decodedY.blockId,
    renderType: renderTypeForBlockId(decodedY.blockId),
  };
}

function decodeMarketListing(data) {
  if (data.length !== marketListingLength) {
    throw new Error(`Invalid MarketListing length: expected ${marketListingLength}, got ${data.length}.`);
  }
  if (data.subarray(0, 8).toString("utf8") !== marketListingMagic) {
    throw new Error("Invalid MarketListing magic.");
  }
  const currency = marketCurrencyNames.get(data.readUInt8(53)) ?? "NCK";
  const priceBaseUnits = data.readBigUInt64LE(61);
  const soldSlot = data.readBigUInt64LE(199);
  const soldAt = data.readBigInt64LE(207);
  const buyerBytes = data.subarray(167, 199);
  const hasBuyer = buyerBytes.some((byte) => byte !== 0);
  return {
    magic: marketListingMagic,
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    state: data.readUInt8(11),
    stateLabel: marketStateNames.get(data.readUInt8(11)) ?? "unknown",
    seller: new PublicKey(data.subarray(12, 44)).toBase58(),
    listingId: data.readBigUInt64LE(44).toString(),
    category: marketCategoryNames.get(data.readUInt8(52)) ?? "raw",
    currency,
    source: marketSourceKindNames.get(data.readUInt8(54)) ?? "backpack",
    sourceIndex: data.readUInt16LE(55),
    quantity: data.readUInt32LE(57),
    priceBaseUnits: priceBaseUnits.toString(),
    price: formatMarketBaseUnits(priceBaseUnits, currency),
    itemHash: Buffer.from(data.subarray(69, 101)).toString("hex"),
    sourceInventory: new PublicKey(data.subarray(101, 133)).toBase58(),
    sourceRecord: {
      worldX: data.readInt32LE(133),
      worldY: data.readInt16LE(137),
      worldZ: data.readInt32LE(139),
    },
    createdSlot: data.readBigUInt64LE(143).toString(),
    updatedSlot: data.readBigUInt64LE(151).toString(),
    createdAt: data.readBigInt64LE(159).toString(),
    buyer: hasBuyer ? new PublicKey(buyerBytes).toBase58() : null,
    soldSlot: soldSlot ? soldSlot.toString() : null,
    soldAt: soldAt ? soldAt.toString() : null,
  };
}

function decodeMarketAsset(data) {
  if (data.length !== marketAssetLength) {
    throw new Error(`Invalid MarketAsset length: expected ${marketAssetLength}, got ${data.length}.`);
  }
  if (data.subarray(0, 8).toString("utf8") !== marketAssetMagic) {
    throw new Error("Invalid MarketAsset magic.");
  }
  const itemCode = data.readUInt16LE(145);
  const payloadLength = Math.min(data.readUInt16LE(155), marketAssetPayloadLength);
  const payload = Array.from(data.subarray(157, 157 + payloadLength));
  const dynamicItemId = itemCode === marketDynamicAssetItemCode
    ? new TextDecoder().decode(Uint8Array.from(payload)).replace(/\0+$/, "") || null
    : null;
  return {
    magic: marketAssetMagic,
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    state: data.readUInt8(11),
    stateLabel: data.readUInt8(11) === 1 ? "active" : data.readUInt8(11) === 2 ? "listed" : "unknown",
    owner: new PublicKey(data.subarray(12, 44)).toBase58(),
    assetId: data.readBigUInt64LE(44).toString(),
    category: marketCategoryNames.get(data.readUInt8(52)) ?? "raw",
    quantity: data.readUInt32LE(53),
    itemHash: Buffer.from(data.subarray(57, 89)).toString("hex"),
    listing: data.subarray(89, 121).some((byte) => byte !== 0)
      ? new PublicKey(data.subarray(89, 121)).toBase58()
      : null,
    createdSlot: data.readBigUInt64LE(121).toString(),
    updatedSlot: data.readBigUInt64LE(129).toString(),
    createdAt: data.readBigInt64LE(137).toString(),
    itemCode,
    itemId: marketAssetItemIds.get(itemCode) ?? dynamicItemId,
    stackCount: data.readUInt32LE(147),
    durability: data.readUInt32LE(151),
    payloadLength,
    payload,
  };
}

async function isBlockAlreadyBrokenOnChain(block) {
  const chunkX = blockChunkX(block.x);
  const chunkZ = blockChunkZ(block.z);
  try {
    const deltas = await loadChunkBlockDeltas(chunkX, chunkZ);
    return deltas.some((delta) =>
      delta.x === block.x && delta.y === block.y && delta.z === block.z
    );
  } catch (error) {
    reportRpcError(error, "already-broken-check");
    throw error;
  }
}

function decodeGlobalConfig(data) {
  if (data.length !== globalConfigLength) {
    throw new Error(`Invalid GlobalConfig length: expected ${globalConfigLength}, got ${data.length}.`);
  }
  if (data.subarray(0, 8).toString("utf8") !== globalConfigMagic) {
    throw new Error("Invalid GlobalConfig magic.");
  }
  return {
    magic: globalConfigMagic,
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    initialized: data.readUInt8(11) === 1,
    nckMint: new PublicKey(data.subarray(12, 44)).toBase58(),
    nckDecimals: data.readUInt8(44),
    nckGenesisSupply: data.readBigUInt64LE(45).toString(),
    developmentWallet: new PublicKey(data.subarray(53, 85)).toBase58(),
    worldId: data.readUInt16LE(85),
    worldSeed: Buffer.from(data.subarray(87, 119)),
    terrainConfigHash: Buffer.from(data.subarray(119, 151)).toString("hex"),
    resourceRuleHash: Buffer.from(data.subarray(151, 183)).toString("hex"),
    clientWorldConfigHash: Buffer.from(data.subarray(183, 215)).toString("hex"),
    chunkSize: data.readUInt16LE(259),
    sectionHeight: data.readUInt16LE(261),
    minBuildY: data.readInt16LE(263),
    maxBuildY: data.readInt16LE(265),
    maxTerrainHeight: data.readInt16LE(267),
    seaLevel: data.readInt16LE(269),
    guardianRegionSizeChunks: data.readUInt16LE(271),
    guardianRealtimeRadiusChunks: data.readUInt16LE(273),
    mineCooldownSlots: data.readUInt16LE(275),
    genesisSlot: data.readBigUInt64LE(277).toString(),
    createdAt: data.readBigInt64LE(285).toString(),
  };
}

function decodePlayerProfile(data) {
  if (data.length !== playerProfileLength && data.length !== legacyPlayerProfileLength) {
    throw new Error(
      `Invalid PlayerProfile length: expected ${playerProfileLength} or ${legacyPlayerProfileLength}, got ${data.length}.`,
    );
  }
  if (data.subarray(0, 8).toString("utf8") !== "NCKPLY01") {
    throw new Error("Invalid PlayerProfile magic.");
  }
  return {
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    initialized: data.readUInt8(11) === 1,
    owner: new PublicKey(data.subarray(12, 44)).toBase58(),
    globalConfig: new PublicKey(data.subarray(44, 76)).toBase58(),
    worldId: data.readUInt16LE(76),
    position: {
      x: data.readInt32LE(78),
      y: data.readInt32LE(82),
      z: data.readInt32LE(86),
    },
    equippedBackpack: data.length === playerProfileLength
      ? new PublicKey(data.subarray(393, 425)).toBase58()
      : PublicKey.default.toBase58(),
  };
}

function decodePlayerLoadout(data) {
  if (data.length !== playerLoadoutLength) {
    throw new Error(`Invalid PlayerLoadout length: expected ${playerLoadoutLength}, got ${data.length}.`);
  }
  if (data.subarray(0, 8).toString("utf8") !== playerLoadoutMagic) {
    throw new Error("Invalid PlayerLoadout magic.");
  }
  const slotCount = data.readUInt8(78);
  const slots = [];
  const decoder = new TextDecoder();
  for (let slot = 0; slot < slotCount; slot += 1) {
    const offset = playerLoadoutHeaderLength + slot * playerLoadoutSlotRecordLength;
    const codeLength = data.readUInt16LE(offset + 4);
    const boundedLength = Math.min(codeLength, playerLoadoutSlotCodeMaxLength);
    const codeBytes = data.subarray(
      offset + playerLoadoutSlotHeaderLength,
      offset + playerLoadoutSlotHeaderLength + boundedLength,
    );
    slots.push({
      slot,
      equipped: data.readUInt8(offset) === 1 && boundedLength > 0,
      flags: data.readUInt16LE(offset + 2),
      codeLength,
      code: decoder.decode(codeBytes),
    });
  }
  return {
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    initialized: data.readUInt8(11) === 1,
    owner: new PublicKey(data.subarray(12, 44)).toBase58(),
    globalConfig: new PublicKey(data.subarray(44, 76)).toBase58(),
    worldId: data.readUInt16LE(76),
    slotCount,
    slotCodeMaxLength: data.readUInt16LE(80),
    revision: data.readBigUInt64LE(82).toString(),
    updatedSlot: data.readBigUInt64LE(90).toString(),
    updatedAt: data.readBigInt64LE(98).toString(),
    slots,
  };
}

function serializeGlobalConfigForStorage(config) {
  return {
    ...config,
    worldSeed: undefined,
    worldSeedHex: Buffer.from(config.worldSeed).toString("hex"),
    loadError: undefined,
  };
}

function createInitializePlayerInstruction(authority, playerProfile) {
  return new TransactionInstruction({
    programId: playerProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([0]),
  });
}

function createSetEquippedBackpackInstruction({ authority, playerProfile, backpack }) {
  return new TransactionInstruction({
    programId: playerProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: true },
      { pubkey: backpack, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([5]),
  });
}

function createSetLoadoutSlotCodeInstruction({ authority, playerLoadout, slot, codeBytes }) {
  if (!(codeBytes instanceof Uint8Array)) {
    throw new Error("Loadout code bytes are required.");
  }
  if (codeBytes.length > playerLoadoutSlotCodeMaxLength) {
    throw new Error(`Loadout code is too large: ${codeBytes.length}/${playerLoadoutSlotCodeMaxLength}.`);
  }
  const data = Buffer.alloc(4 + codeBytes.length);
  data.writeUInt8(6, 0);
  data.writeUInt8(slot, 1);
  data.writeUInt16LE(codeBytes.length, 2);
  Buffer.from(codeBytes).copy(data, 4);
  return new TransactionInstruction({
    programId: playerProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerLoadout, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function createOrRefreshPlayerSessionInstruction({
  owner,
  sessionAuthority,
  playerProfile,
  playerSession,
  expiresAt,
}) {
  const data = Buffer.alloc(15);
  data.writeUInt8(4, 0);
  data.writeBigInt64LE(BigInt(expiresAt), 1);
  data.writeUInt16LE(sessionAllowedActions, 9);
  data.writeUInt32LE(sessionMaxActions, 11);

  return new TransactionInstruction({
    programId: playerProgramId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: sessionAuthority, isSigner: true, isWritable: false },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: playerSession, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function createMineBlockInstruction({ authority, block, owner, expectedBlockId, context = gameContext }) {
  if (!owner) throw new Error("owner is required for canonical mining");
  if (!Number.isInteger(expectedBlockId)) throw new Error("expectedBlockId is required for canonical mining");
  const [chunkBrokenPda] = deriveChunkBrokenPdaForContext(blockChunkX(block.x), blockChunkZ(block.z), context);
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, authority);
  const data = Buffer.alloc(13);
  data.writeUInt8(5, 0);
  data.writeInt32LE(block.x, 1);
  data.writeInt16LE(block.y, 5);
  data.writeInt32LE(block.z, 7);
  data.writeUInt16LE(expectedBlockId, 11);

  return new TransactionInstruction({
    programId: context.chunkProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: playerSession, isSigner: false, isWritable: false },
      { pubkey: chunkBrokenPda, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: contextInstructionData(context, gameNamespaceChunk, data),
  });
}

function createMineBlockWithRewardsInstruction({ authority, block, owner, backpack, expectedBlockId, context = gameContext }) {
  if (!owner) throw new Error("owner is required for canonical mining");
  if (!backpack) throw new Error("backpack is required for reward mining");
  if (!Number.isInteger(expectedBlockId)) throw new Error("expectedBlockId is required for canonical mining");
  const [chunkBrokenPda] = deriveChunkBrokenPdaForContext(blockChunkX(block.x), blockChunkZ(block.z), context);
  const [resourceDropTable] = deriveResourceDropTablePdaForContext(context);
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, authority);
  const [playerProgress] = derivePlayerProgressPdaForContext(owner, context);
  const data = Buffer.alloc(13);
  data.writeUInt8(8, 0);
  data.writeInt32LE(block.x, 1);
  data.writeInt16LE(block.y, 5);
  data.writeInt32LE(block.z, 7);
  data.writeUInt16LE(expectedBlockId, 11);

  return new TransactionInstruction({
    programId: context.chunkProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: playerSession, isSigner: false, isWritable: false },
      { pubkey: playerProgress, isSigner: false, isWritable: true },
      { pubkey: chunkBrokenPda, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: resourceDropTable, isSigner: false, isWritable: false },
      { pubkey: context.backpackProgramId, isSigner: false, isWritable: false },
      { pubkey: backpack, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: contextInstructionData(context, gameNamespaceChunk, data),
  });
}

function createFellTreeWithRewardsInstruction({ authority, block, owner, backpack, expectedBlockId, chunks = [], context = gameContext }) {
  if (!owner) throw new Error("owner is required for tree felling");
  if (!backpack) throw new Error("backpack is required for tree felling");
  if (!Number.isInteger(expectedBlockId)) throw new Error("expectedBlockId is required for tree felling");
  const normalizedChunks = Array.isArray(chunks) ? chunks.slice(0, treeFellMaxChunkCount) : [];
  if (!normalizedChunks.length) throw new Error("at least one chunk is required for tree felling");
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, authority);
  const [playerProgress] = derivePlayerProgressPdaForContext(owner, context);
  const data = Buffer.alloc(13);
  data.writeUInt8(9, 0);
  data.writeInt32LE(block.x, 1);
  data.writeInt16LE(block.y, 5);
  data.writeInt32LE(block.z, 7);
  data.writeUInt16LE(expectedBlockId, 11);

  return new TransactionInstruction({
    programId: context.chunkProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: playerSession, isSigner: false, isWritable: false },
      { pubkey: playerProgress, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: context.backpackProgramId, isSigner: false, isWritable: false },
      { pubkey: backpack, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...normalizedChunks.map((chunk) => ({
        pubkey: deriveChunkBrokenPdaForContext(chunk.chunkX, chunk.chunkZ, context)[0],
        isSigner: false,
        isWritable: true,
      })),
    ],
    data: contextInstructionData(context, gameNamespaceChunk, data),
  });
}

function createInitializeChunkBrokenInstruction({ authority, chunkX, chunkZ, context = gameContext }) {
  const [chunkBrokenPda] = deriveChunkBrokenPdaForContext(chunkX, chunkZ, context);
  const data = Buffer.alloc(9);
  data.writeUInt8(6, 0);
  data.writeInt32LE(chunkX, 1);
  data.writeInt32LE(chunkZ, 5);

  return new TransactionInstruction({
    programId: context.chunkProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: chunkBrokenPda, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: contextInstructionData(context, gameNamespaceChunk, data),
  });
}

function createInitializeResourceDropTableInstruction({ authority, rules = resourceDropRules, context = gameContext }) {
  const [resourceDropTable] = deriveResourceDropTablePdaForContext(context);
  const normalizedRules = Array.isArray(rules) ? rules : [];
  if (!normalizedRules.length || normalizedRules.length > 64) {
    throw new Error(`Invalid ${resourceDropRuleSet} rule count: ${normalizedRules.length}`);
  }
  const data = Buffer.alloc(2 + normalizedRules.length * resourceDropRuleLength);
  data.writeUInt8(7, 0);
  data.writeUInt8(normalizedRules.length, 1);
  normalizedRules.forEach((rule, index) => {
    const offset = 2 + index * resourceDropRuleLength;
    data.writeUInt16LE(rule.sourceBlockId, offset);
    data.writeUInt16LE(rule.dropBlockId, offset + 2);
    data.writeUInt16LE(rule.chanceBps, offset + 4);
    data.writeInt16LE(rule.minAltitude, offset + 6);
    data.writeInt16LE(rule.maxAltitude, offset + 8);
    data.writeInt16LE(rule.minDepth, offset + 10);
    data.writeInt16LE(rule.maxDepth, offset + 12);
    data.writeUInt8(rule.salt, offset + 14);
    data.writeUInt32LE(rule.minVolumeMm3, offset + 15);
    data.writeUInt32LE(rule.maxVolumeMm3, offset + 19);
  });

  return new TransactionInstruction({
    programId: context.chunkProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: resourceDropTable, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: contextInstructionData(context, gameNamespaceChunk, data),
  });
}

function createInitializeBackpackInstruction({ owner, playerProfile, backpack, backpackId, capacity = backpackDefaultCapacity, context = gameContext }) {
  const data = Buffer.alloc(10);
  data.writeUInt8(0, 0);
  data.writeBigUInt64LE(BigInt(backpackId), 1);
  data.writeUInt8(capacity, 9);
  return new TransactionInstruction({
    programId: context.backpackProgramId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: backpack, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: contextInstructionData(context, gameNamespaceBackpack, data),
  });
}

function createAppendMinedResourceInstruction({ owner, sessionAuthority, backpack, block, volumeMm3 = 0, context = gameContext }) {
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, sessionAuthority);
  const encodedVolume = Math.max(0, Math.min(0xffffffff, Math.floor(Number(volumeMm3) || 0)));
  const data = Buffer.alloc(encodedVolume > 0 ? 15 : 11);
  data.writeUInt8(1, 0);
  data.writeInt32LE(block.x, 1);
  data.writeInt16LE(encodeBackpackPackedY(block.y, block.blockId ?? blockRenderTypeId(block.type)), 5);
  data.writeInt32LE(block.z, 7);
  if (encodedVolume > 0) data.writeUInt32LE(encodedVolume, 11);
  return new TransactionInstruction({
    programId: context.backpackProgramId,
    keys: [
      { pubkey: sessionAuthority, isSigner: true, isWritable: false },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: playerSession, isSigner: false, isWritable: false },
      { pubkey: backpack, isSigner: false, isWritable: true },
    ],
    data: contextInstructionData(context, gameNamespaceBackpack, data),
  });
}

function createAppendMinedResourcesBatchInstruction({ owner, sessionAuthority, backpack, blocks = [], context = gameContext }) {
  const normalizedBlocks = Array.isArray(blocks) ? blocks.filter(Boolean) : [];
  if (!normalizedBlocks.length) throw new Error("blocks are required for batch resource append");
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, sessionAuthority);
  const data = Buffer.alloc(2 + normalizedBlocks.length * 10);
  data.writeUInt8(6, 0);
  data.writeUInt8(normalizedBlocks.length, 1);
  normalizedBlocks.forEach((block, index) => {
    const offset = 2 + index * 10;
    data.writeInt32LE(block.x, offset);
    data.writeInt16LE(encodeBackpackPackedY(block.y, block.blockId ?? blockRenderTypeId(block.type)), offset + 4);
    data.writeInt32LE(block.z, offset + 6);
  });
  return new TransactionInstruction({
    programId: context.backpackProgramId,
    keys: [
      { pubkey: sessionAuthority, isSigner: true, isWritable: false },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: playerSession, isSigner: false, isWritable: false },
      { pubkey: backpack, isSigner: false, isWritable: true },
    ],
    data: contextInstructionData(context, gameNamespaceBackpack, data),
  });
}

function encodeBackpackPackedY(worldY, blockId) {
  const y = Number(worldY);
  const id = Number(blockId);
  const yOffset = y - minBuildY;
  if (
    Number.isInteger(y) &&
    Number.isInteger(yOffset) &&
    yOffset >= 0 &&
    yOffset <= backpackPackedYMask &&
    Number.isInteger(id) &&
    id > 0 &&
    id < (1 << (16 - backpackPackedYBits))
  ) {
    return (id << backpackPackedYBits) | yOffset;
  }
  return y;
}

function decodeBackpackPackedY(packedY) {
  const value = Number(packedY);
  if (!Number.isInteger(value) || value < 0) {
    return { worldY: value, blockId: 0 };
  }
  const blockId = value >> backpackPackedYBits;
  if (blockId <= 0 || !renderTypeForBlockId(blockId)) {
    return { worldY: value, blockId: 0 };
  }
  return {
    worldY: minBuildY + (value & backpackPackedYMask),
    blockId,
  };
}

function createRemoveBackpackResourceInstruction({ owner, sessionAuthority = null, backpack, index, context = gameContext }) {
  const data = Buffer.alloc(2);
  data.writeUInt8(2, 0);
  data.writeUInt8(index, 1);
  if (sessionAuthority) {
    const [playerProfile] = derivePlayerProfilePda(owner);
    const [playerSession] = derivePlayerSessionPda(owner, sessionAuthority);
    return new TransactionInstruction({
      programId: context.backpackProgramId,
      keys: [
        { pubkey: sessionAuthority, isSigner: true, isWritable: false },
        { pubkey: playerProfile, isSigner: false, isWritable: false },
        { pubkey: playerSession, isSigner: false, isWritable: false },
        { pubkey: backpack, isSigner: false, isWritable: true },
      ],
      data: contextInstructionData(context, gameNamespaceBackpack, data),
    });
  }
  return new TransactionInstruction({
    programId: context.backpackProgramId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: backpack, isSigner: false, isWritable: true },
    ],
    data: contextInstructionData(context, gameNamespaceBackpack, data),
  });
}

function createRemoveBackpackResourcesInstruction({ owner, sessionAuthority = null, backpack, indexes = [], context = gameContext }) {
  const normalizedIndexes = Array.from(new Set(indexes
    .map((index) => Number(index))
    .filter((index) => Number.isInteger(index) && index >= 0 && index <= 98)));
  const data = Buffer.alloc(2 + normalizedIndexes.length);
  data.writeUInt8(4, 0);
  data.writeUInt8(normalizedIndexes.length, 1);
  normalizedIndexes.forEach((index, offset) => data.writeUInt8(index, 2 + offset));
  if (sessionAuthority) {
    const [playerProfile] = derivePlayerProfilePda(owner);
    const [playerSession] = derivePlayerSessionPda(owner, sessionAuthority);
    return new TransactionInstruction({
      programId: context.backpackProgramId,
      keys: [
        { pubkey: sessionAuthority, isSigner: true, isWritable: false },
        { pubkey: playerProfile, isSigner: false, isWritable: false },
        { pubkey: playerSession, isSigner: false, isWritable: false },
        { pubkey: backpack, isSigner: false, isWritable: true },
      ],
      data: contextInstructionData(context, gameNamespaceBackpack, data),
    });
  }
  return new TransactionInstruction({
    programId: context.backpackProgramId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: backpack, isSigner: false, isWritable: true },
    ],
    data: contextInstructionData(context, gameNamespaceBackpack, data),
  });
}

function createExecuteSmeltingInstruction({
  owner,
  recipeTable,
  backpack,
  recipeId,
  inputIndexes = [],
  fuelIndexes = [],
  batchMultiplier = 1,
  context = gameContext,
}) {
  const [smeltingAuthority] = deriveSmeltingAuthorityPdaForContext(context);
  const [playerProgress] = derivePlayerProgressPdaForContext(owner, context);
  const globalConfig = deriveGlobalConfigPda();
  const inputs = normalizeBackpackIndexes(inputIndexes);
  const fuels = normalizeBackpackIndexes(fuelIndexes);
  const multiplier = Math.max(1, Math.min(0xffff, Math.floor(Number(batchMultiplier) || 1)));
  const data = Buffer.alloc(13 + inputs.length + fuels.length);
  data.writeUInt8(2, 0);
  data.writeBigUInt64LE(BigInt(recipeId), 1);
  data.writeUInt8(inputs.length, 9);
  data.writeUInt8(fuels.length, 10);
  data.writeUInt16LE(multiplier, 11);
  inputs.forEach((index, offset) => data.writeUInt8(index, 13 + offset));
  fuels.forEach((index, offset) => data.writeUInt8(index, 13 + inputs.length + offset));
  return new TransactionInstruction({
    programId: context.smeltingProgramId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: recipeTable, isSigner: false, isWritable: false },
      { pubkey: backpack, isSigner: false, isWritable: true },
      { pubkey: playerProgress, isSigner: false, isWritable: true },
      { pubkey: globalConfig, isSigner: false, isWritable: false },
      { pubkey: smeltingAuthority, isSigner: false, isWritable: false },
      { pubkey: context.backpackProgramId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: contextInstructionData(context, gameNamespaceSmelting, data),
  });
}

function createInitializeMarketAssetInstruction({
  owner,
  asset,
  assetId,
  category,
  quantity,
  itemHash,
  assetDetails,
  context = gameContext,
}) {
  const categoryCode = marketCategoryCodes.get(category);
  if (!categoryCode) throw new Error(`Unsupported market category: ${category}`);
  const normalizedQuantity = Math.max(1, Math.min(2 ** 32 - 1, Number(quantity) || 1));
  const hash = Buffer.from(itemHash);
  if (hash.length !== 32) throw new Error("Invalid market item hash.");
  const details = assetDetails ?? {
    itemCode: 0,
    itemId: null,
    stackCount: normalizedQuantity,
    durability: 0,
    payloadLength: 0,
    payload: [],
  };
  const payload = Buffer.alloc(marketAssetPayloadLength);
  Buffer.from(details.payload ?? []).copy(payload, 0, 0, marketAssetPayloadLength);
  const data = Buffer.alloc(154);
  data.writeUInt8(3, 0);
  data.writeBigUInt64LE(BigInt(assetId), 1);
  data.writeUInt8(categoryCode, 9);
  data.writeUInt32LE(normalizedQuantity, 10);
  hash.copy(data, 14);
  data.writeUInt16LE(details.itemCode, 46);
  data.writeUInt32LE(details.stackCount, 48);
  data.writeUInt32LE(details.durability, 52);
  data.writeUInt16LE(details.payloadLength, 56);
  payload.copy(data, 58);
  return new TransactionInstruction({
    programId: context.marketProgramId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: asset, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: contextInstructionData(context, gameNamespaceMarket, data),
  });
}

function createMarketListingInstruction({
  seller,
  listing,
  listingId,
  category,
  currency,
  sourceKind,
  sourceIndex,
  quantity,
  priceBaseUnits,
  itemHash,
  sourceInventory,
  sourceRecord,
  context = gameContext,
}) {
  const categoryCode = marketCategoryCodes.get(category);
  const currencyCode = marketCurrencyCodes.get(currency);
  const sourceKindCode = marketSourceKindCodes.get(sourceKind);
  if (!categoryCode) throw new Error(`Unsupported market category: ${category}`);
  if (!currencyCode) throw new Error(`Unsupported market currency: ${currency}`);
  if (!sourceKindCode) throw new Error(`Unsupported market source: ${sourceKind}`);
  const normalizedSourceIndex = Math.max(0, Math.min(65535, Number(sourceIndex) || 0));
  const normalizedQuantity = Math.max(1, Math.min(2 ** 32 - 1, Number(quantity) || 1));
  const hash = Buffer.from(itemHash);
  if (hash.length !== 32) throw new Error("Invalid market item hash.");
  const sourceInventoryKey = sourceInventory ? new PublicKey(sourceInventory) : PublicKey.default;
  const record = sourceRecord ?? {};

  const data = Buffer.alloc(100);
  data.writeUInt8(0, 0);
  data.writeBigUInt64LE(BigInt(listingId), 1);
  data.writeUInt8(categoryCode, 9);
  data.writeUInt8(currencyCode, 10);
  data.writeUInt8(sourceKindCode, 11);
  data.writeUInt16LE(normalizedSourceIndex, 12);
  data.writeUInt32LE(normalizedQuantity, 14);
  data.writeBigUInt64LE(BigInt(priceBaseUnits), 18);
  hash.copy(data, 26);
  sourceInventoryKey.toBuffer().copy(data, 58);
  data.writeInt32LE(Number(record.worldX ?? 0), 90);
  data.writeInt16LE(Number(record.worldY ?? 0), 94);
  data.writeInt32LE(Number(record.worldZ ?? 0), 96);

  const keys = [
    { pubkey: seller, isSigner: true, isWritable: true },
    { pubkey: listing, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  if (sourceKind === "backpack") {
    keys.push(
      { pubkey: sourceInventoryKey, isSigner: false, isWritable: true },
      { pubkey: context.backpackProgramId, isSigner: false, isWritable: false },
    );
  } else if (sourceKind === "asset") {
    keys.push({ pubkey: sourceInventoryKey, isSigner: false, isWritable: true });
  }

  return new TransactionInstruction({
    programId: context.marketProgramId,
    keys,
    data: contextInstructionData(context, gameNamespaceMarket, data),
  });
}

function createCancelMarketListingInstruction({ seller, listing, source = null, sourceInventory = null, context = gameContext }) {
  const keys = [
    { pubkey: seller, isSigner: true, isWritable: true },
    { pubkey: listing, isSigner: false, isWritable: true },
  ];
  if (source === "backpack" && sourceInventory) {
    keys.push(
      { pubkey: new PublicKey(sourceInventory), isSigner: false, isWritable: true },
      { pubkey: context.backpackProgramId, isSigner: false, isWritable: false },
      { pubkey: deriveMarketAuthorityPdaForContext(context)[0], isSigner: false, isWritable: false },
    );
  } else if (source === "asset" && sourceInventory) {
    keys.push({ pubkey: new PublicKey(sourceInventory), isSigner: false, isWritable: true });
  }
  return new TransactionInstruction({
    programId: context.marketProgramId,
    keys,
    data: contextInstructionData(context, gameNamespaceMarket, Buffer.from([1])),
  });
}

function createBuyMarketListingInstruction({
  buyer,
  seller,
  listing,
  currency,
  buyerNckToken = null,
  sellerNckToken = null,
  treasuryNckToken = null,
  source = null,
  sourceInventory = null,
  buyerBackpackAddress = null,
  context = gameContext,
}) {
  const normalizedCurrency = String(currency || "NCK").toUpperCase();
  const keys = [
    { pubkey: buyer, isSigner: true, isWritable: true },
    { pubkey: seller, isSigner: false, isWritable: true },
    { pubkey: listing, isSigner: false, isWritable: true },
  ];
  if (normalizedCurrency === "NCK") {
    if (!buyerNckToken || !sellerNckToken || !treasuryNckToken) {
      throw new Error("NCK purchase requires buyer, seller, and treasury token accounts.");
    }
    keys.push(
      { pubkey: buyerNckToken, isSigner: false, isWritable: true },
      { pubkey: sellerNckToken, isSigner: false, isWritable: true },
      { pubkey: treasuryNckToken, isSigner: false, isWritable: true },
      { pubkey: nckMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    );
  } else if (normalizedCurrency === "SOL") {
    keys.push(
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: marketTreasury, isSigner: false, isWritable: true },
    );
  } else {
    throw new Error(`Unsupported market currency: ${currency}`);
  }
  if (source === "backpack") {
    if (!buyerBackpackAddress) throw new Error("Backpack listing purchase requires a buyer backpack.");
    keys.push(
      { pubkey: new PublicKey(buyerBackpackAddress), isSigner: false, isWritable: true },
      { pubkey: context.backpackProgramId, isSigner: false, isWritable: false },
      { pubkey: deriveMarketAuthorityPdaForContext(context)[0], isSigner: false, isWritable: false },
    );
  } else if (source === "asset") {
    if (!sourceInventory) throw new Error("Asset listing purchase requires an asset account.");
    keys.push({ pubkey: new PublicKey(sourceInventory), isSigner: false, isWritable: true });
  }
  return new TransactionInstruction({
    programId: context.marketProgramId,
    keys,
    data: contextInstructionData(context, gameNamespaceMarket, Buffer.from([2])),
  });
}

async function getOrCreateGameplaySession(provider) {
  const owner = provider.publicKey;
  const stored = loadStoredGameplaySession(owner);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const conn = getNicechunkConnection();
  if (stored && stored.expiresAt > nowSeconds + sessionRefreshSkewSeconds) {
    const [playerSession] = derivePlayerSessionPda(owner, stored.keypair.publicKey);
    if (isGameplaySessionReadyCached(owner, stored.keypair.publicKey)) return stored;
    const [account, sessionAccount] = await conn.getMultipleAccountsInfo(
      [playerSession, stored.keypair.publicKey],
      "confirmed",
    );
    const sessionBalance = accountLamports(sessionAccount);
    if (account?.data?.length) {
      await fundGameplaySessionIfNeeded(provider, stored.keypair.publicKey, sessionBalance, conn);
      const configuredFundingLamports = getConfiguredGameplaySessionFundingLamports(owner);
      const effectiveBalance = sessionBalance < minimumSessionFundingLamports
        ? Math.max(sessionBalance, configuredFundingLamports)
        : sessionBalance;
      updateGameplaySessionStatusCache(owner, {
        walletAvailable: true,
        owner: owner.toBase58(),
        acknowledged: hasAcknowledgedGameplaySessionFunding(owner),
        configuredFundingLamports,
        minimumFundingLamports: minimumSessionFundingLamports,
        balanceLamports: effectiveBalance,
        balanceSol: effectiveBalance / lamportsPerSol,
        publicKey: stored.keypair.publicKey.toBase58(),
        expiresAt: stored.expiresAt,
      });
      markGameplaySessionReady(owner, stored.keypair.publicKey, effectiveBalance);
      return stored;
    }
  }

  const keypair = stored?.keypair ?? Keypair.generate();
  const expiresAt = nowSeconds + sessionDurationSeconds;
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, keypair.publicKey);
  const tx = new Transaction();
  const [profileAccount, sessionAccount] = await conn.getMultipleAccountsInfo(
    [playerProfile, keypair.publicKey],
    "confirmed",
  );
  const sessionBalance = accountLamports(sessionAccount);

  if (!profileAccount?.data?.length) {
    tx.add(createInitializePlayerInstruction(owner, playerProfile));
  }
  const targetLamports = sessionBalance < minimumSessionFundingLamports
    ? getConfiguredGameplaySessionFundingLamports(owner)
    : sessionBalance;
  if (sessionBalance < targetLamports) {
    tx.add(SystemProgram.transfer({
      fromPubkey: owner,
      toPubkey: keypair.publicKey,
      lamports: targetLamports - sessionBalance,
    }));
  }
  tx.add(createOrRefreshPlayerSessionInstruction({
    owner,
    sessionAuthority: keypair.publicKey,
    playerProfile,
    playerSession,
    expiresAt,
  }));

  await signAndSendWalletTransaction(provider, tx, conn, [keypair]);
  const session = { keypair, expiresAt };
  storeGameplaySession(owner, session);
  markGameplaySessionReady(owner, keypair.publicKey, targetLamports);
  updateGameplaySessionStatusCache(owner, {
    walletAvailable: true,
    owner: owner.toBase58(),
    acknowledged: hasAcknowledgedGameplaySessionFunding(owner),
    configuredFundingLamports: getConfiguredGameplaySessionFundingLamports(owner),
    minimumFundingLamports: minimumSessionFundingLamports,
    balanceLamports: targetLamports,
    balanceSol: targetLamports / lamportsPerSol,
    publicKey: keypair.publicKey.toBase58(),
    expiresAt,
  });
  return session;
}

async function fundGameplaySessionIfNeeded(provider, sessionAuthority, sessionBalance, conn) {
  if (sessionBalance >= minimumSessionFundingLamports) return;
  const targetLamports = getConfiguredGameplaySessionFundingLamports(provider.publicKey);
  if (sessionBalance >= targetLamports) return;
  const lamports = targetLamports - sessionBalance;
  if (lamports <= 0) return;
  const tx = new Transaction();
  tx.add(SystemProgram.transfer({
    fromPubkey: provider.publicKey,
    toPubkey: sessionAuthority,
    lamports,
  }));
  await signAndSendWalletTransaction(provider, tx, conn);
}

async function loadEquippedBackpackForOwner(owner, conn = getNicechunkConnection()) {
  const cachedRecord = loadEquippedBackpackRecord(owner);
  if (cachedRecord?.backpack) {
    const cachedBackpack = await loadBackpackAccountForOwner(cachedRecord.backpack, owner, conn).catch(() => null);
    if (cachedBackpack) return cachedBackpack;
    clearEquippedBackpackRecord(owner);
  }

  const [playerProfile] = derivePlayerProfilePda(owner);
  const playerAccount = await conn.getAccountInfo(playerProfile, "confirmed");
  if (!playerAccount?.data?.length) return null;
  const profile = decodePlayerProfile(playerAccount.data);
  if (profile.owner !== owner.toBase58()) return null;
  if (!profile.equippedBackpack || profile.equippedBackpack === PublicKey.default.toBase58()) return null;
  const backpack = await loadBackpackAccountForOwner(profile.equippedBackpack, owner, conn);
  if (!backpack?.publicKey) return null;
  storeEquippedBackpackRecord(owner, {
    backpack: backpack.publicKey.toBase58(),
    backpackId: backpack.backpackId ?? "0",
    owner: owner.toBase58(),
    equippedAt: Date.now(),
    programId: backpack.programId ?? null,
  });
  return backpack;
}

async function loadBackpackAccountForOwner(backpackAddress, owner, conn = getNicechunkConnection()) {
  const publicKey = new PublicKey(backpackAddress);
  const account = await conn.getAccountInfo(publicKey, "confirmed");
  if (!account?.data?.length) return null;
  if (!account.owner.equals(gameProgramId)) return null;
  if (!isCurrentBackpackAccountData(account.data)) return null;
  const decoded = decodeBackpack(account.data);
  if (decoded.owner !== owner.toBase58()) {
    return null;
  }
  return { ...decoded, publicKey, programId: account.owner.toBase58() };
}

function isCurrentBackpackAccountData(data) {
  return Boolean(
    data?.length === backpackAccountLength &&
    data.subarray(0, 8).toString("utf8") === backpackMagic &&
    data.readUInt16LE(8) === backpackVersion,
  );
}

function loadStoredGameplaySession(owner) {
  try {
    if (!hasLocalStorage()) return null;
    const raw = localStorage.getItem(sessionStorageKey(owner));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.secretKey || !Number.isFinite(parsed.expiresAt)) return null;
    const secretKey = base64ToBytes(parsed.secretKey);
    const keypair = Keypair.fromSecretKey(secretKey);
    if (parsed.publicKey && keypair.publicKey.toBase58() !== parsed.publicKey) return null;
    return { keypair, expiresAt: Number(parsed.expiresAt) };
  } catch {
    return null;
  }
}

function loadEquippedBackpackRecord(owner) {
  try {
    if (!hasLocalStorage()) return null;
    const raw = localStorage.getItem(equippedBackpackStorageKey(owner));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.backpack || !parsed?.backpackId) return null;
    if (parsed.programId !== gameProgramId.toBase58()) {
      clearEquippedBackpackRecord(owner);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function storeEquippedBackpackRecord(owner, record) {
  if (!hasLocalStorage()) return;
  localStorage.setItem(equippedBackpackStorageKey(owner), JSON.stringify(record));
}

function clearEquippedBackpackRecord(owner) {
  if (!hasLocalStorage()) return;
  localStorage.removeItem(equippedBackpackStorageKey(owner));
}

function storeGameplaySession(owner, session) {
  if (!hasLocalStorage()) return;
  localStorage.setItem(sessionStorageKey(owner), JSON.stringify({
    publicKey: session.keypair.publicKey.toBase58(),
    secretKey: bytesToBase64(session.keypair.secretKey),
    expiresAt: session.expiresAt,
    savedAt: Date.now(),
  }));
}

function sessionStorageKey(owner) {
  return `${sessionStorageKeyPrefix}${owner.toBase58()}`;
}

function equippedBackpackStorageKey(owner) {
  return `${equippedBackpackStorageKeyPrefix}${owner.toBase58()}`;
}

function sessionFundingStorageKey(owner = null) {
  const suffix = sessionOwnerStorageSuffix(owner);
  return `${sessionFundingStorageKeyPrefix}${suffix}`;
}

function sessionFundingAcknowledgedKey(owner = null) {
  const suffix = sessionOwnerStorageSuffix(owner);
  return `${sessionFundingAcknowledgedKeyPrefix}${suffix}`;
}

function sessionOwnerStorageSuffix(owner = null) {
  if (typeof owner === "string" && owner) return owner;
  return owner?.toBase58?.() ?? "default";
}

function storedWalletPublicKey() {
  try {
    if (!hasLocalStorage()) return null;
    const value = localStorage.getItem(storageWalletKey);
    return value ? new PublicKey(value) : null;
  } catch {
    return null;
  }
}

function createBackpackId() {
  const time = BigInt(Date.now()) & ((1n << 42n) - 1n);
  const random = BigInt(Math.floor(Math.random() * 2 ** 22));
  return (time << 22n) | random;
}

function createMarketListingId() {
  const time = BigInt(Date.now()) & ((1n << 42n) - 1n);
  const random = BigInt(Math.floor(Math.random() * 2 ** 22));
  return (time << 22n) | random;
}

function createMarketAssetId() {
  const time = BigInt(Date.now()) & ((1n << 42n) - 1n);
  const random = BigInt(Math.floor(Math.random() * 2 ** 22));
  return (time << 22n) | random;
}

function parseMarketPriceBaseUnits(value, currency) {
  const decimals = marketCurrencyDecimals.get(currency) ?? 6;
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error("Invalid market listing price.");
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Price supports at most ${decimals} decimal places for ${currency}.`);
  }
  const paddedFraction = fraction.padEnd(decimals, "0");
  const amount = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(paddedFraction || "0");
  if (amount <= 0n || amount > 2n ** 64n - 1n) throw new Error("Invalid market listing price.");
  return amount;
}

function formatMarketBaseUnits(value, currency) {
  const decimals = marketCurrencyDecimals.get(currency) ?? 6;
  const amount = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = amount % scale;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

function createMarketAssetDetails(item, quantity = 1) {
  const slot = item?.slot ?? {};
  const itemId = slot.itemId ?? item?.itemId ?? "backpack_resource";
  const itemCode = marketAssetItemCodes.get(itemId) ?? marketDynamicAssetItemCode;
  const stackCount = clampU32(Number.isFinite(slot.count) ? slot.count : quantity);
  const durability = clampU32(Number.isFinite(slot.durability) ? slot.durability : 0);
  const payloadSource = itemId === "forged_item" && Array.isArray(slot.bytes)
    ? slot.bytes
    : itemCode === marketDynamicAssetItemCode
      ? Array.from(new TextEncoder().encode(itemId))
      : [];
  if (payloadSource.length > marketAssetPayloadLength) {
    throw new Error("Market asset payload is too large.");
  }
  return {
    itemCode,
    itemId,
    stackCount,
    durability,
    payloadLength: payloadSource.length,
    payload: [...payloadSource],
  };
}

async function createMarketItemHash({ item, category, currency, quantity, assetDetails = null }) {
  const payload = JSON.stringify({
    id: item?.id ?? "",
    source: item?.source ?? "",
    slotIndex: item?.slotIndex ?? null,
    name: item?.name ?? "",
    meta: item?.meta ?? "",
    category,
    currency,
    quantity,
    record: item?.slot?.record
      ? {
          worldX: item.slot.record.worldX,
          worldY: item.slot.record.worldY,
          worldZ: item.slot.record.worldZ,
        }
      : null,
    code: item?.slot?.code ?? null,
    itemId: item?.slot?.itemId ?? null,
    asset: assetDetails,
  });
  const encoded = new TextEncoder().encode(payload);
  if (crypto?.subtle?.digest) {
    return Buffer.from(await crypto.subtle.digest("SHA-256", encoded));
  }
  let hash = 2166136261;
  for (const byte of encoded) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  const fallback = Buffer.alloc(32);
  for (let index = 0; index < 32; index += 4) {
    fallback.writeUInt32LE(hash >>> 0, index);
    hash = Math.imul(hash ^ index, 16777619);
  }
  return fallback;
}

function clampU32(value) {
  return Math.max(0, Math.min(2 ** 32 - 1, Math.floor(Number(value) || 0)));
}

function getConfiguredGameplaySessionFundingLamports(owner = null) {
  if (!hasLocalStorage()) return minimumSessionFundingLamports;
  const ownerValue = localStorage.getItem(sessionFundingStorageKey(owner));
  const defaultValue = localStorage.getItem(sessionFundingStorageKey(null));
  const parsed = Number(ownerValue ?? defaultValue);
  return Number.isFinite(parsed) && parsed >= minimumSessionFundingLamports
    ? Math.floor(parsed)
    : minimumSessionFundingLamports;
}

async function signAndSendWalletTransaction(provider, transaction, conn = getNicechunkConnection(), extraSigners = []) {
  transaction.feePayer = provider.publicKey;

  if (typeof conn.prepareTransaction === "function") {
    await conn.prepareTransaction(transaction, { commitment: "confirmed" });
  } else {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
  }

  for (const signer of extraSigners) transaction.partialSign(signer);

  if (typeof provider.signTransaction === "function") {
    const signed = await provider.signTransaction(transaction);
    const signature = await sendRawTransactionWithLogs(conn, signed.serialize(), "wallet");
    await confirmTransactionByHttpPolling(conn, {
      signature,
      blockhash: transaction.recentBlockhash,
      lastValidBlockHeight: transaction.lastValidBlockHeight,
    }, "confirmed");
    return signature;
  }

  if (typeof provider.signAndSendTransaction !== "function") {
    throw new Error("Wallet does not support transaction signing.");
  }
  const result = await provider.signAndSendTransaction(transaction);
  const signature = typeof result === "string" ? result : result?.signature;
  if (!signature) throw new Error("Wallet did not return a transaction signature.");
  await confirmTransactionByHttpPolling(conn, {
    signature,
    blockhash: transaction.recentBlockhash,
    lastValidBlockHeight: transaction.lastValidBlockHeight,
  }, "confirmed");
  return signature;
}

async function signAndSendKeypairTransaction(signer, transaction, conn = getNicechunkConnection()) {
  transaction.feePayer = signer.publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.sign(signer);
  const signature = await sendRawTransactionWithLogs(conn, transaction.serialize(), "keypair");
  await confirmTransactionByHttpPolling(conn, { signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
}

async function sendRawTransactionWithLogs(conn, serializedTransaction, context) {
  try {
    return await conn.sendRawTransaction(serializedTransaction, { skipPreflight: false });
  } catch (error) {
    await attachSendTransactionLogs(error, conn, context);
    throw error;
  }
}

async function confirmTransactionByHttpPolling(conn, strategy, commitment = "confirmed") {
  const { signature, lastValidBlockHeight } = strategy;
  const startedAt = Date.now();
  let nextBlockHeightCheckAt = 0;

  while (true) {
    const statusResponse = await conn.getSignatureStatuses([signature]);
    const status = statusResponse?.value?.[0] ?? null;
    if (status?.err) throw createTransactionStatusError(signature, status.err);
    if (hasReachedSignatureCommitment(status, commitment)) {
      return {
        context: statusResponse.context,
        value: { err: null },
      };
    }

    const now = Date.now();
    if (Number.isFinite(lastValidBlockHeight) && now >= nextBlockHeightCheckAt) {
      nextBlockHeightCheckAt = now + transactionBlockHeightPollMs;
      const blockHeight = await conn.getBlockHeight(commitment).catch(() => null);
      if (Number.isFinite(blockHeight) && blockHeight > lastValidBlockHeight) {
        const finalStatusResponse = await conn.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        });
        const finalStatus = finalStatusResponse?.value?.[0] ?? null;
        if (finalStatus?.err) throw createTransactionStatusError(signature, finalStatus.err);
        if (hasReachedSignatureCommitment(finalStatus, commitment)) {
          return {
            context: finalStatusResponse.context,
            value: { err: null },
          };
        }
        throw new TransactionExpiredBlockheightExceededError(signature);
      }
    } else if (!Number.isFinite(lastValidBlockHeight) && now - startedAt > transactionConfirmationTimeoutMs) {
      throw createTransactionConfirmationTimeoutError(signature);
    }

    await sleep(transactionConfirmationPollMs);
  }
}

function hasReachedSignatureCommitment(status, commitment = "confirmed") {
  if (!status) return false;
  const confirmationStatus = status.confirmationStatus ?? (status.confirmations === null ? "finalized" : null);
  if (commitment === "processed" || commitment === "recent") return true;
  if (commitment === "finalized" || commitment === "max" || commitment === "root") {
    return confirmationStatus === "finalized";
  }
  return (
    confirmationStatus === "confirmed" ||
    confirmationStatus === "finalized" ||
    (confirmationStatus === null && Number.isFinite(status.confirmations) && status.confirmations > 0)
  );
}

function createTransactionStatusError(signature, transactionError) {
  const error = new Error(`Transaction ${signature} failed: ${JSON.stringify(transactionError)}`);
  error.name = "TransactionStatusError";
  error.signature = signature;
  error.transactionError = transactionError;
  return error;
}

function createTransactionConfirmationTimeoutError(signature) {
  const error = new Error(`Transaction ${signature} was not confirmed within ${transactionConfirmationTimeoutMs / 1000} seconds.`);
  error.name = "TransactionConfirmationTimeoutError";
  error.signature = signature;
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

async function attachSendTransactionLogs(error, conn, context) {
  if (!error || typeof error.getLogs !== "function") return;
  try {
    const logs = await error.getLogs(conn);
    error.nicechunkLogs = logs;
    if (isVerboseTransactionLogsEnabled() && Array.isArray(logs) && logs.length) {
      console.warn(`NiceChunk ${context} transaction logs`, logs);
    }
  } catch (logError) {
    error.nicechunkLogError = logError;
  }
}

function isVerboseTransactionLogsEnabled() {
  try {
    return Boolean(window.NiceChunkDebugMining) || localStorage.getItem("nicechunk.debugTransactionLogs") === "1";
  } catch {
    return false;
  }
}

async function connectedWalletProvider({ prompt = false } = {}) {
  const providers = [
    window.phantom?.solana,
    window.solflare,
    window.backpack?.solana,
    window.solana,
  ].filter((candidate, index, list) => (
    candidate &&
    typeof candidate.connect === "function" &&
    list.indexOf(candidate) === index
  ));
  if (!providers.length) return null;
  const storedWallet = localStorage.getItem(storageWalletKey);

  for (const provider of providers) {
    try {
      if (!provider.publicKey) {
        if (prompt) {
          await provider.connect();
        } else {
          await provider.connect({ onlyIfTrusted: true });
        }
      }
    } catch {
      continue;
    }
    if (!provider.publicKey) continue;
    if (storedWallet && provider.publicKey.toBase58() !== storedWallet) continue;
    try {
      await assertNicechunkWalletNetwork(provider, { requestSwitch: prompt });
    } catch (error) {
      if (prompt) throw createWalletNetworkMessageError(error);
      continue;
    }
    return provider;
  }
  return null;
}

function createWalletNetworkMessageError(error) {
  const expected = solanaClusterLabel(error?.requiredCluster);
  const detected = error?.detectedCluster ? solanaClusterLabel(error.detectedCluster) : "Unknown";
  const nextError = new Error(
    error?.code === "nicechunk_network_unsupported"
      ? `Switch your wallet to Solana ${expected}, then retry.`
      : `NiceChunk requires Solana ${expected}. Wallet network: ${detected}.`,
  );
  nextError.code = error?.code || "nicechunk_network_error";
  nextError.cause = error;
  return nextError;
}

function readableErrorMessage(error) {
  return error?.transactionMessage || error?.message || String(error || "Unknown error");
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
