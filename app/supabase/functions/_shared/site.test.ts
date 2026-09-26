import { describe, expect, it } from "vitest";
import { collectPhotoAssets, generateIndexHtml, generateTreeJson } from "./site";

const payload = {
  id: "tree-1",
  name: "Ray & <Family>",
  root: {
    person: { name: "Founder <script>", photo: "founder.jpg", occupation: "Teacher" },
    spouses: [{ name: "Partner & Friend" }],
    children: [{ person: { name: "Child" } }],
  },
  snapshot: {
    overrides: { Child: { birthplace: "Cuttack", photoStoragePath: "tree-1/custom/child.png" } },
    structure: { childrenOf: { Child: [{ person: { name: "Grandchild" } }] }, renames: {} },
  },
  publishedAt: "2026-09-26T00:00:00.000Z",
};

describe("published family tree artifacts", () => {
  it("serializes the complete payload", () => {
    expect(JSON.parse(generateTreeJson(payload))).toEqual(payload);
  });

  it("escapes user-controlled HTML while retaining the tree", () => {
    const html = generateIndexHtml(payload);
    expect(html).toContain("Ray &amp; &lt;Family&gt;");
    expect(html).toContain("Founder &lt;script&gt;");
    expect(html).toContain("Partner &amp; Friend");
    expect(html).not.toContain("<strong>Founder <script></strong>");
    expect(html).toContain("Child");
    expect(html).toContain("Grandchild");
    expect(html).toContain("Teacher");
    expect(html).toContain("Search family members");
  });

  it("collects private photo objects for durable publication", () => {
    expect(collectPhotoAssets(payload)).toEqual([
      { storagePath: "tree-1/seed/founder.jpg", publishedPath: "photos/Founder-script.jpg" },
      { storagePath: "tree-1/custom/child.png", publishedPath: "photos/Child.png" },
    ]);
  });
});
