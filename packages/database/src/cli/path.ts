import { resolve } from "node:path";

export function getDatabasePath(): string {
  const configured =
    process.env.DATABASE_URL ?? "./.data/dev-learning-harness.sqlite";
  const path = configured.startsWith("file:")
    ? configured.slice("file:".length)
    : configured;
  return path === ":memory:" ? path : resolve(process.cwd(), path);
}
