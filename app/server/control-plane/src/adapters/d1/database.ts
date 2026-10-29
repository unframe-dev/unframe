import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema";

export const createD1Database = (database: D1Database) => drizzle(database, { schema });
