import { loadConfig } from "./config.js";
import { buildServer } from "./api/server.js";

const config = loadConfig();
const app = buildServer(config);

await app.listen({ port: config.AGENT_PORT, host: "127.0.0.1" });
