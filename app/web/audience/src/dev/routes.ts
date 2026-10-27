export function isFixtureRoute(development: boolean, search: string): boolean {
  const query = new URLSearchParams(search);
  return development && query.getAll("fixture").length === 1 && query.get("fixture") === "1";
}

export function isTrackingRoute(development: boolean, search: string): boolean {
  const query = new URLSearchParams(search);
  return development && query.getAll("tracking").length === 1 && query.get("tracking") === "1";
}
