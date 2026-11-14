# Phase 2 implementation plan: the collaboration server

**Status: proposal, for markup.** Written 2026-11-12, after Phase 1 and the sync-conflict work
([phase1-sync-conflicts.md](phase1-sync-conflicts.md)) both reached production. Implements
[coauthoring.md](coauthoring.md) §9's Phase 2: a network provider, draft storage, invites and access
control, live cursors, owner-only `manual` publishing.

Every judgement call below is tagged so it can be struck.

**Two things were measured against the devnet PDS on 2026-11-13** rather than reasoned about, the
way `swapRecord` was before the conflict work. [A6] is closed: a PDS refuses to write a record
referencing a blob that account did not upload, so the pre-Stage-4 failure is a refused publish
rather than a broken published image. [A2] is closed too: `getServiceAuth` works, OAuth sessions may
call it by design, tokens last an hour at most, and `aud` is checked for syntax but not
resolvability — but it needs an `rpc:` permission this app does not yet declare, so [P4] costs a
client-metadata change and a round of re-consent ([P19], [P20]). Both are written into Stage 1 and
the media section below; the scripts are gone.

## Pick up here

Nothing is built. The first thing to cut is Stage 0, which is a throwaway: a Worker and a Durable
Object that a browser can connect a Yjs provider to, no auth, no persistence. Its only job is to
prove the central bet — that this is a **provider swap, not an editor rewrite**
([phase1-plan.md](phase1-plan.md)). If Stage 0 takes more than a day or starts reaching into the
editor, stop: the document model drifted and that is the thing to go fix first.

Before writing any of it, re-read [coauthoring.md](coauthoring.md) §4 (the publishing negotiation)
and §5 (consent and accountability). They shape the server's API even though most of what they
describe does not ship until Phase 3.

### What has to be settled first, and what does not

**Nothing blocks Stage 0.** It needs a Cloudflare account that can deploy a Worker with a
SQLite-backed Durable Object, which the free plan does, and no decision in this document.

**The two things that had to land before Stage 1 ships a scope have landed** — both appear in client
metadata that users approve on a consent screen, and changing either costs another round of
re-consent ([P20]), so they were worth deciding before any code. [P26] fixes the service at
`drafts.knightlab.com` and [P27] the method at `com.knightlab.drafts.connect`, giving the one string
Stage 1 has to ship:

```
rpc:com.knightlab.drafts.connect?aud=did:web:drafts.knightlab.com
```

What is left of them is operational: a DNS record in the `knightlab.com` and `knilab.com` zones.

**Everything else is already decided, answered by building, or needed later than the code.** [R1]
(hibernation) and [R4] (whether the editor accepts a remote change at all) are findings Stage 0
produces rather than questions to answer beforehand — which is most of why Stage 0 is first.
[P24]'s retention rule blocks nothing before Stage 3. The one item with a clock of its own is
whether the retention policy needs Northwestern's sign-off before a pilot, because that runs on
other people's calendars; see [A4].

**[P25] The service has no dependency on `packages/core`.** `workers/collab` sits beside
`workers/og-preview`, which does depend on core and reads its `dist` — the build-ordering wrinkle
CLAUDE.md warns about. The collaboration server should not need it at all: §10.6 says to keep
timeline semantics out of the sync, auth and publish layers, and a `package.json` with no core
dependency is that seam made checkable rather than aspirational. If an import of core appears, the
seam has already leaked.

---

## What ships

- A Cloudflare Worker with two Durable Object classes: one per promoted timeline, one per user.
- A network provider in place of — strictly, **alongside** — `y-indexeddb`.
- **Promotion**: a timeline acquires a server draft. In Phase 2 the only trigger is inviting someone
  ([coauthoring.md](coauthoring.md) §3.3, Q12).
- Invites, a collaborator list, and access control checked on every connection.
- Collaborator media in R2, content-addressed by CID.
- The three publication states of §4.2, shown to owner and collaborator.
- Live cursors.
- Owner-only publishing, `manual` policy only, **from the owner's browser**.

## What does not

- **Any server-held PDS credential.** See [P1]. This is the largest single simplification available
  to Phase 2 and it should be defended, not quietly spent.
