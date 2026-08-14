import { GlassLayout } from 'fumadocs-ui/layouts/glass';
import { source } from '@/lib/source';
import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    <GlassLayout tree={source.getPageTree()} {...baseOptions()}>
      {children}
    </GlassLayout>
  );
}
