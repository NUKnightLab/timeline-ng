import { loadTimeline } from './atproto.ts';
import { extractOgData } from './og-data.ts';
import { renderPreviewPage, renderErrorPage } from './render.ts';

export interface Env {
  EMBED_BASE_URL: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== '/ng/share') {
      return new Response('Not found', { status: 404 });
    }

    const src = url.searchParams.get('src');
    if (!src) {
      return new Response(renderErrorPage('Missing "src" parameter.'), {
        status: 400,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    const plcDirectory = url.searchParams.get('plc') ?? undefined;
    const handleResolver = url.searchParams.get('resolver') ?? undefined;

    const embedUrl = new URL(env.EMBED_BASE_URL);
    embedUrl.searchParams.set('src', src);
    if (plcDirectory) embedUrl.searchParams.set('plc', plcDirectory);
    if (handleResolver) embedUrl.searchParams.set('resolver', handleResolver);

    const result = await loadTimeline(src, { plcDirectory, handleResolver });

    if (!result.ok) {
      return new Response(renderErrorPage('This timeline could not be loaded.'), {
        status: 502,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    const debug = url.searchParams.has('debug');
    const og = extractOgData(result.timeline);
    const html = renderPreviewPage(og, url.toString(), embedUrl.toString(), { debug });

    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': debug ? 'no-store' : 'public, max-age=300',
      },
    });
  },
};
