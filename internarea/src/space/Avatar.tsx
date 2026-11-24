import React from "react";

// Profile photo, or the first letter of the name when there is none.
export default function Avatar({ name, photo, size = 40 }: { name?: string | null; photo?: string | null; size?: number }) {
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photo} alt="" width={size} height={size} referrerPolicy="no-referrer" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {(name || "?").trim().charAt(0).toUpperCase()}
    </span>
  );
}
