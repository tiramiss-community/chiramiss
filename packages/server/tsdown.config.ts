import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: './src/index.ts',
	outExtensions: () => ({ js: '.js' }),
	// The tsconfig maps the lib to its sources for type-checking; the build must import the built lib instead.
	tsconfig: false,
	deps: {
		neverBundle: true,
	},
	outDir: './built',
	dts: false,
});
