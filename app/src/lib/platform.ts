const COARSE_QUERY = "(pointer: coarse), (hover: none)";
// Portrait-only: a landscape iPad should get the same layout as Mac, not the
// compact portrait-tablet treatment — keep this in sync with the equivalent
// @media rule in index.css.
const TABLET_QUERY = "(min-width: 768px) and (max-width: 1024px) and (orientation: portrait)";

export function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia(COARSE_QUERY).matches;
}

export function isTabletViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(TABLET_QUERY).matches;
}

/** Keeps document.body class list in sync with platform media queries; call once at boot. */
export function initPlatformBodyClasses(): () => void {
  const coarseMq = window.matchMedia(COARSE_QUERY);
  const tabletMq = window.matchMedia(TABLET_QUERY);
  const sync = () => {
    document.body.classList.toggle("coarse-pointer", coarseMq.matches);
    document.body.classList.toggle("tablet-viewport", tabletMq.matches);
  };
  sync();
  coarseMq.addEventListener("change", sync);
  tabletMq.addEventListener("change", sync);
  return () => {
    coarseMq.removeEventListener("change", sync);
    tabletMq.removeEventListener("change", sync);
  };
}
