// article-unique-icon は article と同じページで、favicon の URL だけをページごとに変えた物（favicon 確認のキャッシュが当たらない）。
export type PageKind = 'article' | 'article-unique-icon' | 'large' | 'sjis' | 'oembed' | 'redirect';
export type TargetName = 'chiramiss' | 'summaly';
export type ScenarioId = 's1' | 's2' | 's3a' | 's3b';

/** 成功とみなす応答の中身。loadgen はこれと要約させた URL から期待値を作って比べる。 */
export interface Expectation {
	title: string;
	description: string;
	/** `{search}` は要約させた URL のクエリ（`?` 込み）に置き換えて比べる。 */
	icon: string;
	thumbnail: string;
	sitename: string;
	playerUrl?: string;
	/** origin がリダイレクトする先のパス。応答の `url` は、要約させた URL のパスをこれに替えた物と比べる。 */
	finalPath?: string;
}

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
	memoryPeakBeforeRunBytes: number; // 計測区間の開始時点の memory.peak（起動と暖機を含む）
	memoryPeakBytes: number; // 計測区間の終了時点の memory.peak（コンテナの起動から）。開始時点より大きければ計測区間のピーク
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
