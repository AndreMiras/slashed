import assert from "assert";
import * as utils from "./utils";

describe("utils", () => {
  describe("pubKeyToSha256", () => {
    it("should return the first 20 bytes of the sha256 hash of the base64 decoded public key", () => {
      const pubKey = "A7Lq93NiF1FPkHh5YrQJ8ovquM6rH2uZggpqJvx1nSBI";
      const expected = new Uint8Array([
        154, 172, 35, 190, 38, 50, 52, 218, 134, 116, 104, 126, 37, 145, 214,
        96, 42, 99, 234, 132,
      ]);
      const result = utils.pubKeyToSha256(pubKey);
      assert.deepStrictEqual(result, expected);
    });
  });

  describe("pubKeyToBench32", () => {
    it("should return a Bech32 encoded address with the given prefix", () => {
      const prefix = "cosmos";
      const pubKey = "A7Lq93NiF1FPkHh5YrQJ8ovquM6rH2uZggpqJvx1nSBI";
      const expected = "cosmos1n2kz803xxg6d4pn5dplztywkvq4x865y428dl6";
      const result = utils.pubKeyToBench32(prefix, pubKey);
      assert.strictEqual(result, expected);
    });
  });

  describe("getEnvVariable", () => {
    before(() => {
      process.env.TEST_VAR = "test_value";
      process.env.EMPTY_VAR = "";
    });

    after(() => {
      delete process.env.TEST_VAR;
      delete process.env.EMPTY_VAR;
    });

    it("should return the value of a defined environment variable", () => {
      const result = utils.getEnvVariable("TEST_VAR");
      assert.strictEqual(result, "test_value");
    });

    it("should throw an error if the environment variable is not defined", () => {
      assert.throws(() => {
        utils.getEnvVariable("UNDEFINED_VAR");
      }, /UNDEFINED_VAR environment variable is required./);
    });

    it("should throw an error if the environment variable is empty", () => {
      assert.throws(() => {
        utils.getEnvVariable("EMPTY_VAR");
      }, /EMPTY_VAR environment variable is required./);
    });
  });
});
