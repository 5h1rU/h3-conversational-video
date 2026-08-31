import { describe, expect, it } from "vitest";
import { demoHtml } from "../src/demo";

describe("session viewer", () => {
  it("restores an existing session and plays its generated branch", () => {
    expect(demoHtml).toContain("location.pathname.split('/')");
    expect(demoHtml).toContain("state.branchPhase==='ready'");
    expect(demoHtml).toContain("clip.source==='branch'");
    expect(demoHtml).toContain('<video id="generated-video" controls muted');
    expect(demoHtml).not.toContain("innerHTML=clip.title");
  });
});
