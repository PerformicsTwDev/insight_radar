/**
 * Home / index route content (T1.1 shell placeholder). The real create-analysis
 * form is T1.2 and the search-driven views are T2+; for now this is an inert
 * landing panel so the shell has a mounted outlet. Tokens only (no hardcoded hex).
 */
export function HomeRoute() {
  return (
    <section aria-labelledby="home-heading" className="max-w-2xl rounded-2xl bg-bg-card p-6">
      <h2 id="home-heading" className="text-xl font-semibold">
        關鍵字分析
      </h2>
      <p className="mt-2 text-sm text-white/60">建立分析表單將於 T1.2 上線。</p>
    </section>
  );
}