- The confidential client (§4.1), deferred publishing, `review`, `auto` — all Phase 3.
- Version history and revert (§4.3), and therefore the revert-horizon half of the retention policy
  (§10.5). Draft retention still has to be decided — see [A4].
- The second promotion trigger, "sync this across my devices" (§3.3, Q12) — deferred, and the
  invariants below are written so it stays cheap.
- Contributor attribution in the published record (§5), change lists, publication log — Phase 4.
- Q1's review UX. Phase 2 needs the *states*, not the diff view.

---

## Four things the code says that the design doc does not

These came out of reading the Phase 1 code rather than the design, and three of them change a stage.

### The provider seam is one function

`App.svelte`'s `attach(id)` is the whole of it:

```js
async function attach(id) {
  const result = await persistDoc(id, tldoc.doc);
  provider = result.provider;
  persistWarning = result.error;
}
```

One call site, one `provider` variable, one closing path in `closeDraft()`. The network provider
goes in beside it. This is the strongest available evidence that the Phase 1 decomposition held, and
it is worth checking first precisely because it is cheap to check.

### `createDoc()` stamps the document, which collides with sync-conflicts [P13]

`createDoc()` writes `schemaVersion` into `meta` at construction, and `TimelineDoc` calls it in a
field initializer — so **every `TimelineDoc` is a non-empty document before anyone touches it**.
[P13] in [phase1-sync-conflicts.md](phase1-sync-conflicts.md) — that document's tag, not this
one's — requires that a browser joining an existing server draft connect an *empty* document and let the provider fill it. A stamp is a small
divergence rather than a duplicated slide, but it is a write, and it means "empty" needs defining in
code rather than assumed. `localStore.readDraftTimeline` already has this exact problem and solves
it by using a bare `Y.Doc` — the same move is available here, but it has to be deliberate.

Note that `createDoc`'s own comment anticipates this: *"Phase 2's connect handshake wants the same
value."* The handshake wants to *read* the version, which is a different thing from stamping one.

### Media is uploaded eagerly, to whoever is signed in

`EventEditor.svelte` calls `uploadBlob` the moment an author picks a file (two call sites), not at
publish, and `uploadBlob` uses the signed-in agent — so the bytes go to **the collaborator's own
PDS**, and nothing in that repo ever references them. The only record that would is the owner's
timeline record, in the owner's repo.

**[A6] answered on devnet, 2026-11-13.** The failure is loud, not silent:

- **`putRecord` refuses.** Bob referencing a CID Alice uploaded gets HTTP 400,
  `{"error":"BlobNotFound"}`. A PDS will not write a record referencing a blob that account did not
  upload, so **no dangling reference can reach a published timeline**. The pre-Stage-4 failure mode
  is a publish that stops with an unhelpful error, which is the good version of this bug.
- **Blob checking is independent of lexicon validation.** The same write came back
  `"validationStatus":"unknown"` — the devnet PDS has never heard of `com.knightlab.timeline` and
  did not validate the record's shape — and it still enforced the blob rule. So this does not depend
  on our lexicon being known to anyone.
- **An unreferenced blob is not readable at all**, from either repo: `getBlob` returns 400 for the
  uploader's own DID until a record commits. `blobCache.ts` already says so in a comment — *"only
  works after the record containing the blob is committed"* — which corrects an earlier draft of
  this section that had the collaborator's PDS serving their own upload back to them. It does not.
  What makes the image look fine to the person who added it is `blobCache.ts`'s session-scoped map
  of CID → local object URL, populated at upload and read by `localOrPdsBlobUrl`. **The one person
  who cannot see the problem is the one who caused it**, and the mechanism is a browser-local cache,
  not a PDS.
- **Identical bytes gave identical CIDs** across two accounts and two uploads, which is §4.5's revert
  argument confirmed rather than assumed: re-uploading from our store lands on the CID the record
  already names.
- After a record referenced it, `getBlob` returned 200. Garbage collection never enters the story —
  the write fails first.

Stage 4 is still required, and nothing needs guarding before it: the failure is a refused publish,
visible to the owner at the moment they try.

This is why media is a Phase 2 stage and not a Phase 3 one. It is not an optimization; without it,
collaboration produces broken timelines the first time anyone adds a picture.

### The sync-conflict machinery is the fork mechanism Phase 2 needs

