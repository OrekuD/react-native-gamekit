import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2">
          <span className="size-2 rounded-full bg-fd-primary" />
          <span>{appName}</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-fd-muted-foreground">
            docs
          </span>
        </span>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
