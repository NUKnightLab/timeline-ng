# @knight-lab/timeline-ng-core

Framework-agnostic types and utilities for [TimelineJS](https://timeline.knightlab.com/)-style
timeline data: TypeScript types, date parsing/formatting (including cosmological-scale
BigInt dates), validation, i18n, and adapters for legacy TimelineJS 3 data.

Used by [`@knight-lab/timeline-ng`](https://npmx.dev/package/@knight-lab/timeline-ng)
(the Svelte player), but has no Svelte dependency itself — usable anywhere you need to
parse, validate, or transform timeline data. 

Originally created to support the authoring tool at https://timeline.knightlab.com/ng/

## Install

```sh
npm install @knight-lab/timeline-ng-core
```

## Usage

```ts
import { validateTimeline, parseTLDate, formatDate, fromTL3 } from '@knight-lab/timeline-ng-core';
import type { TLTimeline } from '@knight-lab/timeline-ng-core';

const timeline: TLTimeline = { events: [/* ... */] };

const result = validateTimeline(timeline);
if (!result.ok) {
  console.error(result.errors); // path-based validation errors
}
```

### Migrating from TimelineJS 3

```ts
import { fromTL3, fromTL3CSV } from '@knight-lab/timeline-ng-core';

const timeline = fromTL3(existingTL3Json);
// or, from a Google Sheets CSV export:
const timeline2 = fromTL3CSV(csvText);
```

## What's included

- **Types** — `TLTimeline`, `TLEvent`, `TLMedia`, `TLText`, `TLBackground`, and related types
- **JSON Schema** — `schema/timeline.schema.json`, generated directly from the TypeScript
  types, for validating or generating timeline data outside of JavaScript/TypeScript
- **Dates** — `parseTLDate`, `compareDates`, `formatDate` (via `Intl.DateTimeFormat`, with
  `BigInt` support for cosmological-scale years)
- **Validation** — `validateTimeline` with path-based error reporting
- **Adapters** — `fromTL3` / `fromTL3CSV` for migrating existing TimelineJS 3 data
- **i18n** — flat-JSON locale messages (`en`, `es`) via `getLocale` / `getMessage`
- **Media** — `resolveMedia` for turning a raw URL into a typed, renderable media descriptor

## JSON Schema

A [JSON Schema](https://json-schema.org/) for the timeline data format ships in the
package at `schema/timeline.schema.json` — generated from the `TLTimeline` TypeScript
type, so it can't drift out of sync. Use it to validate timeline JSON from any language,
or to drive codegen/tooling outside the JS ecosystem:

```ts
import { createRequire } from 'node:module';
import Ajv from 'ajv';

const require = createRequire(import.meta.url);
const schema = require('@knight-lab/timeline-ng-core/schema/timeline.schema.json');

const validate = new Ajv().compile(schema);
if (!validate(myTimelineJson)) {
  console.error(validate.errors);
}
```

For a plain-language walkthrough of the same format, see the
[timeline data format guide](https://timeline.knightlab.com/ng/docs.html#data-format).

## Links

- [Full documentation](https://github.com/NUKnightLab/timeline-ng)
- [Report an issue](https://github.com/NUKnightLab/timeline-ng/issues)
