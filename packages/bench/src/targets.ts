import type { TargetName } from './types.ts';

export const SERVICE: Record<TargetName, string> = {
	chiramiss: 'chiramiss',
	summaly: 'summaly',
};

const SHARED_ENV: Record<string, string> = {
	SUMMALY_LANG: 'ja-JP',
	SUMMALY_USER_AGENT: 'ChiramissBench/1.0',
	SUMMALY_FOLLOW_REDIRECTS: 'true',
	SUMMALY_RESPONSE_TIMEOUT: '20000',
	SUMMALY_OPERATION_TIMEOUT: '60000',
	SUMMALY_CONTENT_LENGTH_LIMIT: '10485760',
	SUMMALY_CONTENT_LENGTH_REQUIRED: 'false',
	NODE_EXTRA_CA_CERTS: '/certs/ca.pem',
};

export function targetEnv(target: TargetName, subnet: string): Record<string, string> {
	if (target === 'chiramiss') {
		return { ...SHARED_ENV, CHIRAMISS_ALLOWED_PRIVATE_NETWORKS: subnet };
	}

	return { ...SHARED_ENV, SUMMALY_ALLOW_PRIVATE_IP: 'true' };
}
