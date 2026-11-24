/**
 * P6: the links every page ends with: privacy, terms and how to reach the team, in the reader's language. Spaced and
 * sized as targets of their own (44 px tall), so a finger finds each.
 */
import "./site-foot.css";

export function SiteFoot({ lang }: { lang: "en" | "zh" }) {
  const zh = lang === "zh";
  return (
    <nav className="site-foot" aria-label={zh ? "关于灵犀" : "About Lingxi"}>
      <a href="privacy.html">{zh ? "隐私" : "Privacy"}</a>
      <a href="terms.html">{zh ? "条款" : "Terms"}</a>
      <a href="https://github.com/Pratiikpy/lingxi/issues" rel="noopener noreferrer">
        {zh ? "联系我们" : "Contact"}
      </a>
    </nav>
  );
}
