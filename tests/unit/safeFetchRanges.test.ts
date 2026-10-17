import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateAddress } from "@/lib/server/safeFetch";

// SEC-10: ranges the first version missed (found by probing isPrivateAddress with the hostname `new URL` yields).
describe("isPrivateAddress: IPv6 transition forms and reserved IPv4 ranges", () => {
  it("flags embedded loopback/metadata addresses in every IPv6 transition notation", () => {
    for (const ip of ["::7f00:1", "::127.0.0.1", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "64:ff9b::10.0.0.1", "64:ff9b:1::1", "2002:7f00:1::", "2002:a9fe:a9fe::", "2002:0a00:0001::1", "::ffff:0:7f00:1", "::ffff:0:127.0.0.1", "fec0::1", "feff::1", "2001::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001:db8::1", "100::1", "::2", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "FE80::1", "fe80::1%eth0", "ff02::1"]) expect(isPrivateAddress(ip), ip).toBe(true);
  });
  it("still allows public IPv6, including public addresses wrapped in NAT64 / 6to4", () => {
    for (const ip of ["2606:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001:81b::200e", "64:ff9b::808:808", "64:ff9b::8.8.8.8", "2002:808:808::1", "::ffff:8.8.8.8", "::ffff:808:808"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("flags IETF-reserved, benchmarking and documentation IPv4 ranges", () => {
    for (const ip of ["192.0.0.192", "192.0.0.0", "198.18.0.1", "198.19.255.255", "192.0.2.1", "198.51.100.7", "203.0.113.9", "240.0.0.1", "255.255.255.255"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["192.0.1.1", "198.17.255.255", "198.20.0.1", "203.0.112.255", "1.1.1.1"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("fails closed on anything that is not an address", () => {
    for (const ip of ["", "example.com", "1.2.3", "::g", "1:2:3:4:5:6:7:8:9"]) expect(isPrivateAddress(ip), ip).toBe(true);
  });
  it("assertPublicUrl rejects those literals as the browser-normalised hostnames", async () => {
    for (const u of ["http://[::7f00:1]/", "http://[::127.0.0.1]/", "http://[64:ff9b::7f00:1]/", "http://[64:ff9b::a9fe:a9fe]/", "http://[2002:7f00:1::]/", "http://[2002:a9fe:a9fe::]/", "http://[::ffff:0:7f00:1]/", "http://[fec0::1]/", "http://192.0.0.192/", "http://198.18.0.1/", "http://0x7f.1/", "http://2130706433/", "http://0177.0.0.1/", "http://127.1/"]) await expect(assertPublicUrl(u), u).rejects.toThrow();
  });
});
