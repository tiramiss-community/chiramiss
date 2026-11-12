import { expect, test } from 'vitest';
import { SERVICE, targetEnv } from '../src/targets.ts';

test('chiramiss env never disables the private IP block', () => {
	const env = targetEnv('chiramiss', '172.30.250.0/24');

	expect(Object.keys(env).filter((k) => k.endsWith('ALLOW_PRIVATE_IP'))).toEqual([]);
	expect(env.CHIRAMISS_ALLOWED_PRIVATE_NETWORKS).toBe('172.30.250.0/24');
});

test('summaly env allows private IP; shared settings are identical', () => {
	const c = targetEnv('chiramiss', '172.30.250.0/24');
	const s = targetEnv('summaly', '172.30.250.0/24');

	expect(s.SUMMALY_ALLOW_PRIVATE_IP).toBe('true');
	expect(s.CHIRAMISS_ALLOWED_PRIVATE_NETWORKS).toBeUndefined();

	const shared = {
		SUMMALY_LANG: 'ja-JP',
		SUMMALY_USER_AGENT: 'ChiramissBench/1.0',
		SUMMALY_FOLLOW_REDIRECTS: 'true',
		SUMMALY_RESPONSE_TIMEOUT: '20000',
		SUMMALY_OPERATION_TIMEOUT: '60000',
		SUMMALY_CONTENT_LENGTH_LIMIT: '10485760',
		SUMMALY_CONTENT_LENGTH_REQUIRED: 'false',
		NODE_EXTRA_CA_CERTS: '/certs/ca.pem',
	};

	expect(c).toMatchObject(shared);
	expect(s).toMatchObject(shared);
});

test('service names', () => {
	expect(SERVICE).toEqual({ chiramiss: 'chiramiss', summaly: 'summaly' });
});
