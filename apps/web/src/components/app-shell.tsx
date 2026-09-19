import { Menu } from "@base-ui/react/menu";
import { cn } from "@starpay/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, useMatches, useNavigate } from "@tanstack/react-router";
import { ChevronsUpDown, LogOut, Menu as MenuIcon, Monitor, Moon, Sun } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Avatar, Drawer } from "@/components/kit";
import { Logo } from "@/components/logo";
import { useTheme } from "@/components/theme-provider";
import { authClient } from "@/lib/auth-client";
import { initials, timeAgo } from "@/lib/format";
import { orpc, setMode, useMode } from "@/utils/orpc";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    title?: string;
    subtitle?: string;
  }
}

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/payments", label: "Payments" },
  { to: "/products", label: "Products" },
  { to: "/subscriptions", label: "Subscriptions" },
  { to: "/customers", label: "Customers" },
  { to: "/webhooks", label: "Webhooks" },
  { to: "/bot", label: "Bot & API" },
  { to: "/balance", label: "Balance" },
  { to: "/settings", label: "Settings" },
] as const;

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const mode = useMode();
  const { data: organization } = authClient.useActiveOrganization();
  const bot = useQuery(orpc.bot.get.queryOptions());

  return (
    <div className="flex h-full flex-col gap-[22px] px-4 py-[22px]">
      <Logo className="px-1.5" />

      <div role="radiogroup" aria-label="Mode" className="flex gap-1 rounded-[10px] bg-muted p-1">
        {(["live", "test"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              "flex-1 cursor-pointer rounded-[7px] py-1.5 text-[12.5px] font-bold capitalize transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              mode !== value && "text-[#6B7C99] hover:text-foreground dark:text-muted-foreground",
              mode === value && value === "live" && "bg-brand text-white",
              mode === value && value === "test" && "bg-test text-test-foreground",
            )}
          >
            {value}
          </button>
        ))}
      </div>

      <nav aria-label="Main" className="flex flex-col gap-0.5">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            activeOptions={{ exact: item.to === "/" }}
            className="group flex items-center gap-2.5 rounded-[9px] px-[11px] py-[9px] text-[13.5px] font-medium text-[#59677E] transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 data-[status=active]:bg-brand-soft data-[status=active]:font-bold data-[status=active]:text-brand-strong dark:text-muted-foreground"
          >
            <span className="size-[5px] shrink-0 rounded-full bg-[#D5DDE9] group-data-[status=active]:bg-brand dark:bg-[#2a3a57]" />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-auto border-t border-border pt-3.5">
        <AccountMenu
          organizationName={organization?.name ?? "…"}
          botUsername={bot.data ? `@${bot.data.username}` : "no bot connected"}
        />
      </div>
    </div>
  );
}

function AccountMenu({ organizationName, botUsername }: { organizationName: string; botUsername: string }) {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { data: session } = authClient.useSession();
  const itemClass =
    "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] outline-none data-[highlighted]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground";

  return (
    <Menu.Root>
      <Menu.Trigger className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg p-1 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50">
        <Avatar text={initials(organizationName)} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">{organizationName}</div>
          <div className="truncate font-mono text-[11px] text-faint">{botUsername}</div>
        </div>
        <ChevronsUpDown className="size-4 text-faint" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={8} className="z-50">
          <Menu.Popup className="w-56 rounded-xl border border-border bg-popover p-1.5 shadow-xl outline-none">
            <div className="px-2.5 py-2">
              <div className="truncate text-[13px] font-semibold">{session?.user.name}</div>
              <div className="truncate text-[12px] text-muted-foreground">{session?.user.email}</div>
            </div>
            <Menu.Separator className="my-1 h-px bg-border" />
            {(
              [
                ["light", "Light", Sun],
                ["dark", "Dark", Moon],
                ["system", "System", Monitor],
              ] as const
            ).map(([value, label, Icon]) => (
              <Menu.Item key={value} className={itemClass} onClick={() => setTheme(value)}>
                <Icon />
                {label}
                {theme === value && <span className="ml-auto text-[11px] text-brand">●</span>}
              </Menu.Item>
            ))}
            <Menu.Separator className="my-1 h-px bg-border" />
            <Menu.Item
              className={itemClass}
              onClick={async () => {
                await authClient.signOut();
                navigate({ to: "/login" });
              }}
            >
              <LogOut />
              Sign out
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function BotStatus() {
  const bot = useQuery({ ...orpc.bot.get.queryOptions(), refetchInterval: 30_000 });
  if (bot.isPending || bot.isError) return null;

  const view = bot.data;
  const state: { tone: string; dot: string; text: string } = !view
    ? {
        tone: "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708] dark:border-[#5c4508] dark:bg-[#3a2a06] dark:text-[#fdb022]",
        dot: "bg-[#F79009]",
        text: "No bot connected",
      }
    : view.status === "active"
      ? {
          tone: "border-brand-line bg-brand-soft text-brand-strong",
          dot: "bg-[#12B76A]",
          text: `Bot online · last update ${timeAgo(view.last_update_at)}`,
        }
      : {
          tone: "border-[#FDA29B] bg-[#FEF3F2] text-[#B42318] dark:border-[#7a2a24] dark:bg-[#2a1215] dark:text-[#f97066]",
          dot: "bg-[#F04438]",
          text: view.status === "invalid_token" ? "Bot token rejected" : "Bot webhook failing",
        };

  return (
    <Link
      to="/bot"
      className={cn(
        "flex items-center gap-2 rounded-full border px-3 py-[7px] text-[12.5px] font-semibold whitespace-nowrap",
        state.tone,
      )}
    >
      <span className={cn("size-[7px] rounded-full", state.dot)} />
      {state.text}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const mode = useMode();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const matches = useMatches();
  const page = [...matches].reverse().find((match) => match.staticData?.title)?.staticData;

  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      <aside className="hidden border-r border-border bg-sidebar lg:block">
        <div className="sticky top-0 h-svh">
          <Sidebar />
        </div>
      </aside>
      <Drawer open={mobileNavOpen} onOpenChange={setMobileNavOpen} side="left" title="Navigation">
        <Sidebar onNavigate={() => setMobileNavOpen(false)} />
      </Drawer>

      <main className="flex min-w-0 flex-col">
        {mode === "test" && (
          <div className="bg-test px-4 py-1.5 text-center text-[12.5px] font-semibold text-test-foreground sm:px-7">
            Test mode · Telegram test server. Payments here aren't real.
          </div>
        )}
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-4 border-b border-border bg-background/90 px-4 py-4 backdrop-blur sm:px-7">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setMobileNavOpen(true)}
            className="-ml-1 cursor-pointer rounded-lg p-1.5 hover:bg-muted lg:hidden"
          >
            <MenuIcon className="size-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold tracking-[-0.02em]">{page?.title}</h1>
            {page?.subtitle && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{page.subtitle}</p>}
          </div>
          <div className="min-w-3 flex-1" />
          <BotStatus />
        </header>
        <div className="flex flex-col gap-5 px-4 pt-6 pb-14 sm:px-7">{children}</div>
      </main>
    </div>
  );
}
