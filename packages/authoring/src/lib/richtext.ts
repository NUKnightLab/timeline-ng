/**
 * One place that knows what the rich-text editor can express.
 *
 * The editor's configuration *is* a ProseMirror schema, and from Stage 3 the
 * document stores prose as `Y.XmlFragment` — structured nodes rather than an
 * HTML string. Two things then need the same schema: `RichTextEditor`, to edit,
 * and the reactive bridge, to derive the HTML mirror that gets published. They
 * have to agree exactly, so the configuration lives here rather than in the
 * component.
 *
 * See docs/phase1-plan.md, Stage 3 and its migration strategy.
 */
import { getSchema } from '@tiptap/core';
import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { DOMParser as PMDOMParser, DOMSerializer } from '@tiptap/pm/model';
import type { Schema } from '@tiptap/pm/model';
import * as Y from 'yjs';
import DOMPurify from 'dompurify';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';

/**
 * Bumped whenever the schemas below change in a way that stored documents
 * cannot simply be read under. Nothing consumes it yet — it is stamped from the
 * start because retrofitting a version onto documents that lack one is the
 * genuinely painful part of a migration, and Phase 2's connect handshake will
 * want the same value. See docs/phase1-plan.md [P9].
 */
export const SCHEMA_VERSION = 1;

export interface RichTextOptions {
  /** Caption and credit: one line of prose, no block structure. */
  minimal?: boolean;
  /** Headline: as `minimal`, and no inline code either. */
  inlineOnly?: boolean;
  singleLine?: boolean;
}

/**
 * `minimal` and `inlineOnly` remove *block structure* — a headline or a caption
 * is one line of prose, not a document. Inline marks default to author freedom:
 * every mark StarterKit offers is available everywhere, except inline `code` in
 * a headline, where it is far more often a paste artefact than an intention.
 *
 * Links are allowed in headlines. Arguably they are a poor idea there, but
 * StarterKit has permitted them since forever and the freedom default settles
 * a close call — restricting them now would strip anchors out of headlines
 * people have already published, which is a real cost against a stylistic one.
 */
export function extensionsFor(o: RichTextOptions = {}, collaborative = false): Extensions {
  const block = o.minimal || o.inlineOnly ? false : undefined;
  return [StarterKit.configure({
    heading: block,
    blockquote: block,
    bulletList: block,
    orderedList: block,
    codeBlock: block,
    horizontalRule: block,
    code: o.inlineOnly ? false : undefined,
    hardBreak: o.singleLine ? false : undefined,
    link: { openOnClick: false, autolink: true },
    // Yjs owns history for a collaborative field: its UndoManager is the only
    // undo in the app, so ProseMirror's own must be off or the two fight.
    ...(collaborative ? { undoRedo: false as const } : {}),
  })];
}

const schemaCache = new Map<string, Schema>();

/** The schema a given configuration produces. Cached: building one is not free. */
export function schemaFor(o: RichTextOptions = {}): Schema {
  const key = `${!!o.minimal}|${!!o.inlineOnly}|${!!o.singleLine}`;
  let schema = schemaCache.get(key);
  if (!schema) {
    // `collaborative` is deliberately false here: the Collaboration extension
    // contributes no nodes or marks, so it cannot affect the schema, and a
    // schema that depended on it would differ between editing and publishing.
    schema = getSchema(extensionsFor(o, false));
    schemaCache.set(key, schema);
  }
  return schema;
}

/** The editor treats an empty document as an empty string, not as `<p></p>`. */
function normalizeEmpty(html: string): string {
  return html === '<p></p>' ? '' : html;
}

