interface Person {
  name: string;
  gender?: "m" | "f";
  photo?: string | null;
  dob?: string;
  birthplace?: string;
  occupation?: string;
  notes?: string;
}

interface FamilyNode {
  person: Person;
  spouses?: Person[];
  children?: FamilyNode[];
}

interface AddedPerson { name: string; gender?: "m" | "f" }

interface TreeSnapshot {
  overrides?: Record<string, Partial<Person> & { photoFile?: string; photoStoragePath?: string; photoX?: number; photoY?: number; photoZoom?: number; birthOrder?: number }>;
  structure?: {
    childrenOf?: Record<string, Array<{ person: AddedPerson; spouse?: AddedPerson }>>;
    spouseOf?: Record<string, AddedPerson[]>;
    parentsOf?: Record<string, AddedPerson>;
    removed?: string[];
    renames?: Record<string, string>;
  };
}

interface TreePayload { id: string; name: string; root: FamilyNode; snapshot: TreeSnapshot; publishedAt: string }
interface PublishedPerson extends Person { originalName: string; photoPath?: string; photoX: number; photoY: number; photoZoom: number }
interface PublishedNode { person: PublishedPerson; spouses: PublishedPerson[]; children: PublishedNode[] }
export interface PhotoAsset { storagePath: string; publishedPath: string }

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function safeFileName(value: string): string {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "photo";
}

function photoExtension(path: string): string {
  const match = path.match(/\.(jpe?g|png|webp)$/i);
  return match?.[1]?.toLowerCase().replace("jpeg", "jpg") ?? "jpg";
}

function createPublishedTree(payload: TreePayload): PublishedNode {
  const structure = payload.snapshot?.structure ?? {};
  const overrides = payload.snapshot?.overrides ?? {};
  const removed = new Set(structure.removed ?? []);
  const renames = structure.renames ?? {};
  const resolveName = (name: string) => renames[name] ?? name;

  const publishPerson = (person: Person): PublishedPerson => {
    const originalName = person.name;
    const resolvedName = resolveName(originalName);
    const override = overrides[originalName] ?? overrides[resolvedName] ?? {};
    const storagePath = override.photoStoragePath ?? (override.photoFile || person.photo ? `${payload.id}/seed/${override.photoFile ?? person.photo}` : undefined);
    return {
      ...person,
      ...override,
      originalName,
      name: override.name ?? resolvedName,
      photoPath: storagePath ? `photos/${safeFileName(override.name ?? resolvedName)}.${photoExtension(storagePath)}` : undefined,
      photoX: override.photoX ?? 50,
      photoY: override.photoY ?? 50,
      photoZoom: override.photoZoom ?? 1,
    };
  };

  const extraSpouses = (name: string): Person[] => [
    ...(structure.spouseOf?.[name] ?? []),
    ...(resolveName(name) !== name ? structure.spouseOf?.[resolveName(name)] ?? [] : []),
  ].filter((person) => !removed.has(person.name) && !removed.has(resolveName(person.name)));

  const walk = (node: FamilyNode): PublishedNode => {
    const rawName = node.person.name;
    const spouses = [...(node.spouses ?? []), ...extraSpouses(rawName)]
      .filter((person) => !removed.has(person.name) && !removed.has(resolveName(person.name)))
      .map(publishPerson);
    const nativeChildren = (node.children ?? [])
      .filter((child) => !removed.has(child.person.name) && !removed.has(resolveName(child.person.name)))
      .map((child, index) => ({ node: walk(child), index, order: overrides[child.person.name]?.birthOrder }));
    const addedChildren = [
      ...(structure.childrenOf?.[rawName] ?? []),
      ...(resolveName(rawName) !== rawName ? structure.childrenOf?.[resolveName(rawName)] ?? [] : []),
    ]
      .filter((child) => !removed.has(child.person.name) && !removed.has(resolveName(child.person.name)))
      .map((child, index) => ({ node: walk({ person: child.person, spouses: child.spouse ? [child.spouse] : undefined }), index: nativeChildren.length + index, order: overrides[child.person.name]?.birthOrder }));
    const children = [...nativeChildren, ...addedChildren]
      .sort((a, b) => {
        const ao = Number.isFinite(a.order) ? Number(a.order) : Number.MAX_SAFE_INTEGER;
        const bo = Number.isFinite(b.order) ? Number(b.order) : Number.MAX_SAFE_INTEGER;
        return ao === bo ? a.index - b.index : ao - bo;
      })
      .map((entry) => entry.node);
    return { person: publishPerson(node.person), spouses, children };
  };

  let root = payload.root;
  const seen = new Set([root.person.name]);
  while (true) {
    const parent = structure.parentsOf?.[root.person.name] ?? structure.parentsOf?.[resolveName(root.person.name)];
    if (!parent || seen.has(parent.name) || removed.has(parent.name)) break;
    seen.add(parent.name);
    root = { person: parent, children: [root] };
  }
  return walk(root);
}

