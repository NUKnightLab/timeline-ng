/**
 * The collaboration server's entry point — docs/phase2-plan.md Stage 0.
 *
 * Routes `/draft/<id>` to that draft's Durable Object and nothing else.
 * Stage 1 adds the identity check ([P4]); Stage 2 adds promotion and access
 * control. Until then any id opens a room, which is why this is not deployed
 * anywhere a stranger can reach.
 *
 * Note what is absent from `package.json`: `@knight-lab/timeline-ng-core`.
 * The service syncs a Yjs document and knows nothing about timelines — [P25],
 * which is coauthoring.md §10.6's seam written as a dependency list.
 */
export { DraftRoom } from './room.ts';

interface Env {
  DRAFT: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = /^\/draft\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
    if (!match) {
      return new Response('Not found.', { status: 404 });
    }
    // idFromName, not newUniqueId: the same draft id must reach the same
    // object from every browser, which is the whole point of a DO here.
    const id = env.DRAFT.idFromName(match[1]);
    return env.DRAFT.get(id).fetch(request);
  },
};
