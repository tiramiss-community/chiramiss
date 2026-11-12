export function parseCgroup(cpuStat: string, memoryPeak: string): { cpuUsageUsec: number; memoryPeakBytes: number } {
	const match = /^usage_usec\s+(\d+)\s*$/m.exec(cpuStat);

	if (!match) {
		throw new Error('cpu.stat に usage_usec がありません');
	}

	const memoryPeakBytes = Number(memoryPeak.trim());

	if (!Number.isFinite(memoryPeakBytes) || memoryPeak.trim() === '') {
		throw new Error(`memory.peak の値が不正です: ${JSON.stringify(memoryPeak)}`);
	}

	return { cpuUsageUsec: Number(match[1]), memoryPeakBytes };
}
