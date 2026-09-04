# Co-authoring timelines

**Status: design, not started.** Revised 2026-09-04 (v6).

> **v3 changed the architecture.** v1 and v2 proposed building co-authoring on Atproto Spaces with
> no server. That's now the *deferred* option — see §7. The plan is a collaboration server holding
> drafts, publishing to the owner's repo. The deciding argument is in §1.
>
> **v4 changed Phase 1.** The published record is no longer being decomposed (§3.1) — that was a
> leftover requirement from the Spaces design. Phase 1 is now "adopt Yjs locally, single user, no
> server," which delivers the model change as a by-product of a real implementation and ships undo
> and multi-tab safety on its own (§9).
>
> **v5 is clarification, not redirection.** Three passages that read wrong on their own are fixed
> (§2 on where a draft link is served from, §4.1 on what key rotation actually requires, §5 on which
> of the accountability artifacts is public). The substantive addition is §8.2: the questions that a
> reading of the current editor code raises, which have to be answered before Phase 1 code is cut.
>
> **v6 resolves eight of the eleven open questions**, folding each answer into the body where it
> belongs: the rich-text type, slide-ID keying and the Svelte bridge into §3.2; review and
> draft-state UI into §4.2; local drafts into §9; credential scope into §10.2; the retention number
> into §10.5, undo into its own spec. §8 now holds only what is genuinely still open — Q1 and Q6.

---

## 1. Why a server, and why now

The question that settled it: **when a collaborator makes a change and the owner is offline, how
does the published record get updated?**

In the serverless design it cannot. The published record lives at
`at://ownerDID/com.knightlab.timeline/rkey`, and only the owner's credentials can write it. ATProto
OAuth grants scopes from a user to an *app*, never from one user to another — there is no
protocol path for a collaborator to write into the owner's repo. With no server, nobody else holds
the owner's credentials. Publication would require the owner's browser to be open, always.

So "collaborator contributions should reach the public without the owner present" doesn't lean
toward a server; it *selects* one.

The secondary argument is that portable drafts turned out to be worth less than they first appeared.
The durable artifact is the *published* timeline, which already lives in the user's repo under their
DID. A draft is working state. What we give up by putting drafts on a server:

- **The purist story** ("even our drafts are yours"). Real currency in the atmosphere community,
  soft, not decisive.
- **Unpublished work dies with the service.** Bounded — published timelines survive regardless — and
  mitigable with an export.
- **What the project is operationally.** Today: static assets plus one *stateless* Worker
  (`workers/og-preview`). After: a stateful service holding user content and OAuth refresh tokens for
  users' PDS accounts.

  StoryMapJS is a partial precedent: it already runs an authoring-only server (Flask + Postgres,
  Google OAuth) that publishes finished work to S3, and that split is reportedly reassuring in
  practice rather than burdensome. So the *containment pattern* is proven here — see §10.7.

  But the precedent is narrower than it first looks. StoryMap has **no co-authoring**, so edits only
  happen while the user is present, and it **holds no long-lived credentials**. Custody of refresh
  tokens that can write to a user's atproto identity while they are away is genuinely new territory
  for the lab, and it is the novel risk in this design — not the server, not the storage. Nor are
  there existing retention/deletion policies to inherit; those have to be written (§10.5).

Third argument: it ships without waiting on the Spaces alpha, which is Draft-status software with a
"later in 2026" release target and explicit no-backups, breaking-schema-change warnings.

---

## 2. Prior art: Longform

