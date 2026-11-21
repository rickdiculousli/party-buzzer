# LAN TLS from the published local-ip.sh wildcard

Phones need a secure context for `getUserMedia`, and a plain-http LAN address is not one (browsers leave `navigator.mediaDevices` undefined). No CA issues a certificate for a private IP, so the server uses local-ip.sh, whose hostnames encode the address (`192-168-0-74.local-ip.sh`) and which publishes a real wildcard certificate with its private key. A published key gives no protection against a man in the middle, but the threat model for a living-room LAN is nobody, and it buys a secure context with no warning and nothing to install. local-ip.co is the second provider. Without a certificate the server serves http (README.md, "Run").

- Certificates are refetched a week before expiry; they are 90-day Let's Encrypt certificates, so a party can fall on the wrong side of a renewal.
- A lone leaf gets its issuer appended, fetched from the address the leaf names, because Node and some phones will not fetch a missing intermediate. The issuer arrives over plain http, so its signature is verified, not just its name.
- local-ip.co's published `chain.pem` belongs to an older certificate from another CA and is never fetched.
- A download is checked before caching, so a truncated fetch never poisons later boots.
- A certificate on disk does not prove a phone can use it (the provider's DNS may not resolve, or the chain may stop verifying). Boot fetches each provider's join url the way a phone would and takes the first that answers with this boot's random id from `/boot`, so another server holding the same published wildcard is not mistaken for this one.

Where: `server/cert.ts` (`PROVIDERS`, `ensureCert`, `completeChain`, `usable`), `server/index.ts` (`startServer`)
