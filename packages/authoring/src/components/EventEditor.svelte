<script lang="ts">
  import type { ATProtoBlobRef, TLEvent, TLDateInput } from '@knight-lab/timeline-ng-core';
  import { resolveMedia, parseTLDate, formatDate, compareDates, canResolveBackgroundImage, resolveBackgroundImageUrl } from '@knight-lab/timeline-ng-core';
  import DatePicker from './DatePicker.svelte';
  import RichTextEditor from './RichTextEditor.svelte';
  import MediaPreview from './MediaPreview.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import { untrack } from 'svelte';
  import { getAuthState, getAvailableCollections, uploadBlob, blobUrl, cacheLocalBlobUrl, extractCid, localOrPdsBlobUrl } from '../lib/atproto.svelte.ts';
  import RepoBrowser from './RepoBrowser.svelte';
  import { describeMediaInput } from '../lib/mediaInput.js';

  interface Props {
    event: TLEvent;
    isTitle?: boolean;
    index?: number; // 0-based position in sorted events; undefined for title slide
    onchange: (updated: TLEvent) => void;
    ondelete: () => void;
  }

  interface DateDraft {
    year: number | '';
    month: number | '';
    day: number | '';
    hour: number | '';
    minute: number | '';
    second: number | '';
  }

  let { event, isTitle = false, index, onchange, ondelete }: Props = $props();
  // Snapshot the event prop — this component is keyed on selectedId and recreated
  // when the event changes, so $state fields only need the initial value.
  const ev = untrack(() => event);

  let startYear   = $state<number | ''>(ev.start_date?.year ?? '');
  let startMonth  = $state<number | ''>(ev.start_date?.month ?? '');
  let startDay    = $state<number | ''>(ev.start_date?.day ?? '');
  let startHour   = $state<number | ''>(ev.start_date?.hour ?? '');
  let startMinute = $state<number | ''>(ev.start_date?.minute ?? '');
  let startSecond = $state<number | ''>(ev.start_date?.second ?? '');

  let hasEndDate  = $state(!!ev.end_date);
  let endYear     = $state<number | ''>(ev.end_date?.year ?? '');
  let endMonth    = $state<number | ''>(ev.end_date?.month ?? '');
  let endDay      = $state<number | ''>(ev.end_date?.day ?? '');
  let endHour     = $state<number | ''>(ev.end_date?.hour ?? '');
  let endMinute   = $state<number | ''>(ev.end_date?.minute ?? '');
  let endSecond   = $state<number | ''>(ev.end_date?.second ?? '');
  let startDateDraft = $state<DateDraft>({
    year: ev.start_date?.year ?? '',
    month: ev.start_date?.month ?? '',
    day: ev.start_date?.day ?? '',
    hour: ev.start_date?.hour ?? '',
    minute: ev.start_date?.minute ?? '',
    second: ev.start_date?.second ?? '',
  });
  let endDateDraft = $state<DateDraft>({
    year: ev.end_date?.year ?? '',
    month: ev.end_date?.month ?? '',
    day: ev.end_date?.day ?? '',
    hour: ev.end_date?.hour ?? '',
    minute: ev.end_date?.minute ?? '',
    second: ev.end_date?.second ?? '',
  });

  let headline   = $state(ev.text?.headline ?? '');

  const formattedDateRange = $derived.by((): string | null => {
    if (isTitle || startYear === '') return null;
    try {
      const sd = date(startYear, startMonth, startDay, startHour, startMinute, startSecond);
      if (!sd) return null;
      const startStr = formatDate(parseTLDate(sd), 'en');
      if (hasEndDate) {
        const ed = date(endYear, endMonth, endDay, endHour, endMinute, endSecond);
        if (ed) {
          const endStr = formatDate(parseTLDate(ed), 'en');
          return endStr === startStr ? startStr : `${startStr} – ${endStr}`;
        }
      }
      return startStr;
    } catch { return null; }
  });
  const endDateOrderValid = $derived.by((): boolean => {
    if (isTitle || !hasEndDate) return true;
    const sourceStart = editingDate
      ? startDateDraft
      : { year: startYear, month: startMonth, day: startDay, hour: startHour, minute: startMinute, second: startSecond };
    const sourceEnd = editingDate
      ? endDateDraft
      : { year: endYear, month: endMonth, day: endDay, hour: endHour, minute: endMinute, second: endSecond };
    const sd = date(sourceStart.year, sourceStart.month, sourceStart.day, sourceStart.hour, sourceStart.minute, sourceStart.second);
    const ed = date(sourceEnd.year, sourceEnd.month, sourceEnd.day, sourceEnd.hour, sourceEnd.minute, sourceEnd.second);
    if (!sd || !ed) return false;
    try {
      return compareDates(parseTLDate(sd), parseTLDate(ed)) < 0;
    } catch {
      return false;
    }
  });
  let body       = $state(ev.text?.text ?? '');
  let mediaBlobRef = $state<ATProtoBlobRef | undefined>(ev.media?.blobRef);
  let mediaUrl     = $state(ev.media?.blobRef ? localOrPdsBlobUrl(extractCid(ev.media.blobRef.ref)) : (ev.media?.url ?? ''));
  let mediaCaption = $state(ev.media?.caption ?? '');
  let mediaCredit  = $state(ev.media?.credit ?? '');
  let mediaAlt     = $state(ev.media?.alt ?? '');

  const authState = $derived(getAuthState());
  const availableCollections = $derived(getAvailableCollections());
  let uploadStatus = $state<'idle' | 'uploading' | 'error'>('idle');
  let uploadError  = $state('');
  let modal        = $state<'media-types' | 'sign-in' | null>(null);
  const endDateToggleId = 'event-editor-end-date-toggle';

  // Media UX state
  let mediaMode           = $state<'upload' | 'url' | 'browse'>(ev.media?.blobRef ? 'upload' : 'url');
  let editingMedia        = $state(false);
  let isDragOver          = $state(false);
  let mediaSourceUrl      = $state<string | undefined>(undefined);
  let mediaCollectionNsid = $state<string | undefined>(undefined);
  let mediaCollectionUri  = $state<string | undefined>(undefined);
  let localBlobPreviewUrl = $state<string | undefined>(undefined);

  // Snapshot taken only when entering edit mode via "Change" — not after "Remove"
  let _snapUrl: string = '';
  let _snapBlobRef: ATProtoBlobRef | undefined = undefined;
  let _snapSourceUrl: string | undefined = undefined;
  let _snapCollectionNsid: string | undefined = undefined;
  let _snapCollectionUri: string | undefined = undefined;
  let _canRestoreSnap = $state(false); // true only when "Change" was clicked on existing media

  function startEditing() {
    _snapUrl             = mediaUrl;
    _snapBlobRef         = mediaBlobRef;
    _snapSourceUrl       = mediaSourceUrl;
    _snapCollectionNsid  = mediaCollectionNsid;
    _snapCollectionUri   = mediaCollectionUri;
    _canRestoreSnap      = !!(mediaUrl || mediaBlobRef);
    editingMedia    = true;
  }

  function cancelEdit() {
    if (_canRestoreSnap) {
      mediaUrl            = _snapUrl;
      mediaBlobRef        = _snapBlobRef;
      mediaSourceUrl      = _snapSourceUrl;
      mediaCollectionNsid = _snapCollectionNsid;
      mediaCollectionUri  = _snapCollectionUri;
      buildAndEmit();
    }
    editingMedia = false;
  }
  const hasMedia       = $derived(!!(mediaUrl || mediaBlobRef));
  const mediaInput = $derived(describeMediaInput(mediaUrl, mediaBlobRef?.mimeType));
  const showMediaSourceLink = $derived(mediaInput.showSourceLink);
  const mediaUrlMultiline = $derived(mediaInput.preferMultiline);

  const mediaUrlValid = $derived.by(() => {
    return mediaInput.isValid;
  });
  const isAudioMedia = $derived(
    ['audio', 'soundcloud', 'spotify'].includes(mediaInput.resolved.kind)
  );

  function mediaSourceLabel(): string {
    if (mediaSourceUrl) {
      try { return new URL(mediaSourceUrl).hostname.replace(/^www\./, ''); } catch { /* fall through */ }
    }
    if (mediaBlobRef) return `PDS · ${mediaBlobRef.mimeType.split('/')[0]}`;
    return mediaInput.sourceLabel;
  }
  let bgColor    = $state(ev.background?.color ?? '');
  const bgColorValid = $derived(!bgColor.trim() || CSS.supports('color', bgColor.trim()));

  let bgBlobRef         = $state<ATProtoBlobRef | undefined>(ev.background?.blobRef);
  let bgImageUrl        = $state(ev.background?.blobRef ? localOrPdsBlobUrl(extractCid(ev.background.blobRef.ref)) : (ev.background?.url ?? ''));
  let bgImageIsUploaded = $state(!!ev.background?.blobRef);
  let bgUploadStatus    = $state<'idle' | 'uploading' | 'error'>('idle');
  let bgUploadError     = $state('');
  let bgResolvedPreviewUrl = $state<string | null>(null);
  let bgImageValidationState = $state<'idle' | 'loading' | 'valid' | 'invalid'>('idle');
  let bgValidationToken = 0;
  const bgImageValid    = $derived(
    !bgImageUrl.trim() ||
    bgImageIsUploaded ||
    bgImageValidationState === 'valid'
  );

  // Background is exclusively color OR image
  let bgMode = $state<'none' | 'color' | 'image'>(
    ev.background?.url ? 'image' : ev.background?.color ? 'color' : 'none'
  );

  function setBgMode(mode: 'none' | 'color' | 'image') {
    bgMode = mode;
    if (mode === 'none') { bgColor = ''; bgImageUrl = ''; bgImageIsUploaded = false; bgBlobRef = undefined; }
    if (mode === 'color') { bgImageUrl = ''; bgImageIsUploaded = false; bgBlobRef = undefined; }
    if (mode === 'image') { bgColor = ''; }
    buildAndEmit();
  }

  $effect(() => {
    const url = bgImageUrl.trim();
    const token = ++bgValidationToken;

    if (!url) {
      bgResolvedPreviewUrl = null;
      bgImageValidationState = 'idle';
      return;
    }

    if (bgImageIsUploaded) {
      bgResolvedPreviewUrl = url;
      bgImageValidationState = 'valid';
      return;
    }

    if (!canResolveBackgroundImage({ url })) {
      bgResolvedPreviewUrl = null;
      bgImageValidationState = 'invalid';
      return;
    }

    bgResolvedPreviewUrl = null;
    bgImageValidationState = 'loading';

    void resolveBackgroundImageUrl({ url }).then((src) => {
      if (token !== bgValidationToken) return;
      if (bgImageIsUploaded || bgImageUrl.trim() !== url) return;
      bgResolvedPreviewUrl = src;
      bgImageValidationState = src ? 'valid' : 'invalid';
    });
  });
  let group      = $state(ev.group ?? '');

  function date(year: number|'', month: number|'', day: number|'', hour: number|'', minute: number|'', second: number|''): TLDateInput | undefined {
    if (year === '') return undefined;
    return {
      year: Number(year),
      ...(month  !== '' ? { month:  Number(month)  } : {}),
      ...(day    !== '' ? { day:    Number(day)    } : {}),
      ...(hour   !== '' ? { hour:   Number(hour)   } : {}),
      ...(minute !== '' ? { minute: Number(minute) } : {}),
      ...(second !== '' ? { second: Number(second) } : {}),
    };
  }

  // Slide ID doubles as the identity key the parent uses to find this event in its
  // array, so unlike other fields it can't commit on every keystroke — renaming it
  // live would make the parent re-key and remount this editor mid-type, dropping
  // focus out of whichever field the user is in. It commits on blur instead (see
  // commitSlideId), same as it would need a dedicated "confirm" gesture anywhere else.
  function buildAndEmit(idOverride?: string) {
    const startDate = isTitle ? undefined : date(startYear, startMonth, startDay, startHour, startMinute, startSecond);
    const endDate   = (!isTitle && hasEndDate) ? date(endYear, endMonth, endDay, endHour, endMinute, endSecond) : undefined;

    const updated: TLEvent = {
      unique_id: idOverride ?? event.unique_id,
      ...(startDate ? { start_date: startDate } : {}),
      ...(endDate   ? { end_date: endDate }     : {}),
      ...(headline || body
        ? { text: { ...(headline ? { headline } : {}), ...(body ? { text: body } : {}) } }
        : {}),
      ...(mediaUrl || mediaBlobRef
        ? { media: {
              ...(mediaUrl     ? { url:     mediaUrl     } : {}),
              ...(mediaBlobRef ? { blobRef: mediaBlobRef, mimeType: mediaBlobRef.mimeType } : {}),
              ...(mediaCaption ? { caption: mediaCaption } : {}),
              ...(mediaCredit  ? { credit:  mediaCredit  } : {}),
              ...(mediaAlt     ? { alt:     mediaAlt     } : {}),
            } }
        : {}),
      ...(bgColor || bgImageUrl
        ? { background: { ...(bgColor ? { color: bgColor } : {}), ...(bgImageUrl ? { url: bgImageUrl } : {}), ...(bgBlobRef ? { blobRef: bgBlobRef } : {}) } }
        : {}),
      ...(!isTitle && group ? { group } : {}),
      ...(mediaOnRight ? { media_position: 'right' as const } : {}),
    };

    onchange(updated);
  }

  async function processFile(file: File) {
    uploadStatus = 'uploading';
    uploadError = '';
    try {
      const ref = await uploadBlob(file);
      mediaBlobRef = ref;
      // Use a local object URL for preview — getBlob won't serve the blob until it's
      // committed to a record. stripBlobUrls removes this URL before saving, and the
      // component re-derives mediaUrl from blobRef on next load (line 99).
      localBlobPreviewUrl = URL.createObjectURL(file);
      cacheLocalBlobUrl(extractCid(ref.ref), localBlobPreviewUrl);
      mediaUrl = localBlobPreviewUrl;
      buildAndEmit();
      uploadStatus = 'idle';
      editingMedia = false;
    } catch (err) {
      uploadStatus = 'error';
      uploadError = String(err);
    }
  }

  async function handleFileInput(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await processFile(file);
    input.value = '';
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) void processFile(file);
  }

  function confirmUrl() {
    if (mediaUrl.trim() && mediaUrlValid) {
      mediaBlobRef = undefined;
      buildAndEmit();
      editingMedia = false;
    }
  }

  async function handleBgFileUpload(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    bgUploadStatus = 'uploading';
    bgUploadError = '';
    try {
      const ref = await uploadBlob(file);
      bgBlobRef = ref;
      bgImageUrl = URL.createObjectURL(file);
      cacheLocalBlobUrl(extractCid(ref.ref), bgImageUrl);
      bgImageIsUploaded = true;
      buildAndEmit();
      bgUploadStatus = 'idle';
    } catch (err) {
      bgUploadStatus = 'error';
      bgUploadError = String(err);
    }
    input.value = '';
  }

  function clearMedia() {
    mediaUrl            = '';
    mediaBlobRef        = undefined;
    mediaSourceUrl      = undefined;
    mediaCollectionNsid = undefined;
    mediaCollectionUri  = undefined;
    editingMedia        = false;
    buildAndEmit();
  }

  function handleBrowseSelect(item: import('../lib/atproto.svelte.ts').CollectionMediaItem) {
    mediaBlobRef        = item.media.blobRef;
    mediaUrl            = item.media.blobRef ? blobUrl(extractCid(item.media.blobRef.ref)) : (item.media.url ?? '');
    mediaSourceUrl      = item.webUrl;
    mediaCollectionNsid = item.nsid;
    mediaCollectionUri  = item.uri;
    if (item.media.alt && !mediaAlt)    mediaAlt     = item.media.alt;
    if (item.prefill?.caption)          mediaCaption = item.prefill.caption;
    if (item.prefill?.credit)           mediaCredit  = item.prefill.credit;
    buildAndEmit();
    editingMedia = false;
  }

  // ── Field editing state ──────────────────────────────────────────────────────
  let editingDate     = $state(false);
  let editingHeadline = $state(false);
  let editingBody     = $state(false);
  let mediaOnRight    = $state(ev.media_position === 'right');
  let slideId         = $state(ev.unique_id ?? '');
  const slideIdValid  = $derived(!slideId.trim() || /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(slideId.trim()));

  function commitSlideId() {
    const customId = slideId.trim();
    if (customId && slideIdValid && customId !== event.unique_id) buildAndEmit(customId);
  }

  function handleSlideIdKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  }
  let deletePending   = $state(false);
  let startDatePicker = $state<{ commit: () => void } | null>(null);
  let endDatePicker = $state<{ commit: () => void } | null>(null);
  let pointerDownInsideOpenEditor = false;
  let pointerDownInsideOpenEditorReset: ReturnType<typeof setTimeout> | null = null;
  let filePickerActive = false;

  function handleFileLabelClick() {
    filePickerActive = true;
    window.addEventListener('focus', () => { filePickerActive = false; }, { once: true });
  }

  let _snapHeadline = '';
  let _snapBody = '';
  let _snapDate: {
    startYear: number | '';
    startMonth: number | '';
    startDay: number | '';
    startHour: number | '';
    startMinute: number | '';
    startSecond: number | '';
    hasEndDate: boolean;
    endYear: number | '';
    endMonth: number | '';
    endDay: number | '';
    endHour: number | '';
    endMinute: number | '';
    endSecond: number | '';
  } | null = null;

  function startHeadlineEdit() {
    _snapHeadline = headline;
    editingHeadline = true;
  }

  function cancelHeadlineEdit() {
    headline = _snapHeadline;
    buildAndEmit();
    editingHeadline = false;
  }

  function clearHeadline() {
    headline = '';
    buildAndEmit();
    editingHeadline = false;
  }

  function startBodyEdit() {
    _snapBody = body;
    editingBody = true;
  }

  function cancelBodyEdit() {
    body = _snapBody;
    buildAndEmit();
    editingBody = false;
  }

  function clearBody() {
    body = '';
    buildAndEmit();
    editingBody = false;
  }

  function startDateEdit() {
    syncDateDraftsFromCommitted();
    _snapDate = {
      startYear, startMonth, startDay, startHour, startMinute, startSecond,
      hasEndDate,
      endYear, endMonth, endDay, endHour, endMinute, endSecond,
    };
    editingDate = true;
  }

  function cancelDateEdit() {
    if (_snapDate) {
      startYear = _snapDate.startYear;
      startMonth = _snapDate.startMonth;
      startDay = _snapDate.startDay;
      startHour = _snapDate.startHour;
      startMinute = _snapDate.startMinute;
      startSecond = _snapDate.startSecond;
      hasEndDate = _snapDate.hasEndDate;
      endYear = _snapDate.endYear;
      endMonth = _snapDate.endMonth;
      endDay = _snapDate.endDay;
      endHour = _snapDate.endHour;
      endMinute = _snapDate.endMinute;
      endSecond = _snapDate.endSecond;
      buildAndEmit();
    }
    editingDate = false;
  }

  function clearDate() {
    startYear = '';
    startMonth = '';
    startDay = '';
    startHour = '';
    startMinute = '';
    startSecond = '';
    hasEndDate = false;
    endYear = '';
    endMonth = '';
    endDay = '';
    endHour = '';
    endMinute = '';
    endSecond = '';
    buildAndEmit();
    editingDate = false;
  }

  function syncDateDraftsFromCommitted() {
    startDateDraft = {
      year: startYear,
      month: startMonth,
      day: startDay,
      hour: startHour,
      minute: startMinute,
      second: startSecond,
    };
    endDateDraft = {
      year: endYear,
      month: endMonth,
      day: endDay,
      hour: endHour,
      minute: endMinute,
      second: endSecond,
    };
  }

  function focusLeftEditor(event: FocusEvent): boolean {
    if (pointerDownInsideOpenEditor || filePickerActive) return false;
    const current = event.currentTarget as HTMLElement | null;
    const next = event.relatedTarget as Node | null;
    return !!current && (!next || !current.contains(next));
  }

  function markPointerDownInsideOpenEditor() {
    pointerDownInsideOpenEditor = true;
    if (pointerDownInsideOpenEditorReset !== null) {
      clearTimeout(pointerDownInsideOpenEditorReset);
    }
    pointerDownInsideOpenEditorReset = setTimeout(() => {
      pointerDownInsideOpenEditor = false;
      pointerDownInsideOpenEditorReset = null;
    }, 0);
  }

  function handleMediaEditorFocusOut(event: FocusEvent) {
    if (!focusLeftEditor(event)) return;
    if (mediaMode === 'url') {
      if (mediaUrl.trim() && mediaUrlValid) {
        confirmUrl();
        return;
      }
      if (!mediaUrl.trim() && !mediaBlobRef) {
        editingMedia = false;
      }
      return;
    }
    editingMedia = false;
  }

  function handleDateEditorFocusOut(event: FocusEvent) {
    if (!focusLeftEditor(event)) return;
    confirmDateEdit();
  }

  function handleHeadlineEditorFocusOut(event: FocusEvent) {
    if (!focusLeftEditor(event)) return;
    editingHeadline = false;
  }

  function handleBodyEditorFocusOut(event: FocusEvent) {
    if (!focusLeftEditor(event)) return;
    editingBody = false;
  }

  function confirmDateEdit(): boolean {
    startDatePicker?.commit();
    endDatePicker?.commit();
    if (!endDateOrderValid) return false;
    syncDateDraftsFromCommitted();
    editingDate = false;
    return true;
  }

  // Only one content field editor open at a time
  function openField(f: 'date' | 'headline' | 'body' | 'media') {
    deletePending = false;
    if (editingDate && f !== 'date' && !confirmDateEdit()) return;
    editingDate     = false;
    editingHeadline = false;
    editingBody     = false;
    if (f === 'media') startEditing();
    else {
      editingMedia = false;
      if (f === 'date') startDateEdit();
      if (f === 'headline') startHeadlineEdit();
      if (f === 'body') startBodyEdit();
    }
  }

  const helpPanel = $derived.by(() => {
    if (editingMedia) {
      return {
        title: 'Media',
        lines: [
          'Use Upload for files you want stored on your PDS. Use URL / Embed for web-hosted media and supported embeds.',
          'Caption and credit display with the media. Alt text is only for accessibility, so write what a screen reader user needs.',
          'The preview card stays compact until you open it, so finished events remain easier to scan in the editor.',
        ],
      };
    }
    if (editingDate) {
      return {
        title: 'Date',
        lines: [
          'Every event needs a start date to appear on the timeline.',
          'Add an end date only when the event should occupy a span rather than a single moment.',
          'If precision is not important, leaving month, day, or time blank keeps the date appropriately broad.',
        ],
      };
    }
    if (editingHeadline) {
      return {
        title: 'Headline',
        lines: [
          'The headline appears in the slide and is the main label people use to orient themselves.',
          'Keep it short and specific. It can include basic inline HTML formatting when needed.',
          'If you leave it blank, the event can still rely on media or body text, but the navigation becomes less scannable.',
        ],
      };
    }
    if (editingBody) {
      return {
        title: 'Body',
        lines: [
          'Body text is where context, explanation, and citation-style details belong.',
          'Use headings and lists sparingly. A short, readable block usually works better than dense prose in this layout.',
          'The rich text editor supports links and basic formatting, and the raw HTML view remains available when you need tighter control.',
        ],
      };
    }
    if (!headline && !body && !hasMedia) {
      return {
        title: 'Start Here',
        lines: [
          'A slide can have media, text, or both. Start with whichever element carries the most meaning for this event.',
          'Dates anchor the event in time; headline and body help readers understand why it matters.',
          'The options section covers background, grouping, and media placement once the main content is in place.',
        ],
      };
    }
    return {
      title: 'Editor',
      lines: [
        'The left side holds the main slide content: media, date, headline, and body.',
        'Use Slide Options for layout and background choices after the core event content is in place.',
      ],
    };
  });
