import { WebhookEventType } from "@starpay/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { Webhook } from "lucide-react";

import { Button, EmptyState, Mono, Panel, PanelHeader } from "@/components/kit";

export const Route = createFileRoute("/_auth/webhooks")({
	component: Webhooks,
	staticData: { title: "Webhooks", subtitle: "Deliveries to your server" },
});

const SAMPLE = `X-StarPay-Signature: t=1726747327,v1=5f8c…
X-StarPay-Event-Id: evt_01J8…
X-StarPay-Event-Type: payment.succeeded

{
  "id": "evt_01J8…",
  "object": "event",
  "type": "payment.succeeded",
  "livemode": true,
  "data": { "object": { "object": "order", "id": "ord_…", "status": "paid", … } }
}`;

function Webhooks() {
	return (
		<>
			<div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
				<Panel>
					<PanelHeader
						title="Endpoints"
						action={<Button disabled>Add endpoint</Button>}
					/>
					<EmptyState
						icon={<Webhook />}
						title="Webhook delivery is coming next"
					>
						StarPay already records every event below for your orders. Sending
						them to your server, with signing, retries and resend, is the next
						milestone. Until then, poll GET /v1/orders/:id.
					</EmptyState>
				</Panel>
				<Panel className="flex flex-col gap-3 p-5">
					<h2 className="font-bold text-[14.5px]">Events</h2>
					<div className="flex flex-wrap gap-1.5">
						{WebhookEventType.options.map((type) => (
							<span
								key={type}
								className="rounded-full bg-muted px-2.5 py-1 font-mono text-[#475467] text-[11.5px] dark:text-muted-foreground"
							>
								{type}
							</span>
						))}
					</div>
					<p className="text-[13px] text-muted-foreground leading-relaxed">
						Every delivery carries an{" "}
						<Mono className="text-foreground">X-StarPay-Signature</Mono> header:
						an HMAC-SHA256 of{" "}
						<Mono className="text-foreground">timestamp.body</Mono> with your
						signing secret. Verify it and reject timestamps older than five
						minutes before trusting the payload.
					</p>
				</Panel>
			</div>
			<Panel>
				<PanelHeader title="Example delivery" />
				<pre className="overflow-x-auto bg-[#0B1B2B] p-5 font-mono text-[#CFE0FF] text-[12.5px] leading-relaxed">
					{SAMPLE}
				</pre>
			</Panel>
		</>
	);
}
