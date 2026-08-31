import { describe, expect, it } from "vitest";
import { demoHtml } from "../src/demo";

describe("session viewer", () => {
  it("restores a session with an identity-stable double-buffered player", () => {
    expect(demoHtml).toContain("location.pathname.split('/')");
    expect(demoHtml).toContain("branchPhase=state.branchPhase");
    expect(demoHtml).toContain("clip.source==='branch'");
    expect(demoHtml).toContain('<video id="program-video-a" preload="auto"');
    expect(demoHtml).toContain('<video id="program-video-b" preload="auto"');
    expect(demoHtml).toContain("video===activeVideo");
    expect(demoHtml).toContain("addEventListener('ended'");
    expect(demoHtml).toContain("shouldAdvanceFromEnded");
    expect(demoHtml).not.toContain("setInterval(()=>{cursor++");
    expect(demoHtml).not.toContain("innerHTML=clip.title");
  });

  it("buffers the full canonical set and paints standby before handoff", () => {
    expect(demoHtml).toContain(
      "await Promise.all(canonicalUrls.map(bufferUrl))",
    );
    expect(demoHtml).toContain("await video.play()}");
    expect(demoHtml).toContain(
      "requestAnimationFrame(()=>requestAnimationFrame(resolve))",
    );
    expect(demoHtml).toContain("video.muted=true");
    expect(demoHtml).toContain("await ensureStandby(clip)");
    expect(demoHtml).toContain("canCommitMediaHandoff");
    expect(demoHtml).toContain("requestAnimationFrame(()=>{");
    expect(demoHtml).toContain("previous.className='standby'");
    expect(demoHtml).not.toContain("previous.removeAttribute('src')");
  });

  it("falls back past media errors without polling teardown", () => {
    expect(demoHtml).toContain("unavailableClipIds.add(clip.id)");
    expect(demoHtml).toContain("selectNextPlayableClipId");
    expect(demoHtml).toContain("if(started&&selected!==currentClipId)");
    expect(demoHtml).not.toContain("video.src=clip.mediaUrl");
  });

  it("uses a microphone-first question flow with explicit paid-generation confirmation", () => {
    expect(demoHtml).toContain('id="mic"');
    expect(demoHtml).toContain("window.SpeechRecognition");
    expect(demoHtml).toContain("window.webkitSpeechRecognition");
    expect(demoHtml).toContain("interimResults=true");
    expect(demoHtml).toContain("Microphone permission was not granted");
    expect(demoHtml).toContain("may use fal.ai credits");
    expect(demoHtml).toContain("send.disabled=true");
    expect(demoHtml).toContain("input.readOnly=false");
  });
});
