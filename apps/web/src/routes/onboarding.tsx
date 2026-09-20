import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { Button, Field, inputClass, Panel } from "@/components/kit";
import { Logo } from "@/components/logo";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/onboarding")({
	component: Onboarding,
	beforeLoad: async () => {
		const session = await authClient.getSession();
		if (!session.data) throw redirect({ to: "/login" });
	},
});

function slugify(name: string) {
	return name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
}

function Onboarding() {
	const navigate = useNavigate();
	const [name, setName] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function onSubmit(event: FormEvent) {
		event.preventDefault();
		if (!name.trim()) return;
		setPending(true);
		setError(null);
		// A short random suffix keeps slugs unique without asking the user for one.
		const slug = `${slugify(name) || "merchant"}-${Math.random().toString(36).slice(2, 6)}`;
		const created = await authClient.organization.create({
			name: name.trim(),
			slug,
		});
		if (created.error || !created.data) {
			setPending(false);
			setError(created.error?.message ?? "Couldn't create the merchant");
			return;
		}
		await authClient.organization.setActive({
			organizationId: created.data.id,
		});
		navigate({ to: "/" });
	}

	return (
		<div className="flex min-h-svh items-center justify-center px-4 py-10">
			<div className="w-full max-w-[440px]">
				<Logo className="mb-8 justify-center" />
				<Panel className="p-7">
					<h1 className="font-extrabold text-xl tracking-[-0.02em]">
						Set up your merchant
					</h1>
					<p className="mt-1 mb-6 text-[13px] text-muted-foreground leading-relaxed">
						This is the business your buyers pay. You'll connect its Telegram
						bot and add products next.
					</p>
					<form onSubmit={onSubmit} className="flex flex-col gap-4">
						<Field
							label="Business or game name"
							htmlFor="name"
							error={error ?? undefined}
						>
							<input
								id="name"
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder="Pixel Forge"
								maxLength={64}
								required
								className={inputClass}
							/>
						</Field>
						<Button
							type="submit"
							loading={pending}
							disabled={!name.trim()}
							className="w-full"
						>
							Continue
						</Button>
					</form>
				</Panel>
			</div>
		</div>
	);
}