[Longform](https://longform.social/qsje6f4zgb) shipped exactly this and is worth copying closely:

- Yjs + Hocuspocus over WebSockets for real-time sync, with live cursors
- *"Access control is stored server-side, checked on every WebSocket connection. So is the draft data."*
- Atproto provides identity (OAuth) and the publish target; drafts never touch it
- Two permission levels: read/write and read-only. **"Only the document owner can publish."**
- An optional read-only draft link that needs no account to open — which they can offer *because*
  the draft lives on **their own** server and never on a PDS. "Public" here means "no sign-in
  required to view," not "written to the atmosphere": nothing reaches a repo until publish. A space
  could not offer this, for the opposite reason to the one you might expect — space reads require a
  delegation token from the reader's own PDS, so `policy: public` means "any signed-in atproto
  user," not the open web (§7).

  Treat it as opt-in and off by default. Drafts are private unless their owner decides otherwise.

Their model is our model, plus deferred publishing (§4), which they don't appear to do.

---

## 3. Shape


|            | Draft                                   | Publication                    |
| ---------- | --------------------------------------- | ------------------------------ |
| Storage    | Our server                              | Public repo record (unchanged) |
| Sync       | Yjs/CRDT over WebSocket                 | —                             |
| Who writes | Owner + collaborators                   | Server, acting as the owner    |
| Who reads  | Invited collaborators (+ optional link) | Anyone, no auth                |

The player, embeds, and share links are **untouched**. No regression risk to the shipped thing.

### 3.1 The published record does not change

It stays exactly what `saveTimeline` writes today: one `com.knightlab.timeline` record holding
`timeline.events[]`. It's a leaf artifact that the server materializes into. No player changes, no
migration of existing timelines, no lexicon churn.

*(Earlier drafts of this plan called for decomposing it into per-slide records. That was forced by
the Spaces design — one repo per user, no shared mutable record, so slides had to be individually
authored. With a server holding the draft, the constraint is gone and the record should stay as it
is.)*

### 3.2 What does need structure is the CRDT document

**In Yjs, how you decompose the document *is* your merge granularity.** Model a timeline as one
opaque value in a `Y.Map` and every edit becomes a whole-document replace — last-write-wins with
extra steps and a WebSocket. The shape that actually merges:


| Piece              | Yjs type                          | Why                                        |
| ------------------ | --------------------------------- | ------------------------------------------ |
| Slide collection   | `Y.Map` keyed by an internal id   | **Not** a `Y.Array` — see below            |
| A slide            | `Y.Map`                           | Independent fields merge independently     |
| `headline`, `text` | `Y.XmlFragment` (+ derived HTML)  | Two people in one paragraph actually merge |
| `unique_id`        | ordinary field on the slide's map | Author-visible and editable, not the key   |
| Settings           | `Y.Map`                           |                                            |

Note this is a decomposition of the **editor's in-memory model**, not of anything on the PDS. The
data is already close to this shape — `App.svelte` holds `events` as a `TLEvent[]` with `unique_id`s,
and `EventEditor` edits one at a time. What's missing is the CRDT types underneath.

**Rich text is `Y.XmlFragment`, not `Y.Text`.** The editor is Tiptap, and Tiptap's collaborative
binding is y-prosemirror, which requires an `Y.XmlFragment`. That buys the real thing — two people
editing one paragraph actually merge — at three costs worth naming:

- **Publishing gains a serialization step.** In Phase 3 the *server* publishes, and it must not need
  the ProseMirror schema to do so (§10.6). So each rich-text field also carries a **derived HTML
  string** on the slide's map, written by the same client transaction that edits the fragment. The
  fragment is the source of truth for editing and merging; the string is a denormalized copy for the
  publish layer to read.
- **Sanitization moves, and improves.** `DOMPurify` currently cleans HTML on the way out of the
  editor. A ProseMirror schema constrains which nodes can exist at all, a stronger guarantee than
  cleaning a string afterwards. Keep DOMPurify at serialization as defence in depth.
- **Schema changes become migrations.** Once text is stored as structured nodes, adding a mark or a
  node type means transforming stored documents; HTML strings would have been trivially
  forward-compatible. Today the schema is StarterKit + Link — small, stable, nothing planned — so
  this is a rare cost rather than a recurring one. Revisit it if media ever becomes an inline
  ProseMirror node.

One knock-on: Tiptap's `Collaboration` extension replaces the editor's own history, so
`StarterKit.configure({ undoRedo: false })` and Yjs's `UndoManager` becomes the only undo in the app
(Q11).

**The map key is an internal id, not `unique_id`.** Slide IDs are author-facing — they appear in URLs
as slide anchors and are meant to stay legible (`the-moon-landing`). That makes them a bad primary
key: renaming one in a `Y.Map` is a delete plus an insert, which under concurrency discards another
author's edits to that slide. So the map is keyed by an arbitrary internal id, assigned at creation
and never shown, and `unique_id` becomes an ordinary field that merges like any other.
`assignSlideIds()` keeps its existing job at import. What this gives up is structural uniqueness —
two collaborators can concurrently choose the same `unique_id` — so uniqueness becomes a validation
pass at publish rather than a property of the data structure.

**The Y.Doc reaches Svelte as a snapshot.** Observe the document and rebuild plain `$state` on
change, rather than wrapping Y types in a reactive proxy. Every existing component keeps working
against ordinary objects, at the cost of a re-derive per update — cheap at timeline sizes, and it
keeps Phase 2 a provider swap instead of an editor rewrite.

**Slide ordering is free.** TimelineJS orders slides by date, so a keyed `Y.Map` suffices and we never
need list-CRDT semantics — no fractional indexing, no order convergence. The single hardest part of
collaborative document editing simply doesn't apply to us. Only the title slide is pinned.

---

## 4. The publishing negotiation

### 4.1 Become a confidential client

This is the enabling change. Today `caddy/client-metadata.json` declares
`"token_endpoint_auth_method": "none"` — a **public** client. The [OAuth
spec](https://atproto.com/specs/oauth) treats the two very differently:


|                        | Public client (today)       | Confidential client                                       |
| ---------------------- | --------------------------- | --------------------------------------------------------- |
| Session lifetime       | **2 weeks**                 | **may be unlimited**                                      |
| Refresh token lifetime | 2 weeks                     | **up to 180 days**                                        |
| Access token           | <30 min (5 min recommended) | same                                                      |
| Requires               | nothing                     | `private_key_jwt`, keys published via `jwks` / `jwks_uri` |

Confidential clients get this because they authenticate with a signing key and can revoke a
compromised one. Practically: as a public client the owner would have to sign in **every two weeks**
or auto-publishing stops. As a confidential client, the session can persist indefinitely and refresh
tokens rotate on a 180-day clock — so any owner who opens the app twice a year never lapses.

**"Confidential" means "can keep a secret," so the confidential client *is* the server.** A SPA can't
be one regardless of what its metadata says — anything shipped to the browser is readable. So this
isn't a change we could make to `caddy/client-metadata.json` on its own; it's only available to us
once a server exists. (Which is a second, independent reason deferred publishing is impossible in the
serverless design: not just "nobody holds the owner's session," but "nobody can hold a long-lived
session at all.")

What it takes:

- `"token_endpoint_auth_method": "private_key_jwt"` and `"token_endpoint_auth_signing_alg": "ES256"`
  in client metadata, plus `jwks` **or** `jwks_uri` — one or the other, not both
- a **client assertion** JWT signed with an ES256/P-256 key, sent with the Authorization Request (via
  PAR) and every token refresh: `client_assertion_type` of
  `urn:ietf:params:oauth:client-assertion-type:jwt-bearer`, claims `iss`/`sub` = our `client_id`,
  `aud` = the Authorization Server's `issuer`, plus `iat`, `exp`, and a unique `jti`
- **the OAuth flow moves server-side.** Today `atproto.svelte.ts` runs `BrowserOAuthClient` entirely
  in the browser. As a confidential client the server handles PAR, the callback, and token storage.
  Both reference apps are shaped this way (Bulletin: `app/oauth-client-metadata.json/route.ts`,
  `app/oauth/callback/route.ts`). Budget this as a refactor, not a config change.
- **key rotation** as a written procedure: publish the new key in the JWKS, allow time for
  authorization servers to refresh their cached copy of it, then switch to signing with it, then
  retire the old one. Removing a compromised key is immediate, and will break in-flight refreshes —
  which is the correct trade.

  Note what this is *not*: a client assertion is signed fresh on every token request, so no session
  is bound to a particular key and there is nothing to drain. The overlap window is however long an
  authorization server caches `jwks_uri`, measured in hours, not the 180 days of a refresh token.
  Rotation is therefore a runbook plus a calendar entry, not ongoing toil. *(Worth confirming against
  a real PDS alongside Q6 — both are "what does the implementation actually do" questions.)*

### 4.2 Publish policy, per timeline


| Policy             | Behavior                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `manual` (default) | Only the owner publishes. Collaborator edits sit in the draft; owner sees "3 pending changes." |
| `review`           | Collaborator edits are staged as suggestions. Owner approves, then it publishes.               |
| `auto`             | Any collaborator edit republishes after a debounce.                                            |

`auto` is opt-in per timeline, never a global default.

**Review is wholesale, not per-change.** The interaction is "here is the current draft; if you are
happy with it, publish it" — an owner reads through and makes one call, rather than adjudicating
forty individual edits. Version history exists underneath (§4.3) and can be surfaced when something
looks wrong, but browsing it is the exception, not the review flow.

**What a collaborator sees.** The editor has to be unambiguous about publication state, because a
collaborator cannot publish and should never have to guess. Three states, not two:

| State | What the collaborator needs to know |
|---|---|
| Never published | This timeline has no public version yet. Nothing here is visible to anyone outside. |
| Published, draft matches | What you see is what the public sees. |
| Published, draft has moved on | There are unpublished changes; only the owner can publish them. |

A collaborator can always view the published version — it is a public record on the owner's PDS,
readable by anyone, with or without an account. A count of pending changes is probably noise; the
signal is the state, not the number.

### 4.3 Revert is what makes this safe

Because the server holds every draft version, "publish" is just materializing a version and
`putRecord`-ing it. That makes **revert cheap: republish an earlier materialization.** Version
history, a visible "published version N (by X, 2h ago)", and one-click revert should be built
*before* `auto` is offered, not after. Most of the risk in automated publishing is the
irreversibility, and here there isn't any — a `putRecord` overwrite is fully undoable as long as we
keep the history, which we do by construction.

### 4.4 Blobs get much simpler

In the spaces design, publishing meant fetching each collaborator's blobs from *their* PDS with a
space credential and re-uploading them into the owner's repo. Here the draft — bytes included — is
already on our server, so publish is a single upload pass with the owner's session. This was the
largest chunk of pure plumbing in the old plan and it mostly disappears.

### 4.5 Blob GC vs. revert

Real problem, worth designing against explicitly. A PDS garbage-collects blobs that no record in the
repo references. So: collaborator adds an image → owner publishes → collaborator removes it → owner
publishes again → the blob is now unreferenced and gets collected. Owner reverts to the earlier
version, and its `blobRef` points at a CID the PDS no longer has. Broken image in a published
timeline.

**The architecture already solves this, if we let it.** Blob CIDs are content hashes: the same bytes
always produce the same CID. So as long as *our server* still holds the media in draft history,
revert simply re-uploads it and lands on the identical CID, and the re-materialized record is
byte-identical to the original. Publish is a projection of draft state; revert re-projects.

That makes the design rule explicit:

> **The draft store is the source of truth for media.** It retains bytes for as long as it retains
> version history. The PDS holds a projection, and anything missing there is re-uploadable.

The alternative — keeping retired `blobRef`s in a hidden field of the published record so the PDS
never collects them — works, and it's a known trick, but it's the worse option here:

- it pins storage in the **user's** PDS quota forever for media nothing displays
- it leaks. A reader inspecting the record sees blobs absent from the visible timeline, and they stay
  publicly fetchable. If a collaborator removed an image because it shouldn't have been there —
  wrong photo, rights problem — pinning it in the public repo is a feature-shaped bug.

Server-side retention is private, revertible, and doesn't consume someone else's quota. Prefer it.

Two consequences: **media retention policy becomes load-bearing for revert**, not just a storage
question (§10.5) — the revert horizon is therefore 90 days, the same number, and the UI shouldn't
offer a revert it can't perform. And if the owner has revoked our session, re-upload fails, so reverting to a version
with collected media degrades to "reconnect to revert."

---

## 5. Consent and accountability

Under `auto`, a collaborator's words go out signed by the owner's key, from the owner's repo, without
the owner reading them. Anyone inspecting the repo sees the owner published it, and the owner's PDS
terms of service are what's on the hook. This is an editorial question, not a technical one.

It is a well-understood shape in editorial contexts — shared bylines, managed publications — and
it's handled with process rather than mechanism. What the software should provide:

- `review` as the interesting default for anything beyond a trusted pair; `manual` as the safe one
- a `contributors` field **in the published record on the PDS**, and therefore public by
  construction — which is the point, since attribution has to survive independently of our server.
  Whether the *player* renders it as a visible byline is a separate design question, and not yet
  answered.
- a publication log — who triggered each published version, and when — held **with the draft on our
  server**, visible to the owner and collaborators. This one is not public and is not part of the
  published record.
- cheap revert (§4.3), which converts most consent failures from incidents into corrections

The first two are easy to run together and shouldn't be: one is a public, durable claim about
authorship, the other is private operational history. They have different audiences, different
lifetimes, and different deletion stories.

---

## 6. Telling people when things break

### 6.1 Mostly, don't have the problem

§4.1 does most of the work. Confidential-client sessions can be unlimited with 180-day refresh
rotation, so token expiry stops being a routine event and becomes an edge case for genuinely
abandoned accounts. The remaining triggers are explicit revocation and account changes.

### 6.2 The person who needs the alert is already present

When a publish fails, the owner is by definition absent — but **the collaborator is in the app right
now**, and they're the one whose work isn't reaching the public. So the alert is in-app and
synchronous: *"Joe's connection has expired. Your changes are saved to the draft but aren't
published."* Plus a nudge affordance — copy a link, hand off to the collaborator's own mail or
messaging client. No service identity, no notification infrastructure.

The owner learns the moment they next sign in, which is also the moment they can fix it. If they
never sign in again, no notification channel would have helped.

### 6.3 On DMing from a service account

Technically viable, and the reason you haven't seen it is structural: **Bluesky's default DM setting
is "people you follow."** So our service account could only DM users who follow it first. That turns
a fallback notification channel into an onboarding step ("follow @timeline.knightlab.com to get
alerts") that most users won't complete — and the ones who don't are exactly the disengaged owners
the alert is for.

Other frictions: `chat.bsky.*` is a centralized Bluesky service reached by proxying to
`did:web:api.bsky.chat`, not general atproto, so it doesn't cover non-Bluesky accounts; automated
DMing sits close to spam behavior; and it's another integration to maintain. Worth keeping in the
back pocket as an *opt-in* channel for engaged users, not as the mechanism we rely on.

---

## 7. Atproto Spaces: deferred, not discarded

The Spaces alpha opened 2026-08-20 ([announcement](https://atproto.com/blog/atproto-spaces-alpha)).
We investigated building co-authoring on it; the research is worth keeping because the constraints
are stable facts, and because §1's argument is the only thing standing between us and revisiting it.

**The four constraints:**

- **No shared mutable record.** One permissioned repo per (user, space); you write only your own. Any
  co-authoring must be per-author records plus a deterministic merge.
- **No anonymous read.** A space credential needs a delegation token from *the reader's own PDS*.
  `policy: public` means "any signed-in atproto user," not the open web — so a space can't back a
  public embed, and can't even offer Longform's public draft-preview link.
- **The member list gates reads, not writes.** Writes are unilateral. The owner's lever is
  authority-authored adjudication records inside the space that clients honor — see Bulletin's
  `my.bulletin.removal`, *"an authority-authored removal."* Adjudicator, not gatekeeper. This is a
  genuinely elegant pattern and the most interesting thing in the whole design.
- **No firehose.** `registerNotify` needs a reachable endpoint, so browsers poll. A relay for
  sub-second is optional and changes latency, not the data model.

**What would bring us back:** a protocol path for delegated writes to another user's repo (which
would dissolve §1 entirely), or Spaces reaching stable release with the ecosystem tooling — a
browser OAuth client that speaks spaces, which today's `@atproto/oauth-client-browser@alpha`
verifiably does not.

Details, the op-log/CRDT design sketch, and the reading log live in
[spaces-coauthoring.md](spaces-coauthoring.md). Note that we'd still be running a server in most
Spaces designs anyway, for notifications and public read — the serverless version was always the
narrow case.

---

## 8. Open questions

Nine of the original eleven are resolved and have moved into the body — rich text, slide-ID keying
and the Svelte bridge to §3.2, review and draft-state UI to §4.2, credential scope to §10.2, local
drafts to §9, retention to §10.5, and undo into its own spec ([phase1-undo.md](phase1-undo.md)).
What is left:

- **Q1. What are the manual and review UXs?** The mechanism is settled (§4.2); the interaction is
  not. How does an owner see what changed since they last published — a diff, a slide-level change
  list, an activity feed? What does the history view look like on the occasions it is called for?
  To be worked through visually rather than in prose, and not on Phase 1's critical path.

- **Q6. How do we handle session lifetimes we cannot predict?** The spec states 2 weeks / 180 days /
  unlimited (§4.1), but users arrive from arbitrary PDSes and each one enforces its own limits, so
  there is no single number to design against. Treat the lifetimes as **observed, not assumed**:
  drive expiry handling off what a token response actually says, and measure the reference
  implementation (`bluesky-social/atproto`) only to get a sanity baseline. Fold in the `jwks_uri`
  cache behaviour from §4.1 while measuring.

---

## 9. Sequencing

- **Phase 1 — adopt Yjs locally.** Single user, no server, no collaboration. Move the editor onto the
  §3.2 document model, persist with `y-indexeddb`, keep publishing to the same single PDS record.

  **Several local drafts, not one.** `lib/draft.ts` is a single localStorage slot (`tl-draft-v1`)
  today, so opening a second timeline silently discards the first — a live data-loss bug. Since
  `y-indexeddb` is per-document by nature, keeping several is the default shape and the single-slot
  limit is what would take effort to preserve. The cost is a local drafts list in `HomeView`, which
  Phase 2 needs anyway. (This is about one browser's local state; nothing has ever stopped a person
  from collaborating on many timelines at once — in Phase 2 those are separate Durable Objects with
  separate access control.)
- **Phase 2 — the collaboration server.** Add a network provider (Hocuspocus on Workers + Durable
  Objects), draft storage, invite + access control, live cursors. Owner-only publishing, `manual`.
- **Phase 3 — confidential client + deferred publishing.** Version history and revert *first*, then
  `review`, then `auto`.
- **Phase 4 — polish.** Presence, change lists, publication log, contributor attribution.

### Why Phase 1 is worth doing on its own

Not because collaboration needs it staged — because it **pays for itself before any server exists**:

- **Undo/redo.** There is none in the app today (zero matches for undo/redo in `packages/authoring`).
  Yjs's `UndoManager` gives proper undo essentially for free, and it's the kind of thing users
  immediately notice in an authoring tool. The interaction is specified in
  [phase1-undo.md](phase1-undo.md): one global stack, and *reveal, then apply, then flash* whenever
  the change is off screen. Note that `trackedOrigins` must be set in Phase 1 even with a single
  user — it is what stops undo from reverting a *collaborator's* edits in Phase 2, and retrofitting
  it means re-auditing every mutation site.
- **Multi-tab safety.** Autosave today is whole-state to localStorage (`lib/draft.ts`), so two open
  tabs are a live data-loss bug — last save wins. `y-indexeddb` makes persistence incremental and
  syncs tabs.
- **Offline editing**, as a side effect.

And it de-risks the sequencing: the decomposition falls out of a **real implementation** rather than a
guess, so Phase 2 is a provider swap instead of an editor rewrite. Building the abstraction first,
before the thing it abstracts, is how you get the wrong seam.

Phase 1 needs no server, no CRDT *infrastructure*, and none of the §10 policy work. It remains the
place to start.

---

## 10. Running it

Cloudflare, on the strength of the Workers we already deploy plus one specific fit described in
§10.2. Notably **Hocuspocus 4 runs on Cloudflare Workers** (via `crossws`), not only Node — so we get
the standard, well-supported Yjs backend rather than porting to a bespoke implementation.

### 10.1 Shape


| Piece                                  | Cloudflare primitive                   | Why                                                                                                                                     |
| -------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Per-timeline draft + WebSocket fan-out | Durable Object, one per timeline       | A DO exists in one place at a time and reconnections route back to the same object — exactly the guarantee collaborative editing needs |
| Per-user session + tokens              | Durable Object, one per DID            | §10.2                                                                                                                                  |
| Media                                  | R2                                     | Zero egress fees                                                                                                                        |
| Our signing key                        | Workers secret / Secrets Store binding | §10.2                                                                                                                                  |

**There is not much to "provision."** The unit of isolation is the document, so there's no cluster to
size, no connection pool to tune, and no capacity plan — a new co-authored timeline is a new DO and
Cloudflare places it.

**Use the [WebSocket Hibernation API](https://developers.cloudflare.com/durable-objects/best-practices/websockets)
from day one.** This workload is pathological for naive billing: editors hold connections open while
reading and thinking. A DO idle and eligible for hibernation is *not billed for duration* while its
sockets stay alive. Without hibernation, idle editors are the entire bill.

### 10.2 Where credentials live

Two different kinds of secret, two different homes. Conflating them is the easy mistake.

**Our confidential-client signing key** (§4.1) is one value, set at deploy time, shared by all
requests → a **Workers secret**, or a Secrets Store binding for account-level management. Never in
the repo, never in the bundle, never reaching the browser.

**Whose tokens we hold, and for how long.** Only **owners of timelines that have at least one
collaborator**. Collaborators authenticate to *our* server for identity and access control, but we
never write to their repos — their media lands in our R2 and is re-uploaded under the owner's session
at publish (§4.4) — so storing their refresh tokens would add risk and buy no capability. Acquisition
is lazy: a solo author has no server-held session at all, and the escalation to a confidential-client
session happens when an owner first invites someone.

Release solves itself, provided we **never run a keep-alive**. Refreshing only when we actually need
to publish means an abandoned shared timeline's refresh token simply lapses at the 180-day mark, so
credential lifetime tracks real use with no cron and no attempt to detect that collaboration has
stopped — which is not reliably detectable. Explicit revocation paths (last collaborator removed,
timeline deleted, owner disconnects the app) still exist, but they are conveniences rather than the
mechanism.

**Users' refresh tokens are data, not configuration.** There's one per user, they change constantly,
and there may eventually be thousands. Secrets bindings are the wrong tool. They belong in storage —
and specifically in a **per-user Account DO, keyed by DID**.

The reason is the strongest single argument for Durable Objects here. From the
[OAuth spec](https://atproto.com/specs/oauth):

> *"In the atproto OAuth profile, refresh tokens are generally single-use, with the 'new' refresh
> token replacing that used in the token request. This means client implementations may need locking
> primitives to prevent concurrent token refresh requests."*

Refresh tokens **rotate and are single-use**. If two timeline DOs owned by the same user try to
refresh concurrently — entirely plausible when someone co-authors two timelines — one wins and the
other invalidates the session. That's a silent, intermittent "you've been logged out" bug of the
worst kind.

**A Durable Object is single-threaded per object.** Routing every refresh for a given DID through
that user's Account DO *is* the locking primitive the spec asks for, for free, with no lock table and
no lease protocol. Document DOs never hold tokens; they ask the Account DO for a fresh access token
when they need to publish.

That also concentrates the sensitive asset in one place with one access path, which makes the rest of
the security story tractable: encrypt tokens at the application layer with a key from the secrets
binding (defense in depth over the platform's own at-rest encryption), log every mint, and give the
Account DO an explicit revoke path so "disconnect this app" is a real button.

### 10.3 What actually costs money

Almost nothing, at any scale timeline-ng is likely to reach.

- **Compute:** near zero with hibernation.
- **Yjs state:** a 30-slide timeline is on the order of hundreds of KB including history. Negligible.
- **Media:** the only term that grows.
- **Egress:** zero on R2. (On S3 this would be the line item that hurt.)

Three decisions keep media small:

1. **Keep blobs out of the CRDT.** Store media separately and reference it from the Yjs doc.
   Embedding binary inflates every sync.
2. **Content-address our media store by CID, mirroring the PDS.** Fifty retained versions referencing
   one image cost one copy, so **version history is nearly free** — growth tracks *unique bytes*, not
   versions × media. It also makes §4.5 exact rather than hopeful: the CID we hold is the CID the PDS
   computes on re-upload, so revert is verifiable. Retention becomes refcount-and-GC on our side, the
   same pattern the PDS runs.
3. **Only co-authored timelines touch the server.** Solo authoring stays browser → PDS, as today.

Sizing: a heavy co-authored timeline at ~30 MB of unique media, times a thousand timelines, is ~30 GB
— well under a dollar a month on R2 at current rates. Ten thousand is still a rounding error. **Don't
optimize here.**

### 10.4 Normalize media on ingest

Historically TimelineJS content leaned on externally-hosted media because uploading was awkward.
PDS-backed upload removes that friction, so **upload volume should be expected to go up**, and users
routinely upload camera-resolution files that are wildly oversized for web publishing.

Resize and re-encode at ingest rather than storing what was handed to us. It cuts storage and egress,
speeds up published timelines, and — because we content-address (§10.3) — the CID we store is the CID
of the *normalized* image, which is what gets published. One canonical artifact, no divergence between
what the editor previews and what readers fetch. Keep the original only if we want a re-crop story
later, and if so, treat it as a separate, shorter-retention class.

### 10.5 Retention and deletion: a policy we have to write

The dollars are trivial. These are the real cost, and there is **no existing Knight Lab policy to
inherit** — StoryMap never needed one at this depth. Treat it as a deliverable, not housekeeping.

**The whole policy is one tension.** Two forces pull the retention window in opposite directions:


| Longer history                             | Shorter history                                |
| ------------------------------------------ | ---------------------------------------------- |
| Revert reaches further back (§4.3, §4.5) | Less user content held, smaller breach surface |
| Media stays re-uploadable after PDS GC     | Contributors' data ages out on its own         |
| Better recovery from a bad`auto` publish   | Cheaper, simpler, less to answer for           |

Pick the number and everything else follows. **The revert horizon cannot exceed media retention**, and
the UI must never offer a revert it can't perform.

**The sharp problem: a contributor asking to have their contributions removed.** In a CRDT, everyone's
operations are interleaved in one append-only history. "Delete my contributions" is not a
delete-a-row operation, and after a merge it may be genuinely infeasible to extract one person's
edits surgically.

The elegant answer is to make it a *retention* question rather than a *surgery* question:
**history compaction gives retraction by expiry.** Compact draft history on the retention schedule,
and a contributor's raw operations age out on their own — the request is satisfied by the window,
not by a scalpel. Which is also why the window can't be indefinite, and why the revert horizon and
the deletion promise are the same number viewed from two sides.

**The number is 90 days.** Draft version history is kept for 90 days, and media is kept for as long
as any retained version references it. Comparable products treat history as a tiered feature rather
than an archive — Figma and Notion both cap version history on lower tiers — and nobody in this
category keeps raw edit history indefinitely. Ninety days covers "we published something wrong and
nobody noticed for a while" by a wide margin, sits at the generous end of the field, and makes the
contributor promise a sentence we can actually keep: *your raw edits age out within 90 days of being
superseded.*

Published versions are the exception and are kept indefinitely: they are small materializations, the
current one lives on the owner's PDS regardless, and they are what a publication log (§5) refers to.

**Abandoned drafts**, separately: warn in-app at 12 months untouched, purge at 18. We cannot notify
the owner out-of-band — §6.3 disposes of DMs, and atproto hands us no email address, which we would
then have to hold and retain in its own right — so the mitigation is that the purge is nearly
harmless rather than that the warning is loud. If the timeline was ever published, the published
version is on the owner's PDS and is untouched; only unpublished working state is lost.

One carve-out: a draft **never published at all** has no copy anywhere else, so purging it destroys
the only one. Those get a longer window and an explicit confirmation on the owner's next sign-in
rather than silent deletion.

Still to write down, all of which follow from the number rather than reopening it:

- What happens to a draft when the owner deletes the timeline — immediate purge, or a grace period?
- When a collaborator is removed, do their existing contributions stay in the draft?
- What happens on account deletion or session revocation?

*(Not a legal opinion. Northwestern will have a records-retention policy this has to sit inside;
confirm before the number goes anywhere public-facing.)*

Two more obligations alongside it:

- **Refresh tokens as the crown jewels.** Long-lived credentials to users' PDS accounts, and the part
  with no institutional precedent (§1). See §10.2.
- **It can be down** in a way a static site cannot.

### 10.6 Build for a second consumer

StoryMapJS is expected to get a comparable overhaul — atproto-backed, with a substantial JS rewrite.
If that happens, it needs exactly this machinery: a confidential OAuth client, token custody with
serialized refresh, a collaborative draft store, deferred publishing, and this retention policy.

That is worth honoring now, cheaply, without building a platform:

- **Keep timeline semantics out of the sync, auth, and publish layers.** The service syncs a Yjs
  document and publishes a record; *which* record shape is a parameter. Slide-aware logic belongs in
  the app, not the server.
- **The retention policy should be written tool-agnostic**, as Knight Lab authoring policy that
  timeline-ng is simply the first to adopt.
- **Separate OAuth clients, shared custody.** Distinct `client_id`s so users see "TimelineJS" or
  "StoryMap" on the consent screen, over common token-custody infrastructure.

A seam, not an abstraction. Cheap to leave now, expensive to retrofit.

### 10.7 Protect the blast radius

An outage here degrades **co-authoring only**. Published timelines live in users' PDSes; the player
and every embed read from there and never touch this service. Solo authoring keeps working. This is
the same split that makes StoryMapJS's authoring server comfortable to run, and it is the single most
valuable property of the design.

**Hold onto it deliberately.** The tempting shortcut later — "let the player call our API for just
this one thing" — would quietly convert thousands of embedded timelines into dependents of a service
we now have to keep up forever. Treat "the player has no runtime dependency on the collaboration
service" as an invariant, not a preference.

### 10.8 Cloudflare plan: free vs. paid

We're on Workers Free today. **Build and pilot on free; move to Workers Paid ($5/mo) before real
users** — but not for the reason you'd guess.

Durable Objects *are* available on the free plan, restricted to **SQLite-backed** DOs. That's not a
real constraint; SQLite-backed is the right choice here anyway.


|                | Free                        | Paid ($5/mo)                              |
| -------------- | --------------------------- | ----------------------------------------- |
| Requests       | 100k/day (≈3M/mo)          | 1M/mo included, then $0.15/M              |
| Duration       | 13,000 GB-s/day (≈390k/mo) | 400k GB-s/mo included, then $12.50/M GB-s |
| SQLite storage | 5 GB total                  | 5 GB-month, then $0.20/GB-month           |
| Rows written   | 100k/day                    | —                                        |

Note what that table says: **the free allowances roughly equal what the $5 plan includes**, and free
gives *more* requests per month. Paying does not buy headroom.

**What it buys is overage instead of cutoff.** On free, hitting a limit is a hard stop — requests
start failing, sessions break mid-edit, at peak usage, which is exactly when it's least acceptable.
On paid you get billed a few cents and nothing breaks. At $5/month that isn't a close call, and the
engineering time spent nursing free-tier caps costs more than the subscription in the first hour.

**The free headroom is genuinely fine for a pilot**, though. Incoming WebSocket messages bill at a
**20:1 ratio** — twenty messages count as one request. Yjs is chatty while someone is actively typing,
but at 20:1, ~10 messages/second works out to ~1,800 billed requests/hour, so 100k/day is on the
order of **fifty heavy editing-hours per day**. Ample for Phase 2 and an invite-only pilot.

**R2 for media:** 10 GB-month storage free, 1M Class A and 10M Class B operations, and egress is
always free. Beyond that, $0.015/GB-month. At ~30 MB per co-authored timeline, the free tier covers
roughly 300 timelines before you're paying pennies. *(Unverified: whether R2 can be enabled without
Workers Paid. It bills separately and has its own free tier, but may want a card on file regardless.)*

**The levers that keep it cheap**, on any plan:

- **Hibernation** (§10.1) — without it, duration billing for idle editors is the entire cost
- **Media in R2, never DO storage** — keeps you clear of the 5 GB SQLite limit
- **Content-addressed media** (§10.3) — version history costs almost nothing
- **Debounced persistence** — don't write a row per Yjs update. Rows-written (100k/day) is the
  tightest free limit, and batching is standard practice for Yjs providers regardless.
