import { runLoad, warmup } from './loadgen.ts';
import type { LoadSpec } from './types.ts';

const args = process.argv.slice(2);
const mode = args[0];
const specJson = args[1];

if (args.length !== 2 || (mode !== 'run' && mode !== 'warmup')) {
	process.stderr.write("usage: node src/loadgen-main.ts <run|warmup> '<LoadSpec JSON>'\n");
	process.exit(2);
}

const spec = JSON.parse(specJson as string) as LoadSpec;

if (mode === 'run') {
	process.stdout.write(`${JSON.stringify(await runLoad(spec))}\n`);
} else {
	await warmup(spec);
}
