import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const libSrc = fileURLToPath(new URL('../chiramiss/src', import.meta.url));
const libPackageJson = fileURLToPath(new URL('../chiramiss/package.json', import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			// Run against the lib's sources so that tests need no lib build.
			'@tiramiss-community/chiramiss': `${libSrc}/index.ts`,
			// The lib's sources import each other through this alias.
			'@': libSrc,
		},
	},
	test: {
		// Same reset as the lib's tests: private IP handling must not depend on the developer's shell.
		setupFiles: ['../chiramiss/test/setup.ts'],
	},
	define: {
		_VERSION_: JSON.stringify(JSON.parse(readFileSync(libPackageJson, 'utf-8')).version),
	},
});
