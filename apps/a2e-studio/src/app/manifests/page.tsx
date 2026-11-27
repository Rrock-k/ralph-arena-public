import { listManifests } from "@/lib/a2e-ops";
import { ManifestCatalog } from "@/components/ManifestCatalog";

export const dynamic = "force-dynamic";

export default function ManifestsPage() {
  const manifests = listManifests();
  return <ManifestCatalog manifests={manifests} />;
}
