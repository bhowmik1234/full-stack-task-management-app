// Must load before the adapter reads DATABASE_URL below. ESM evaluates imported
// modules before the importing module's body, so app.ts's own config() call
// runs too late for this file — it has to load dotenv itself.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/index.js";

// Single client for the process — Prisma manages its own connection pool, so
// creating more than one would multiply pools against the same database.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });

export const connectdb = async () => {
  try {
    await prisma.$connect();
    console.log("Database connected (postgres)");
  } catch (e) {
    console.log(e);
    process.exit(1);
  }
};
