// The IEMprove mark: three rising bars with leaf-shaped corners, and the wordmark with IEM highlighted.
export function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <svg viewBox="14 14 36 36" width="22" height="22">
        <path className="bar b1" opacity=".45" d="M16.5 36H19A5 5 0 0 1 24 41V47.5A2.5 2.5 0 0 1 21.5 50H19A5 5 0 0 1 14 45V38.5A2.5 2.5 0 0 1 16.5 36Z" />
        <path className="bar b2" opacity=".72" d="M29.5 26H32A5 5 0 0 1 37 31V47.5A2.5 2.5 0 0 1 34.5 50H32A5 5 0 0 1 27 45V28.5A2.5 2.5 0 0 1 29.5 26Z" />
        <path className="bar b3" d="M42.5 14H45A5 5 0 0 1 50 19V47.5A2.5 2.5 0 0 1 47.5 50H45A5 5 0 0 1 40 45V16.5A2.5 2.5 0 0 1 42.5 14Z" />
      </svg>
    </div>
  );
}

export function BrandName() {
  return <span className="brand-name" dir="ltr"><span className="brand-iem">IEM</span>prove</span>;
}
