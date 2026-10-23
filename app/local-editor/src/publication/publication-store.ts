import { createStore } from "zustand/vanilla";
import type { BuildJob } from "@unframe/unframe-cli/author-contract";
import type { PublicationAuth } from "../infra/host-api";
export type DisplayReceipt = { requestId: string; buildIdentity: string };
export type PublicationSnapshot = {
  auth: PublicationAuth | null;
  job: BuildJob | null;
  pending: boolean;
  error: string | null;
  receipt: DisplayReceipt | null;
  result: { buildId: string; publicationEpoch: number; requestId: string } | null;
};
export const createPublicationStore = () =>
  createStore<PublicationSnapshot>(() => ({
    auth: null,
    job: null,
    pending: false,
    error: null,
    receipt: null,
    result: null,
  }));
