import { BlockList, isIP } from "node:net";
/**
 * Accepts loopback plus the listed subnets (e.g. "192.168.0.0/24"), so binding to
 * every interface does not expose the tracker on VPNs or virtual networks.
 */
export function clientFilter(subnets: string[]) {
  const allowed = new BlockList();
  allowed.addAddress("127.0.0.1");
  allowed.addAddress("::1", "ipv6");
  for (const subnet of subnets) {
    const [address = "", prefix = ""] = subnet.split("/");
    const family = isIP(address);
    const bits = Number(prefix);
    if (!family || !/^\d+$/.test(prefix) || bits > (family === 4 ? 32 : 128))
      throw new Error(`Invalid ALLOWED_CLIENTS subnet: ${subnet}`);
    allowed.addSubnet(address, bits, family === 4 ? "ipv4" : "ipv6");
  }
  return (remoteAddress: string | undefined) => {
    // Dual-stack sockets report IPv4 clients as IPv4-mapped IPv6 addresses.
    const address = (remoteAddress ?? "").replace(/^::ffff:(?=\d+\.)/, "");
    const family = isIP(address);
    return (
      family !== 0 && allowed.check(address, family === 4 ? "ipv4" : "ipv6")
    );
  };
}
