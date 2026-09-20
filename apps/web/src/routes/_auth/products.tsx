import type { ProductObject } from "@starpay/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Package } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import {
	Button,
	Dialog,
	EmptyState,
	ErrorState,
	Field,
	inputClass,
	Mono,
	Panel,
	Shimmer,
	Star,
	StatusPill,
} from "@/components/kit";
import { formatStars } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/products")({
	component: Products,
	staticData: { title: "Products", subtitle: "What buyers see in your bot" },
});

function Products() {
	const products = useQuery(
		orpc.products.list.queryOptions({ input: { limit: 100 } }),
	);
	const [editing, setEditing] = useState<ProductObject | "new" | null>(null);

	const list = products.data?.data ?? [];
	const active = list.filter((product) => product.status === "active").length;

	return (
		<>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="text-[13px] text-muted-foreground">
					{products.data
						? `${list.length} product${list.length === 1 ? "" : "s"} · ${active} active`
						: " "}
				</div>
				<Button onClick={() => setEditing("new")}>New product</Button>
			</div>

			{products.isPending ? (
				<div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3.5">
					{Array.from({ length: 3 }, (_, index) => (
						<Shimmer key={index} className="h-[260px] rounded-2xl" />
					))}
				</div>
			) : products.isError ? (
				<Panel>
					<ErrorState
						error={products.error}
						onRetry={() => products.refetch()}
					/>
				</Panel>
			) : list.length === 0 ? (
				<Panel>
					<EmptyState
						icon={<Package />}
						title="No products yet"
						action={
							<Button onClick={() => setEditing("new")}>
								Create a product
							</Button>
						}
					>
						A product is what a buyer pays for: a gem pack, a skin, a monthly
						plan. Its name and description appear on the Telegram invoice.
					</EmptyState>
				</Panel>
			) : (
				<div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3.5">
					{list.map((product) => (
						<ProductCard
							key={product.id}
							product={product}
							onEdit={() => setEditing(product)}
						/>
					))}
				</div>
			)}

			<ProductDialog editing={editing} onClose={() => setEditing(null)} />
		</>
	);
}

function ProductCard({
	product,
	onEdit,
}: {
	product: ProductObject;
	onEdit: () => void;
}) {
	return (
		<Panel className="flex flex-col">
			<div className="grid h-[120px] place-items-center bg-[repeating-linear-gradient(135deg,#EEF2F9_0_10px,#E6ECF6_10px_20px)] dark:bg-[repeating-linear-gradient(135deg,#131d31_0_10px,#162238_10px_20px)]">
				{product.photo_url ? (
					<img
						src={product.photo_url}
						alt=""
						className="h-full w-full object-cover"
					/>
				) : (
					<Mono className="text-[11px] text-faint">no photo</Mono>
				)}
			</div>
			<div className="flex flex-1 flex-col gap-2 px-4 py-3.5">
				<div className="flex items-start justify-between gap-2">
					<div className="font-bold text-[14.5px] tracking-[-0.01em]">
						{product.name}
					</div>
					<StatusPill status={product.status} />
				</div>
				<p className="text-pretty text-[12.5px] text-muted-foreground leading-relaxed">
					{product.description}
				</p>
				{product.lookup_key && (
					<Mono className="text-[11.5px] text-faint">{product.lookup_key}</Mono>
				)}
				<div className="mt-auto flex items-center justify-between border-border/70 border-t pt-2.5">
					<div className="font-extrabold text-[15px]">
						<Star /> {formatStars(product.price)}
					</div>
					<div className="flex items-center gap-1">
						<span className="rounded-full bg-muted px-2.5 py-1 font-semibold text-[#475467] text-[11.5px] dark:text-muted-foreground">
							{product.type === "subscription"
								? "Subscription · 30d"
								: "One-time"}
						</span>
						<Button variant="ghost" size="sm" onClick={onEdit}>
							Edit
						</Button>
					</div>
				</div>
			</div>
		</Panel>
	);
}

