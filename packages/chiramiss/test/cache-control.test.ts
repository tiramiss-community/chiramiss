import { describe, expect, test } from 'vitest';
import { summaryCacheControl } from '@/index.js';

describe('summaryCacheControl', () => {
	test('既定では成功は 300 秒、失敗は 30 秒', () => {
		expect(summaryCacheControl({}, 'ok')).toBe('public, max-age=300');
		expect(summaryCacheControl({}, 'error')).toBe('public, max-age=30');
	});

	test('cacheTtl / errorCacheTtl を秒に切り捨てて使う', () => {
		expect(summaryCacheControl({ cacheTtl: 61999 }, 'ok')).toBe('public, max-age=61');
		expect(summaryCacheControl({ errorCacheTtl: 5000 }, 'error')).toBe('public, max-age=5');
	});

	test('成功と失敗はそれぞれの TTL だけを見る', () => {
		expect(summaryCacheControl({ errorCacheTtl: 0 }, 'ok')).toBe('public, max-age=300');
		expect(summaryCacheControl({ cacheTtl: 0 }, 'error')).toBe('public, max-age=30');
	});

	test('TTL が 1 秒未満なら no-store', () => {
		expect(summaryCacheControl({ cacheTtl: 0 }, 'ok')).toBe('no-store');
		expect(summaryCacheControl({ cacheTtl: 999 }, 'ok')).toBe('no-store');
		expect(summaryCacheControl({ errorCacheTtl: 0 }, 'error')).toBe('no-store');
	});
});