`threeWay()`, `pullList()` and the fork index entry (`forkedFrom`, carrying `baseSnapshot`) already
exist and are exercised in production. [P13]'s "a local draft that already exists is reconciled
separately and never attached" has somewhere to put that draft on day one. Phase 2 inherits a
solved problem here; see Stage 2.

---

## Stages

Each stage should be independently mergeable and leave the app working.

### Stage 0 — the service skeleton ✅ built 2026-11-14, not merged

A Worker, one Durable Object class, a document name from the URL, no auth. The authoring app gets a
dev-only flag — `?collab=<room>` with `VITE_COLLAB_URL` set — that attaches a network provider.
`workers/collab`, and `lib/collabSession.ts` on the client. The gate is met: a slide added in one
browser appears in another, and opening it there shows the same Slide ID, so the internal key
synced rather than being re-derived — which is what [P13] needs to be true.

**[P30] Not Hocuspocus. The sync protocol is implemented directly against `y-protocols`.** §10 chose
Hocuspocus to get "the standard, well-supported Yjs backend rather than porting to a bespoke
implementation", and that argument does not survive contact with [P2]. Hocuspocus 4 *does* run on
Workers — v4 moved off the Node `ws` package to `crossws` precisely for this, and on non-Node
runtimes you drive the `Hocuspocus` class directly rather than its `Server`. But its model is a
long-lived in-memory server, and hibernation re-runs the constructor with every class field reset,
so the document has to be reloaded on wake either way. Once that is true, Hocuspocus is carrying a
framework to avoid about 150 lines, on a code path its own maintainers describe as new and want
feedback on, with one public report of Workers being a poor fit. The reference implementation for
this exact shape, `TimoWilhelm/yjs-cf-ws-provider`, is bespoke for the same reason.

What it costs: Hocuspocus's `onAuthenticate` / `onStoreDocument` hooks would have given Stage 1 and
Stage 3 a shape to fill in. Those are now ours to write — which Stage 1 wanted anyway, since the
identity check is [P4]'s service auth rather than anything Hocuspocus knows about.

**What Stage 0 did not prove: hibernation itself.** `wrangler dev` offers no way to force eviction,
so the wake path is correct by construction — `ctx.acceptWebSocket`, the in-memory `Y.Doc` treated
strictly as a cache reloaded from storage — rather than verified. Re-check it on the first real
deploy, before Stage 3 builds on the assumption.

**[P1] Phase 2 holds no PDS credentials at all.** §10.2 says credential escalation happens "when an
owner first invites someone," which reads as a Phase 2 obligation. It is not, because Phase 2
publishes `manual`-only from the owner's browser — and §3.3 makes the same point in passing about
solo-synced timelines: the owner is *present* at every publish, so their existing browser OAuth
session is sufficient. Server-held refresh tokens buy a capability (`review`, `auto`, publishing
while the owner is away) that Phase 2 deliberately does not ship.

What this removes from Phase 2: the confidential client, the Account DO's token custody, the
single-use-refresh locking problem, application-layer token encryption, and the part of §10.5 with
no institutional precedent. The server still holds user *content*, which is real, but it stops being
the novel-risk project §1 describes. **Hold this line.** The first time a Phase 2 story seems to
want a token, it is a Phase 3 story.

**[P2] Hibernation from day one** (§10.1, §10.8). Retrofitting it means moving socket state out of
instance variables, which is a restructure rather than a flag. This is what decided [P30]: once
hibernation is non-negotiable, the reload-on-wake work exists whatever is running on top.

**[P3] The DO is keyed by a server-minted id, assigned at promotion.** A timeline can be promoted
before it has ever been published, and a published record's URI is a fact about one account's repo,
so neither the `at://` URI nor anything the browser already holds will do. Note what the browser
holds: `newDocId()` is a `crypto.randomUUID()` naming an IndexedDB database, so two browsers that
each opened the same published record have different ones — the same mismatch [P13] describes a
level down at `newSlideKey`. The id therefore comes into existence at promotion, which is also when
the DO does, and the client records it in the draft index (`DraftSummary` gains a field beside
`atUri`, `baseCid` and `forkedFrom`).

