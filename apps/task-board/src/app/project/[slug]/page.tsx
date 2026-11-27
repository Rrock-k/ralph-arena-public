import { notFound } from "next/navigation";
import { getTasksByProject } from "@/lib/backlog";
import { normalizeBacklogError } from "@/lib/backlog-errors";
import { BacklogErrorState } from "@/components/BacklogErrorState";
import { Board } from "@/components/Board";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function ProjectPage({ params }: Props) {
  const { slug } = await params;

  try {
    const tasks = await getTasksByProject(slug);
    return <Board initialTasks={tasks} projectSlug={slug} />;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      notFound();
    }

    console.error(`[task-board] Failed to load project ${slug}:`, error);
    return (
      <BacklogErrorState
        fullPage
        projectSlug={slug}
        retryHref={`/project/${slug}`}
        error={normalizeBacklogError(error, `${slug}.md`)}
      />
    );
  }
}
