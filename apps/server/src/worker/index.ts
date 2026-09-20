import type { Services } from "@starpay/core";

type Job = { name: string; everyMs: number; run: () => Promise<unknown> };

/**
 * In-process background jobs. Each job never overlaps itself, and every job is
 * safe to run on several instances at once (conditional updates, idempotent
 * ledger postings, one in-flight payout per wallet).
 */
export function startWorker(services: Services) {
	const jobs: Job[] = [
		{
			name: "webhook-dispatch",
			everyMs: 2_000,
			run: () => services.webhooks.dispatchDue(),
		},
		{
			name: "release-earnings",
			everyMs: 60_000,
			run: () => services.settlement.releaseDue(),
		},
		{
			name: "payouts",
			everyMs: 20_000,
			run: async () => {
				for (const mode of ["live", "test"] as const)
					await services.payouts.processNext(mode);
			},
		},
	];

	const timers = jobs.map((job) => {
		let running = false;
		const tick = async () => {
			if (running) return;
			running = true;
			try {
				await job.run();
			} catch (error) {
				console.error(`[worker] ${job.name} failed`, error);
			} finally {
				running = false;
			}
		};
		void tick();
		return setInterval(tick, job.everyMs);
	});

	return () => {
		for (const timer of timers) clearInterval(timer);
	};
}
