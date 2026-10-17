import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateAddress } from "@/lib/server/safeFetch";

describe("isPrivateAddress", () => {
  it("flags loopback, private, link-local, CGNAT and unspecified IPv4", () => {
    for (const ip of ["127.0.0.1", "127.9.9.9", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
  });
  it("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "93.184.216.34"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("flags IPv6 loopback, link-local, ULA and mapped private addresses", () => {
    for (const ip of ["::1", "::", "fe80::1", "fd00::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
  });
});

describe("assertPublicUrl", () => {
  it("rejects non-http schemes, localhost names and literal private hosts", async () => {
    await expect(assertPublicUrl("ftp://example.com/x")).rejects.toThrow();
    await expect(assertPublicUrl("http://localhost:3100/")).rejects.toThrow();
    await expect(assertPublicUrl("http://foo.localhost/")).rejects.toThrow();
    await expect(assertPublicUrl("http://127.0.0.1:5432/")).rejects.toThrow();
    await expect(assertPublicUrl("http://[::1]/")).rejects.toThrow();
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow();
  });
  it("rejects hostnames that resolve to private addresses", async () => {
    // nip.io style names resolve to the embedded address; skip gracefully when DNS is unavailable.
    try {
      await expect(assertPublicUrl("http://127.0.0.1.nip.io/")).rejects.toThrow();
    } catch (e) {
      if (!(e instanceof Error && /could not be found/.test(e.message))) throw e;
    }
  });
});
