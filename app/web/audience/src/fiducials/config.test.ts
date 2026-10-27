import { describe, expect, it } from "vitest";
import { parseBoardConfig, selectedTagProfile, configureTagBoard } from "./config";
import data from "../../public/poc-config.json";
describe("fiducial board contract", () => {
  it("uses one 15 cm marker at the venue origin", () => {
    const config = parseBoardConfig(data);
    expect(config.markers).toHaveLength(1);
    expect(config.markers[0]!.id).toBe(0);
    expect(config.markers[0]!.sizeMeters).toBe(0.15);
    expect(config.markers[0]!.venueFromMarker.position).toEqual({ x: 0, y: 0, z: 0 });
  });
  it("rejects multiple markers and non-metric sizes", () => {
    expect(() =>
      parseBoardConfig({ ...data, markers: [data.markers[0], data.markers[0]] }),
    ).toThrow();
    expect(() =>
      parseBoardConfig({ ...data, markers: [{ ...data.markers[0], sizeMeters: 0 }] }),
    ).toThrow();
  });
});

describe("large tag profiles", () => {
  it.each([22.5, 36, 50, 60, 70] as const)(
    "uses outer size %i cm and a 2/3 black boundary",
    (size) => {
      const profile = selectedTagProfile(`?size=${size}`);
      expect(profile.sizeCm).toBe(size);
      expect(profile.outerSizeMeters).toBe(size / 100);
      expect(profile.markerSizeMeters).toBeCloseTo(size / 150);
      const config = configureTagBoard(parseBoardConfig(data), profile);
      expect(config.markers).toHaveLength(1);
      expect(config.markers[0]!.id).toBe(0);
      expect(config.markers[0]!.sizeMeters).toBe(profile.markerSizeMeters);
      expect(config.boardId).toContain(String(size));
      expect(data.markers[0]!.sizeMeters).toBe(0.15);
    },
  );
  it("defaults to 22.5 cm and rejects malformed or repeated sizes", () => {
    expect(selectedTagProfile("").sizeCm).toBe(22.5);
    for (const query of ["?size=10", "?size=50.0", "?size=", "?size=50&size=70"])
      expect(() => selectedTagProfile(query)).toThrow();
  });
  it("requires registered ID 0", () => {
    expect(() =>
      configureTagBoard({ ...parseBoardConfig(data), markers: [] }, selectedTagProfile("")),
    ).toThrow();
  });
});
