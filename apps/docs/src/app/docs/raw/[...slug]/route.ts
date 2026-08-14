import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

const CONTENT_ROOT = path.join(process.cwd(), 'content', 'docs');

/**
 * Serve the raw markdown of a docs page, agent-friendly.
 *
 * Strips the MDX frontmatter and prepends the page title as an H1, so the
 * copied text is standalone markdown that can be pasted into an agent or
 * another doc without the Fumadocs chrome.
 */
export async function GET(
  _request: Request,
  props: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await props.params;
  if (
    slug.length === 0 ||
    !slug.every((part) => /^[a-z0-9-]+$/.test(part))
  ) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  const file = path.join(CONTENT_ROOT, ...slug) + '.mdx';
  if (!file.startsWith(CONTENT_ROOT + path.sep)) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const frontmatter = /^---\n[\s\S]*?\n---\n?/.exec(raw);
  const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
  const title = frontmatter ? /^title:\s*(.+)$/m.exec(frontmatter[0])?.[1] : undefined;
  const markdown = title ? `# ${title}\n\n${body}\n` : `${body}\n`;

  return new NextResponse(markdown, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}
