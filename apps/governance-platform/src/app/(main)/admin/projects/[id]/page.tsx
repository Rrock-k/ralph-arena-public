// RA-240: Old detail page → redirect to OPS
import { redirect } from "next/navigation";

export default async function AdminProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin?project=${id}&tab=overview`);
}
