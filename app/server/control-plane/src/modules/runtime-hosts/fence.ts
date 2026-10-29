import { sql } from "drizzle-orm";
import { runtimeAssignments } from "../../adapters/d1/schema";

export const currentHostGeneration = sql`(${runtimeAssignments.runtimeKind} != 'Cloud' OR EXISTS (
  SELECT 1 FROM runtime_hosts AS host WHERE host.runtime_id = ${runtimeAssignments.runtimeId}
    AND host.generation = ${runtimeAssignments.hostGeneration} AND host.endpoint = ${runtimeAssignments.endpoint}
))`;
