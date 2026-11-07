// Keccak-256 (the pre-standard padding Ethereum uses, not SHA3-256), which
// neither Bun nor node:crypto provides. Only used for EIP-55 checksums, so
// clarity is preferred over speed.

const MASK = (1n << 64n) - 1n;
const RATE_BYTES = 136;

const ROUND_CONSTANTS = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
];

// Rotation offsets indexed by lane x + 5 * y.
const ROTATIONS = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18,
  2, 61, 56, 14,
];

function rotl(value: bigint, shift: number): bigint {
  if (shift === 0) return value;
  const s = BigInt(shift);
  return ((value << s) | (value >> (64n - s))) & MASK;
}

function lane(state: bigint[], index: number): bigint {
  return state[index] ?? 0n;
}

function theta(state: bigint[]): void {
  const columns = [0, 1, 2, 3, 4].map(
    (x) =>
      lane(state, x) ^
      lane(state, x + 5) ^
      lane(state, x + 10) ^
      lane(state, x + 15) ^
      lane(state, x + 20),
  );
  for (let x = 0; x < 5; x++) {
    const d =
      (columns[(x + 4) % 5] ?? 0n) ^ rotl(columns[(x + 1) % 5] ?? 0n, 1);
    for (let y = 0; y < 25; y += 5) state[x + y] = lane(state, x + y) ^ d;
  }
}

function rhoPi(state: bigint[]): bigint[] {
  const moved = new Array<bigint>(25).fill(0n);
  for (let x = 0; x < 5; x++) {
    for (let y = 0; y < 5; y++) {
      const index = x + 5 * y;
      moved[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(
        lane(state, index),
        ROTATIONS[index] ?? 0,
      );
    }
  }
  return moved;
}

function chi(moved: bigint[], state: bigint[]): void {
  for (let y = 0; y < 25; y += 5) {
    for (let x = 0; x < 5; x++) {
      state[x + y] =
        lane(moved, x + y) ^
        (~lane(moved, ((x + 1) % 5) + y) &
          MASK &
          lane(moved, ((x + 2) % 5) + y));
    }
  }
}

function keccakF(state: bigint[]): void {
  for (const constant of ROUND_CONSTANTS) {
    theta(state);
    chi(rhoPi(state), state);
    state[0] = lane(state, 0) ^ constant;
  }
}

function absorbBlock(state: bigint[], block: Uint8Array): void {
  for (let i = 0; i < RATE_BYTES / 8; i++) {
    let value = 0n;
    for (let b = 7; b >= 0; b--) {
      value = (value << 8n) | BigInt(block[i * 8 + b] ?? 0);
    }
    state[i] = lane(state, i) ^ value;
  }
  keccakF(state);
}

export function keccak256(input: Uint8Array): Uint8Array {
  const paddedLength =
    Math.floor(input.length / RATE_BYTES) * RATE_BYTES + RATE_BYTES;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[paddedLength - 1] = (padded[paddedLength - 1] ?? 0) | 0x80;

  const state = new Array<bigint>(25).fill(0n);
  for (let offset = 0; offset < paddedLength; offset += RATE_BYTES) {
    absorbBlock(state, padded.subarray(offset, offset + RATE_BYTES));
  }

  const output = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    output[i] = Number((lane(state, i >> 3) >> BigInt(8 * (i & 7))) & 0xffn);
  }
  return output;
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** EIP-55 checksum of a 20-byte hex address, or null if it is not one. */
export function toChecksumAddress(address: string): string | null {
  if (!ADDRESS_PATTERN.test(address)) return null;
  const lower = address.slice(2).toLowerCase();
  const hash = keccak256(new TextEncoder().encode(lower));
  let checksummed = "0x";
  for (let i = 0; i < 40; i++) {
    const nibble = ((hash[i >> 1] ?? 0) >> (i % 2 === 0 ? 4 : 0)) & 0x0f;
    const character = lower[i] ?? "";
    checksummed += nibble >= 8 ? character.toUpperCase() : character;
  }
  return checksummed;
}

/**
 * Checksum an address whose case is either uniform (no checksum claimed) or a
 * valid EIP-55 checksum. A mixed-case address with a wrong checksum is null:
 * it was mistyped or altered.
 */
export function checksumIfConsistent(address: string): string | null {
  const checksummed = toChecksumAddress(address);
  if (!checksummed) return null;
  const digits = address.slice(2);
  const uniform =
    digits === digits.toLowerCase() || digits === digits.toUpperCase();
  return uniform || checksummed === address ? checksummed : null;
}
