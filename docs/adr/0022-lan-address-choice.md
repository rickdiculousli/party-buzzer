# The join address skips virtual interfaces and prefers 192.168.x.x

`lanAddresses` ignores Docker bridges, VPN tunnels and Apple's peer-to-peer interfaces (`docker`, `br-`, `veth`, `utun`, `tun`, `tap`, `awdl`, `llw`), which are never the party WiFi. When several private addresses remain, `pickAddress` prefers `192.168.` because home routers hand those out; `HOST_IP` overrides the choice.

Where: `server/net.ts` (`lanAddresses`, `pickAddress`)
