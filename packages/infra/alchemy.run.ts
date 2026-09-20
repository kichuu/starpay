import * as Alchemy from "alchemy";
import * as Command from "alchemy/Command";
import * as Output from "alchemy/Output";
import * as Prisma from "alchemy/Prisma";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import "varlock/auto-load";

export const prismaProject = Prisma.Project("project", {
  createDatabase: false,
  region: "us-east-1",
});

const managedDatabase = Effect.gen(function* () {
  const project = yield* prismaProject;
  const database = yield* Prisma.Postgres("database", { project });
  const connection = yield* Prisma.Connection("database-connection", { database });
  const runtimeUrl = Output.all(connection.directConnectionString, connection.databaseUrl).pipe(
    Output.map(([directUrl, fallbackUrl]) => {
      const url = directUrl ?? fallbackUrl;
      if (!url) {
        throw new Error("Prisma did not return a database connection URL");
      }
      return url;
    }),
  );
  const migrationUrl = runtimeUrl;

  yield* Command.Exec("database-migrations", {
    command: "pnpm run db:migrate:deploy",
    cwd: "../../packages/db",
    env: { MIGRATE_DATABASE_URL: migrationUrl },
    memo: {
      include: ["prisma/migrations/**", "prisma/schema/**"],
    },
  });

  return {
    runtimeEnv: { DATABASE_URL: runtimeUrl },
  };
});

export const databaseEnv = managedDatabase.pipe(Effect.map(({ runtimeEnv }) => runtimeEnv));

export const databaseBindings = {
  DATABASE_URL: databaseEnv.pipe(Effect.map(({ DATABASE_URL }) => DATABASE_URL)),
};

export const databaseProviders = Layer.mergeAll(Command.providers(), Prisma.providers());

/** Includes an environment variable only when it has a value. */
function optionalEnv(name: string, options: { secret?: boolean } = {}) {
  const value = process.env[name]?.trim();
  if (!value) return {};
  return { [name]: options.secret ? Redacted.make(value) : value };
}

export const server = Prisma.Compute(
  "server",
  Effect.gen(function* () {
    const project = yield* prismaProject;
    const resolvedDatabaseEnv = yield* databaseEnv;

    return {
      project,
      path: "../../apps/server",
      build: {
        type: "auto",
        framework: "bun",
      },
      entrypoint: "src/index.ts",
      port: 3000,
      env: {
        ...resolvedDatabaseEnv,
        CORS_ORIGIN: Config.String("CORS_ORIGIN"),
        BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
        BETTER_AUTH_URL: Config.String("BETTER_AUTH_URL"),
        ENCRYPTION_KEY: Config.Redacted("ENCRYPTION_KEY"),
        // The server's public HTTPS URL (your api.* domain); Telegram posts bot updates here.
        PUBLIC_API_URL: Config.String("PUBLIC_API_URL"),
        WORKER_ENABLED: Config.String("WORKER_ENABLED").pipe(Config.withDefault("true")),
        STAR_USD_RATE: Config.String("STAR_USD_RATE").pipe(Config.withDefault("0.013")),
        // Prisma Compute rejects empty values, so unset optional vars are left out.
        ...optionalEnv("PLATFORM_ADMIN_USER_IDS"),
        ...optionalEnv("TONCENTER_API_KEY", { secret: true }),
        // Hot-wallet mnemonics: unset = payouts are processed by hand from the admin page.
        ...optionalEnv("TON_PAYOUT_MNEMONIC_LIVE", { secret: true }),
        ...optionalEnv("TON_PAYOUT_MNEMONIC_TEST", { secret: true }),
      },
      healthCheck: { path: "/" },
      destroyOldDeployment: true,
      dev: {
        command: "pnpm run dev:bare",
        port: 3000,
      },
    };
  }),
);

export const web = Prisma.Compute(
  "web",
  Effect.gen(function* () {
    const project = yield* prismaProject;
    const deployedServer = yield* server;

    const webEnv = {
      ...(process.env._VARLOCK_ENV_KEY
        ? { _VARLOCK_ENV_KEY: Redacted.make(process.env._VARLOCK_ENV_KEY) }
        : {}),
      VITE_SERVER_URL: deployedServer.url,
    };

    return {
      project,
      path: "../../apps/web",
      build: { type: "auto", framework: "vite", env: webEnv },
      env: webEnv,
      healthCheck: { path: "/" },
      destroyOldDeployment: true,
      dev: {
        command: "pnpm run dev:bare",
        port: 3001,
        env: webEnv,
      },
    };
  }),
);

export default Alchemy.Stack(
  "starpay",
  {
    providers: databaseProviders,
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const serverWorker = yield* server;
    const webWorker = yield* web;

    return {
      web: webWorker.url,
      server: serverWorker.url,
    };
  }),
);