**[P21] The `at://` URI is promotion's idempotency index, not the DO's key.** Minting the id at
promotion raises "is this already promoted?", and for a published timeline the record URI answers it:
a second browser promoting the same timeline must *join* the existing id rather than mint a second.
A never-published timeline has no such key, and nothing can recognise two browsers' local drafts of
it as the same thing — correctly, since no shared identifier has ever existed. Treat that as a limit
of promotion-before-publication rather than a gap to close. The server records the owner's DID
explicitly at promotion for the same reason: with no `at://` URI there is nothing to derive it from,
and `DraftSummary.ownerHandle` is already documented as display-only for exactly this reason.

### Stage 1 — who is this

The server has to know which atproto identity is on a socket before it can check access.

**[P4] Authenticate with atproto service auth**, not a session of our own: the client asks its PDS
for a short-lived token via `com.atproto.server.getServiceAuth` with `aud` set to our service DID,
and the server verifies the signature against the user's signing key. No passwords, no account
creation, no long-lived server session, and it composes with [P1] — we learn who someone is without
holding anything that can act as them.

This needs our service to have a DID. `did:web` over the Worker's hostname is the cheap option.

**Verified on devnet, 2026-11-13** — behaviour by experiment, rules by reading `@atproto/pds@0.5.9`
in the running container ([A2] closed):

