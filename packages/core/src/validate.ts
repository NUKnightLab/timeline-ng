import type {
  TLTimeline,
  TLEvent,
  TLDateInput,
  ValidationResult,
  ValidationError,
} from './types.ts';

function err(path: string, message: string): ValidationError {
  return { path, message };
}

function validateDateInput(d: unknown, path: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (typeof d !== 'object' || d === null) {
    errors.push(err(path, 'must be an object'));
    return errors;
  }
  const date = d as Record<string, unknown>;
  if (typeof date['year'] !== 'number') {
    errors.push(err(`${path}.year`, 'year is required and must be a number'));
  }
  for (const field of ['month', 'day', 'hour', 'minute', 'second', 'millisecond'] as const) {
    if (field in date && typeof date[field] !== 'number') {
      errors.push(err(`${path}.${field}`, `${field} must be a number if provided`));
    }
  }
  if ('month' in date && typeof date['month'] === 'number') {
    if (date['month'] < 1 || date['month'] > 12) {
      errors.push(err(`${path}.month`, 'month must be between 1 and 12'));
    }
  }
  if ('day' in date && typeof date['day'] === 'number') {
    if (date['day'] < 1 || date['day'] > 31) {
      errors.push(err(`${path}.day`, 'day must be between 1 and 31'));
    }
  }
  return errors;
}

function validateEvent(event: unknown, path: string, requireDate: boolean): ValidationError[] {
  const errors: ValidationError[] = [];
  if (typeof event !== 'object' || event === null) {
    errors.push(err(path, 'must be an object'));
    return errors;
  }
  const e = event as Record<string, unknown>;

  if (requireDate) {
    if (!('start_date' in e)) {
      errors.push(err(`${path}.start_date`, 'start_date is required'));
    } else {
      errors.push(...validateDateInput(e['start_date'], `${path}.start_date`));
    }
  }

  if ('end_date' in e && e['end_date'] !== undefined) {
    errors.push(...validateDateInput(e['end_date'], `${path}.end_date`));
  }

  if ('text' in e && e['text'] !== undefined) {
    if (typeof e['text'] !== 'object' || e['text'] === null) {
      errors.push(err(`${path}.text`, 'text must be an object'));
    }
  }

  if ('media' in e && e['media'] !== undefined) {
    if (typeof e['media'] !== 'object' || e['media'] === null) {
      errors.push(err(`${path}.media`, 'media must be an object'));
    } else {
      const m = e['media'] as Record<string, unknown>;
      if (typeof m['url'] !== 'string' || m['url'].trim() === '') {
        errors.push(err(`${path}.media.url`, 'media.url must be a non-empty string'));
      }
    }
  }

  if ('background' in e && e['background'] !== undefined) {
    if (typeof e['background'] !== 'object' || e['background'] === null) {
      errors.push(err(`${path}.background`, 'background must be an object'));
    }
  }

  return errors;
}

function validateSettings(settings: unknown, path: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (typeof settings !== 'object' || settings === null) {
    errors.push(err(path, 'settings must be an object'));
    return errors;
  }
  const s = settings as Record<string, unknown>;

  if ('language' in s && s['language'] !== undefined && typeof s['language'] !== 'string') {
    errors.push(err(`${path}.language`, 'language must be a string'));
  }
  if ('theme' in s && s['theme'] !== undefined) {
    if (s['theme'] !== 'light' && s['theme'] !== 'dark' && s['theme'] !== 'auto') {
      errors.push(err(`${path}.theme`, `theme must be 'light', 'dark', or 'auto'`));
    }
  }
  if ('initialIndex' in s && s['initialIndex'] !== undefined) {
    if (typeof s['initialIndex'] !== 'number' || s['initialIndex'] < 0) {
      errors.push(err(`${path}.initialIndex`, 'initialIndex must be a non-negative number'));
    }
  }
  if ('reverseOrder' in s && s['reverseOrder'] !== undefined && typeof s['reverseOrder'] !== 'boolean') {
    errors.push(err(`${path}.reverseOrder`, 'reverseOrder must be a boolean'));
  }

  return errors;
}

/**
 * Validate an unknown value as a TLTimeline.
 * Returns a ValidationResult with any structural errors found.
 */
export function validateTimeline(data: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof data !== 'object' || data === null) {
    return { valid: false, errors: [err('', 'timeline must be an object')] };
  }

  const tl = data as Record<string, unknown>;

  if (!('events' in tl)) {
    errors.push(err('events', 'events array is required'));
  } else if (!Array.isArray(tl['events'])) {
    errors.push(err('events', 'events must be an array'));
  } else {
    for (let i = 0; i < tl['events'].length; i++) {
      errors.push(...validateEvent(tl['events'][i], `events[${i}]`, true));
    }
  }

  if ('title' in tl && tl['title'] !== undefined) {
    errors.push(...validateEvent(tl['title'], 'title', false));
  }

  if ('settings' in tl && tl['settings'] !== undefined) {
    errors.push(...validateSettings(tl['settings'], 'settings'));
  }

  return { valid: errors.length === 0, errors };
}
