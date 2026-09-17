// Public landing page
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-8 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900">
              <span className="font-sans text-sm font-extrabold text-white">S</span>
            </div>
            <span className="font-sans text-lg font-extrabold text-slate-900">signal</span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="/login"
              className="rounded-lg px-4 py-2 font-sans text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900"
            >
              Sign In
            </a>
            <a
              href="/signup"
              className="rounded-lg bg-indigo-600 px-4 py-2 font-sans text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              Get Started
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="mx-auto max-w-5xl px-8 pt-32 pb-20 text-center">
        <h1 className="font-serif text-5xl font-semibold leading-tight text-slate-900 md:text-6xl">
          Know what your competitors are doing before everyone else
        </h1>
        <p className="mx-auto mt-6 max-w-2xl font-sans text-lg leading-relaxed text-slate-600">
          Signal continuously monitors your competitive landscape and surfaces the movements that matter—pricing changes, product launches, hiring spikes—before they become industry news.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <a
            href="/signup"
            className="rounded-lg bg-indigo-600 px-6 py-3 font-sans text-base font-semibold text-white transition-colors hover:bg-indigo-700"
          >
            Start tracking
          </a>
          <a
            href="/login"
            className="rounded-lg border border-slate-300 px-6 py-3 font-sans text-base font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-white"
          >
            Sign in
          </a>
        </div>
      </div>

      {/* How it works */}
      <div className="mx-auto max-w-7xl px-8 py-20">
        <div className="grid gap-8 md:grid-cols-3">
          <div className="rounded-2xl bg-white p-8 shadow-sm">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100">
              <svg className="h-6 w-6 text-blue-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <h3 className="mb-2 font-sans text-lg font-bold text-slate-900">Continuous Discovery</h3>
            <p className="font-sans text-sm leading-relaxed text-slate-600">
              Signal automatically finds and tracks competitors across pricing pages, job boards, product changelogs, and community discussions.
            </p>
          </div>

          <div className="rounded-2xl bg-white p-8 shadow-sm">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-rose-100">
              <svg className="h-6 w-6 text-rose-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="mb-2 font-sans text-lg font-bold text-slate-900">Real-time Intelligence</h3>
            <p className="font-sans text-sm leading-relaxed text-slate-600">
              Get immediate alerts when competitors ship features, change pricing, or scale their teams—not days later from newsletters.
            </p>
          </div>

          <div className="rounded-2xl bg-white p-8 shadow-sm">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
              <svg className="h-6 w-6 text-emerald-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="mb-2 font-sans text-lg font-bold text-slate-900">Strategic Analysis</h3>
            <p className="font-sans text-sm leading-relaxed text-slate-600">
              Chat with your intelligence to understand patterns, compare strategies, and get recommendations grounded in actual competitive movements.
            </p>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="mx-auto max-w-4xl px-8 py-20 text-center">
        <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 px-12 py-16 shadow-xl">
          <h2 className="font-serif text-3xl font-semibold text-white md:text-4xl">
            Start tracking your competitive landscape today
          </h2>
          <p className="mx-auto mt-4 max-w-xl font-sans text-base text-slate-300">
            Join teams that stay ahead by knowing what&apos;s happening in real-time.
          </p>
          <a
            href="/signup"
            className="mt-8 inline-block rounded-lg bg-white px-8 py-3 font-sans text-base font-semibold text-slate-900 transition-colors hover:bg-slate-100"
          >
            Get started
          </a>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-8 py-8">
          <p className="text-center font-sans text-sm text-slate-500">
            © {new Date().getFullYear()} Signal. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