| Question | Answer |
| --- | --- |
| Does it work at all? | Yes, HTTP 200. Token is a JWT, `alg: ES256K`. |
| Claims | `iss` (the user's DID), `aud`, `iat`, `exp`, `jti`, and `lxm` when asked for. |
| **Can an OAuth session call it?** | **Yes, by design.** `getServiceAuth.ts` takes `ctx.authVerifier.authorization(...)`, and its legacy branch is guarded by `credentials.type === 'access'` with the comment *"'oauth' based credentials already checked through permission set."* OAuth is the first-class path, not the tolerated one. |
| Is `lxm` required? | Not syntactically — but a method-less token (`lxm` defaults to `'*'`) is capped at **one minute**, so it is required in practice. |
| Maximum lifetime | **1 hour with an `lxm`**, one minute without. Beyond either: 400 `BadExpiration`. |
| Is `aud` validated? | **Syntax only** — a valid atproto DID or an absolute `did#serviceId`. `did:web:not-a-real-host.invalid` was accepted; `not-a-did` was refused. The PDS does not check that our service exists. |
| Methods that can never be service-authed | `PROTECTED_METHODS` — account management: `updateHandle`, `getSession`, the email and app-password calls, `signPlcOperation`. Nothing we want. |
| What verification needs | The user's `#atproto` key from their DID document — a secp256k1 `Multikey`, reachable from `describeRepo`, which returns the whole `didDoc`. |

**[P19] The client metadata needs a new `rpc:` permission, and this is a prerequisite rather than
polish.** For an OAuth session the `authorize` hook calls `permissions.assertRpc({ aud, lxm })`, and
the base `ScopePermissions.allowsRpc` is `this.scopes.matches('rpc', options)` — it requires an
explicit `rpc:` permission matching that exact `(aud, lxm)` pair. There is one blanket escape hatch,
`ScopePermissionsTransition`, which returns true for any `lxm` outside `chat.bsky.` — but **it fires
only when `transition:generic` is present, and this project does not use it anywhere**. All six
client-metadata files and `buildWriteLoopbackClientId` declare:

```
atproto repo:com.knightlab.timeline blob:*/*
```

Granular already, devnet included. So **`getServiceAuth` would be refused for the app exactly as it
stands today** — `ScopeMissingError`, because no `rpc:` permission is declared at all. [P4] holds,
but not for free: it needs

```
rpc:com.knightlab.drafts.connect?aud=did:web:drafts.knightlab.com
```

added alongside the existing three (`rpc:*?aud=*` is explicitly forbidden, so the `aud` must be
named). Helpfully the failure is self-documenting:
`assertRpc` builds the error from `RpcPermission.scopeNeededFor(options)`, so the PDS names the
scope string it wanted.

**[P26] The service is `drafts.knightlab.com`, and its DID is `did:web:drafts.knightlab.com`.**
Staging is `drafts.knilab.com`, matching the `timeline.knightlab.com` / `timeline.knilab.com` split
`scripts/deploy.sh` already uses; devnet is `did:web:drafts.devnet.internal`, which never resolves
and does not need to — the PDS checks `aud` for syntax only, and we are the verifier.

Three things decided it. **A dedicated host rather than a path on `timeline.knightlab.com`**: a
path-based `did:web` is `did:web:timeline.knightlab.com:ng:collab`, resolving at `/ng/collab/did.json`,
which bakes a timeline-ng URL path into the service's permanent identity. A bare host puts the
document at `/.well-known/did.json`, which the Worker serves in a line. (`workers/og-preview` does
route on a path, but it is a timeline-specific service and this one is deliberately not.)

**An app-neutral name, because §10.6 says so and this is the expensive thing to get wrong.**
StoryMapJS is expected to need exactly this machinery, under *"separate OAuth clients, shared
custody"* — the client is per-app, the service is not. A hostname is the one choice [P20] makes
costly to revisit, so it is where honoring that seam actually matters.

**`drafts`, not `collab`,** for the same reason [P6] is about promotion and [P22] is about
ownership: name it for what it holds, not for the first thing it is used for. The deferred
cross-device trigger (§3.3, Q12) is a promoted timeline with no collaborators at all, and §4.5
already calls this *"the draft store"* and makes it the source of truth for media.

**[P27] The method is `com.knightlab.drafts.connect`.** The NSID's authority mirrors the host, so
the scope string is self-consistent and legible on a consent screen:

```
rpc:com.knightlab.drafts.connect?aud=did:web:drafts.knightlab.com
```

No `#serviceId` fragment — that is for a DID hosting several services, and it would only buy a `%23`
in every copy of the string. `com.knightlab.*` is unused in the lexicon index, so nothing collides.

**One method, and it should stay one thing.** All it authorizes is establishing a session with the
draft service. Phase 3's server-side publishing is a different capability — the owner letting the
service write to their repo while they are away — and belongs in its own permission rather than
quietly widening this one.

*Two notes for whoever sets it up.* The DID document is **not load-bearing in Phase 2**: nothing
resolves it, since the PDS does not check `aud` and we verify the user rather than ourselves. Serve
one anyway — it is cheap, a 404 at a published `did:web` is a bad look, and Phase 3 may want it.
And this needs a DNS record in the existing `knightlab.com` zone (the one `og-preview`'s wrangler
config already names) plus its `knilab.com` counterpart, which is Joe's to add, not the Worker's.

**[P20] Budget for re-consent.** A scope is fixed at authorization, so every currently signed-in
author holds a session without the new permission. They cannot be upgraded silently — the first
connection to the collaboration server fails and they have to re-authorize, consent screen and all.
That is a rollout step in Stage 1, and an argument for getting the permission string right the first
time rather than discovering a fourth one at Stage 4.

With that in place the shape is concrete: the client mints with `aud` = our service DID and `lxm` =
an NSID of our own, the PDS resolves neither but checks the scope permits the pair, and our Worker
verifies the signature against `iss`'s `#atproto` key and checks `aud`, `lxm`, `exp` and `jti`
itself.

Three consequences for the service. **`jti` is there, so replay protection is available** and we
should use it. **We must require `lxm`**, which the one-minute cap enforces for us anyway. And
**nothing about `aud` protects us**: a token naming our DID is not evidence the PDS vouched for us,
so checking `aud` against our own DID is the service's job and the only thing standing between us and
a token minted for somebody else.

*(Two places still describe the old `transition:generic` scope and are now wrong:
[atproto-devnet.md](atproto-devnet.md)'s `buildWriteLoopbackClientId` snippet, and the note it was
written from. The code moved; the docs did not.)*

**[P5] Identity is checked at connect and re-checked on a timer, not only at connect.** A socket in
this app is open for hours, and the 1-hour ceiling above sets the cadence for free: a client has to
re-mint within the hour regardless, so re-presenting a token *is* the re-check, with no separate
timer to design. Access revoked at 10:05 should not survive until the collaborator closes their
laptop.

### Stage 2 — promotion, invites, access control

**[P6] A Durable Object exists because a timeline was promoted, never because it has
collaborators.**
§3.3's invariant, stated here as the thing to test: it should be possible to construct a promoted
timeline with no collaborators and have every code path behave. The "sync across my devices"
trigger is then a second button rather than a refactor. Write the retention rules (Stage 3) in terms
of promotion for the same reason.

**[P7] Promotion is explicit and irreversible-ish in the UI, and the author is told what it means.**
"Invite someone" quietly meaning "upload my draft to Knight Lab's servers" is the kind of thing that
is defensible in a design doc and indefensible in a screenshot. One sentence at the moment of
invite, naming what moves and what does not.

**[P8] Sync-conflicts [P13] is implemented as a refusal, not a merge.** A browser that holds a local draft of a
timeline that has since been promoted does **not** attach it. It connects empty, syncs from the DO,
and the local draft becomes a fork in the existing sense — `forkedFrom` with its `baseSnapshot`,
surfaced by the pull-list that shipped on 2026-11-03. No new reconciliation UI.

**[P22] The owner is not a collaborator.** Ownership is a property of the timeline — the DID
recorded at promotion ([P21]) — and not an entry in the collaborator list with a special role. The
list holds the people who were invited, so "a promoted timeline with no collaborators" is a
statement that can be made at all, which is what [P6] needs. It also keeps the owner's rights from
depending on list membership, where "remove the last collaborator" and "can the owner remove
themselves" become questions. Presence and cursors do want everyone rendered uniformly, owner
included, but that is derived from who is connected rather than from who is invited.

**[P31] Making the editor render incoming changes is Stage 2's largest piece, and Stage 0 measured
it.** Two browsers in one room behave differently depending on what changed:

| Change | What the other browser does |
| --- | --- |
| A slide added or removed | Appears immediately. The slide list rebuilds from the snapshot. |
| A rich-text field edited | **Nothing**, until a reload — after which it is all there. |

So this is a rendering gap, not a sync gap: the document is correct in both browsers the whole time.
The cause is the one [phase1-plan.md](phase1-plan.md) already named — `EditorView` wraps the editor
in `{#key selectedId}` and its `$state` fields initialise from the `event` prop once at mount, so
data changing underneath does nothing on screen. That document calls it *"real Phase 1 work, not a
Phase 2 concern, and the hardest single piece"*, and it did not get done. It is Phase 2's now, and
its approach still looks right: derive the fields from the snapshot, with a local override while a
field has focus so an incoming change never fights the user's cursor.

**One claim in that note is wrong, and only running it showed it.** It says rich-text fields
*"sidestep it entirely, since Tiptap binds to the fragment directly"*. That holds only while a
Tiptap editor is mounted on the field — and in this UI a field is a placeholder until someone clicks
into it. The resting state renders the derived HTML mirror through the snapshot, so it is on the
broken path, not the exempt one. Phase 1's estimate of this work was therefore too small: it is not
just the non-rich-text fields.

**[P32] The empty state is keyed on selection, not on the document.** A browser holding slides it
has received but not selected shows *"Get started by adding slides to your timeline."* Harmless with
one writer, and exactly wrong for a collaborator opening a timeline someone else has filled. Small,
but it is the first thing an invited collaborator would see.

**[P28] `meta` is owner-only, and that is an access rule rather than a convention.** The Yjs `meta`
map holds `atUri`, `publishedSnapshot`, `baseCid` and now `createdAt` — four facts about the owner's
published record, none of them a collaborator's to write. Phase 1 never had to say so, having one
writer. Phase 2 syncs that map through the Durable Object to everyone on the socket, so a
collaborator's client must sync `meta` and never originate a write to it.

The code already half-draws this line: `doc.svelte.ts` has a `BOOKKEEPING_ORIGIN` for *"facts about
the document rather than content in it"*. Today that governs undo. Phase 2 needs the same split as
authorization, which is convenient — the mutation sites are already tagged. This is [P22] one level
down: the owner is distinguished by what they own, and their bookkeeping travels with the document
without becoming shared property.

**[P9] Two permission levels, read/write and read-only** (Longform's model, §2), both of them levels
*for collaborators*; the owner is not a third ([P22]). Not three, not
per-slide. The public draft link is **not** in Phase 2 — it is a separate consent decision and it is
the feature most likely to produce an accidental disclosure.

### Stage 3 — durable storage and retention

**[P10] Yjs state in the DO's SQLite, debounced.** Rows-written is the tightest free-plan limit
(§10.8) and batching is standard for Yjs providers regardless.

**[P11] No version history in Phase 2** — the DO holds current state plus whatever its provider
needs, not a retained series. History is what Phase 3's revert needs, and building a retained series
before the thing that reads it is the mistake §9 warns about in general.

Retention still has to be written, because Phase 2 holds drafts. It is a smaller question than
§10.5's — no revert horizon to trade against — but it is not zero: see [A4].

### Stage 4 — media in R2

**[P12] Collaborator uploads go to R2, addressed by CID.** The draft holds a reference that resolves
either to a PDS blob (the owner's, already published) or to our store (anything added since). At
publish, the owner's browser re-uploads anything R2-held and lands on the identical CID, because
CIDs are content hashes (§4.5).

**[P18] Normalize on ingest** (§10.4) — resize and re-encode rather than storing camera-resolution
originals. Doing it now means the CID we store is the CID that gets published, with no divergence
between preview and published bytes. Doing it later means two generations of stored media.

**[P14] The owner's own uploads keep going straight to their PDS**, as today. Changing that would
put every solo author's media in our store for no benefit, and §3.3's whole point is that solo
authoring does not touch us. *(This creates two upload paths in one editor, which is the cost. The
alternative — everything through R2 — is simpler code and worse architecture.)*

### Stage 5 — publication state and publishing

**[P15] `lib/syncState.ts` grows a "never published" case and is reused as-is.** §4.2's three
states are the four it already computes, minus the conflict case that the server draft dissolves.
Nothing new to design.

**[P16] A collaborator sees state, not a count.** §4.2 says the count of pending changes is probably
noise. Agreed, and it is also the expensive half.

**[P17] The publish button is owner-only and the draft is not locked during publish.** Publishing
reads a snapshot; collaborators keep typing. A lock would be a server-held mutex over a human-scale
operation, and the failure mode — a collaborator's edit landing in the next publish instead of this
one — is the normal case anyway.

**[P29] The record's `schemaVersion` travels with the draft; the service never knows it.** The
published record now carries a `schemaVersion` from `TIMELINE_RECORD_VERSION` in `packages/core`.
Phase 2 is unaffected — the owner's browser publishes ([P1]), so it stamps the value the way it does
today. Phase 3 is where it bites: the server materializes the record, and [P25] says the service
never imports core, so it cannot know the current version to stamp.

§10.6 already answers it in the abstract — *"the service syncs a Yjs document and publishes a record;
**which** record shape is a parameter"* — and this is the first concrete thing that tests it. The
version therefore belongs in the draft, written by the client that knows it, and the publish layer
copies it out rather than supplying it. Worth settling in Phase 2 even though nothing depends on it
yet, because the alternative is discovered at Phase 3 as a reason to add a core dependency "just for
this one constant", which is exactly how a seam goes.

### Stage 6 — live cursors

Yjs awareness, which the provider gives us. Last because it is the only stage that is purely
additive, and the first thing to cut if Stages 0–5 run long.

---

## Risks

- **[R1] — retired. Answered by taking the stated fallback.** The bespoke provider was the cheaper
  branch once [P2] held; see [P30]. The residual is not Hocuspocus but hibernation itself, which
  Stage 0 could not exercise locally.
- **[R2] Service auth fits — retired as a risk.** The fallback it guarded against (a server-minted
  session cookie after an OAuth round trip, dragging the confidential client into Phase 2 and undoing
  [P1]) is not needed. What is left is not a risk but a task: [P19]'s scope change and [P20]'s
  re-consent.
- **[R3] Two upload paths** ([P14]) is the fiddliest part of Stage 4 and the easiest to get subtly
  wrong, because it is invisible until publish.
- **[R4] — confirmed, and it is the biggest thing in Phase 2.** Stage 0 found out: structural
  changes arrive and render, rich-text edits arrive and do **not**. See [P31]. No longer a risk in
  the sense of an unknown; it is now known work, and it is Stage 2's largest piece.

## Gates

- Stage 0 does not merge until a second browser sees a change made in the first.
- Stage 2 does not merge until a promoted timeline with no collaborators works end to end ([P6]).
- Stage 4 does not merge until a collaborator-added image survives a publish and loads from the
  owner's PDS.
- `workers/collab/package.json` never gains a `@knight-lab/timeline-ng-core` dependency ([P25]).
- Nothing ships to real users on Workers Free (§10.8) — which is a pilot gate, not a build gate
  ([A1]).

## Asks

- **[A1] — the money half is answered: not yet, and not a concern.** Build and pilot on Workers
  Free; §10.8's argument for the $5 plan is about overage instead of cutoff, which only bites with
  real users, and there is a long way to go before anyone meets a wall. The hostname half is settled by [P26]; what
  is left is operational rather than a decision — a DNS record in each zone.
- **[A2] — closed.** The NSID and `aud` are decided in [P26] and [P27]:
  `rpc:com.knightlab.drafts.connect?aud=did:web:drafts.knightlab.com`, no service fragment.
- **[A3] — answered: out of Phase 2, and it is easy to add later provided one thing.** The risk was
  never the feature, it was baking "every connection has an identity" into the DO's invariants — the
  same shape of mistake as [P6]'s "has collaborators". So: **[P23] the DO authorizes a connection by
  what it may do, not by who it is.** An anonymous reader is then a connection carrying a
  capability and no DID, which Stage 2's access control has to be able to express even though
  nothing mints one in Phase 2. Get that right and the link is later UI work; assume a DID
  everywhere and it is a refactor of the authorization path.
- **[A4] — provisionally adopted, so it blocks nothing: [P24]** drafts live as long as the timeline
  is promoted; abandoned ones warn at 12 months and purge at 18. That is §10.5's abandonment rule
  without the 90-day history rule, which has nothing to trade against while [P11] holds. Strike it
  whenever; no code before Stage 3 depends on it.

  **One part of this is not deferrable on the same clock**, which an earlier draft of this ask buried
  by bundling it with the number: whether the policy has to go past Northwestern before a pilot.
  That has lead time measured in other people's calendars, so it wants starting well before a pilot
  is otherwise ready — and it is the one §10.5 item with no institutional precedent to inherit (§1).
  Not a blocker for writing code; a blocker for showing it to anyone.
- **[A5] — answered: invite by handle, and the invitee must already have an account.** No holding
  pattern for someone who has not signed up, since everything downstream depends on their identity.
  An invite to a handle that does not resolve fails at the point of invitation, which is the right
  place for it to fail.
- **[A6] — answered, nothing left to ask.** A PDS refuses the write with `BlobNotFound`; see *Media
  is uploaded eagerly* above. Kept here only so the numbering does not move.

## Decisions I made

- [P1] Phase 2 holds no PDS credentials. The biggest call in this document, and the one most worth
  arguing with — it reads §10.2's "escalation at invite" as describing the end state rather than
  Phase 2.
- [P3] Server-minted DO ids rather than `at://` URIs.
- [P8] Sync-conflicts [P13] becomes a fork, reusing the shipped pull-list rather than new UI.
- [P11] No version history in Phase 2, which defers most of §10.5.
- [P14] Owners keep uploading to their own PDS; only collaborators go through R2.
- [P17] No lock during publish.
- [P21] The `at://` URI indexes promotion; it does not key the DO.
- [P22] The owner is not a collaborator.
- [P23] Connections are authorized by capability, not by identity — what keeps [A3] cheap.
- [P24] Phase 2 retention: promoted drafts live, abandoned ones warn at 12 months, purge at 18.
- [P25] No core dependency in the service, as §10.6's seam made checkable.
- [P26] `drafts.knightlab.com` — a dedicated, app-neutral host, named for what it holds.
- [P27] `com.knightlab.drafts.connect`, one method, no service fragment.
- [P28] `meta` is owner-only — [P22] one level down, and already tagged by `BOOKKEEPING_ORIGIN`.
- [P29] The record version travels with the draft, keeping [P25]'s seam intact at Phase 3.
- [P30] The sync protocol is written directly against y-protocols, not Hocuspocus — [P2] decided it.
- [P31] The editor must render incoming changes; Stage 0 measured which changes it drops today.
- [P32] The empty state is keyed on selection rather than on the document.
- [P19] A new `rpc:` permission in client metadata, as a Stage 1 prerequisite rather than a
  production-hygiene item — the app declares none today, so [P4] does not work without it.
- [P20] Re-consent is a rollout step, not an accident.
