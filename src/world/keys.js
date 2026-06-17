export function blockKey(x, y, z) {
  return `${x},${y},${z}`;
}

export function chunkKey(x, z) {
  return `${x},${z}`;
}

export function parseCellKey(key) {
  return key.split(",").map(Number);
}
