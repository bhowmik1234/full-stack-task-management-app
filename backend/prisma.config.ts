import "dotenv/config";
import { defineConfig } from "prisma/config";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 no longer reads the connection URL from schema.prisma; the CLI
// (migrate, studio, db push) gets it from here.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL!,
  },
  adapter: () =>
    Promise.resolve(
      new PrismaPg({ connectionString: process.env.DATABASE_URL })
    ),
});
