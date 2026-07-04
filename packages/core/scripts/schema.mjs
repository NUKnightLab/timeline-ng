import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createGenerator } from 'ts-json-schema-generator';

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function generateTimelineSchema() {
  const generator = createGenerator({
    path: path.join(packageDir, 'src/types.ts'),
    tsconfig: path.join(packageDir, 'tsconfig.json'),
    type: 'TLTimeline',
    skipTypeCheck: true,
  });
  const schema = generator.createSchema('TLTimeline');
  return {
    $id: 'https://raw.githubusercontent.com/NUKnightLab/timeline-ng/main/packages/core/schema/timeline.schema.json',
    ...schema,
  };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const schema = generateTimelineSchema();
  const outPath = path.join(packageDir, 'schema/timeline.schema.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(schema, null, 2) + '\n');
  console.log(`Wrote ${path.relative(packageDir, outPath)}`);
}
