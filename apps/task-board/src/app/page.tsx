import { getProjects } from "@/lib/backlog";
import { normalizeBacklogError } from "@/lib/backlog-errors";
import { BacklogErrorState } from "@/components/BacklogErrorState";
import { ProjectList } from "@/components/ProjectList";

export const dynamic = "force-dynamic";

export default async function Home() {
  try {
    const projects = await getProjects();

    return <ProjectList projects={projects} />;
  } catch (error) {
    console.error("[task-board] Failed to load project list:", error);
    return (
      <BacklogErrorState
        fullPage
        retryHref="/"
        error={normalizeBacklogError(error)}
      />
    );
  }
}
