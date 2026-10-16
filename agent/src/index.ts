import { loadConfig, resolveRepoPath } from "./config.js";
import { buildServer } from "./api/server.js";
import { createOwnerSessionToken, writeOwnerSessionFile } from "./api/ownerSession.js";

const config = loadConfig();
// A fresh owner session token each run; only the local web console reads the file (never logged).
const ownerSessionToken = createOwnerSessionToken();
writeOwnerSessionFile(resolveRepoPath(config.OWNER_SESSION_FILE ?? ".demo/owner-session"), ownerSessionToken);
const app = buildServer(config, { ownerSessionToken });

await app.listen({ port: config.AGENT_PORT, host: "127.0.0.1" });
