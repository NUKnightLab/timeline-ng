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

---

## What ships

- A Cloudflare Worker with two Durable Object classes: one per promoted timeline, one per user.
- A network provider in place of — strictly, **alongside** — `y-indexeddb`.
- **Promotion**: a timeline acquires a server draft. In Phase 2 the only trigger is inviting someone
  ([coauthoring.md](coauthoring.md) §3.3, Q12).
- Invites, a member list, and access control checked on every connection.
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

### Stage 0 — the service skeleton

A Worker, one Durable Object class, Hocuspocus 4 over `crossws`. A hard-coded document name, no
auth, no persistence beyond the DO's memory. The authoring app gets a dev-only flag that attaches
the network provider to the open draft.

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
instance variables, which is a restructure rather than a flag. Hocuspocus-on-Workers needs checking
against this specifically — see [A1].

**[P3] The DO is keyed by the promoted timeline's own id, not by the record's `at://` URI.** A
timeline can be promoted before it has ever been published, and a published record's URI is a fact
about one account's repo. A server-minted id survives both.

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
rpc:com.knightlab.timeline.connect?aud=did:web:timeline.knightlab.com%23collab
```

added alongside the existing three (`rpc:*?aud=*` is explicitly forbidden, so the `aud` must be
named, and a `did#serviceId` carries its `#` as `%23`). Helpfully the failure is self-documenting:
`assertRpc` builds the error from `RpcPermission.scopeNeededFor(options)`, so the PDS names the
scope string it wanted.

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

**[P6] A Durable Object exists because a timeline was promoted, never because it has members.**
§3.3's invariant, stated here as the thing to test: it should be possible to construct a promoted
timeline with an empty member list and have every code path behave. The "sync across my devices"
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

**[P9] Two permission levels, read/write and read-only** (Longform's model, §2). Not three, not
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

### Stage 6 — live cursors

Yjs awareness, which the provider gives us. Last because it is the only stage that is purely
additive, and the first thing to cut if Stages 0–5 run long.

---

## Risks

- **[R1] Hocuspocus 4 on Workers with hibernation is the schedule risk.** §10 asserts it runs via
  `crossws`; that it runs *hibernating* is a further claim. If it does not, the options are a bespoke
  provider on the DO WebSocket API (real work, well-trodden) or paying duration for idle editors
  (§10.8 says that is the entire bill). Find out in Stage 0, not Stage 3.
- **[R2] Service auth fits — retired as a risk.** The fallback it guarded against (a server-minted
  session cookie after an OAuth round trip, dragging the confidential client into Phase 2 and undoing
  [P1]) is not needed. What is left is not a risk but a task: [P19]'s scope change and [P20]'s
  re-consent.
- **[R3] Two upload paths** ([P14]) is the fiddliest part of Stage 4 and the easiest to get subtly
  wrong, because it is invisible until publish.
- **[R4] The editor accepting incoming changes.** [A1] in phase1-plan.md was the Phase 1 schedule
  risk and it was about this. Phase 1 shipped the snapshot bridge, but nothing has ever actually
  *received* a remote change in this editor. Stage 0 is where that gets found out.

## Gates

- Stage 0 does not merge until a second browser sees a change made in the first.
- Stage 2 does not merge until a promoted timeline with zero members works end to end ([P6]).
- Stage 4 does not merge until a collaborator-added image survives a publish and loads from the
  owner's PDS.
- Nothing ships to real users on Workers Free (§10.8).

## Asks

- **[A1] Is the Cloudflare account ready** — Workers Paid, R2 enabled, a hostname for the service
  DID? §10.8 flags that R2 may want a card on file regardless of plan. Worth settling before Stage 0
  rather than discovering it at Stage 4.
- **[A2] — answered. What remains is your call on the NSID.** `com.knightlab.timeline.connect` is a
  placeholder; it goes in client metadata that users see on a consent screen and is awkward to
  change afterwards ([P20]). Worth naming deliberately, and worth deciding at the same time whether
  the `aud` is a plain `did:web:<host>` or a `did:web:<host>#collab` service reference.
- **[A3] Does Phase 2 need the public read-only draft link?** [P9] says no. Longform has it and it
  is genuinely useful for showing work in progress to someone without an account.
- **[A4] What is draft retention in Phase 2, given there is no revert to trade against?** The
  §10.5 analysis assumes version history exists. A defensible Phase 2 answer is "drafts live as long
  as the timeline is promoted, abandoned ones warn at 12 months and purge at 18" — which is §10.5's
  abandonment rule without the 90-day history rule. Confirm, and confirm whether anything needs to
  go past Northwestern before a pilot.
- **[A5] Is invite-by-handle enough**, or does an invite need to work for someone who has not signed
  in yet? The second is a notification problem (§6.3 disposes of DMs) and probably means "copy a
  link and send it yourself."
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
- [P19] A new `rpc:` permission in client metadata, as a Stage 1 prerequisite rather than a
  production-hygiene item — the app declares none today, so [P4] does not work without it.
- [P20] Re-consent is a rollout step, not an accident.
