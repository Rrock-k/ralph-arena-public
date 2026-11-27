import type { ArenaCtlConfig } from "./config.js";
import type { GovernanceClient } from "./governance-client.js";
import type { WorkerClient } from "./worker-client.js";

export type ArenaCtlContext = {
  config: ArenaCtlConfig;
  governance: GovernanceClient;
  worker: WorkerClient;
};
