export type PageKind = 'article' | 'large' | 'sjis' | 'oembed' | 'redirect';
export type TargetName = 'chiramiss' | 'summaly';
export type ScenarioId = 's1' | 's2' | 's3a' | 's3b';

export interface Expectation { title: string; playerUrl?: string }

export interface OriginStats {
	requests: Record<string, number>; // key: `${method} ${pathname}` 例: 'GET /article', 'HEAD /favicon.ico'
	newConnections: number;
	bytesOut: number; // origin → クライアントのワイヤ上のバイト数（TLS 込み）
}

export type Arrival = { kind: 'closed'; concurrency: number } | { kind: 'spread'; durationMs: number };

export interface LoadSpec {
	targetBaseUrl: string; // 例 'http://chiramiss:3000/'
	originControlUrl: string; // 例 'http://origin.bench:9000/'
	rttMs: number;
	urls: string[]; // 要約させる URL（件数 = リクエスト数）
	arrival: Arrival;
	expected: Expectation;
	requestTimeoutMs: number;
}

export interface LoadResult {
	latenciesMs: number[]; // 成功したリクエストのみ
	ok: number;
	errors: number;
	errorSamples: string[]; // 最大 5 件
	wallMs: number;
	origin: OriginStats; // ラン開始時にリセットした後の値
}

export interface RunSpec {
	scenario: ScenarioId;
	pageKind: PageKind;
	rttMs: number;
	requests: number;
	arrival: Arrival;
	sameUrl: boolean;
	runIndex: number;
	warmupRequests: number;
}

export interface RunRecord {
	target: TargetName;
	spec: RunSpec;
	load: LoadResult;
	cpuUsageUsec: number; // 計測区間の差分
	memoryPeakBytes: number;
}

export interface BenchMeta {
	startedAt: string; host: { cpuModel: string; cpuCount: number; totalMemBytes: number; os: string; docker: string };
	limits: { cpus: string; memory: string };
	chiramiss: { commit: string; tag: string | null; dirty: boolean; node: string };
	summaly: { image: string; digest: string | null; node: string };
	quick: boolean;
}

export interface BenchResults { meta: BenchMeta; runs: RunRecord[] }

export interface FixtureResponse { status: number; headers: Record<string, string>; body: Uint8Array }
export interface Fixtures { respond(method: string, url: URL): FixtureResponse } // 未知のパスは 404