/**
 * Reading a fragment under a schema that did not write it **silently discards
 * unknown nodes and everything inside them** — measured, not assumed: a
 * `<blockquote><p>Quoted.</p></blockquote><p>After.</p>` body read under the
 * headline schema comes back as `<p>After.</p>`, with the quoted text simply
 * gone. Note this is the opposite of the *parse* path, where the same markup
 * flattens to `<p>Quoted.</p>` and keeps its text.
 *
 * So there is no safety net here, and no loud failure to notice: a field must
 * always be read with the configuration that wrote it. `RICH_TEXT_FIELDS` in
 * doc.ts is the one place that mapping is recorded, and richtext.test.ts pins
 * the loss so the behaviour cannot be rediscovered by accident.
 *
 * Serialize a fragment to the HTML the published record carries.
 *
 * Derived from the *fragment*, never from an editor instance, for two reasons
 * that both bite:
 *
 * Concurrent edits to one field. Two authors typing in the same paragraph
 * produce a fragment that merges correctly, but each client would compute the
 * mirror from its own view and write it to the same string key — last write
 * wins, and the mirror ends up holding one author's text while the fragment
 * holds the merge. The published paragraph would then disagree with the one on
 * screen.
 *
 * Undo, which is a Phase 1 problem and not a Phase 2 one. `UndoManager` mutates
 * a fragment directly with no editor involved, and undo routinely lands on a
 * slide other than the one being displayed (docs/phase1-undo.md, Script 3), so
 * there is no editor to derive from at all.
 */
export function fragmentToHtml(fragment: Y.XmlFragment, schema: Schema): string {
  const root = yXmlFragmentToProseMirrorRootNode(fragment, schema);
  const dom = DOMSerializer.fromSchema(schema).serializeFragment(root.content);
  const host = document.createElement('div');
  host.appendChild(dom);
  return normalizeEmpty(host.innerHTML);
}

/**
 * Parse HTML into an existing (empty) fragment.
 *
 * Sanitized first. The schema would reject anything dangerous on the way into
 * the fragment anyway, but parsing assigns `innerHTML` on a real element, and a
 * detached node is not a guarantee in every browser — an `<img onerror>` is the
 * classic case. Cheaper to remove the question than to reason about it.
 */
export function htmlToFragment(html: string, schema: Schema, fragment: Y.XmlFragment): void {
  const host = document.createElement('div');
  host.innerHTML = DOMPurify.sanitize(html ?? '', { ADD_ATTR: ['target'] });
  const node = PMDOMParser.fromSchema(schema).parse(host);
  prosemirrorJSONToYXmlFragment(schema, node.toJSON(), fragment);
}

/**
 * Elements a ProseMirror schema built from StarterKit cannot represent, and
 * which therefore vanish rather than degrading when prose is parsed.
 *
 * ProseMirror is allowlist-only: a schema names the nodes and marks that exist,
 * and the parser discards everything else. That is usually benign, because most
 * unknown markup keeps its text — a table flattens to a paragraph reading
 * `Apollo1969`, a definition list becomes two paragraphs. These are the
 * exceptions, because they carry no text to fall back to. An `<img>` in body
 * prose simply disappears.
 */
const UNREPRESENTABLE = 'img,iframe,video,audio,embed,object,svg,canvas,picture,source';

/** Text content, whitespace-normalized, for comparing before against after. */
function textOf(html: string): string {
  const host = document.createElement('div');
  host.innerHTML = DOMPurify.sanitize(html ?? '', { ADD_ATTR: ['target'] });
  return (host.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Whether turning `html` into `fragment` cost anything that cannot be got back.
 *
 * Two different losses. Text that failed to survive the trip, which would be a
 * schema bug rather than an unsupported element, and embedded content that the
 * schema has no node for and which leaves nothing behind when dropped.
 *
 * A field that fails this keeps its HTML and forgoes a fragment. It stops being
 * collaboratively mergeable — the pre-Stage-3 behaviour — which is a far better
 * outcome than publishing a paragraph with the photograph quietly removed.
 */
export function seedingLosesContent(html: string, schema: Schema, fragment: Y.XmlFragment): boolean {
  if (textOf(html) !== textOf(fragmentToHtml(fragment, schema))) return true;
  const host = document.createElement('div');
  host.innerHTML = DOMPurify.sanitize(html ?? '', { ADD_ATTR: ['target'], ADD_TAGS: ['iframe'] });
  return host.querySelector(UNREPRESENTABLE) !== null;
}

/** Replace a fragment's contents from HTML — the migration path (see the plan). */
export function rebuildFragmentFromHtml(html: string, schema: Schema, fragment: Y.XmlFragment): void {
  if (fragment.length > 0) fragment.delete(0, fragment.length);
  htmlToFragment(html, schema, fragment);
}
