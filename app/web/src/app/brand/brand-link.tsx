import { Link } from "@tanstack/react-router";
import { BrandMark } from "./brand-mark";
import moduleStyles from "./brand-link.module.css";
const styles = { link: moduleStyles["link"]! };

export function BrandLink({
  application = false,
  className,
}: {
  application?: boolean;
  className?: string | undefined;
}) {
  const content = (
    <>
      <BrandMark size={34} />
      <span>Unframe</span>
    </>
  );

  return application ? (
    <Link to="/home" className={`${styles.link} ${className ?? ""}`} aria-label="Unframe home">
      {content}
    </Link>
  ) : (
    <a href="/" className={`${styles.link} ${className ?? ""}`} aria-label="Unframe home">
      {content}
    </a>
  );
}
