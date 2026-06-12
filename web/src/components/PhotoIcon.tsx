// Photos nav icon: a camera (unmistakably "photos") whose lens is a leaf
// (the Dayleaf theme). Strokes use currentColor so it tints with the nav
// state — dim when inactive, accent green when active — like the other icons.
export default function PhotoIcon() {
  return (
    <svg
      className="photo-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* camera body */}
      <rect x="2.4" y="7" width="19.2" height="13" rx="3.4" />
      {/* viewfinder hump on top */}
      <path d="M8.6 7l1.1-2.1a1 1 0 0 1 .9-.5h2.8a1 1 0 0 1 .9.5L16.4 7" />
      {/* leaf lens */}
      <path d="M12 9.5c3.1 1.6 3.1 5.4 0 7.2c-3.1-1.8-3.1-5.6 0-7.2Z" />
      {/* leaf vein */}
      <path d="M12 10.6v5.2" />
    </svg>
  );
}