function personCard(person: PublishedPerson, relationship: string): string {
  const initials = person.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const image = person.photoPath
    ? `<img src="${escapeHtml(person.photoPath)}" alt="" loading="lazy" style="object-position:${person.photoX}% ${person.photoY}%;transform:scale(${person.photoZoom})" />`
    : `<span class="initials" aria-hidden="true">${escapeHtml(initials)}</span>`;
  const details = [person.dob ? `<span>Born ${escapeHtml(person.dob)}</span>` : "", person.birthplace ? `<span>${escapeHtml(person.birthplace)}</span>` : "", person.occupation ? `<span>${escapeHtml(person.occupation)}</span>` : ""].filter(Boolean).join("");
  const search = [person.name, person.dob, person.birthplace, person.occupation, person.notes].filter(Boolean).join(" ").toLowerCase();
  return `<article class="person" data-search="${escapeHtml(search)}" tabindex="0"><div class="avatar">${image}</div><div class="person-copy"><small>${escapeHtml(relationship)}</small><strong>${escapeHtml(person.name)}</strong>${details ? `<div class="details">${details}</div>` : ""}${person.notes ? `<p>${escapeHtml(person.notes)}</p>` : ""}</div></article>`;
}

function renderNode(node: PublishedNode, generation: number): string {
  const people = [personCard(node.person, generation === 1 ? "Founder" : `Generation ${generation}`), ...node.spouses.map((spouse) => personCard(spouse, "Spouse"))].join("");
  const children = node.children.length ? `<div class="children">${node.children.map((child) => renderNode(child, generation + 1)).join("")}</div>` : "";
  return `<section class="branch"><div class="union">${people}</div>${children}</section>`;
}

export function collectPhotoAssets(payload: TreePayload): PhotoAsset[] {
  const root = createPublishedTree(payload);
  const assets = new Map<string, string>();
  const add = (person: PublishedPerson) => {
    const override = payload.snapshot?.overrides?.[person.originalName] ?? payload.snapshot?.overrides?.[person.name] ?? {};
    const storagePath = override.photoStoragePath ?? (override.photoFile || person.photo ? `${payload.id}/seed/${override.photoFile ?? person.photo}` : undefined);
    if (storagePath && person.photoPath) assets.set(storagePath, person.photoPath);
  };
  const visit = (node: PublishedNode) => { add(node.person); node.spouses.forEach(add); node.children.forEach(visit); };
  visit(root);
  return [...assets].map(([storagePath, publishedPath]) => ({ storagePath, publishedPath }));
}

export function generateTreeJson(payload: TreePayload): string { return JSON.stringify(payload, null, 2); }

