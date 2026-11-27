import { A2EStudio } from "@/components/A2EStudio";
import { getPrepData } from "@/lib/a2e-ops";

export const dynamic = "force-dynamic";

export default function Page() {
  const prep = getPrepData();
  return <A2EStudio prep={prep} />;
}
