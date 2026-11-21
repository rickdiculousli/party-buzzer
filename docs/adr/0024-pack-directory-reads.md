# Pack reads: a missing directory is quiet, other failures warn, names cannot traverse

- `listPacks` treats a missing pack directory (`ENOENT`) as a room with no packs, silently. Any other error (permissions, a file where the directory should be) logs a warning, so a permissions slip on game night does not read as "no packs".
- A pack name arrives from a host message, so `loadPack` treats it as untrusted: a name that is not already its own `basename` is refused as path traversal.

Where: `server/packs.ts` (`listPacks`, `loadPack`)
