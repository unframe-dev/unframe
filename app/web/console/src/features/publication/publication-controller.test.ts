// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createPublicationClient } from "@unframe/api-client-typescript/publication";
import { hashCanonicalJsonPayload } from "@unframe/artifacts";
import { createPublicationController } from "./publication-controller";
import { distFixture } from "./test-support/dist-fixture";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const publication = (
  manifest: ReturnType<typeof distFixture>["artifacts"]["buildManifest"],
  epoch: number,
) => {
  const payload = { ...manifest, publicationEpoch: epoch };
  return { ...payload, publicationManifestHash: hashCanonicalJsonPayload(payload) };
};

describe("Dist publication confirmation", () => {
  it("validates the selected Dist before requesting its target and publishes only once after confirmation", async () => {
    const fixture = distFixture();
    const requests: { path: string; method: string }[] = [];
    const client = createPublicationClient({
      baseUrl: "http://127.0.0.1:8787",
      credentials: "include",
      fetch: async (url, init) => {
        requests.push({ path: url.pathname, method: init.method ?? "GET" });
        if (init.method === "GET") return json({ error: { code: "not_found" } }, 404);
        if (url.pathname === "/presentations") return json({ id: "demo" }, 201);
        if (url.pathname.endsWith("/builds"))
          return json(
            { buildId: "build-1", assetIds: Object.keys(fixture.artifacts.assetSet.assets) },
            201,
          );
        if (init.method === "PUT") return new Response(null, { status: 204 });
        return json(publication(fixture.artifacts.buildManifest, 1), 201);
      },
    });
    const controller = createPublicationController(client);
    await controller.choose(fixture.files);
    expect(controller.getSnapshot().status).toBe("ready");
    expect(requests.every((request) => request.method === "GET")).toBe(true);

    await Promise.all([controller.publish(), controller.publish()]);

    expect(controller.getSnapshot()).toMatchObject({
      status: "published",
      result: { buildId: "build-1", publicationEpoch: 1 },
    });
    expect(requests.filter((request) => request.path.endsWith("/publications"))).toHaveLength(1);
  });

  it("makes no request when the selected files are incomplete", async () => {
    const requested: string[] = [];
    const client = createPublicationClient({
      baseUrl: "http://127.0.0.1:8787",
      credentials: "include",
      fetch: async (url) => {
        requested.push(url.pathname);
        throw new Error("Unexpected request");
      },
    });
    const controller = createPublicationController(client);

    await controller.choose(distFixture().files.slice(1));
    await controller.publish();

    expect(controller.getSnapshot().status).toBe("error");
    expect(requested).toEqual([]);
  });

  it("blocks resubmission after a lost publication response and resolves it by reading current publication", async () => {
    const fixture = distFixture();
    const completed = publication(fixture.artifacts.buildManifest, 1);
    let committed = false;
    let attempts = 0;
    const client = createPublicationClient({
      baseUrl: "http://127.0.0.1:8787",
      credentials: "include",
      fetch: async (url, init) => {
        if (init.method === "GET") {
          if (!committed) return json({ error: { code: "not_found" } }, 404);
          return url.pathname.endsWith("/publication")
            ? json(completed)
            : json({ id: "demo", name: "Contract fixture" });
        }
        if (url.pathname === "/presentations") return json({ id: "demo" }, 201);
        if (url.pathname.endsWith("/builds"))
          return json(
            { buildId: "build-1", assetIds: Object.keys(fixture.artifacts.assetSet.assets) },
            201,
          );
        if (init.method === "PUT") return new Response(null, { status: 204 });
        attempts++;
        committed = true;
        throw new TypeError("Lost response");
      },
    });
    const controller = createPublicationController(client);
    await controller.choose(fixture.files);
    await controller.publish();
    expect(controller.getSnapshot().status).toBe("uncertain");

    await controller.publish();
    await controller.choose(fixture.files);
    expect(attempts).toBe(1);
    expect(controller.getSnapshot().status).toBe("uncertain");

    await controller.recheck();
    expect(controller.getSnapshot()).toMatchObject({ status: "published", alreadyPublished: true });
    expect(attempts).toBe(1);
  });

  it("discards a superseded file selection while its target request completes", async () => {
    const fixture = distFixture();
    let release: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let waiting: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    const client = createPublicationClient({
      baseUrl: "http://127.0.0.1:8787",
      credentials: "include",
      fetch: async () => {
        waiting();
        return pending;
      },
    });
    const controller = createPublicationController(client);
    const first = controller.choose(fixture.files);
    await started;
    await controller.choose(fixture.files.slice(1));
    release(json({ error: { code: "not_found" } }, 404));
    await first;

    expect(controller.getSnapshot().status).toBe("error");
  });

  it.each([404, 503])(
    "keeps an unknown publication blocked when reconciliation returns HTTP %s",
    async (status) => {
      const fixture = distFixture();
      let attempts = 0;
      const controller = createPublicationController(
        createPublicationClient({
          baseUrl: "http://127.0.0.1:8787",
          credentials: "include",
          fetch: async (url, init) => {
            if (init.method === "GET")
              return json({ error: { code: "unavailable" } }, attempts ? status : 404);
            if (url.pathname === "/presentations") return json({ id: "demo" }, 201);
            if (url.pathname.endsWith("/builds"))
              return json(
                { buildId: "build-1", assetIds: Object.keys(fixture.artifacts.assetSet.assets) },
                201,
              );
            if (init.method === "PUT") return new Response(null, { status: 204 });
            attempts++;
            throw new TypeError("Lost response");
          },
        }),
      );
      await controller.choose(fixture.files);
      await controller.publish();
      await controller.recheck();

      expect(controller.getSnapshot().status).toBe("uncertain");
      await controller.choose(fixture.files);
      await controller.publish();
      expect(attempts).toBe(1);
    },
  );
});
