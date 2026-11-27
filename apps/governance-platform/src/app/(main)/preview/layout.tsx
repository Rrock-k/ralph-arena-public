export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#0a0d14] overflow-hidden">
      {children}
    </div>
  );
}
