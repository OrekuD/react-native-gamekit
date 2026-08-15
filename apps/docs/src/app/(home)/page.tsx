import Link from 'next/link';
import { appName } from '@/lib/shared';

const sections = [
  {
    title: 'Getting Started',
    description: 'Development builds, prebuild, and the monorepo commands.',
    href: '/docs/getting-started/installation',
  },
  {
    title: 'Concepts',
    description: 'The game definition contract and the headless-first model.',
    href: '/docs/concepts/game-definition',
  },
  {
    title: 'Compatibility',
    description: 'The tested Expo, React Native, and native peer lines.',
    href: '/docs/introduction/supported-platforms',
  },
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-4xl flex-col items-center justify-center gap-10 px-6 py-20">
      <section className="flex flex-col items-center text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-fd-muted-foreground">
          Mobile &amp; tablet · Expo · React Native
        </p>
        <h1 className="mt-4 text-5xl font-semibold tracking-tight sm:text-6xl">
          Games, defined headlessly.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-fd-muted-foreground">
          {appName} is a headless-first 2D game toolkit for React Native and
          Expo. React configures and observes a game session — it never becomes
          the per-frame store.
        </p>
        <div className="mt-8 flex gap-3">
          <Link
            className="rounded-full bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground"
            href="/docs/getting-started/installation"
          >
            Get started
          </Link>
          <Link
            className="rounded-full border border-fd-border px-5 py-2.5 text-sm font-medium"
            href="/docs/concepts/game-definition"
          >
            Read the definition contract
          </Link>
        </div>
      </section>

      <section className="grid w-full gap-4 sm:grid-cols-3">
        {sections.map((section) => (
          <Link
            key={section.title}
            className="rounded-2xl border border-fd-border bg-fd-card p-5 transition-colors hover:border-fd-primary/50"
            href={section.href}
          >
            <strong className="text-sm">{section.title}</strong>
            <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
              {section.description}
            </p>
          </Link>
        ))}
      </section>

      <p className="text-center text-sm text-fd-muted-foreground">
        Architecture research:{' '}
        <Link
          className="text-fd-primary underline underline-offset-4"
          href="https://github.com/OrekuD/react-native-gamekit/blob/main/REACT_NATIVE_GAMEKIT_RESEARCH.md"
        >
          REACT_NATIVE_GAMEKIT_RESEARCH.md
        </Link>
      </p>
    </main>
  );
}