export function generateIndexHtml(payload: TreePayload): string {
  const tree = createPublishedTree(payload);
  const publishedDate = new Date(payload.publishedAt).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="description" content="The ${escapeHtml(payload.name)} family tree"/><title>${escapeHtml(payload.name)}</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--cyan:#76efff;--line:rgba(118,239,255,.22);--panel:rgba(9,20,31,.92)}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 24% 5%,#17344a 0,transparent 30%),#05070d;color:#eafcff}main{width:min(1500px,calc(100vw - 28px));margin:auto;padding:42px 0 72px}header{text-align:center;margin-bottom:28px}h1{margin:0;font-size:clamp(30px,6vw,68px);letter-spacing:.07em;text-transform:uppercase}.meta{margin-top:10px;color:rgba(234,252,255,.62);font-size:12px;letter-spacing:.08em;text-transform:uppercase}.toolbar{position:sticky;top:10px;z-index:3;width:min(520px,100%);margin:20px auto 28px}.toolbar input{width:100%;padding:13px 16px;border:1px solid var(--line);border-radius:999px;background:rgba(5,12,20,.95);color:#fff;font:inherit;box-shadow:0 12px 35px #0008}.toolbar input:focus{outline:2px solid var(--cyan);outline-offset:2px}#tree{overflow:auto;padding:26px 16px 46px;border:1px solid var(--line);border-radius:18px;background:rgba(4,10,16,.68)}.branch{display:flex;flex-direction:column;align-items:center;min-width:max-content;position:relative}.union{display:flex;gap:10px;justify-content:center}.children{display:flex;gap:28px;align-items:flex-start;padding-top:45px;position:relative}.children:before{content:"";position:absolute;top:22px;left:8%;right:8%;border-top:1px solid var(--line)}.children>.branch:before{content:"";height:23px;border-left:1px solid var(--line);position:absolute;top:-23px}.person{display:flex;width:220px;min-height:96px;padding:10px;gap:11px;border:1px solid var(--line);border-radius:13px;background:var(--panel);box-shadow:0 8px 25px #0007;transition:.18s}.person:focus,.person:hover{border-color:var(--cyan);transform:translateY(-2px);outline:none}.person[hidden],.branch[hidden]{display:none}.avatar{width:64px;height:76px;flex:0 0 64px;border-radius:9px;overflow:hidden;display:grid;place-items:center;background:linear-gradient(145deg,#153b4a,#0a1823);color:var(--cyan);font-weight:800}.avatar img{width:100%;height:100%;object-fit:cover}.person-copy{min-width:0}.person small{display:block;color:#79dfea;font-size:9px;text-transform:uppercase;letter-spacing:.08em}.person strong{display:block;margin-top:3px;font-size:14px}.details{display:grid;margin-top:5px;color:#a9bac1;font-size:10px;line-height:1.35}.person p{max-width:125px;margin:5px 0 0;color:#a9bac1;font-size:10px;line-height:1.35}.empty{text-align:center;color:#9eb1b8;padding:30px}footer{text-align:center;color:#71848b;font-size:11px;margin-top:18px}@media(max-width:700px){main{width:calc(100vw - 16px);padding-top:24px}#tree{padding-inline:10px}.person{width:180px}.children{gap:18px}}
</style></head><body><main><header><h1>${escapeHtml(payload.name)}</h1><div class="meta">Read-only family tree · Published ${escapeHtml(publishedDate)}</div></header><div class="toolbar"><label><span style="position:absolute;clip:rect(0 0 0 0)">Search family members</span><input id="search" type="search" placeholder="Search family members…" autocomplete="off"/></label></div><div id="tree" aria-label="Family tree">${renderNode(tree, 1)}<div id="empty" class="empty" hidden>No matching family member.</div></div><footer>Published securely from Family Tree</footer></main><script>
const input=document.querySelector('#search'),cards=[...document.querySelectorAll('.person')],empty=document.querySelector('#empty');input.addEventListener('input',()=>{const q=input.value.trim().toLowerCase();let matches=0;cards.forEach(card=>{const show=!q||card.dataset.search.includes(q);card.hidden=!show;if(show)matches++});document.querySelectorAll('.branch').forEach(branch=>{branch.hidden=!!q&&![...branch.querySelectorAll('.person')].some(card=>!card.hidden)});empty.hidden=matches>0});
</script></body></html>`;
}
