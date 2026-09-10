import { isDatabaseConfigured } from "../db/client";
import {
  LocalJsonStatementRepository,
  PostgresStatementRepository,
  type StatementRepository,
} from "./repository";

export type { StatementRepository } from "./repository";
export { recordsFromParseResult } from "./fromParse";

let cached: StatementRepository | null = null;

/**
 * Resolve the active statement repository: Postgres when DATABASE_URL is set,
 * otherwise the local JSON fallback.
 */
export function getStatementRepository(): StatementRepository {
  if (cached) return cached;
  cached = isDatabaseConfigured()
    ? new PostgresStatementRepository()
    : new LocalJsonStatementRepository();
  return cached;
}
