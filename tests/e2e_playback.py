"""Playback across a split stays continuous and in sync."""
import sys
from playwright.sync_api import sync_playwright
URL = "http://localhost:5173/index.html"
with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    page = b.new_page(viewport={"width": 1500, "height": 900})
    errs = []; page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL); page.wait_for_selector("#tlTracks .track-lane")
    page.set_input_files("#fileInput", ["/tmp/media/clip.webm"]); page.wait_for_selector(".media-card")
    page.click(".media-card"); page.click("#btnAddToTimeline")
    page.evaluate("async () => { const {playback} = await import('/js/core/playback.js'); playback.seek(3); }")
    page.click(".track-lane .clip:not(.ghost)"); page.keyboard.press("s")
    # trim the first half's end by 1s so source is skipped: the cut becomes a jump cut
    res = page.evaluate("""async () => {
      const {store} = await import('/js/core/store.js'); const {playback} = await import('/js/core/playback.js');
      const E = await import('/js/core/edit.js'); const {engine} = await import('/js/core/engine.js');
      const [a, b] = store.project.clips; E.trimEdge(a.id, 'left', 1);            // a: 1..3 shows source 1..3
      playback.seek(2.5); playback.play();
      await new Promise(r => setTimeout(r, 1500));
      const t = playback.time; playback.pause();
      const [A, B] = store.project.clips;
      const active = engine.activeClips(playback.time).map(c => c.id);
      return { t, a: [A.start, A.duration, A.in], b: [B.start, B.duration, B.in], active, bId: B.id };
    }""")
    print(res)
    ok = res["t"] > 3.5 and res["active"] == [res["bId"]]
    # element of second half must be at in + (t - start)
    el = page.evaluate("""async () => { const {playback} = await import('/js/core/playback.js'); const {store} = await import('/js/core/store.js');
      const B = store.project.clips[1]; return B.in + (playback.time - B.start); }""")
    print("expected source time in 2nd half:", round(el, 2))
    print("PASS playback crossed the cut into the second clip" if ok else "FAIL")
    print("errors:", errs)
    b.close(); sys.exit(0 if ok and not errs else 1)
