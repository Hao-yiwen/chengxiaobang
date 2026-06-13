import { describe, expect, it } from "vitest";
import { parseKeychainSecretRef } from "../src/secrets/secret-store";

describe("parseKeychainSecretRef", () => {
  it("keeps colons inside the Keychain account name", () => {
    expect(parseKeychainSecretRef("keychain:程小帮:web-search:tavily")).toEqual({
      service: "程小帮",
      account: "web-search:tavily"
    });
  });

  it("rejects malformed Keychain refs", () => {
    expect(parseKeychainSecretRef("memory:web-search:tavily")).toBeUndefined();
    expect(parseKeychainSecretRef("keychain:程小帮")).toBeUndefined();
    expect(parseKeychainSecretRef("keychain::web-search:tavily")).toBeUndefined();
  });
});
