import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAppFromPackage, listApps } from './models/app.js';
import { allSamplePackages } from './samplePackages.js';
import { packageToZipPayload } from './zip.js';

const SAMPLE_DIR = join(process.cwd(), 'samples');

if (!existsSync(SAMPLE_DIR)) mkdirSync(SAMPLE_DIR, { recursive: true });

if (listApps().length === 0) {
  for (const pkg of allSamplePackages()) {
    createAppFromPackage(pkg);
  }
}

for (const pkg of allSamplePackages()) {
  const slug = pkg.manifest.id;
  writeFileSync(join(SAMPLE_DIR, `${slug}.json`), JSON.stringify(pkg, null, 2));
  writeFileSync(join(SAMPLE_DIR, `${slug}.sgpkg`), Buffer.from(packageToZipPayload(pkg)));
}

console.log('Sample apps and .sgpkg files are ready in samples/.');
