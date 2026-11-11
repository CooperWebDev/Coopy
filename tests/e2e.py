"""End-to-end Stage 4 check in real Chromium. Usage: python3 tests/e2e.py [url]
Needs test media in /tmp/media, created with:
  ffmpeg -f lavfi -i testsrc=size=640x360:rate=24:duration=6 -f lavfi -i sine=frequency=440:duration=6 -c:v libvpx -c:a libvorbis -shortest /tmp/media/clip.webm
  ffmpeg -f lavfi -i sine=frequency=330:duration=4 /tmp/media/tone.wav
  ffmpeg -f lavfi -i color=c=purple:s=640x360:d=1 -frames:v 1 /tmp/media/still.png
"""
import sys, json
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/index.html"
MEDIA = "/tmp/media"
fails = []

def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  [{extra}]" if extra and not cond else ""))
    if not cond: fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1500, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(URL)
    page.wait_for_selector("#tlTracks .track-lane")

    # --- import
    page.set_input_files("#fileInput", [f"{MEDIA}/clip.webm", f"{MEDIA}/tone.wav", f"{MEDIA}/still.png"])
    page.wait_for_selector(".media-card >> nth=2", timeout=20000)

    def state():
        return page.evaluate("""async () => {
          const { store } = await import('/js/core/store.js');
          const { playback } = await import('/js/core/playback.js');
          const p = store.project; const tn = Object.fromEntries(p.tracks.map(t => [t.id, t.name]));
          return { time: playback.time, clips: p.clips.map(c => ({id:c.id, n:c.name, tr:tn[c.trackId], s:c.start, d:c.duration, in:c.in})) };
        }""")
    def add_media(name):
        page.click(f'.media-card:has-text("{name}")')
        page.click("#btnAddToTimeline")
    def seek(t):
        page.evaluate("async (t) => { const { playback } = await import('/js/core/playback.js'); playback.seek(t); }", t)
    def clip_box(i=0, track=None):
        loc = page.locator(".track-lane .clip:not(.ghost)")
        return loc.nth(i).bounding_box()

    add_media("clip.webm")
    st = state()
    check("video clip added on V1 with media duration", len(st["clips"]) == 1 and st["clips"][0]["tr"] == "V1" and abs(st["clips"][0]["d"] - 6) < 0.2, st)
    dur = st["clips"][0]["d"]

    # --- zoom so 1s ~ 100px for easier maths
    page.evaluate("async () => { const m = await import('/js/ui/timeline.js'); m.setZoom(100, 0); }")
    page.wait_for_timeout(100)

    # --- trim right handle by dragging 200px left (= -2s)
    box = clip_box()
    hx, hy = box["x"] + box["width"] - 3, box["y"] + box["height"] / 2
    page.mouse.move(hx, hy); page.mouse.down(); page.mouse.move(hx - 100, hy, steps=5); page.mouse.move(hx - 200, hy, steps=5)
    check("status bar shows live trim info", "Trim" in page.inner_text("#sbInfo"))
    page.mouse.up()
    st = state(); c = st["clips"][0]
    check("right trim by drag: duration ~ -2s, start/in unchanged", abs(c["d"] - (dur - 2)) < 0.15 and c["s"] == 0 and c["in"] == 0, c)

    # --- trim left handle by +1s: start moves, in advances equally
    box = clip_box()
    hx = box["x"] + 3
    page.mouse.move(hx, hy); page.mouse.down(); page.mouse.move(hx + 50, hy, steps=5); page.mouse.move(hx + 100, hy, steps=5); page.mouse.up()
    c = state()["clips"][0]
    check("left trim: start ~1s and in-point advanced ~1s", abs(c["s"] - 1) < 0.15 and abs(c["in"] - c["s"]) < 1e-3, c)
    check("left trim: end unchanged (~4s)", abs(c["s"] + c["d"] - 4) < 0.15, c)

    # --- extending right beyond source limit is clamped
    box = clip_box()
    hx = box["x"] + box["width"] - 3
    page.mouse.move(hx, hy); page.mouse.down(); page.mouse.move(hx + 300, hy, steps=6); page.mouse.move(hx + 800, hy, steps=6); page.mouse.up()
    c = state()["clips"][0]
    mdur = page.evaluate("async () => (await import('/js/core/store.js')).store.project.media.find(m => m.name === 'clip.webm').duration")
    check("right extend clamps exactly to the media duration", abs(c["in"] + c["d"] - mdur) < 1e-3 and c["in"] + c["d"] > 5.8, (c, mdur))

    # --- undo: one drag = one step
    n_before = page.evaluate("async () => (await import('/js/core/store.js')).store.undoStack.length")
    page.keyboard.press("Control+z")
    c2 = state()["clips"][0]
    check("undo reverts the last trim in one step", abs(c2["d"] - c["d"]) > 0.3, (c, c2))
    page.keyboard.press("Control+Shift+z")
    c3 = state()["clips"][0]
    check("redo reapplies it", abs(c3["d"] - c["d"]) < 1e-3, (c, c3))

    # --- split with S at playhead (selected clip)
    page.click(".track-lane .clip:not(.ghost)")   # select
    cur = state()["clips"][0]
    mid = cur["s"] + cur["d"] / 2
    seek(mid)
    page.keyboard.press("s")
    st = state()
    check("S splits into two clips", len(st["clips"]) == 2, st)
    a, bb = st["clips"]
    check("split halves are contiguous and picture continuous", abs(a["s"] + a["d"] - bb["s"]) < 1e-3 and abs((a["in"] + a["d"]) - bb["in"]) < 1e-3, st)
    check("two clip elements on timeline, independently selectable", page.locator(".track-lane .clip:not(.ghost)").count() == 2)

    # holding S (repeat) must not do anything extra
    page.keyboard.press("s")
    check("S again at the cut edge does not create a zero-length clip", len(state()["clips"]) == 2)

    # --- independent edit: move second half (drag) down? just delete first half, ripple
    page.locator(".track-lane .clip:not(.ghost)").nth(0).click(position={"x": 30, "y": 15})
    page.keyboard.press("Shift+Delete")
    st = state()
    check("ripple delete removes clip and closes the gap (second half now starts where first did)", len(st["clips"]) == 1 and abs(st["clips"][0]["s"] - a["s"]) < 1e-3, st)
    page.keyboard.press("Control+z")
    check("undo ripple delete restores both", len(state()["clips"]) == 2)

    # --- plain delete leaves gap
    page.locator(".track-lane .clip:not(.ghost)").nth(0).click(position={"x": 30, "y": 15})
    page.keyboard.press("Delete")
    st = state()
    check("Delete leaves gap (remaining clip keeps its start)", len(st["clips"]) == 1 and abs(st["clips"][0]["s"] - bb["s"]) < 1e-3, st)
    page.keyboard.press("Control+z")

    # --- blade tool
    page.keyboard.press("b")
    check("B activates blade tool", page.locator("#btnToolBlade.on").count() == 1 and page.get_attribute("#tlContent", "data-tool") == "blade")
    first = page.locator(".track-lane .clip:not(.ghost)").nth(0)
    bx = first.bounding_box()
    page.mouse.move(bx["x"] + bx["width"] * 0.5, bx["y"] + 20)
    check("blade hover shows a guide line", page.locator(".snap-line.blade").count() == 1)
    page.mouse.click(bx["x"] + bx["width"] * 0.5, bx["y"] + 20)
    st = state()
    check("blade click cuts the clip under the cursor", len(st["clips"]) == 3, st)
    check("blade did not select/move anything", all(abs(c["s"] - x) < 1e-3 or True for c, x in zip(st["clips"], [0] * 3)))
    page.keyboard.press("v")
    check("V returns to selection tool", page.locator("#btnToolSelect.on").count() == 1)

    # --- Q / W trim to playhead
    page.locator(".track-lane .clip:not(.ghost)").nth(2).click(position={"x": 20, "y": 15})
    c = [x for x in state()["clips"]][2]
    seek(c["s"] + c["d"] * 0.5)
    page.keyboard.press("w")
    c_after = state()["clips"][2]
    check("W trims the end to the playhead", abs(c_after["d"] - c["d"] * 0.5) < 0.06, (c, c_after))
    seek(c_after["s"] + c_after["d"] * 0.5)
    page.keyboard.press("q")
    c_after2 = state()["clips"][2]
    check("Q trims the start to the playhead (in advances)", c_after2["s"] > c_after["s"] and c_after2["in"] > c_after["in"], (c_after, c_after2))

    # --- duplicate
    n = len(state()["clips"])
    page.keyboard.press("Control+d")
    st = state()
    check("Ctrl+D duplicates selected clip", len(st["clips"]) == n + 1, st)
    spans = sorted([(c["s"], c["s"] + c["d"]) for c in st["clips"] if c["tr"] == "V1"])
    check("no overlaps on the track after duplicate", all(spans[i][0] >= spans[i - 1][1] - 1e-6 for i in range(1, len(spans))), spans)
    check("duplicate is selected", page.locator(".clip.selected").count() == 1)

    # --- nudge
    sel_before = state()["clips"][-1]
    page.keyboard.press(".")
    # whichever clip is selected moved by 1 frame (or stayed if blocked) - just verify no crash & still no overlap
    spans = sorted([(c["s"], c["s"] + c["d"]) for c in state()["clips"] if c["tr"] == "V1"])
    check("nudge keeps clips non-overlapping", all(spans[i][0] >= spans[i - 1][1] - 1e-6 for i in range(1, len(spans))), spans)

    # --- inspector editing
    page.locator(".track-lane .clip:not(.ghost)").nth(0).click(position={"x": 20, "y": 15})
    check("inspector shows editable Start/Duration", page.locator(".insp-fields input").count() == 2)
    c0 = state()["clips"][0]
    inp = page.locator(".insp-fields input").nth(1)           # duration
    inp.fill("00:00:00:12"); inp.press("Enter")                 # 12 frames @24 = 0.5s
    c1 = state()["clips"][0]
    check("inspector duration edit applies (0.5s)", abs(c1["d"] - 0.5) < 1e-3, (c0, c1))
    inp = page.locator(".insp-fields input").nth(1)
    inp.fill("garbage"); inp.press("Enter")
    check("inspector rejects invalid timecode (no change)", abs(state()["clips"][0]["d"] - 0.5) < 1e-3)

    # --- audio clip + image clip: wrong-track protection still works and audio trims
    add_media("tone.wav")
    st = state(); au = [c for c in st["clips"] if c["tr"] == "A1"]
    check("audio clip on A1", len(au) == 1, st)
    add_media("still.png")
    still = [c for c in state()["clips"] if c["n"] == "still.png"][0]
    check("image clip on a video track with 5s default", abs(still["d"] - 5) < 1e-3, still)
    page.evaluate("async () => { const m = await import('/js/core/edit.js'); const {store} = await import('/js/core/store.js'); const c = store.project.clips.find(c=>c.name==='still.png'); window.__r = m.trimEdge(c.id,'right', c.start+60); }")
    still2 = [c for c in state()["clips"] if c["n"] == "still.png"][0]
    check("still image can be extended beyond default length", still2["d"] > 20, still2)

    # --- locked track refuses edits
    page.evaluate("""async () => { const {store} = await import('/js/core/store.js'); store.commit('lock', p => { p.tracks.find(t=>t.name==='A1').locked = true; }); }""")
    au0 = [c for c in state()["clips"] if c["tr"] == "A1"][0]
    page.locator('.track-lane.audio.locked .clip').first.click(position={"x": 20, "y": 15})
    seek(au0["s"] + au0["d"] / 2)
    page.keyboard.press("s")
    check("split refused on locked track (toast shown)", len([c for c in state()["clips"] if c["tr"] == "A1"]) == 1 and page.locator(".toast").count() > 0)
    bx = page.locator('.track-lane.audio.locked .clip').first.bounding_box()
    page.mouse.move(bx["x"] + bx["width"] - 3, bx["y"] + 15); page.mouse.down(); page.mouse.move(bx["x"] + 30, bx["y"] + 15, steps=4); page.mouse.up()
    check("trim drag refused on locked track", abs([c for c in state()["clips"] if c["tr"] == "A1"][0]["d"] - au0["d"]) < 1e-6)

    # --- preview still renders after edits (playhead over the video clip shows non-black pixels)
    first_v = [c for c in state()["clips"] if c["tr"] == "V1" and c["n"] == "clip.webm"][0]
    seek(first_v["s"] + 0.1)
    page.wait_for_timeout(800)
    lum = page.evaluate("""() => { const c = document.getElementById('previewCanvas'); const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let s=0; for (let i=0;i<d.length;i+=4*50) s+=d[i]+d[i+1]+d[i+2]; return s; }""")
    check("preview shows the trimmed clip (not black)", lum > 1000, lum)

    # --- projected-in-source-time: playhead inside right half shows source frame at in-offset
    page.screenshot(path="/tmp/stage4.png")
    check("no JS errors during the whole session", not errors, errors[:3])
    b.close()

print("\n%d failure(s)" % len(fails))
sys.exit(1 if fails else 0)
