import { Link } from "@tanstack/react-router";
import { BrandMark } from "./brand-mark";

export function BrandLink({ application = false }: { application?: boolean }) {
  const content = (
    <>
      <BrandMark size={34} />
      <span>Unframe</span>
    </>
  );

  return application ? (
    <Link to="/home" className="brand-link" aria-label="Unframe home">
      {content}
    </Link>
  ) : (
    <a href="/" className="brand-link" aria-label="Unframe home">
      {content}
    </a>
  );
}
