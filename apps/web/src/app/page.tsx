import { APP_NAME, APP_TAGLINE } from '@zerodue/shared';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="text-3xl font-semibold">{APP_NAME}</h1>
      <p className="text-slate-600 dark:text-slate-400">{APP_TAGLINE}</p>
    </main>
  );
}
