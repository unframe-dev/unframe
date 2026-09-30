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
    <Link aria-label="Unframe home" className={`${styles.link} ${className ?? ""}`} to="/home">
      {content}
    </Link>
  ) : (
    <a aria-label="Unframe home" className={`${styles.link} ${className ?? ""}`} href="/">
      {content}
    </a>
  );
}
