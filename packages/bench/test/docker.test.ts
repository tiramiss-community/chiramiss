import { execFile } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vitest';
import { compose, imageDigest, nodeVersionOfImage, pullImage } from '../src/docker.ts';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

type Callback = (error: Error | null, stdout: string, stderr: string) => void;
type Reply = { stdout: string } | { stderr: string };

const execFileMock = vi.mocked(execFile);

/** 呼ばれた順に reply を返す execFile のスタブを入れる。足りなくなったら最後の reply を使い続ける。 */
function stubExecFile(...replies: Reply[]): void {
	let call = 0;

	execFileMock.mockImplementation(((_file: string, _args: string[], _opts: unknown, callback: Callback) => {
		const reply = replies[Math.min(call++, replies.length - 1)] as Reply;

		if ('stderr' in reply) {
			callback(Object.assign(new Error('Command failed'), { code: 1 }), '', reply.stderr);
		} else {
			callback(null, reply.stdout, '');
		}
	}) as unknown as typeof execFile);
}

function calls(): { file: string; args: string[]; env: NodeJS.ProcessEnv | undefined }[] {
	return execFileMock.mock.calls.map((c) => ({
		file: c[0] as string,
		args: c[1] as string[],
		env: (c[2] as { env?: NodeJS.ProcessEnv } | undefined)?.env,
	}));
}

afterEach(() => {
	execFileMock.mockReset();
});

test('pullImage failure names the image and hints that it may be unpublished', async () => {
	stubExecFile({ stderr: 'Error response from daemon: denied\n' });

	await expect(pullImage('ghcr.io/misskey-dev/summaly:5.6.0')).rejects.toThrow(/ghcr\.io\/misskey-dev\/summaly:5\.6\.0 could not be pulled \(is it published yet\?\)/);
	await expect(pullImage('ghcr.io/misskey-dev/summaly:5.6.0')).rejects.toThrow(/^summaly image ghcr\.io\/misskey-dev\/summaly:5\.6\.0 could not be pulled \(is it published yet\?\).*denied/s);
});

test('pullImage uses an image that already exists locally without pulling', async () => {
	stubExecFile({ stdout: '[{}]\n' });

	await pullImage('summaly-bench:dev');

	expect(calls().map((c) => c.args.slice(0, 2))).toEqual([['image', 'inspect']]);
});

test('pullImage pulls an image that is missing locally', async () => {
	stubExecFile({ stderr: 'No such image' }, { stdout: 'pulled\n' });

	await pullImage('ghcr.io/misskey-dev/summaly:5.6.0');

	expect(calls().map((c) => c.args)).toEqual([
		['image', 'inspect', 'ghcr.io/misskey-dev/summaly:5.6.0'],
		['pull', 'ghcr.io/misskey-dev/summaly:5.6.0'],
	]);
});

test('nodeVersionOfImage strips the v', async () => {
	stubExecFile({ stdout: 'v26.13.1\n' });

	await expect(nodeVersionOfImage('summaly-bench:dev')).resolves.toBe('26.13.1');
	expect(calls()[0]?.args).toEqual(['run', '--rm', '--network', 'none', '--entrypoint', 'node', 'summaly-bench:dev', '-v']);
});

test('nodeVersionOfImage rejects output that is not a node version', async () => {
	stubExecFile({ stdout: 'hello\n' });

	await expect(nodeVersionOfImage('x')).rejects.toThrow(/x/);
});

test('imageDigest returns the first repo digest, or null for a local build', async () => {
	stubExecFile({ stdout: '["ghcr.io/misskey-dev/summaly@sha256:abc"]\n' }, { stdout: '[]\n' });

	await expect(imageDigest('ghcr.io/misskey-dev/summaly:5.6.0')).resolves.toBe('ghcr.io/misskey-dev/summaly@sha256:abc');
	await expect(imageDigest('summaly-bench:dev')).resolves.toBeNull();
});

test('compose runs against the bench compose file and project with the given env', async () => {
	stubExecFile({ stdout: 'out\n' });

	await expect(compose(['up', '-d', 'origin'], { BENCH_SUBNET: '172.30.250.0/24' })).resolves.toBe('out\n');

	const [call] = calls();

	expect(call.file).toBe('docker');
	expect(call.args.slice(0, 2)).toEqual(['compose', '-f']);
	expect(call.args[2]).toMatch(/packages\/bench\/compose\.yaml$/);
	expect(call.args.slice(3)).toEqual(['-p', 'chiramiss-bench', 'up', '-d', 'origin']);
	expect(call.env?.BENCH_SUBNET).toBe('172.30.250.0/24');
	expect(call.env?.PATH).toBe(process.env.PATH);
});

test('compose failure includes the command and stderr', async () => {
	stubExecFile({ stderr: 'service "summaly" is unhealthy\n' });

	await expect(compose(['up', '-d', '--wait', 'summaly'], {})).rejects.toThrow(/docker compose .*up -d --wait summaly[\s\S]*service "summaly" is unhealthy/);
});
