import { loader } from 'fumadocs-core/source';
import { defineDocs } from 'fumadocs-mdx/macro';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { docsRoute } from './shared';

const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
});


/**
 * URL of a docs page's raw markdown, served by the `/docs/raw` route with
 * the frontmatter stripped and the title prepended as an H1. Used by the
 * page-actions copy button so the copied text is standalone markdown.
 */
export function getPageMarkdownUrl(slug: readonly string[] | undefined): string {
  return `/docs/raw/${(slug ?? []).join('/')}`;
}
