"use client";

export function TopBar() {
  return (
    <header className="fixed left-64 right-96 top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-8">
      {/* Search or page title could go here */}
      <div className="flex-1" />

      {/* Profile button */}
      <button className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 font-sans text-sm font-extrabold text-white transition-opacity hover:opacity-90">
        SC
      </button>
    </header>
  );
}
