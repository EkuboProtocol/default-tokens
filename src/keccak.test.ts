import { describe, expect, test } from "bun:test";
import { checksumIfConsistent, keccak256, toChecksumAddress } from "./keccak";

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

describe("keccak256", () => {
  test("matches the Ethereum reference digests", () => {
    expect(hex(keccak256(new Uint8Array()))).toBe(
      "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
    expect(hex(keccak256(new TextEncoder().encode("abc")))).toBe(
      "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
    );
    // Transfer(address,address,uint256), the ERC-20 event topic.
    expect(
      hex(
        keccak256(
          new TextEncoder().encode("Transfer(address,address,uint256)"),
        ),
      ),
    ).toBe("ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");
  });

  test("absorbs inputs longer than one block", () => {
    expect(hex(keccak256(new Uint8Array(200)))).toBe(
      hex(keccak256(new Uint8Array(200))),
    );
    expect(hex(keccak256(new Uint8Array(136)))).not.toBe(
      hex(keccak256(new Uint8Array(135))),
    );
  });
});

describe("EIP-55", () => {
  const vectors = [
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
    "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
    "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
  ];

  test("checksums the EIP-55 vectors", () => {
    for (const vector of vectors) {
      expect(toChecksumAddress(vector.toLowerCase())).toBe(vector);
      expect(checksumIfConsistent(vector)).toBe(vector);
      expect(
        checksumIfConsistent(vector.toUpperCase().replace("0X", "0x")),
      ).toBe(vector);
    }
  });

  test("rejects a wrong checksum and non-addresses", () => {
    expect(
      checksumIfConsistent("0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"),
    ).toBeNull();
    expect(toChecksumAddress("0x1234")).toBeNull();
    expect(
      toChecksumAddress("5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"),
    ).toBeNull();
  });
});
