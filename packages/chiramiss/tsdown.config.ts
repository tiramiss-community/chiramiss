import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: './src/index.ts',
	outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
	tsconfig: true,
	deps: {
		neverBundle: true,
	},
	outDir: './built',
	dts: true,
	define: {
		_VERSION_: JSON.stringify(JSON.parse(readFileSync('./package.json', 'utf-8')).version),
	},
});
