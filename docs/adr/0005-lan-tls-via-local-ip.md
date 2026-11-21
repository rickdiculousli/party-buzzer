# LAN TLS from the published local-ip.sh wildcard

Phones need a secure context for `getUserMedia`, a plain-http LAN address is not one, and no CA issues a certificate for a private IP. So the server uses local-ip.sh (local-ip.co second), whose hostnames encode the address and which publishes a real wildcard certificate with its private key: a published key gives no protection against a man in the middle, but a living-room LAN's threat model is nobody, and it buys a secure context with no warning and nothing to install. A certificate on disk does not prove a phone can use it, so boot fetches each provider's join url the way a phone would and takes the first that answers with this boot's random id from `/boot`; with none, the server serves http.

Where: `server/cert.ts` (`PROVIDERS`, `ensureCert`, `completeChain`, `usable`), `server/index.ts` (`startServer`)
