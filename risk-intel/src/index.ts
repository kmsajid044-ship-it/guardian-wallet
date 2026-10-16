import { loadConfig, loadDeployment } from "./config.js";
import { buildRiskIntelServer } from "./server.js";
import { createPaymentVerifier } from "./verifier.js";

const config = loadConfig();
const deployment = loadDeployment(config);
const app = buildRiskIntelServer(deployment, createPaymentVerifier(config, deployment));
await app.listen({ port: config.RISK_INTEL_PORT, host: "127.0.0.1" });
