# Co-authoring on Atproto Spaces

**Status: exploration / not started.** Notes on the Atproto Spaces alpha and a proposed shape for
co-authored timelines. Nothing here is committed to. Revised 2026-08-27 (v2) after reading the
alpha announcement and the community writing indexed by
[pub-search](https://pub-search.waow.tech/llms.txt).

> **v2 changed the core proposal.** v1 proposed per-slide last-write-wins. That is now the
> fallback, not the plan — see §4. The reason is in §4.1: the per-user-repo constraint makes an
> **op log** the natural shape, and an op log is what lets edits coalesce in near-real-time
> instead of one author's save clobbering another's.

---

## 1. Where things stand

**The alpha opened 2026-08-20.** The feature is now officially called **Atproto Spaces** — it was
"private data," then "permissioned data," then "buckets." Expect all four names in the wild.

| Thing | Where |
|---|---|
| Announcement | [atproto.com/blog/atproto-spaces-alpha](https://atproto.com/blog/atproto-spaces-alpha) |
| Spec | [proposals/0016-permissioned-data](https://github.com/bluesky-social/proposals/tree/main/0016-permissioned-data) |
| Implementation | [atproto#5187](https://github.com/bluesky-social/atproto/pull/5187), branch `permissioned-data` (still Draft) |
| PDS image | `ghcr.io/bluesky-social/atproto:pds-spaces-alpha` — drop-in for the reference PDS, no extra config |
| npm | `@atproto/*` at dist-tag `alpha` (currently `0.0.0-spaces-alpha-20260818163953`) |
| Reference app | **Bulletin** — [bulletin.my](https://bulletin.my/), [source](https://github.com/bluesky-social/bulletin) |
| Hosted sandbox | BPS account by invite; non-persistent, redeployed Thursdays |
| Full release | targeted "later in 2026" |

Alpha caveats from the announcement, worth repeating: no security review, no backups, breaking
database schema changes between versions with no upgrade path, the hosted PDS gets deleted at the
end of the alpha. Test data only. Don't migrate a real account.

---

## 2. What a space is

A **space** is an authorization and sync boundary, identified by a triple:

```
(space authority DID, space type NSID, space key)
at://{spaceDid}/space/{spaceType}/{skey}/{authorDid}/{collection}/{rkey}
```

The authority is the root of trust and issues read credentials. The type is an NSID resolving to a
lexicon with `"type": "space"` that declares the space's collections; it's also the OAuth consent
boundary. The key distinguishes spaces of the same type under one authority.

Every PDS must implement `com.atproto.simplespace`, which anchors a space on a user's own DID and
governs it with a member list. That's available on every account with nothing deployed.

### 2.1 Four constraints that decide the design

**A. There is no shared mutable record.**
A space holds *one permissioned repo per (user, space)*. Each member writes only into their own
repo. There is no record two people can both write; the space is the *aggregation* of per-member
repos, assembled client-side.

> Today the whole timeline — title, all events, settings — is one `com.knightlab.timeline` record
> (`saveTimeline` in `packages/authoring/src/lib/atproto.svelte.ts`). That model cannot be
> co-authored at all. Decomposition is forced, not optional.

**B. There is no anonymous read.**
A space credential requires a *delegation token minted by the reader's own PDS*. Even
`policy: public` means "any signed-in atproto account," not "the open web." A logged-out visitor
loading an embed has no PDS, so no token, so no credential.

> If a published timeline lived in a space, the player could not read it. This is why the
> draft/publish split below isn't a workaround — it's the only shape that preserves embeds.

**C. The member list gates reads, not writes.**
Confirmed bluntly by ngerakines, who is implementing both sides: issuing a credential *"does not
add to or change the member list and does not authorize writes."* Writes are unilateral — anyone
can write into a space they know the identifier of. `listRepos` returns accounts that *have
written*, not accounts *allowed* to write.

> This sounds like a hole. §4.2 argues it's the most useful property in the whole design.

**D. No firehose, and browsers can't subscribe.**
Notifications are HTTP POSTs to endpoints registered via `registerNotify`; a browser tab can't be
one. Browser sync is polling: `listRepos` returns every repo's `rev` + `hash` in one call, then
`listRepoOps since=<rev>` returns ops with record values inlined.

### 2.2 Practical findings from people building on the alpha

From [thunderbird's admin-lifecycle writeup](https://thunderbird.leaflet.pub/3mtusbnr3222j), which
wired the full lifecycle into a shipping app against the hosted alpha:

- **A credential covers the whole space, never part of it.** One credential reads every collection
  and every member's repo. If you want genuinely different audiences for different data, that must
  be *separate spaces* — not separate collections in one space.
- **`createSpace` has no natural trigger.** Reading and writing your *own* records in a space works
  without ever creating it; the PDS provisions implicitly on first write. But `getSpaceCredential`
  looks up a real registered policy config that implicit provisioning never created. So the right
  pattern is reactive: **call `createSpace` when `addMember` fails with `SpaceNotFound`, then
  retry.** "Ensure, don't pre-provision."
- **The admin lifecycle is solid.** create / add / remove / list all worked immediately, no batching
  or propagation delay. A removed member fails the next credential check.

Also: co-authors **cannot enumerate members** — `listMembers` must be called on the authority's PDS
with OAuth, and a space credential explicitly does not suffice. We need an app-level roster
regardless. And **blobs need credentials** (`com.atproto.space.getBlob`), so a plain `<img src>`
won't render a collaborator's image.

---

## 3. The shape: split the draft from the publication

| | Draft | Publication |
|---|---|---|
| Storage | Space | Public repo record (unchanged) |
| Type | `com.knightlab.timeline.workspace` | `com.knightlab.timeline` |
| Authority / repo | Creator's DID | Creator's DID |
| Key | `skey` = the published timeline's rkey | rkey |
| Who writes | Owner + co-authors, each into their own repo | Owner only |
| Who reads | Members (signed in) | Anyone, no auth |

The **player, embeds, and share links are untouched** — no regression risk to the shipped thing.
**Publish** = the owner materializes the merged draft and `putRecord`s it to their public repo.
Only the owner can, because it's their repo — editorially defensible: they're the publisher of
record. Using the timeline's rkey as the `skey` links workspace and publication both ways.

Encouragingly, this is exactly what [Longform](https://longform.social/qsje6f4zgb) does: collaborate
on a draft, and *"only the document owner can publish… Your collaborators' contributions are part of
the published document, but the record lives under your DID."*

---

## 4. Collaboration model

This is the part that changed from v1.

### 4.1 Write ops, not documents

Chris Pardy's [CRDT's on ATProto](https://leaflet.pub/p/did:plc:dp7v5b5kejmmzzpwmqyf5wj6/3motaq6j3g222)
lays out the model that fits constraint A almost exactly. The core of it:

- A CRDT is a **pure function over ops**: `f(ops) → document`. Given the same set of ops in any
  order, every client computes the same document.
- **Ops that originate from your client are written to your PDS.** That's all you're allowed to do
  anyway, and it's all you need.
- Replicating *other people's* ops into your own repo is **optional**, because if `OP1` and `OP2`
  are structurally identical then `f(OP1, OP2) = f(OP1)`. Duplication is harmless. So caching a
  collaborator's ops for offline/availability reasons is a free local choice, not a protocol
  concern.
- A document server / app view that collates op logs is **optional**. A relay for per-character
  live editing is **also optional** — and only needed for true character-level co-typing.
- He notes explicitly that *"private data is the right abstraction for CRDT documents — after all,
  even for a publicly readable document you don't want public contributions."* The article predates
  the alpha and describes composite rkeys as a stopgap until spaces landed. They've landed.

Why this beats v1's per-slide LWW:

| | per-slide LWW (v1) | op log (v2) |
|---|---|---|
| Two people edit different slides | fine | fine |
| Two people edit different fields of one slide | **one loses their edit** | both survive |
| Offline editing | last writer clobbers | merges on reconnect |
| "Coalesce edits in ~real-time" | not really — it's save-and-overwrite | natural |
| Path to a live relay later | requires rework | drop-in, data model unchanged |
| Cost | ~a day | meaningfully more: compaction, snapshots, a merge function that needs a real test suite |

**What I'd actually build:** field-level ops (`set slide S field F to V at lamport L by DID`),
merged by `(lamport, DID)`. That is a legitimate pure function over ops, it's a couple hundred lines,
it needs no CRDT dependency, and it upgrades per-field to a real text CRDT later without changing
the transport. Deletes are tombstone ops. Slide *order* stays free — TimelineJS orders by date, so
there's no list-order convergence problem at all, which is the single biggest reason this is
tractable for us and painful for a general document editor.

Op logs need **compaction**, and Pardy notes this forces an "edit horizon" limiting how far back an
op may apply. Also worth designing carefully: a space repo *already has* an operation log, for sync.
Putting an application op log inside it is two layers of the same idea (see Q1).

### 4.2 The owner's discretion over writes

This is the piece worth being excited about, and the reference app spells it out.

Bulletin's lexicons include `my.bulletin.removal` — described as *"An **authority-authored** removal
of a note from a board."* The owner doesn't *prevent* a write. They can't; constraint C. Instead
they **author a record inside the space that says "disregard that,"** and every well-behaved client
assembling the view honors it.

That generalizes into exactly the model you described from the demo. The owner is not a gatekeeper
standing in front of the write path; they are an **adjudicator publishing decisions into the same
log everyone else reads**. Which means we can define whatever adjudication vocabulary we want:

- `removal` — drop this op / this contribution from the assembled draft
- `pin` — this version of this field wins regardless of lamport order
- `accept` — promote a contribution from "suggested" to "in the draft"

And it composes with the merge function cleanly: adjudication records are just more ops, authored by
a privileged DID, that `f` gives precedence to. No server, no lock, no gate.

There's a second, stronger lever available if we ever want it: `policy: managing-app`, where the
authority calls the app's `checkUserAccess` at credential-mint time. Bulletin uses this — its repo
serves `/xrpc/com.atproto.simplespace.checkUserAccess`. But that requires running a service, so it's
firmly a later option, not a starting point.

### 4.3 What "real-time" costs

Three tiers, and only the last needs a server:

| Tier | Mechanism | Server? |
|---|---|---|
| ~3s convergence | poll `listRepos` (one call detects any change anywhere), then `listRepoOps since=` | **No** |
| Sub-second | a relay that fans ops out over WebSocket while they're also written to PDSes | Yes |
| Character-level co-typing | relay + a real text CRDT per field | Yes + Yjs/Loro |

Pardy is explicit that the relay is "entirely optional" and can be collapsed into whatever else you
run. Because ops go to your own PDS regardless, **adding a relay later changes latency, not the data
model.** That's the property that makes tier 1 a safe starting point rather than a dead end.

**Soft presence, not locking.** With per-user repos and no server there's nowhere to hold a lock;
any lock built from records is an advisory claim with a race inside it. Since we're polling anyway,
write a presence op every ~10s and show "Chris is editing this slide" without hard-blocking. Under
an op-log model the case for locking largely evaporates — concurrent edits merge instead of
colliding, so the UI only needs to *inform*, not *prevent*.

### 4.4 The honest alternative: don't use spaces for the draft

[Longform](https://longform.social/qsje6f4zgb) shipped real-time collaborative longform editing on
atproto. It's worth being precise about what they built, because it is *not* what's proposed above:

> Yjs + Hocuspocus over WebSockets. *"Access control is stored server-side, checked on every
> WebSocket connection. So is the draft data."*

Drafts don't touch atproto at all. Atproto provides identity (OAuth) and the publish target. Only on
publish does a record land in the owner's PDS. They also offer a public read-only draft link — which
they can, precisely *because* the draft is on their server and not in a space (constraint B).

That's a real, shipping, working design and it's cheaper than everything in §4.1–4.3. The tradeoff:
drafts aren't portable, aren't yours, and die with the service. Choosing spaces means choosing the
harder path for a specific reason — co-authored drafts that live in the authors' own repos. Worth
being deliberate that we're paying for that, and it's worth asking Longform's author whether they'd
build it differently now that the alpha is open.

---

## 5. Where the authority lives (this is the expensive decision)

Chris Pardy's [Adversarial Spaces](https://chrispardy.leaflet.pub/3msv77vpfnc2f) games out what
happens when a space authority turns hostile, and it's the best treatment of this question I found.
Three options, all with teeth:

- **Creator's own DID** (what §3 proposes). No server, available today. But the workspace is bound to
  one account: transferring it means handing over the whole atproto identity — Bluesky posts, blogs,
  everything. Pardy's example ends with the board being shut down rather than transferred.
- **A dedicated `did:plc` per space.** Transferable via rotation keys — but rotation keys are
  *ordered*, and the first-position holder wins any dispute within the 72-hour window. His `/d/ama`
  scenario is a co-admin fight that the earliest key holder simply wins. He proposes Shamir secret
  sharing over the first-position key so K-of-N admins must agree; says a PoC is "a long weekend."
- **A `did:web` the app controls.** Enables real governance — and lets the app seize any space,
  permanently, for any reason. His worked example is an acquisition and a dissident admin.

**For us: creator's DID, deliberately.** Our stakes are far lower than a community forum — one owner
plus a few named co-authors, and publication already lands in the owner's public repo, so the
durable artifact was never in the space. The failure mode we accept ("you can't hand a workspace to
a colleague; you republish and start a new one") is much better than the failure mode we'd take on
with a service-owned did:web ("we can seize your workspace"). But it *is* a real cost and Q4 below
keeps it live.

One thing to watch: Pardy proposes that **"spaces don't store records, they authorize records"** — a
record could be authorized by 0–n spaces, so moving between spaces (or from a space to public) would
mean adding and removing an authorizer rather than copying. If that ever lands, it dissolves the
blob problem in §6 entirely. Not implemented; worth asking whether it has traction (Q3).

---

## 6. Known hard parts

**Blobs are the hidden cost.** A collaborator's images live on *their* PDS behind
`com.atproto.space.getBlob`, which requires a credential — so `<img src>` fails in the editor and we
need fetch → object URL. Worse, on publish the owner must **re-upload every collaborator's blob into
their own public repo**, because a public record's blobs must live in the publishing repo. Real work,
plus a real question about what happens when a collaborator later deletes their copy.

**The browser OAuth client has no space support — verified.** I pulled
`@atproto/oauth-client-browser@alpha` and grepped its `dist`: zero occurrences of "space", no
`getDelegationToken`, no credential handling. (v1 flagged this as inferred; it's now confirmed.)
What *does* exist is `@atproto/space@alpha`, which ships the primitives — `credential`, `dpop`,
`lthash`, `repo-commit`, `sync` — platform-agnostic. So the browser glue is ours to write: a
non-extractable WebCrypto key in IndexedDB, delegation token from our PDS, exchange at the authority,
DPoP proof on every read. Note the lifetimes: delegation tokens are 60s and single-use, credentials
7200s and DPoP-bound via `cnf.jkt`.

**Bulletin is a server app.** The official reference app is Next.js with a confidential OAuth client,
and it *serves* `checkUserAccess`, `notifyWrite`, and `notifySpaceDeleted` endpoints. It is a
managing-app and a registered syncer. Useful to read, but it is not a model for a browser-only client
— nobody has published one of those yet, as far as I can find.

**Client attestation isn't required for us.** A browser SPA is a public client and can't produce a
`private_key_jwt`. Fine as long as spaces use `appAccess: open` (the default). `allowList` would force
us to become a confidential client with a server-side key.

**Churn containment.** Put every `com.atproto.space.*` / `simplespace.*` call behind one thin adapter
module. The spec is still moving (`ats://`→`at://`, scope `did`→`authority`, and `cnf.jkt` was added
in PR #99 *during* the alpha).

---

## 7. Phasing

- **Phase 0 — learn it.** Devnet on the alpha image, two accounts, drive the lifecycle from a script.
  Our devnet ([atproto-devnet.md](atproto-devnet.md)) already solves HTTPS, the `.internal` TLD, and
  the loopback-client scope trick; mainly we pin the image tag and add `space:` to the scope string
  (Q6). Read Bulletin's source alongside.
- **Phase 1 — decompose the model.** Move the editor onto an op-log store *behind an abstraction,
  still on the normal public repo*. No spaces involved. Refactoring we want regardless, testable
  today, immune to alpha churn. **This one could merge to `main`.**
- **Phase 2 — swap the store to a space.** Single author, single repo. Editor works; publish writes
  the public record.
- **Phase 3 — second member.** Polling merge, adjudication records, presence, blob re-hosting on
  publish.
- **Phase 4 — tighten.** Sub-second relay if wanted; per-field text CRDT if the conflicts justify it.

Phase 1 remains the leverage: the merge function is the substance, and it can be written and
tested with zero dependency on the alpha.

---

## 8. Questions worth taking to people

These are the ones I could not answer from what's published. Sharpest first.

**Q1. Two layers of op log — is that the intended shape, or a smell?**
A space repo already maintains an operation log (`listRepoOps`) with a set-hash for sync. An
application op log stored *as records inside* that repo means every app-level op is wrapped in a
protocol-level op. Is `listRepoOps` meant to be usable *as* the application op log — its entries
carry `rev`, `collection`, `rkey`, `cid`, `prev` and inline values — or is it strictly a transport
optimization that apps shouldn't build semantics on? The spec calls it "a transport optimization
rather than a committed data structure" and says hosts may compact or drop it, which suggests we
must keep our own. Confirming this would save or cost us a lot of work.

**Q2. Is there an intended invite / discovery path?**
`listSpaces` only returns spaces you've already *written* to; `listMembers` is owner-only. So a
newly-added co-author has no protocol way to learn a space exists. Today that means an out-of-band
link carrying the space ref. Bulletin sidesteps it (boards are "your followers" via managing-app).
Is an invite or inbox mechanism planned, or is that firmly app territory forever?

**Q3. What's the intended path for permissioned → public?**
Publishing means copying records *and re-uploading every blob* into the owner's public repo. Does
Pardy's "records are authorized by 0–n spaces" idea have traction with the protocol team? Is there
any other planned story for promoting a space record to public without a copy? This is the single
largest chunk of work in our plan and it's pure plumbing.

**Q4. For your friend, specifically:** what does the coordinator's discretion over writes look like
in his system — authority-authored adjudication records in the space (the Bulletin `removal`
pattern), a managing-app `checkUserAccess` hook, or something else? And did he land on an op-log /
CRDT merge, or ordered ownership? That's the detail that would most change §4.

**Q5. Can a browser client get near-real-time without a server, or is that settled?**
`registerNotify` needs a reachable endpoint, so the answer looks like "no — poll, or run a syncer."
Is anyone running a shared relay for spaces, and is per-character co-editing over spaces something
anyone has attempted, or is Yjs-on-a-server still the only real answer there?

**Q6. Does the alpha's OAuth provider accept `space:` scopes via the loopback-client-id query param?**
That trick is what makes our devnet work (see [atproto-devnet.md](atproto-devnet.md)). If space
scopes require a discoverable client, our devnet approach needs rethinking and Phase 0 gets harder.
**Cheap to test, gates everything — do this first.** May well be answerable by just trying it.

**Q7 (ours to decide, not to ask).** Creator-DID authority means no ownership transfer, ever. Does
"hand this timeline to a colleague / to the org account" matter enough to pay for a dedicated
space DID? Expensive to change later — switching *policy* is an `updateSpace` call, but switching
*authority* changes the space's identity and requires migrating records.

---

## 9. Other approaches, considered

Two projects are building richer permission layers *on top of* spaces. Both make a server the space
host, which is the thing our design is structured to avoid — but both are worth tracking, and both
would slot in later without changing the record model (a `policy` change is just `updateSpace`).

- **[The Arbiter](https://zicklag.leaflet.pub/3mjrvb5pul224)** (zicklag) — a standardized XRPC service
  for group management: roles, groups and channels all modeled as spaces, spaces delegating to other
  spaces, a cascading `$admin` space, eight access levels. The Arbiter *is* the space host. Two weeks
  old at time of writing, a Quint spec, no published repo. Aimed at community/organizational
  membership, which is a much bigger problem than "creator plus three co-authors."
- **[Habitat's ReBAC on spaces](https://habitat.leaflet.pub/3mtmqvao7oc2q)** — relationship-based
  access control via `network.habitat.relationship.*`, treating spaces as user-sets, with
  owner/manager/writer/reader relations and inheritance between spaces. Notably, **their motivating
  example is literally a collaborative document editor** with owner/editor/commenter/viewer roles.
  Further along than the Arbiter and explicitly intended as a peer to `simplespace`, with a spec
  promised so other hosts can interoperate. If we ever outgrow a flat member list, this is the first
  thing to re-read.

---

## 10. Reading log

Read in full: the alpha announcement; proposal 0016; CRDT's on ATProto; Adversarial Spaces; Atproto
Spaces admin lifecycle; Write Together (Longform); Bulletin's lexicons; `@atproto/space` and
`@atproto/oauth-client-browser` alpha package contents.

Skimmed: Permissioned Data: Space Access (ngerakines); Habitat ReBAC; the Arbiter.

**Queued, not yet read** — all surfaced by pub-search and all plausibly relevant:
Permissioned Data Shapes: Community-Moderated Content (ngerakines); Build Your Own CRDT (Pardy);
Habitat's road to release 01 (simplespace) and 02 (sap for syncing); HappyView v2.5; Permissioned
Data Diaries 5 and 6; Reading Proposal 0016 (ngerakines); Building More Resilient Local-First
Software with atproto.

The pub-search HTTP API works without the MCP:
`curl -sG https://leaflet-search-backend.fly.dev/search --data-urlencode "q=..." --data-urlencode "mode=hybrid"`,
and `/document?uri=at://...` returns full article text one URI at a time.
