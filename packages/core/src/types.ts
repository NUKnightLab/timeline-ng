/**
 * Variable-resolution date. Only `year` is required.
 * Negative year = BCE. Values may be outside JS Date range (cosmological scale).
 */
export interface TLDateInput {
  year: number;
  month?: number;       // 1-based
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
  millisecond?: number;
  /** Override the rendered date string entirely. */
  display_date?: string;
}

/** ATProto blob reference, as returned by com.atproto.repo.uploadBlob. */
export interface ATProtoBlobRef {
  $type: 'blob';
  ref: { $link: string };
  mimeType: string;
  size: number;
}

export interface TLMedia {
  /** URL of the media resource. Should be a valid https:// URL. */
  url?: string;
  /**
   * ATProto blob reference for media uploaded to a PDS.
   * When present, url is hydrated at load time from the PDS endpoint.
   */
  blobRef?: ATProtoBlobRef;
  /**
   * MIME type hint. Takes precedence over URL pattern matching in the resolver.
   * Populated automatically when blobRef is hydrated.
   */
  mimeType?: string;
  caption?: string;
  credit?: string;
  thumbnail?: string;
  /** Alt text for image media; falls back to caption if omitted. */
  alt?: string;
}

export interface TLText {
  /** Headline text; may contain inline HTML. */
  headline?: string;
  /** Body text; may contain HTML. */
  text?: string;
}

export interface TLBackground {
  color?: string;
  url?: string;
  blobRef?: ATProtoBlobRef;
}

export interface TLEvent {
  unique_id?: string;
  /** Required on all events except the title slide. */
  start_date?: TLDateInput;
  end_date?: TLDateInput;
  text?: TLText;
  media?: TLMedia;
  /** Which side the media column appears on. Defaults to 'left'. */
  media_position?: 'left' | 'right';
  /** Optional grouping label. */
  group?: string;
  background?: TLBackground;
}

/** Social-share preview image — auto-generated at save time, or (eventually) user-set. */
export interface TLOgImage {
  url?: string;
  blobRef?: ATProtoBlobRef;
}

/** Timeline-level playback/display configuration. All fields optional; omitted = player default. */
export interface TLSettings {
  /** UI locale for chrome and date formatting. Currently supported: 'en' (default), 'es'. */
  language?: string;
  /** Color theme. 'auto' (default) follows the viewer's OS/browser preference. */
  theme?: 'light' | 'dark' | 'auto';
  /** 0-based index of the slide to display first (counting the title slide if present). Defaults to 0. */
  initialIndex?: number;
  /** Show events newest-first. The title slide (if any) always stays first. Defaults to false. */
  reverseOrder?: boolean;
  /** Social-share preview image for this timeline. */
  ogImage?: TLOgImage;
}

export interface TLTimeline {
  /** Optional title slide. Shown first; not linked to a date. */
  title?: TLEvent;
  events: TLEvent[];
  /** Optional playback/display settings for this timeline. */
  settings?: TLSettings;
}

// ── Internal parsed representations ──────────────────────────────────────────

/** Scale determined by whether year values fit in a JS Date. */
export type DateScale = 'human' | 'cosmological';

export interface TLParsedDate {
  input: TLDateInput;
  scale: DateScale;
  /** Milliseconds since Unix epoch. Only reliable for human-scale dates. */
  ms: number;
  /**
   * For cosmological-scale dates, a BigInt approximation of milliseconds
   * from an arbitrary epoch (year 0). Use only for ordering, not display.
   */
  bigMs?: bigint;
}

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
