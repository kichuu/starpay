import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/dashboard")({
  component: RouteComponent,
});

function RouteComponent() {
  const { session } = Route.useRouteContext();

  const onboarding = useQuery(orpc.onboarding.status.queryOptions());

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome {session.data?.user.name}</p>
      <pre>{JSON.stringify(onboarding.data ?? onboarding.error?.message, null, 2)}</pre>
    </div>
  );
}
