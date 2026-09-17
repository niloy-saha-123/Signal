// Minimal centered layout for auth pages (login, signup, onboarding)
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