</script>

<div class="editor">
<div class="editor-body">
  <div class="editor-layout">
  <div class="editor-main">
  <!-- ── Slide canvas — always two-column ────────────────────────── -->
  <div class="slide-canvas" class:slide-canvas--media-right={mediaOnRight}>

    <!-- Left column: media (editor | thumbnail | empty slot) -->
    <div class="slide-media-col">
      {#if editingMedia}
        <!-- Media editor in-place -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="media-editor-inline" onpointerdown={markPointerDownInsideOpenEditor} onfocusout={handleMediaEditorFocusOut}>
          <div class="media-input-card">
            <div class="media-tabs" role="tablist">
              <button type="button" role="tab" class="media-tab" class:active={mediaMode === 'upload'}
                aria-selected={mediaMode === 'upload'} onclick={() => (mediaMode = 'upload')}>Upload</button>
              <button type="button" role="tab" class="media-tab" class:active={mediaMode === 'url'}
                aria-selected={mediaMode === 'url'} onclick={() => (mediaMode = 'url')}>URL / Embed</button>
              <button type="button" role="tab" class="media-tab" class:active={mediaMode === 'browse'}
                aria-selected={mediaMode === 'browse'} onclick={() => (mediaMode = 'browse')}>Atmosphere</button>
              <div class="media-input-actions" role="none">
                <button type="button" class="icon-btn icon-btn--done"
                  aria-label="Done"
                  disabled={mediaMode === 'browse' || (mediaMode === 'url' ? (!mediaUrl.trim() || !mediaUrlValid) : !hasMedia)}
                  onclick={mediaMode === 'url' ? confirmUrl : () => (editingMedia = false)}>✓</button>
                {#if _canRestoreSnap}
                  <button type="button" class="icon-btn"
                    aria-label="Cancel" onclick={cancelEdit}>✕</button>
                  <button type="button" class="icon-btn icon-btn--remove"
                    aria-label="Remove media" onclick={clearMedia}>🗑</button>
                {/if}
              </div>
            </div>

            {#if mediaMode === 'browse'}
              <div class="media-browse-panel">
                <RepoBrowser
                  availableCollections={availableCollections}
                  onselect={handleBrowseSelect}
                  initialNsid={mediaCollectionNsid}
                  selectedUri={mediaCollectionUri}
                />
              </div>
            {:else}
            <div class="media-panel">
              {#if mediaMode === 'upload'}
                {#if authState.status === 'signed-in'}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                  <label class="media-dropzone" class:drag-over={isDragOver} class:uploading={uploadStatus === 'uploading'}
                    onclick={handleFileLabelClick}
                    ondragover={(e) => { e.preventDefault(); isDragOver = true; }}
                    ondragleave={() => (isDragOver = false)}
                    ondrop={handleDrop}>
                    {#if uploadStatus === 'uploading'}
                      <span class="dropzone-spinner">Uploading…</span>
                    {:else}
                      <span class="dropzone-icon" aria-hidden="true">⬆</span>
                      <span class="dropzone-primary">Drop a file here</span>
                      <span class="dropzone-secondary">or <span class="dropzone-browse">browse</span></span>
                      <span class="dropzone-types">Image · Audio · Video</span>
                    {/if}
                    <input type="file" accept="image/*,audio/*,video/*"
                      onchange={handleFileInput} disabled={uploadStatus === 'uploading'} class="visually-hidden" />
                  </label>
                  {#if uploadStatus === 'error'}
                    <p class="media-error">{uploadError}</p>
                  {:else}
                    <p class="media-panel-hint">Stored on your personal data server (PDS).</p>
                  {/if}
                {:else}
                  <div class="media-signin-notice">
                    <p>Sign in to upload media and save your timeline.</p>
                    <a href="#" class="learn-more-link" onclick={(e) => { e.preventDefault(); modal = 'sign-in'; }}>Learn more</a>
                  </div>
                {/if}
              {:else}
                <div class="media-url-wrap">
                  {#if mediaUrlMultiline}
                    <textarea
                      class="media-url-input media-url-input--multiline"
                      placeholder="Paste embed markup…"
                      class:media-url-input--error={!mediaUrlValid}
                      bind:value={mediaUrl}
                      rows="6"
                      oninput={() => { mediaBlobRef = undefined; }}
                    ></textarea>
                  {:else}
                    <input class="media-url-input" type="url" placeholder="Paste a URL…"
                      class:media-url-input--error={!mediaUrlValid}
                      bind:value={mediaUrl}
                      oninput={() => { mediaBlobRef = undefined; }}
                      onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmUrl(); } }} />
                  {/if}
                </div>
                {#if !mediaUrlValid}
                  <p class="media-url-error" role="alert">That doesn't look like a URL — try starting with https://</p>
                {/if}
                <p class="media-panel-hint">
                  Embed YouTube, SoundCloud, Wikipedia, and more.
                  <a href="#" class="learn-more-link" onclick={(e) => { e.preventDefault(); modal = 'media-types'; }}>Learn more</a>
                </p>
              {/if}
            </div>
            {/if}
          </div>
          {#if hasMedia}
            <div class="media-meta-inline">
              <div class="media-meta-preview">
                <MediaPreview url={mediaUrl} mimeType={mediaBlobRef?.mimeType} />
              </div>
              <div class="field">
                <label class="field-label" for="caption-rte">Caption</label>
                <RichTextEditor id="caption-rte" value={mediaCaption} onchange={(v) => { mediaCaption = v; buildAndEmit(); }} minimal rows={2} />
              </div>
              <div class="field">
                <label class="field-label" for="credit-rte">Credit</label>
                <RichTextEditor id="credit-rte" value={mediaCredit} onchange={(v) => { mediaCredit = v; buildAndEmit(); }} minimal rows={2} />
              </div>
              <div class="field">
                <label class="field-label" for="media-alt">Alt text</label>
                <textarea id="media-alt" bind:value={mediaAlt} oninput={() => buildAndEmit()} rows="3"></textarea>
                <p class="field-hint">Describes the media for screen readers.</p>
              </div>
            </div>
          {/if}
        </div>

      {:else if hasMedia}
        <!-- Media thumbnail -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="media-thumb-wrap" onclick={() => openField('media')}
          role="button" tabindex="0" aria-label="Edit media"
          onkeydown={(e) => e.key === 'Enter' && openField('media')}>
          <div class="media-thumb-visual" class:media-thumb-visual--audio={isAudioMedia}>
            <MediaPreview url={mediaUrl} mimeType={mediaBlobRef?.mimeType} />
            <div class="media-thumb-overlay">
              <span class="media-thumb-edit-icon" aria-hidden="true">✎</span>
              {#if mediaSourceUrl || (mediaUrl && showMediaSourceLink)}
                <a class="media-source-link" href={mediaSourceUrl ?? mediaUrl} target="_blank" rel="noopener noreferrer"
                  onclick={(e) => e.stopPropagation()}>{mediaSourceLabel()} ↗</a>
              {/if}
            </div>
          </div>
          <div class="media-thumb-meta">
            {#if mediaCaption || mediaCredit}
              <div class="slide-media-caption">
                {#if mediaCaption}<span class="slide-caption-text">{@html mediaCaption}</span>{/if}
                {#if mediaCredit}<cite class="slide-credit-text">{@html mediaCredit}</cite>{/if}
              </div>
            {/if}
            <p class="media-alt-summary" class:media-alt-summary--empty={!mediaAlt.trim()}>
              {#if mediaAlt.trim()}
                Alt text: {mediaAlt}
              {:else}
                No alt text
              {/if}
            </p>
          </div>
        </div>

      {:else}
        <!-- Empty media slot -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="media-thumb-wrap media-thumb-wrap--empty" onclick={() => openField('media')}
          role="button" tabindex="0" aria-label="Add media"
          onkeydown={(e) => e.key === 'Enter' && openField('media')}>
          <div class="media-thumb-visual media-thumb-visual--empty">
            <div class="media-empty-preview">
              <span class="media-empty-icon" aria-hidden="true">◈</span>
              <span class="media-empty-label">Add media</span>
            </div>
            <div class="media-thumb-overlay">
              <span class="media-thumb-edit-icon" aria-hidden="true">✎</span>
            </div>
          </div>
        </div>
      {/if}
    </div><!-- slide-media-col -->

    <!-- Right column: text content -->
    <div class="slide-content-col">

      <!-- Date(s) — events only -->
      {#if !isTitle}
        {#if editingDate}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="field-panel" onpointerdown={markPointerDownInsideOpenEditor} onfocusout={handleDateEditorFocusOut}>
            <div class="field-panel-actions">
              <button type="button" class="icon-btn icon-btn--done"
                aria-label="Done" disabled={!endDateOrderValid} onclick={confirmDateEdit}>✓</button>
              <button type="button" class="icon-btn"
                aria-label="Cancel" onclick={cancelDateEdit}>✕</button>
              <button type="button" class="icon-btn icon-btn--remove"
                aria-label="Delete date" onclick={clearDate}>🗑</button>
            </div>
            <div class="field-panel-body field-panel-body--date">
              <div class="slide-date-row">
                <div class="end-date-toggle">
                  <input
                    id={endDateToggleId}
                    type="checkbox"
                    bind:checked={hasEndDate}
                    onchange={() => buildAndEmit()}
                  />
                  <label for={endDateToggleId}>
                    {hasEndDate ? 'Remove end date' : '+ End date'}
                  </label>
                </div>
                <div class="slide-date-pickers">
                  <div>
                    <DatePicker
                      bind:this={startDatePicker}
                      bind:year={startYear} bind:month={startMonth} bind:day={startDay}
                      bind:hour={startHour} bind:minute={startMinute} bind:second={startSecond}
                      onchange={buildAndEmit}
                      onconfirm={confirmDateEdit}
                      ondraftchange={(draft) => { startDateDraft = draft; }}
                    />
                    {#if startYear === ''}
                      <p class="date-error" role="alert">Start year required.</p>
                    {/if}
                  </div>
                  {#if hasEndDate}
                    <span class="date-range-sep">–</span>
                    <DatePicker
                      bind:this={endDatePicker}
                      bind:year={endYear} bind:month={endMonth} bind:day={endDay}
                      bind:hour={endHour} bind:minute={endMinute} bind:second={endSecond}
                      onchange={buildAndEmit}
                      onconfirm={confirmDateEdit}
                      ondraftchange={(draft) => { endDateDraft = draft; }}
                    />
                  {/if}
                </div>
                {#if hasEndDate && !endDateOrderValid}
                  <p class="date-error" role="alert">End date must be after start date.</p>
                {/if}
              </div>
            </div>
          </div>
        {:else}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="slide-field slide-date-display"
            onclick={() => openField('date')}
            onkeydown={(e) => e.key === 'Enter' && openField('date')}
            role="button" tabindex="0" aria-label="Edit date">
            <span class="slide-field-edit-icon" aria-hidden="true">✎</span>
            {#if formattedDateRange}
              <p class="slide-date-summary">{formattedDateRange}</p>
            {:else}
              <p class="set-prompt" role="presentation">Set date</p>
            {/if}
          </div>
        {/if}
      {/if}

      <!-- Headline -->
      {#if editingHeadline}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="field-panel" onpointerdown={markPointerDownInsideOpenEditor} onfocusout={handleHeadlineEditorFocusOut}>
          <div class="field-panel-actions">
            <button type="button" class="icon-btn icon-btn--done"
              aria-label="Done" onclick={() => (editingHeadline = false)}>✓</button>
            <button type="button" class="icon-btn"
              aria-label="Cancel" onclick={cancelHeadlineEdit}>✕</button>
            <button type="button" class="icon-btn icon-btn--remove"
              aria-label="Delete headline" onclick={clearHeadline}>🗑</button>
          </div>
          <div class="field-panel-body field-panel-body--headline">
            <RichTextEditor
              id="headline-rte"
              value={headline}
              onchange={(v) => { headline = v; buildAndEmit(); }}
              inlineOnly
              noLink
              singleLine
              rows={1}
              autofocus
              onconfirm={() => (editingHeadline = false)}
            />
          </div>
        </div>
      {:else}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="slide-field slide-headline-display"
          onclick={() => openField('headline')}
          onkeydown={(e) => e.key === 'Enter' && openField('headline')}
          role="button" tabindex="0" aria-label="Edit headline">
          <span class="slide-field-edit-icon" aria-hidden="true">✎</span>
          {#if headline}
            <h2 class="slide-h">{@html headline}</h2>
          {:else}
            <p class="set-prompt" role="presentation">Set headline</p>
          {/if}
        </div>
      {/if}

      <!-- Body -->
      {#if editingBody}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="field-panel" onpointerdown={markPointerDownInsideOpenEditor} onfocusout={handleBodyEditorFocusOut}>
          <div class="field-panel-actions">
            <button type="button" class="icon-btn icon-btn--done"
              aria-label="Done" onclick={() => (editingBody = false)}>✓</button>
            <button type="button" class="icon-btn"
              aria-label="Cancel" onclick={cancelBodyEdit}>✕</button>
            <button type="button" class="icon-btn icon-btn--remove"
              aria-label="Delete body text" onclick={clearBody}>🗑</button>
          </div>
          <div class="field-panel-body field-panel-body--richtext">
            <RichTextEditor id="body-rte" value={body} onchange={(v) => { body = v; buildAndEmit(); }} rows={5} autofocus />
          </div>
        </div>
      {:else}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="slide-field slide-body-display"
          onclick={() => openField('body')}
          onkeydown={(e) => e.key === 'Enter' && openField('body')}
          role="button" tabindex="0" aria-label="Edit body text">
          <span class="slide-field-edit-icon" aria-hidden="true">✎</span>
          {#if body}
            <div class="slide-body-text">{@html body}</div>
          {:else}
            <p class="set-prompt" role="presentation">Set body text</p>
          {/if}
        </div>
      {/if}

    </div><!-- slide-content-col -->

  </div><!-- slide-canvas -->

  <!-- ── Slide options ─────────────────────────────────────────── -->
  <div class="slide-options">
    <h3 class="slide-options-label">Slide options</h3>
    <div class="slide-options-body">

      <!-- Background: exclusively color OR image -->
      <fieldset class="field field-group">
        <legend class="field-label">Background</legend>
        <div class="bg-mode-tabs">
          <button type="button" class="bg-mode-btn" class:active={bgMode === 'none'} onclick={() => setBgMode('none')}>None</button>
          <button type="button" class="bg-mode-btn" class:active={bgMode === 'color'} onclick={() => setBgMode('color')}>Color</button>
          <button type="button" class="bg-mode-btn" class:active={bgMode === 'image'} onclick={() => setBgMode('image')}>Image</button>
        </div>
        {#if bgMode === 'color'}
          <div class="color-row" style="margin-top:0.4rem">
            <ColorPicker value={bgColor} onchange={(v) => { bgColor = v; buildAndEmit(); }} />
            <input id="bg-color-text" type="text" class="color-text"
              class:color-text--error={!bgColorValid}
              bind:value={bgColor} oninput={() => buildAndEmit()} />
            {#if bgColor}
              <button class="clear-btn" onclick={() => { bgColor = ''; buildAndEmit(); }} aria-label="Clear color">✕</button>
            {/if}
          </div>
          {#if !bgColorValid}
            <p class="field-error" role="alert">Not a valid CSS color.</p>
          {:else}
            <p class="field-hint">Any valid CSS color — hex, named, rgb(), hsl(), etc.</p>
          {/if}
        {:else if bgMode === 'image'}
          {#if bgImageUrl && bgImageValid && bgResolvedPreviewUrl}
            <div class="bg-image-preview" style="margin-top:0.4rem">
              <img src={bgResolvedPreviewUrl} alt="Background preview" class="bg-image-thumb" />
              <button type="button" class="bg-image-remove clear-btn"
                onclick={() => { bgImageUrl = ''; bgImageIsUploaded = false; bgBlobRef = undefined; buildAndEmit(); }}>✕ Remove</button>
            </div>
          {:else}
            <div class="bg-image-input" style="margin-top:0.4rem">
              {#if authState.status === 'signed-in'}
                <label class="upload-btn-compact" class:uploading={bgUploadStatus === 'uploading'}>
                  {bgUploadStatus === 'uploading' ? 'Uploading…' : 'Upload'}
                  <input type="file" accept="image/*" onchange={handleBgFileUpload}
                    disabled={bgUploadStatus === 'uploading'} class="visually-hidden" />
                </label>
              {/if}
              <input type="url" class:field-url-error={bgImageUrl.trim() && bgImageValidationState === 'invalid'}
                bind:value={bgImageUrl} oninput={() => { bgImageIsUploaded = false; bgBlobRef = undefined; buildAndEmit(); }}
                placeholder="Paste an image URL…" />
            </div>
            {#if bgUploadStatus === 'error'}
              <p class="field-error">{bgUploadError}</p>
            {:else if bgImageValidationState === 'loading'}
              <p class="field-hint">Checking image URL…</p>
            {:else if bgImageUrl.trim() && bgImageValidationState === 'invalid'}
              <p class="field-error">URL doesn't resolve to an image.</p>
            {/if}
          {/if}
        {/if}
      </fieldset>

      <!-- Media layout -->
      <fieldset class="field field-group">
        <legend class="field-label">Media position</legend>
        <div class="bg-mode-tabs">
          <button type="button" class="bg-mode-btn" class:active={!mediaOnRight} onclick={() => { mediaOnRight = false; buildAndEmit(); }}>Left</button>
          <button type="button" class="bg-mode-btn" class:active={mediaOnRight} onclick={() => { mediaOnRight = true; buildAndEmit(); }}>Right</button>
        </div>
        <p class="field-hint">Which side the media column appears on.</p>
      </fieldset>

      {#if !isTitle}
        <div class="field">
          <label class="field-label" for="group">Group</label>
          <input id="group" type="text" bind:value={group} oninput={() => buildAndEmit()} />
          <p class="field-hint">Groups events together in the timeline navigation bar.</p>
        </div>
      {/if}

      <div class="field">
        <label class="field-label" for="slide-id">Slide ID</label>
        <input id="slide-id" type="text" bind:value={slideId} onblur={commitSlideId} onkeydown={handleSlideIdKeydown}
          class:field-id-error={slideId.trim() && !slideIdValid}
          placeholder={event.unique_id ?? ''} />
        {#if slideId.trim() && !slideIdValid}
          <p class="field-error" role="alert">Must start with a letter; only letters, digits, hyphens, and underscores allowed.</p>
        {/if}
        <p class="field-hint">Used for direct links to this slide and for CSS customization. Auto-generated if blank.</p>

      </div>

    </div>
  </div>
  {#if !isTitle}
    <div class="editor-delete-row">
      {#if deletePending}
        <button
          type="button"
          class="delete-slide-btn delete-slide-btn--confirm"
          onclick={ondelete}
        >Confirm delete slide</button>
        <button
          type="button"
          class="delete-slide-cancel"
          onclick={() => (deletePending = false)}
        >Cancel</button>
      {:else}
        <button
          type="button"
          class="delete-slide-btn"
          onclick={() => (deletePending = true)}
        >Delete slide</button>
      {/if}
    </div>
  {/if}
  </div><!-- editor-main -->

  <aside class="editor-help">
    <h3 class="editor-help-title">{helpPanel.title}</h3>
    {#each helpPanel.lines as line}
      <p>{line}</p>
    {/each}
  </aside>
</div><!-- editor-layout -->
</div><!-- editor-body -->
</div>

{#if modal}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-label={modal === 'media-types' ? 'Supported media types' : 'About signing in'}
    tabindex="-1"
    onkeydown={(e) => e.key === 'Escape' && (modal = null)}
    onclick={(e) => e.target === e.currentTarget && (modal = null)}
  >
    <div class="modal">
      <button class="modal-close" onclick={() => (modal = null)} aria-label="Close">✕</button>

      {#if modal === 'media-types'}
        <h2 class="modal-title">Supported media types</h2>

        <dl class="modal-list">
          <dt>Images</dt>
          <dd>Link directly to JPG, PNG, GIF, WebP, or SVG files.</dd>

          <dt>Video</dt>
          <dd>YouTube and Vimeo URLs show an embedded player. Direct links to MP4 or WebM files play inline.</dd>

          <dt>Audio</dt>
          <dd>SoundCloud track and playlist URLs embed a player. Spotify links work too. Direct MP3, WAV, or OGG file links play inline.</dd>

          <dt>Wikipedia</dt>
          <dd>A Wikipedia article URL shows the article's lead image and a brief summary pulled from the page.</dd>

          <dt>Wikipedia Images</dt>
          <dd>A Wikipedia URL pointing at a File: page, a “lightbox view” of an image, or a Wikimedia Commons file will be shown as if you linked the image directly.</dd>

          <dt>Maps</dt>
          <dd>Google Maps share URLs embed an interactive map at the location or route you've chosen.</dd>

          <dt>Social</dt>
          <dd>Embed BlueSky, TikTok or X content with the direct link to the post. Sorry, Instagram is not supported.</dd>

          <dt>Iframe embed codes</dt>
          <dd>Paste a raw <code>&lt;iframe&gt;</code> embed code from any site. Sorry, <code>&lt;script&gt;</code> tags not supported.</dd>
        </dl>

      {:else if modal === 'sign-in'}
        <h2 class="modal-title">Sign in to do more</h2>

        <p class="modal-intro">This tool uses AT Protocol — the open, decentralized technology behind Bluesky — so you own your content.</p>

        <dl class="modal-list">
          <dt>Save your timeline</dt>
          <dd>Signed-in users can save timelines to their AT Protocol account. Each timeline gets a permanent, shareable link (an AT URI) that works in any compatible app.</dd>

          <dt>Upload media</dt>
          <dd>Upload images, audio, and video directly. Files are stored on your Personal Data Server (PDS) — a server attached to your account that you control, not one we run.</dd>

          <dt>Your data, your server</dt>
          <dd>You can migrate to a different PDS provider or self-host at any time. Your timelines and media come with you.</dd>

          <dt>Getting an account</dt>
          <dd>Create a free account at <a href="https://bsky.app" target="_blank" rel="noopener noreferrer">bsky.app</a> (Bluesky's app) or with any AT Protocol-compatible provider.</dd>
        </dl>
      {/if}
    </div>
  </div>
{/if}

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 0;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 1.5rem;
    box-sizing: border-box;
    min-width: 0;
    width: 100%;
    container-type: inline-size;
  }

  .editor-body {
    max-width: 1080px;
    width: 100%;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .editor-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1.25rem;
    align-items: start;
  }
  .editor-main {
    min-width: 0;
  }

  /* ── Slide canvas — content area ───────────────────────────── */
  .slide-canvas {
    display: grid;
    grid-template-columns: minmax(0, 42%) minmax(0, 58%);
    gap: 1.5rem;
    align-items: start;
    font-family: system-ui, sans-serif;
  }

  @container (min-width: 940px) {
    .editor-layout {
      grid-template-columns: minmax(0, 1fr) 240px;
      gap: 1.5rem;
    }
  }

  .slide-canvas--media-right .slide-media-col { order: 2; }
  .slide-canvas--media-right .slide-content-col { order: 1; }

  .editor-help {
    display: none;
    font-size: 0.78rem;
    color: #7a7a7a;
    line-height: 1.6;
    padding-left: 0.9rem;
    border-left: 2px solid #f0f0f0;
  }
  @container (min-width: 940px) {
    .editor-help {
      display: block;
    }
  }
  .editor-help-title {
    margin: 0 0 0.55rem;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #9a9a9a;
  }
  .editor-help p {
    margin: 0 0 0.65rem;
  }
  .editor-help p:last-child {
    margin-bottom: 0;
  }

  .field-group {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }

  .editor-delete-row {
    margin-top: 1.1rem;
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }
  .delete-slide-btn,
  .delete-slide-cancel {
    background: none;
    border: none;
    padding: 0.2rem 0.5rem;
    margin: 0;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
    border-radius: 4px;
  }
  .delete-slide-btn {
    color: #b42318;
  }
  .delete-slide-btn:hover {
    text-decoration: underline;
  }
  .delete-slide-btn--confirm {
    font-weight: 600;
  }
  .delete-slide-cancel {
    color: #888;
  }
  .delete-slide-cancel:hover {
    color: #444;
    text-decoration: underline;
  }

  /* Set prompt — compact empty-state for all fields */
  .set-prompt {
    display: inline-block;
    background: none;
    border: none;
    margin: 0;
    padding: 0.2rem 0.4rem;
    font-size: 0.82rem;
    font-family: inherit;
    font-weight: normal;
    text-transform: none;
    color: #ccc;
    font-style: italic;
    cursor: pointer;
    border-radius: 3px;
    transition: color 0.1s, background 0.1s;
  }
  .set-prompt:hover { color: #999; background: #f5f5f5; }

  /* ── Media column ──────────────────────────────────────────── */
  .slide-media-col { display: flex; flex-direction: column; gap: 0.5rem; }

  .media-thumb-wrap {
    cursor: pointer;
    border-radius: 6px;
    overflow: hidden;
    display: block;
    border: 1px solid #e8e8e8;
    background: #fff;
  }
  .media-thumb-wrap--empty {
    min-height: 7.25rem;
  }
  .media-thumb-wrap:focus { outline: 2px solid #13a4df; outline-offset: 2px; }
  .media-thumb-visual {
    position: relative;
    overflow: hidden;
    border-bottom: 1px solid #ececec;
  }
  .media-thumb-visual--empty {
    border-bottom: none;
  }
  .media-thumb-visual--audio {
    padding-top: 2.5rem;
  }
  .media-empty-preview {
    min-height: 7.25rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    color: #777;
    background:
      linear-gradient(180deg, rgba(0,0,0,0.02), rgba(0,0,0,0.05)),
      #fafafa;
  }
  .media-empty-icon {
    font-size: 1.25rem;
    color: #999;
    line-height: 1;
  }
  .media-empty-label {
    font-size: 0.82rem;
  }

  .media-thumb-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 0.4rem 0.5rem;
    opacity: 1;
    transition: opacity 0.15s;
    background: linear-gradient(
      to bottom,
      rgba(0,0,0,0.35) 0%, transparent 22%,
      transparent 72%, rgba(0,0,0,0.22) 100%
    );
    pointer-events: none;
  }
  .media-thumb-visual--audio .media-thumb-overlay {
    background: linear-gradient(
      to bottom,
      rgba(0,0,0,0.28) 0%, transparent 18%,
      transparent 100%
    );
  }

  .media-source-link {
    font-size: 0.7rem;
    color: #fff;
    text-decoration: none;
    text-shadow: none;
    background-image: none;
    outline: none;
    line-height: 1.2;
    align-self: flex-start;
    padding: 0.18rem 0.45rem;
    border-radius: 6px;
    background: rgba(0,0,0,0.58);
    backdrop-filter: blur(2px);
    pointer-events: auto;
  }
  .media-source-link:hover { opacity: 0.8; }
  .media-thumb-meta {
    padding: 0.6rem 0.75rem 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .media-thumb-edit-icon {
    align-self: flex-end;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.8rem;
    height: 1.8rem;
    font-size: 0.95rem;
    color: #fff;
    border-radius: 6px;
    background: rgba(0,0,0,0.58);
    backdrop-filter: blur(2px);
    transform: scaleX(-1);
  }

  .slide-media-caption {
    font-size: 0.75rem;
    color: #555;
    line-height: 1.4;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .slide-credit-text { font-style: italic; }
  .media-alt-summary {
    margin: 0;
    font-size: 0.72rem;
    line-height: 1.35;
    color: #555;
  }
  .media-alt-summary--empty {
    color: #888;
    font-style: italic;
  }

  /* ── Content column ────────────────────────────────────────── */
  .slide-content-col {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }

  /* ── Date row ──────────────────────────────────────────────── */
  .slide-date-row { display: flex; flex-direction: column; gap: 0.25rem; }
  .slide-date-pickers { display: flex; align-items: flex-start; gap: 0.5rem; flex-wrap: wrap; }
  .date-range-sep { color: #aaa; font-size: 0.85rem; padding-top: 0.25rem; }
  .end-date-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.75rem;
    color: #888;
    cursor: pointer;
    user-select: none;
  }
  .end-date-toggle input { margin: 0; cursor: pointer; }
  .end-date-toggle:hover { color: #444; }

  .date-error {
    margin: 0;
    font-size: 0.78rem;
    color: #c0392b;
    background: #fdf0ee;
    border: 1px solid #f5c0b8;
    border-radius: 4px;
    padding: 0.25rem 0.5rem;
  }

  /* ── Slide fields (headline, body) ─────────────────────────── */
  .slide-field {
    position: relative;
    cursor: pointer;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 0.45rem 2.4rem 0.45rem 0.4rem;
    transition: border-color 0.12s, background 0.12s;
    min-height: 1.8rem;
  }
  .slide-field:hover { border-color: #d4d4d4; background: #fafafa; }
  .slide-field:focus { outline: 2px solid #13a4df; outline-offset: 1px; }
  .slide-field-edit-icon {
    position: absolute;
    top: 0.35rem;
    right: 0.35rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    font-size: 0.9rem;
    color: #666;
    border-radius: 6px;
    background: #f2f2f2;
    transform: scaleX(-1);
  }
  .slide-date-summary {
    margin: 0;
    font-size: 0.82rem;
    color: #666;
  }

  .slide-h {
    font-size: 1.65rem;
    font-weight: 700;
    color: #1d1f21;
    margin: 0;
    line-height: 1.2;
  }

  .slide-body-text {
    font-size: 0.9rem;
    line-height: 1.65;
    color: #333;
  }
  .slide-body-text :global(p) { margin: 0 0 0.4em; }
  .slide-body-text :global(p:last-child) { margin-bottom: 0; }
  .slide-body-text :global(h2) { font-size: 1.05rem; font-weight: 700; margin: 0.5em 0 0.25em; }
  .slide-body-text :global(h3) { font-size: 0.95rem; font-weight: 700; margin: 0.5em 0 0.2em; }
  .slide-body-text :global(ul), .slide-body-text :global(ol) { margin: 0 0 0.4em; padding-left: 1.4em; }
  .slide-body-text :global(a) { color: #13a4df; }


  /* ── Field editing panels ──────────────────────────────────── */
  .field-panel {
    position: relative;
    border: 1px solid #13a4df;
    border-radius: 6px;
    overflow: hidden;
    background: #fff;
    box-shadow: 0 0 0 3px rgba(19,164,223,0.1);
  }
  .field-panel-actions {
    position: absolute;
    top: 0.4rem;
    right: 0.45rem;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .field-panel-body {
    padding-top: 0.35rem;
  }
  .field-panel-body--headline {
    padding-top: 2.4rem;
  }
  .field-panel-body--date {
    padding: 2.4rem 0.4rem 0.2rem;
  }
  .field-panel-body--richtext {
    padding-top: 2.4rem;
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.8rem;
    height: 1.8rem;
    padding: 0;
    border: 1px solid rgba(29,31,33,0.18);
    border-radius: 6px;
    background: rgba(255,255,255,0.94);
    color: #555;
    font-size: 0.9rem;
    line-height: 1;
    cursor: pointer;
    margin-bottom: 0;
    backdrop-filter: blur(2px);
  }
  .icon-btn:hover:not(:disabled) { border-color: rgba(29,31,33,0.3); background: #fff; color: #111; }
  .icon-btn:disabled { opacity: 0.35; cursor: default; }
  .icon-btn--done { color: #0f766e; }
  .icon-btn--remove { color: #b91c1c; }

  /* ── Media editor inline (inside left column) ─────────────── */
  .media-editor-inline {
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    overflow: hidden;
  }
  .media-meta-inline {
    padding: 0.75rem;
    border-top: 1px solid #f0f0f0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    background: #fafafa;
  }
  .media-meta-preview {
    align-self: center;
    max-width: 11rem;
  }
  .media-meta-preview :global(.preview-img) {
    max-height: 130px;
  }
  .media-meta-preview :global(.preview-card),
  .media-meta-preview :global(.preview-label--fallback) {
    min-height: 0;
  }

  /* ── Media input card ──────────────────────────────────────── */
  .media-input-card {
    overflow: hidden;
  }
  .media-tabs {
    display: flex;
    align-items: center;
    border-bottom: 1px solid #e0e0e0;
    background: #f7f7f7;
  }
  .media-input-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.5rem;
    flex-shrink: 0;
  }
  .media-tab {
    padding: 0.28rem 0.6rem;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    font-size: 0.72rem;
    font-family: inherit;
    font-weight: 500;
    text-transform: none;
    color: #888;
    cursor: pointer;
    margin-bottom: 0;
    transition: color 0.1s, border-color 0.1s;
    white-space: nowrap;
    align-self: stretch;
  }
  .media-tab:hover { color: #444; }
  .media-tab.active { color: #13a4df; border-bottom-color: #13a4df; background: #fff; }
  .media-panel { padding: 0.85rem; }
  .media-browse-panel { border-top: 0; }

  .media-dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    border: 2px dashed #d4d4d4;
    border-radius: 6px;
    padding: 1.5rem 1rem;
    cursor: pointer;
    text-align: center;
    transition: border-color 0.15s, background 0.15s;
    user-select: none;
  }
  .media-dropzone:hover, .media-dropzone.drag-over { border-color: #13a4df; background: #f0f8ff; }
  .media-dropzone.uploading { opacity: 0.6; cursor: wait; }
  .dropzone-icon { font-size: 1.4rem; color: #bbb; line-height: 1; }
  .dropzone-primary { font-size: 0.85rem; font-weight: 600; color: #444; margin-top: 0.25rem; }
  .dropzone-secondary { font-size: 0.8rem; color: #888; }
  .dropzone-browse { color: #13a4df; text-decoration: underline; }
  .dropzone-types { font-size: 0.7rem; color: #bbb; margin-top: 0.2rem; letter-spacing: 0.03em; }
  .dropzone-spinner { font-size: 0.85rem; color: #888; }

  .media-url-wrap { display: flex; gap: 0.4rem; }
  .media-url-input {
    flex: 1;
    border: 1px solid #d4d4d4;
    border-radius: 4px;
    padding: 0.45rem 0.6rem;
    font-size: 0.875rem;
    font-family: inherit;
    color: #111;
    background: #fff;
    min-width: 0;
  }
  .media-url-input--multiline {
    min-height: 8.5rem;
    resize: vertical;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .media-url-input:focus { outline: none; border-color: #13a4df; box-shadow: 0 0 0 2px rgba(19,164,223,0.2); }
  .media-url-input--error { border-color: #f87171; }
  .media-url-input--error:focus { border-color: #f87171; box-shadow: 0 0 0 2px rgba(248,113,113,0.2); }
  .media-url-error { margin: 0.3rem 0 0; font-size: 0.75rem; color: #b91c1c; }
  .media-panel-hint { margin: 0; font-size: 0.75rem; color: #999; line-height: 1.4; }
  .media-error { margin: 0.4rem 0 0; font-size: 0.78rem; color: #c0392b; }
  .media-signin-notice { text-align: center; padding: 1.25rem 0.5rem; color: #666; font-size: 0.85rem; line-height: 1.5; }

  /* ── Slide options ─────────────────────────────────────────── */
  .slide-options {
    border-top: 1px solid #f0f0f0;
    padding-top: 0.5rem;
  }
  .slide-options-label {
    font-size: 0.7rem;
    font-weight: 700;
    color: #aaa;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin: 0 0 0.65rem;
  }
  .slide-options-body {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.9rem 1rem;
  }
  @container (min-width: 600px) {
    .slide-options-body {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  .field-id-error {
    border-color: #f87171 !important;
  }
  .bg-mode-tabs {
    display: inline-flex;
    border-bottom: 1px solid #e0e0e0;
  }
  .bg-mode-btn {
    padding: 0.2rem 0.55rem;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    font-size: 0.72rem;
    font-family: inherit;
    font-weight: 500;
    text-transform: none;
    color: #888;
    cursor: pointer;
    margin-bottom: 0;
    transition: color 0.1s, border-color 0.1s;
    white-space: nowrap;
    align-self: stretch;
  }
  .bg-mode-btn:hover { color: #444; }
  .bg-mode-btn.active { color: #13a4df; border-bottom-color: #13a4df; }

  /* ── Shared field styles ───────────────────────────────────── */
  .field { display: flex; flex-direction: column; gap: 0; }
  .field-label { font-size: 0.8rem; font-weight: 600; color: #444; margin-bottom: 0.3rem; }
  .field-hint { margin-top: 0.3rem; font-size: 0.75rem; color: #999; line-height: 1.4; }
  .field-error { margin-top: 0.3rem; font-size: 0.75rem; color: #b91c1c; }
  .field-url-error { border-color: #f87171 !important; }

  .field input[type="text"],
  .field input[type="url"],
  .field textarea,
  .slide-options-body input[type="text"],
  .slide-options-body input[type="url"] {
    border: 1px solid #d4d4d4;
    border-radius: 4px;
    padding: 0.4rem 0.6rem;
    font-size: 0.9rem;
    font-family: inherit;
    width: 100%;
    box-sizing: border-box;
    background: #fff;
    transition: border-color 0.15s;
  }
  .field textarea {
    resize: vertical;
    line-height: 1.4;
  }
  .field input:focus,
  .field textarea:focus,
  .slide-options-body input[type="text"]:focus,
  .slide-options-body input[type="url"]:focus {
    outline: none;
    border-color: #13a4df;
    box-shadow: 0 0 0 2px rgba(19,164,223,0.2);
  }

  /* ── Color row ─────────────────────────────────────────────── */
  .color-row { display: flex; align-items: center; gap: 0.4rem; }
  .color-text {
    border: 1px solid #d4d4d4;
    border-radius: 4px;
    padding: 0.4rem 0.6rem;
    font-size: 0.85rem;
    font-family: monospace;
    width: 7rem;
    box-sizing: border-box;
    background: #fff;
  }
  .color-text:focus { outline: none; border-color: #13a4df; box-shadow: 0 0 0 2px rgba(19,164,223,0.2); }
  .color-text--error { border-color: #f87171; }
  .color-text--error:focus { border-color: #f87171; box-shadow: 0 0 0 2px rgba(248,113,113,0.2); }

  /* ── Background image ──────────────────────────────────────── */
  .bg-image-preview { position: relative; display: inline-block; border-radius: 4px; overflow: hidden; border: 1px solid #e0e0e0; }
  .bg-image-thumb { display: block; max-width: 100%; max-height: 120px; width: auto; height: auto; }
  .bg-image-remove {
    position: absolute; top: 4px; right: 4px;
    background: rgba(0,0,0,0.55); color: #fff;
    border: none; border-radius: 3px; font-size: 0.72rem; padding: 2px 6px; cursor: pointer;
  }
  .bg-image-remove:hover { background: rgba(0,0,0,0.8); }
  .bg-image-input { display: flex; gap: 0.5rem; align-items: center; }
  .bg-image-input input[type="url"] {
    flex: 1; min-width: 0;
    border: 1px solid #d4d4d4; border-radius: 4px;
    padding: 0.35rem 0.5rem; font-size: 0.875rem; font-family: inherit;
    background: #fff; color: #111;
  }
  .bg-image-input input[type="url"]:focus { outline: none; border-color: #13a4df; box-shadow: 0 0 0 2px rgba(19,164,223,0.2); }

  /* ── Upload compact button (bg image) ─────────────────────── */
  .upload-btn-compact {
    display: inline-flex;
    align-items: center;
    padding: 0.3rem 0.75rem;
    border: 1px solid #d4d4d4;
    border-radius: 4px;
    background: #fafafa;
    color: #444;
    font-size: 0.82rem;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .upload-btn-compact:hover { border-color: #13a4df; background: #f0f8ff; }
  .upload-btn-compact.uploading { color: #999; cursor: wait; }

  /* ── Misc ──────────────────────────────────────────────────── */
  .clear-btn {
    background: none; border: none; color: #aaa;
    cursor: pointer; font-size: 0.85rem; padding: 0.2rem; line-height: 1;
    margin-bottom: 0; text-transform: none; font-weight: normal;
  }
  .clear-btn:hover { color: #c0392b; }


  .learn-more-link {
    color: #13a4df; text-decoration: underline;
    margin-bottom: 0; font-weight: normal; text-transform: none;
    box-shadow: none; text-shadow: none; border-radius: 0;
  }
  .learn-more-link:hover { color: #0a7cb8; }


  .visually-hidden {
    position: absolute; width: 1px; height: 1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
  }

/* ── Info modal ────────────────────────────────────────────── */
  .modal-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center;
    z-index: 200; padding: 1.5rem;
  }
  .modal {
    background: #fff; border-radius: 6px; padding: 1.75rem;
    max-width: 480px; width: 100%; max-height: 80vh; overflow-y: auto;
    position: relative; box-shadow: 0 8px 32px rgba(0,0,0,0.18);
  }
  .modal-close {
    position: absolute; top: 0.75rem; right: 0.75rem;
    background: none; border: none; font-size: 0.9rem; color: #aaa;
    cursor: pointer; padding: 0.2rem 0.4rem; line-height: 1;
    margin-bottom: 0; text-transform: none; font-weight: normal;
  }
  .modal-close:hover { color: #444; }
  .modal-title { font-size: 1.05rem; font-weight: 700; color: #1d1f21; margin: 0 0 0.75rem; padding-right: 1.5rem; }
  .modal-intro { font-size: 0.875rem; color: #444; line-height: 1.6; margin: 0 0 1rem; }
  .modal-list { margin: 0; display: flex; flex-direction: column; gap: 0.75rem; }
  .modal-list dt { font-size: 0.82rem; font-weight: 700; color: #1d1f21; margin: 0; }
  .modal-list dd { font-size: 0.82rem; color: #444; line-height: 1.5; margin: 0.15rem 0 0; }
  .modal-list dd code { font-family: Consolas, monospace; font-size: 0.78rem; background: #f3f3f3; padding: 0 3px; border-radius: 2px; }
  .modal-list dd a { color: #13a4df; }

  @media (max-width: 640px) {
    .slide-canvas {
      grid-template-columns: 1fr;
    }
    .slide-media-col { order: 2; }
    .slide-canvas--media-right .slide-media-col { order: 2; }
    .slide-canvas--media-right .slide-content-col { order: 1; }
  }
</style>
