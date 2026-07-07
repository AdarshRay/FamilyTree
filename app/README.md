# THE RAY'S — Interactive Family Tree

A premium, JARVIS-style interactive family tree of the **House of Samarsingh**,
built with **React 19 + TypeScript + Vite 6 + Tailwind v4**.

Deep-obsidian dark UI, arc-reactor cyan/magenta glow, glassmorphism, and a
zoomable / pannable canvas with per-member "dossier" panels.

## Run it

You need Node (already installed via nvm on this machine). From this `app/` folder:

```bash
npm install      # first time only
npm run dev      # start the dev server → http://localhost:5173
```

Other scripts:

```bash
npm run build    # type-check + production build into dist/
npm run preview  # serve the production build locally
```

> Note: this project lives in the `app/` subfolder. The standalone,
> zero-install `index.html` in the parent folder is a separate CDN-based
> version you can open by double-clicking — handy when you don't want a build.

## How it works

```
app/
├─ public/photos/            # the family photos (copied from "Family Tree Photos")
└─ src/
   ├─ data/family.ts         # the tree + exact photo-file mapping  ← edit here
   ├─ lib/layout.ts          # tidy-tree layout engine (positions + SVG connectors)
   ├─ components/
   │  ├─ PersonCard.tsx      # a glowing lineage node
   │  ├─ Edges.tsx           # marriage links + parent→child buses
   │  ├─ DetailPanel.tsx     # sliding dossier for the selected person
   │  ├─ Avatar.tsx          # photo with initials fallback
   │  └─ Particles.tsx       # ambient background motes
   ├─ App.tsx                # pan / zoom / search / selection
   └─ index.css              # the full JARVIS design system
```

### Editing the family

Open `src/data/family.ts`. Each node is `{ person, spouse?, children? }`.
A person is `P("Name", "m" | "f", "Optional Photo File.jpg")`.

### Adding / changing a photo

1. Drop the image in `public/photos/`.
2. Set that person's third `P(...)` argument to the **exact file name**
   (including extension), e.g. `P("Rohan Ray", "m", "Rohan Ray.png")`.

Anyone without a photo automatically shows a glowing initials monogram.

The app also tries same-name photo files automatically. If a person is named
`Adarsh Ray`, a file named `public/photos/Adarsh Ray.jpg`,
`Adarsh Ray.jpeg`, `Adarsh Ray.png`, or `Adarsh Ray.webp` will appear without
editing `family.ts`.

In local development, uploading a photo through **Edit Mode** also writes a
compressed `Person Name.jpg` file into `public/photos/` and saves that filename
in the edit data. On a live static host, browsers cannot write files into your
project folder; use the UI upload for browser-saved edits, or add a backend
storage service if you want permanent live uploads later.

## Controls

- **Drag** empty space to pan · **scroll** to zoom toward the cursor
- **Click a node** to open its dossier (spouse, parents, children — all clickable)
- **Search** (bottom-left) to filter + fly to any member
- **+ / − / FIT** buttons (bottom-right)
