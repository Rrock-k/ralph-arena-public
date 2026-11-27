import { acceptedSpecArtifactRequiresLoopWork, parseAcceptedSpecArtifact } from "@arena/contracts";
import type { AssetsData, SpecsData } from "./api.js";
import { checkAssetChanges, writeAssetFiles } from "./assets.js";
import { checkSpecChanges, syncSpecWorkspace } from "./specs.js";

type IdleResourceSyncDeps = {
  checkSpecChangesFn?: (currentHash: string) => Promise<SpecsData | null>;
  syncSpecWorkspaceFn?: (workspaceDir: string, specsDir: string, specs: SpecsData["specs"], projectTitle: string) => void;
  checkAssetChangesFn?: (currentHash: string) => Promise<AssetsData | null>;
  writeAssetFilesFn?: (workspaceDir: string, assets: AssetsData["assets"]) => Promise<void>;
};

type IdleResourceSyncInput = IdleResourceSyncDeps & {
  workspaceDir: string;
  specsDir: string;
  projectTitle: string;
  currentSpecsHash: string;
  currentAssetsHash: string;
};

export async function syncIdleResourceUpdates(input: IdleResourceSyncInput): Promise<{
  currentSpecsHash: string;
  currentAssetsHash: string;
  pendingLoopWork: boolean;
}> {
  const checkSpecChangesFn = input.checkSpecChangesFn ?? checkSpecChanges;
  const syncSpecWorkspaceFn = input.syncSpecWorkspaceFn ?? syncSpecWorkspace;
  const checkAssetChangesFn = input.checkAssetChangesFn ?? checkAssetChanges;
  const writeAssetFilesFn = input.writeAssetFilesFn ?? writeAssetFiles;

  let currentSpecsHash = input.currentSpecsHash;
  let currentAssetsHash = input.currentAssetsHash;
  let pendingLoopWork = false;

  const changedSpecs = await checkSpecChangesFn(currentSpecsHash);
  if (changedSpecs) {
    console.log("[runner] Idle supervisor: specs changed, updating workspace");
    syncSpecWorkspaceFn(input.workspaceDir, input.specsDir, changedSpecs.specs, input.projectTitle);
    currentSpecsHash = changedSpecs.hash;
    pendingLoopWork = specsRequireLoopWork(changedSpecs.specs);
  }

  const changedAssets = await checkAssetChangesFn(currentAssetsHash);
  if (changedAssets) {
    console.log("[runner] Idle supervisor: assets changed, syncing files");
    await writeAssetFilesFn(input.workspaceDir, changedAssets.assets);
    currentAssetsHash = changedAssets.hash;
  }

  return {
    currentSpecsHash,
    currentAssetsHash,
    pendingLoopWork,
  };
}

function specsRequireLoopWork(specs: SpecsData["specs"]): boolean {
  if (specs.length === 0) return false;

  return specs.some((spec) => {
    const backlog = Array.isArray(spec.acceptedArtifactBacklog)
      ? spec.acceptedArtifactBacklog
      : [];
    if (backlog.some((entry) => {
      if (!entry || typeof entry !== "object" || !("acceptedArtifact" in entry)) {
        return false;
      }
      return acceptedSpecArtifactRequiresLoopWork(parseAcceptedSpecArtifact(entry.acceptedArtifact));
    })) {
      return true;
    }

    if (!spec.acceptedArtifact) {
      return true;
    }
    return acceptedSpecArtifactRequiresLoopWork(parseAcceptedSpecArtifact(spec.acceptedArtifact));
  });
}
