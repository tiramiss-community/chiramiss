import { expect, test } from 'vitest';
import { parseCgroup } from '../src/cgroup.ts';

test('parseCgroup', () => {
	expect(parseCgroup('usage_usec 1234\nuser_usec 1000\n', '5678\n')).toEqual({ cpuUsageUsec: 1234, memoryPeakBytes: 5678 });
});

test('parseCgroup throws on missing usage_usec', () => {
	expect(() => parseCgroup('user_usec 1000\n', '5678\n')).toThrow(/usage_usec/);
});

test('parseCgroup throws on invalid memory.peak', () => {
	expect(() => parseCgroup('usage_usec 1\n', 'max\n')).toThrow(/memory\.peak/);
	expect(() => parseCgroup('usage_usec 1\n', '')).toThrow(/memory\.peak/);
});