function ProductDialog({
	editing,
	onClose,
}: {
	editing: ProductObject | "new" | null;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const isNew = editing === "new";
	const product = editing !== "new" ? editing : null;
	const [error, setError] = useState<string | null>(null);

	const onSuccess = (message: string) => {
		toast.success(message);
		queryClient.invalidateQueries({ queryKey: orpc.products.key() });
		queryClient.invalidateQueries({ queryKey: orpc.onboarding.key() });
		onClose();
	};
	const create = useMutation(
		orpc.products.create.mutationOptions({
			onSuccess: () => onSuccess("Product created"),
		}),
	);
	const update = useMutation(
		orpc.products.update.mutationOptions({
			onSuccess: () => onSuccess("Product saved"),
		}),
	);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const text = (key: string) => String(form.get(key) ?? "").trim();
		const price = Number(text("price"));
		if (!Number.isInteger(price) || price < 1) {
			setError("Price must be a whole number of Stars, at least 1");
			return;
		}
		setError(null);
		const photo = text("photo_url");
		if (isNew) {
			create.mutate({
				name: text("name"),
				description: text("description"),
				price,
				type: text("type") === "subscription" ? "subscription" : "one_time",
				lookup_key: text("lookup_key") || undefined,
				photo_url: photo || undefined,
			});
		} else if (product) {
			update.mutate({
				id: product.id,
				name: text("name"),
				description: text("description"),
				price,
				photo_url: photo || null,
			});
		}
	}

	const archive = () =>
		product &&
		update.mutate({
			id: product.id,
			status: product.status === "active" ? "archived" : "active",
		});

	return (
		<Dialog
			open={editing !== null}
			onOpenChange={(open) => !open && onClose()}
			title={isNew ? "New product" : "Edit product"}
			description={
				isNew
					? "The name and description appear on the Telegram invoice."
					: "Price changes apply to new orders only."
			}
		>
			<form
				key={product?.id ?? "new"}
				onSubmit={onSubmit}
				className="flex flex-col gap-4"
			>
				<Field
					label="Name"
					htmlFor="name"
					hint="Up to 32 characters (Telegram's limit)"
				>
					<input
						id="name"
						name="name"
						required
						maxLength={32}
						defaultValue={product?.name}
						className={inputClass}
					/>
				</Field>
				<Field
					label="Description"
					htmlFor="description"
					hint="Up to 255 characters"
				>
					<textarea
						id="description"
						name="description"
						required
						maxLength={255}
						rows={3}
						defaultValue={product?.description}
						className={`${inputClass} resize-y`}
					/>
				</Field>
				<div className="grid gap-4 sm:grid-cols-2">
					<Field
						label="Price in Stars"
						htmlFor="price"
						error={error ?? undefined}
					>
						<input
							id="price"
							name="price"
							type="number"
							inputMode="numeric"
							min={1}
							max={100000}
							step={1}
							required
							defaultValue={product?.price}
							className={inputClass}
						/>
					</Field>
					<Field
						label="Type"
						htmlFor="type"
						hint={product ? "Can't change after creation" : undefined}
					>
						<select
							id="type"
							name="type"
							defaultValue={product?.type ?? "one_time"}
							disabled={!isNew}
							className={inputClass}
						>
							<option value="one_time">One-time</option>
							<option value="subscription">Subscription (30 days)</option>
						</select>
					</Field>
				</div>
				{isNew && (
					<Field
						label="Lookup key (optional)"
						htmlFor="lookup_key"
						hint="A stable name for your code, e.g. gems_500. Use it instead of the product ID."
					>
						<input
							id="lookup_key"
							name="lookup_key"
							pattern="[a-z0-9_.\-]{1,64}"
							placeholder="gems_500"
							className={`${inputClass} font-mono`}
						/>
					</Field>
				)}
				<Field
					label="Photo URL (optional)"
					htmlFor="photo_url"
					hint="Shown on the invoice in Telegram"
				>
					<input
						id="photo_url"
						name="photo_url"
						type="url"
						defaultValue={product?.photo_url ?? ""}
						placeholder="https://"
						className={inputClass}
					/>
				</Field>
				<div className="mt-2 flex flex-wrap items-center justify-between gap-2">
					{product ? (
						<Button
							variant={product.status === "active" ? "danger" : "secondary"}
							onClick={archive}
							disabled={update.isPending}
						>
							{product.status === "active" ? "Archive" : "Unarchive"}
						</Button>
					) : (
						<span />
					)}
					<div className="flex gap-2">
						<Button variant="secondary" onClick={onClose}>
							Cancel
						</Button>
						<Button
							type="submit"
							loading={create.isPending || update.isPending}
						>
							{isNew ? "Create product" : "Save"}
						</Button>
					</div>
				</div>
			</form>
		</Dialog>
	);
}
