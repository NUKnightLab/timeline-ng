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
  noLink?: boolean;
  singleLine?: boolean;
}

/**
 * `minimal` and `inlineOnly` remove *block structure* — a headline or a caption
 * is one line of prose, not a document. Inline marks default to author freedom:
 * every mark StarterKit offers is available everywhere, except inline `code` in
 * a headline, where it is far more often a paste artefact than an intention.
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
    // StarterKit v3 ships Link itself, so excluding a separately-added Link
    // extension did nothing — a headline accepted links regardless. Turning
    // StarterKit's own off is what actually removes the mark.
    link: o.noLink ? false : { openOnClick: false, autolink: true },
    // Yjs owns history for a collaborative field: its UndoManager is the only
    // undo in the app, so ProseMirror's own must be off or the two fight.
    ...(collaborative ? { undoRedo: false as const } : {}),
  })];
}

const schemaCache = new Map<string, Schema>();

/** The schema a given configuration produces. Cached: building one is not free. */
export function schemaFor(o: RichTextOptions = {}): Schema {
  const key = `${!!o.minimal}|${!!o.inlineOnly}|${!!o.noLink}|${!!o.singleLine}`;
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
 * Serialize a fragment to the HTML the published record carries.
 *
 * Derived from the *fragment*, never from an editor instance. In Phase 2 a
 * collaborator's edit changes a fragment on a slide nobody has open locally,
 * which fires no local editor event — deriving from the editor would leave the
 * mirror stale for every slide that is not on screen.
 */
export function fragmentToHtml(fragment: Y.XmlFragment, schema: Schema): string {
  const root = yXmlFragmentToProseMirrorRootNode(fragment, schema);
  const dom = DOMSerializer.fromSchema(schema).serializeFragment(root.content);
  const host = document.createElement('div');
  host.appendChild(dom);
  return normalizeEmpty(host.innerHTML);
}

/** Parse HTML into an existing (empty) fragment. */
export function htmlToFragment(html: string, schema: Schema, fragment: Y.XmlFragment): void {
  const host = document.createElement('div');
  host.innerHTML = html ?? '';
  const node = PMDOMParser.fromSchema(schema).parse(host);
  prosemirrorJSONToYXmlFragment(schema, node.toJSON(), fragment);
}

/** Replace a fragment's contents from HTML — the migration path (see the plan). */
export function rebuildFragmentFromHtml(html: string, schema: Schema, fragment: Y.XmlFragment): void {
  if (fragment.length > 0) fragment.delete(0, fragment.length);
  htmlToFragment(html, schema, fragment);
}
