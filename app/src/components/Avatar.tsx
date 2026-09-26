import { useEffect, useState } from "react";
import { PHOTO_DIR, photoURL, initials, type Person } from "../data/family";
import { supabaseClient } from "../lib/supabase";

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic, on-theme "constellation" monogram for photoless people. */
function Fallback({ person }: { person: Person }) {
  const h = hashStr(person.name);
  const base = person.gender === "f" ? 322 : 190; // magenta vs cyan
  const hue = base + ((h % 44) - 22);
  const ax = 24 + (h % 52);
  const ay = 18 + ((h >> 3) % 42);
  const bg =
    `radial-gradient(circle at ${ax}% ${ay}%, hsla(${hue}, 92%, 58%, 0.32), transparent 62%),` +
    `linear-gradient(150deg, rgba(10, 20, 30, 0.92), rgba(4, 8, 14, 0.96))`;

  const dots = Array.from({ length: 4 }, (_, i) => {
    const hh = (h >> (i * 5)) & 0xff;
    return {
      cx: 14 + (hh % 72),
      cy: 12 + ((hh * 7) % 76),
      r: 0.7 + (hh % 3) * 0.5,
    };
  });

  return (
    <div className="avatar-fallback rich" style={{ background: bg }}>
      <svg className="af-const" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={dots.map((d) => `${d.cx},${d.cy}`).join(" ")} />
        {dots.map((d, i) => (
          <circle key={i} cx={d.cx} cy={d.cy} r={d.r} />
        ))}
      </svg>
      <span className="af-initials">{initials(person.name)}</span>
    </div>
  );
}

const sameNamePhotoCandidates = (person: Person): string[] =>
  ["jpg", "jpeg", "png", "webp"].map((ext) => `${PHOTO_DIR}/${encodeURIComponent(person.name)}.${ext}`);

/**
 * Photo with graceful fallback to a deterministic constellation monogram.
 * `photoData` takes precedence, then an explicit file, then same-name files
 * such as a legacy local `/photos/example.jpg` path.
 */
export function Avatar({
  person,
  photoFile,
  photoData,
  photoStoragePath,
  photoX = 50,
  photoY = 50,
  photoZoom = 1,
}: {
  person: Person;
  photoFile?: string;
  photoData?: string;
  photoStoragePath?: string;
  photoX?: number;
  photoY?: number;
  photoZoom?: number;
}) {
  const [storageUrl, setStorageUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setStorageUrl(null);
    if (!photoStoragePath) return () => { active = false; };
    const client = supabaseClient();
    if (!client) return () => { active = false; };
    void client.storage.from("family-tree-photos").createSignedUrl(photoStoragePath, 3600).then(({ data }) => {
      if (active) setStorageUrl(data?.signedUrl ?? null);
    });
    return () => { active = false; };
  }, [photoStoragePath]);
  const overridePhotoURL = photoFile ? `${PHOTO_DIR}/${encodeURIComponent(photoFile)}` : null;
  const fileCandidates = photoData
    ? [photoData]
    : [storageUrl, overridePhotoURL, photoURL(person), ...sameNamePhotoCandidates(person)].filter(
        (src): src is string => Boolean(src),
      );
  const [srcIndex, setSrcIndex] = useState(0);
  const src = fileCandidates[srcIndex];

  useEffect(() => setSrcIndex(0), [person.name, person.photo, photoFile, photoData, photoStoragePath, storageUrl]);

  if (src) {
    return (
      <img
        src={src}
        alt={person.name}
        loading="lazy"
        decoding="async"
        draggable={false}
        style={{
          objectPosition: `${photoX}% ${photoY}%`,
          transform: `scale(${photoZoom})`,
          transformOrigin: `${photoX}% ${photoY}%`,
        }}
        onError={() => setSrcIndex((index) => index + 1)}
      />
    );
  }
  return <Fallback person={person} />;
}
