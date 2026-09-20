import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_auth")({
	component: AuthLayout,
	beforeLoad: async () => {
		const session = await authClient.getSession();
		if (!session.data) {
			throw redirect({ to: "/login" });
		}
		// Every dashboard call acts on the active merchant (organization).
		if (!session.data.session.activeOrganizationId) {
			const organizations = await authClient.organization.list();
			const first = organizations.data?.[0];
			if (!first) throw redirect({ to: "/onboarding" });
			await authClient.organization.setActive({ organizationId: first.id });
		}
		return { session: session.data };
	},
});

function AuthLayout() {
	return (
		<AppShell>
			<Outlet />
		</AppShell>
	);
}
