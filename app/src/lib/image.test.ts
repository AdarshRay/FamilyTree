import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
}));

vi.mock("./supabase", () => ({
  supabaseClient: () => ({
    storage: {
      from: () => ({ upload: mocks.upload }),
    },
  }),
}));

import { PHOTO_MAX_BYTES, savePhotoFile } from "./image";

describe("photo upload size enforcement", () => {
  beforeEach(() => {
    mocks.upload.mockReset();
    mocks.upload.mockResolvedValue({ error: null });
  });

  it("rejects a compressed payload over 250 KB before upload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      blob: async () => new Blob([new Uint8Array(PHOTO_MAX_BYTES + 1)], { type: "image/jpeg" }),
    }));

    await expect(savePhotoFile("Portrait", "data:image/jpeg;base64,x", "tree-id"))
      .rejects.toThrow("larger than 250 KB");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("uploads a compressed payload at the limit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      blob: async () => new Blob([new Uint8Array(PHOTO_MAX_BYTES)], { type: "image/jpeg" }),
    }));

    await expect(savePhotoFile("Portrait", "data:image/jpeg;base64,x", "tree-id"))
      .resolves.toMatchObject({ ok: true });
    expect(mocks.upload).toHaveBeenCalledOnce();
  });
});
