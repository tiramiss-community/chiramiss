import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const COMPOSE_FILE = fileURLToPath(new URL('../compose.yaml', import.meta.url));
const PROJECT = 'chiramiss-bench';
// loadgen の結果（全リクエストの応答時間を含む JSON）を受け取れる大きさにしておく。
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * コマンドを実行して stdout を返す。失敗時は、コマンドと stderr を含む Error を投げる。
 * env は process.env に重ねて渡す。
 */
export function execCommand(file: string, args: string[], env: Record<string, string> = {}): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(file, args, { env: { ...process.env, ...env }, maxBuffer: MAX_BUFFER, encoding: 'utf8' }, (error, stdout, stderr) => {
			if (error) {
				const detail = String(stderr).trim() || error.message;

				reject(new Error(`\`${[file, ...args].join(' ')}\` failed: ${detail}`, { cause: error }));

				return;
			}

			resolve(String(stdout));
		});
	});
}

/** `docker compose -f <bench>/compose.yaml -p chiramiss-bench ...` を実行する。 */
export function compose(args: string[], env: Record<string, string>): Promise<string> {
	return execCommand('docker', ['compose', '-f', COMPOSE_FILE, '-p', PROJECT, ...args], env);
}

/**
 * 手元に無ければ pull する。手元でビルドしたイメージ（例: summaly-bench:dev）はそのまま使う。
 */
export async function pullImage(image: string): Promise<void> {
	try {
		await execCommand('docker', ['image', 'inspect', image]);

		return;
	} catch {
		// 手元に無い。pull する。
	}

	try {
		await execCommand('docker', ['pull', image]);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);

		throw new Error(`summaly image ${image} could not be pulled (is it published yet?)\n${detail}`, { cause: error });
	}
}

/** レジストリの digest（`<repo>@sha256:...`）。手元でビルドしただけのイメージは null。 */
export async function imageDigest(image: string): Promise<string | null> {
	const out = await execCommand('docker', ['image', 'inspect', '--format', '{{json .RepoDigests}}', image]);
	const digests = JSON.parse(out) as string[] | null;

	return digests?.[0] ?? null;
}

/** イメージの中の `node -v`（先頭の v を除く。例 '26.13.1'）。 */
export async function nodeVersionOfImage(image: string): Promise<string> {
	const out = (await execCommand('docker', ['run', '--rm', '--network', 'none', '--entrypoint', 'node', image, '-v'])).trim();
	const match = /^v(\d+\.\d+\.\d+)$/.exec(out);

	if (!match) {
		throw new Error(`unexpected \`node -v\` output from ${image}: ${JSON.stringify(out)}`);
	}

	return match[1] as string;
}
