# Coopy

A browser-based video editor, built in stages. No build step; plain ES modules.

## Run locally

ES modules need an HTTP server (opening `index.html` via `file://` will not work):

```bash
cd coopy
python3 -m http.server 5173      # or: npm start
```

Open http://localhost:5173 in a current Chrome, Edge or Firefox.

## Structure

```
index.html
css/        theme.css (tokens) · layout.css (grid, workspaces) · components.css
js/main.js  entry point
js/core/    events.js (bus) · store.js (project + undo/redo) · playback.js (master clock) · timecode.js
js/ui/      panels.js · timeline.js · preview.js · menus.js · shortcuts.js · modal.js · toast.js · editing.js
tests/      edit.test.mjs (model logic, Node) · e2e.py / e2e_playback.py (real Chromium, optional)
```

Editing rules live in `js/core/edit.js` (no DOM, one undo step per operation); `js/ui/editing.js` only maps keys,
buttons and menus onto it.

## Stage 5–12 status (done)

Everything below was added on top of Stage 4 and is covered by `node tests/edit.test.mjs` where it has model logic.
The browser-only parts (audio graph, IndexedDB, MediaRecorder export) could not be exercised in a real browser here,
so give them a quick manual try (see "First run checklist").

- **Per-clip properties** (Inspector): Scale, Position X/Y, Rotation, Opacity, Volume (0–200 %), Fade in / Fade out
  (picture and sound). Sliders preview live; releasing is one undo step; each has a reset button.
- **Color tab**: brightness, contrast, saturation, hue shift, grayscale, sepia, blur.
- **Effects tab**: one-click looks (Black & White, Sepia, Vivid, Faded, Cool, Warm, Dreamy, Noir) that set the Color values.
- **Audio**: every clip plays through its own gain node (volume, fades, track mute) into one mix. Fades work as
  fade-from/to-black and fade-in/out of sound.
- **Shared renderer** (`core/render.js`): the preview and the exporter use the same compositor.
- **Save / restore**: autosaves the project and imported media to IndexedDB and restores them on reload.
  `Ctrl+S` saves now; File > Download Project File writes a portable `.coopy.json` (project only, no media bytes);
  File > Open Project reads one back and re-attaches media that is still in this browser.
- **Export** (Export… button): records the timeline in real time at 720p/1080p with the mixed audio.
  Writes MP4 where the browser can record it, otherwise WebM. A 1-minute edit takes about 1 minute; keep the tab visible.

Limits: export is real time (no offline/faster-than-real-time render, no FFmpeg), clips can't overlap on a track so
there are no cross-dissolves between clips (use fades on adjacent clips on different tracks), no keyframes, no text
titles, no waveforms, single selection. `ctx.filter` (looks and color) is not supported by Safari, where those
adjustments show in neither preview nor export.

### First run checklist
1. Import a video, drag it to V1, select it: change Scale/Opacity, apply a Look, add a 1 s fade-in, press play.
2. Reload the page: the project and media should come back.
3. Export…: Start Export, wait, and play the downloaded file.

## Stage 4 status (done)

Cutting, trimming and clip manipulation.

- **Trim**: drag the left or right edge of a clip. The left edge also advances the source in-point, so the picture
  never slides. Edges snap (playhead, other clips, timeline start), can't cross a neighbouring clip, can't go
  under one frame, and can't reveal footage that doesn't exist (video/audio are limited to the source length;
  still images can be extended freely). The status bar shows the live duration while dragging. One drag = one undo step.
- **Split**: `S` or the Split button cuts at the playhead. With a clip selected (and under the playhead) only that
  clip is cut; otherwise every clip under the playhead on an unlocked track is cut. Both halves are independent
  clips and the picture continues seamlessly across the cut.
- **Blade tool** (`B`, back to Select with `V`): a guide line follows the cursor; click a clip to cut it there.
- **Trim to playhead**: `Q` trims the selected clip's start, `W` its end.
- **Duplicate**: `Ctrl+D` places the copy right after the original (or the nearest free spot) and selects it.
- **Delete** leaves a gap; **Ripple delete** (`Shift+Delete`) closes the gap on that track only.
- **Nudge**: `,` / `.` move the selected clip one frame.
- **Inspector**: Start and Duration are editable (type `HH:MM:SS:FF`, or a number of frames). Out-of-range values are
  clamped and you are told why.
- Locked tracks refuse every edit. The Edit menu lists all of the above.

Limits: one clip is selected at a time (multi-select and group moves are not in yet), ripple only affects the
clip's own track, and there are no cross-track ripple, slip/slide or roll tools. Audio waveforms (Stage 5) are not
drawn yet, so audio trims are judged by length rather than by sound.

### Tests

```bash
node tests/edit.test.mjs                  # model logic, no browser needed (npm test)
python3 tests/e2e.py                      # drives the real UI in Chromium: needs `pip install playwright`,
                                          # a running server on :5173 and test files in /tmp/media (see header of e2e.py)
```

## Stage 3 status (done)

Real timeline clips. Drag media from the pool onto a track (video and stills go to video tracks, audio to audio
tracks; wrong or locked tracks are refused), or select media and press **Add to Timeline** (places it at the playhead).
Move clips by dragging, including across tracks of the same type. Snapping to the playhead, timeline start and
other clips' edges (toggle with Snap; the guide line shows what you snapped to). Clips never overlap on a track:
a drop or move that would overlap is placed at the nearest free spot. Click to select (properties in the Inspector),
Delete removes the selected clip, everything is undoable, and removing media that is in use also removes its clips
after confirmation. The preview composites the clips under the playhead (upper tracks paint over lower ones),
plays them in sync with the playhead, and respects hidden/muted tracks. Video clips play their own audio.

Not yet: opacity/transform/blending between layers (Stages 6 and 8),
audio mixing (Stage 5). Clips starting mid-playback may show a brief stall while the decoder warms up; Stage 10 improves this.

## Stage 2 status (done)

Import video/audio/images (button or drag-and-drop onto the Media Pool), thumbnails (cached as small JPEGs in the
project), metadata in the Inspector, nested bins (create, rename by double-click, delete, drag media between bins),
search and type filter, Remove (Delete key, undoable), and a **Source** monitor: double-click media to play it
in the preview (frame step, speed, fullscreen). Files that can't be decoded are rejected with a clear message.

Limits: media files live in memory for the session only; they are persisted to IndexedDB in Stage 12, so a
reload currently clears the pool. Frame rate of source media isn't exposed by browsers, so stepping uses the project fps.

## Stage 1 status (done)

Working: resizable panels (saved, double-click splitter to reset), five workspace tabs,
timeline with ruler, zoom (buttons, slider, Ctrl+wheel, Fit), scrubbing, track add / lock / hide / mute with
undo/redo, transport (play, frame step, speed, fullscreen, timecode), project settings, shortcuts dialog.

Not implemented yet (controls are visibly disabled, not faked): import, clips, effects, color, keyframes,
audio, saving, export. See the stage plan.

## Shortcuts

Ctrl+S save · Space play/pause · S split · B/V blade/select · Q/W trim to playhead · Ctrl+D duplicate · Shift+Delete ripple delete · ,/. nudge · ←/→ frame · Shift+←/→ 10 frames · Home/End · Ctrl+Z / Ctrl+Shift+Z · +/− zoom · F fullscreen
