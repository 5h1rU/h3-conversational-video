import { afterEach, describe, expect, it, vi } from "vitest";
import { callMoonshot } from "../src/layers";

afterEach(() => vi.unstubAllGlobals());

describe("Moonshot Workers transport", () => {
  it("uses Workers-supported manual redirect handling", async () => {
    const fetchMock = vi.fn((...args: Parameters<typeof fetch>) => {
      void args;
      return Promise.resolve(
        Response.json({ choices: [{ finish_reason: "stop" }] }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await callMoonshot("test-only-key", { model: "kimi-k2.6" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      redirect: "manual",
    });
  });

  it("rejects redirects instead of following them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 302 }))),
    );

    await expect(
      callMoonshot("test-only-key", { model: "kimi-k2.6" }),
    ).rejects.toThrow("redirect rejected");
  });
});
