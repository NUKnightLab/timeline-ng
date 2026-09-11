/**
 * Which part of the timeline a captured change touched, so that undo can reveal
 * it before applying it — docs/phase1-undo.md: reveal, then apply, then flash.
 *
 * Computed when a change is *captured*, not when it is undone. Y.UndoManager does
 * report what an undo changed, but only after applying it, and "reveal first"
 * needs the target beforehand. So the result is stored on the stack item's meta
 * as each change lands, and read back just before undoing.
 *
 * Works from each YEvent's `target` rather than from the types a transaction
 * lists as changed. That list includes every *ancestor* of a change, so a
 * caption edit also reports its slide — reading keys off the slide would
 * attribute the change to the wrong field.
 */
import * as Y from 'yjs';
import { RICH_TEXT_FIELDS, metaMap, settingsMap, slidesMap, titleMap } from './doc.ts';

/** What the editor can bring into view. Named for the UI, not the data model. */
export type HistoryField =
  | 'headline' | 'body' | 'caption' | 'credit' | 'alt' | 'media'
  | 'date' | 'background' | 'slideId' | 'group' | 'slide';

export type HistoryTarget =
  | { kind: 'slide'; slideKey: string; field: HistoryField }
  | { kind: 'settings' }
  | { kind: 'title' };

/** A transaction's `changedParentTypes`, typed loosely enough to accept it. */
export type ChangedParentTypes = Map<unknown, unknown[]>;

const MEDIA_SUBFIELDS: Record<string, HistoryField> = {
  caption: 'caption', credit: 'credit', alt: 'alt',
  url: 'media', blobRef: 'media', mimeType: 'media',
};

function fieldFor(topKey: string, subKeys: string[]): HistoryField {
  const rich = RICH_TEXT_FIELDS.find((f) => f.fragmentKey === topKey);
  if (rich) return rich.mirrorField === 'headline' ? 'headline' : 'body';
  switch (topKey) {
    case 'media':
      for (const k of subKeys) if (MEDIA_SUBFIELDS[k]) return MEDIA_SUBFIELDS[k];
      return 'media';
    case 'media_position': return 'media';
    case 'start_date':
    case 'end_date': return 'date';
    case 'background': return 'background';
    case 'unique_id': return 'slideId';
    case 'group': return 'group';
    // Mirror writes are untracked, so this is only reachable from a field that
    // kept plain HTML because it could not become a fragment.
    case 'text': return subKeys.includes('headline') ? 'headline' : 'body';
    default: return 'slide';
  }
}

const targetOf = (event: unknown): unknown => (event as { target: unknown }).target;

function keysChangedOf(event: unknown): string[] {
  if (!(event instanceof Y.YMapEvent)) return [];
  return [...(event.keysChanged as Set<string | null>)].filter((k): k is string => !!k);
}

function keyOf<T>(map: Y.Map<T>, child: unknown): string | null {
  for (const [key, value] of map.entries()) if (value === child) return key;
  return null;
}

/** A type and its ancestors, nearest first, ending at a root type. */
function chainOf(type: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = type;
  while (current instanceof Y.AbstractType) {
    chain.push(current);
    current = current.parent;
  }
  return chain;
}

/** The field inside `owner` (a slide's map) that `event` changed. */
function fieldWithin(owner: Y.Map<unknown>, chain: unknown[], event: unknown): HistoryField {
  const at = chain.indexOf(owner);
  if (at === 0) {
    // Set directly on the slide's own map, so the key names the field.
    const keys = keysChangedOf(event);
    return keys.length ? fieldFor(keys[0], []) : 'slide';
  }
  const child = chain[at - 1];
  const topKey = keyOf(owner, child);
  if (!topKey) return 'slide';
  const subKeys = child === targetOf(event) ? keysChangedOf(event) : [];
  return fieldFor(topKey, subKeys);
}

/**
 * Whether a change to the title slide's map created or removed the whole slide.
 *
 * Reads only `keysChanged` and the map's current size. `YEvent.changes` is the
 * obvious way to tell an add from a delete, but Yjs refuses to compute it once
 * event handlers have run — and an UndoManager's `stack-item-added` listener,
 * which is exactly where this is called from, fires after them. Reading it
 * there throws "You must not compute changes after the event-handler fired."
 */
function isWholeTitleSlide(title: Y.Map<unknown>, event: unknown): boolean {
  const keys = keysChangedOf(event);
  if (keys.length < 2) return false;
  return title.size === 0 || title.size === keys.length;
}

export function targetFor(doc: Y.Doc, changedParentTypes: ChangedParentTypes): HistoryTarget | null {
  const slides = slidesMap(doc);
  const title = titleMap(doc);
  const settings = settingsMap(doc);
  const meta = metaMap(doc);

  const events = new Set<unknown>();
  for (const list of changedParentTypes.values()) for (const e of list) events.add(e);

  // Slides appearing or disappearing outrank any field inside them: adding a
  // slide also sets every field on the new map, and the reveal should be the
  // slide, not whichever field happened to be written first.
  for (const event of events) {
    const target = targetOf(event);
    // A key changing on the slides map itself only ever means a slide was added
    // or removed: slides are edited in place and never replaced, so no need to
    // ask which — and asking would mean reading `changes`, see above.
    if (target === slides) {
      const keys = keysChangedOf(event);
      if (keys.length) return { kind: 'slide', slideKey: keys[0], field: 'slide' };
    }
    if (target === title && isWholeTitleSlide(title, event)) {
      return { kind: 'slide', slideKey: 'title', field: 'slide' };
    }
  }

  for (const event of events) {
    const chain = chainOf(targetOf(event));
    const root = chain[chain.length - 1];
    if (root === settings) return { kind: 'settings' };
    if (root === meta) return { kind: 'title' };
    if (root === title) return { kind: 'slide', slideKey: 'title', field: fieldWithin(title, chain, event) };
    if (root === slides && chain.length >= 2) {
      const slide = chain[chain.length - 2] as Y.Map<unknown>;
      const slideKey = keyOf(slides, slide);
      if (slideKey) return { kind: 'slide', slideKey, field: fieldWithin(slide, chain, event) };
    }
  }
  return null;
}
