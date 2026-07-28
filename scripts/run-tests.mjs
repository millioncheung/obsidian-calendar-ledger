import esbuild from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const outputDir = await mkdtemp(join(tmpdir(), 'calendar-ledger-tests-'));
const outfile = join(outputDir, 'regression-tests.mjs');

try {
	await esbuild.build({
		entryPoints: ['tests/regression.test.ts'],
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node20',
		outfile,
		logLevel: 'silent',
	});
	await import(pathToFileURL(outfile).href);
} finally {
	await rm(outputDir, { recursive: true, force: true });
}
