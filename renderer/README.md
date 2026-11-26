<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE. -->

# p96-renderd: the Paget96 Garage renderer

The GPU renderer for Paget96 Garage apps on the iDrive 7 head unit. An app does not draw pixels itself: it
records its drawing (rectangles, arcs, lines, text) and sends that list over a socket. The renderer draws it
with OpenGL ES on the head unit's GPU, in step with the screen, at up to 60 frames a second.

It starts from the renderer that idrive7-apps ships (`kit/renderd`, which is mgu-render by Robert Nisipeanu
and IterioDev, built from earlier work by cauliflowermossgrape). It speaks the same protocol, so every app
that runs on that renderer runs on this one unchanged. On top of it we fix what gets in our way and add what
our apps need. The plan, phases and reasons are kept by the owner; this file says what is here now.

**Status: phase 1, not installed by anything yet.** It builds and its tests pass on a PC. It has never run on a
head unit, and nothing in the Store or in our apps uses it yet.

## What is different from the upstream renderer

| | upstream (idrive7-renderd) | p96-renderd |
|---|---|---|
| Name and socket | `mgu-renderd`, `/run/mgu-renderd/renderd.sock` | `p96-renderd`, `/run/p96-renderd/render.sock` |
| Compositor ids | layers `0x4d470000` + slot | layers `0x50390000` + slot, surfaces `0x50390100` + slot (`layer_base`) |
| Touch divert | table `idrive7_render`, port 30572 | table `p96_render`, port 30574 |
| Other renderers' sockets | links the community socket and display-bridge's to itself | takes neither: it runs beside the others and serves only apps that connect to it |
| System popups | hides only for the camera surfaces (`yield_surfaces`); everything else relies on the app hearing "focus lost" | **popup watch**: every other program's surface that comes up over the app area is noticed, logged with its process, and (with `popup_watch = yield`) our layers step back while it is up |
| In-page drawing (embed) | on | off for now (`embed = 0`): the HMI page template can only be loaded by one renderer, see the plan |
| HMI popup or menu over an app | touch and the controller stay with the app | the foreground gate reports the app `covered`; its layer steps back, touch and the controller go to the HMI |
| HMI still starting | a gate instance that failed is never watched again | tried again every 5 s; an instance that becomes available is read at once |
| Slow nft | the render loop waits for it (the guard may kill the renderer) | nft runs beside the loop; the rule comes out without a file in `/tmp` |

Everything else (drawing, the protocol and its three dialects, touch routing, the controller, video, pictures, the
frame cap) is upstream's code as it was at idrive7-apps commit `54f9f748`. [COMPARISON.md](COMPARISON.md) lists the
problems reported about mgu-store's renderer and how ours stands on each.

## The popup watch

The problem: the renderer puts an app's picture on its own compositor layer, on top of the whole screen. The
HMI's own popups (the favourite buttons, volume, notifications, Android Auto banners, calls) are drawn below
it, so the app covers them. The kit hides the picture only when the HMI says the app's screen lost focus, and
most of these popups never say that.

Two things now cover this, each for a different kind of popup:

- **Popups that take the input** (a check control message, the header menu, the voice assistant, a screen opened
  from there): the HMI takes the focus from the app's states. The foreground gate follows that focus and reports
  the app `covered` once none of its states had it for 150 ms; the renderer then takes the app's layer off, and
  touch and the controller go back to the HMI with it, until the focus comes back.
- **Popups that do not take the input** (volume, notifications, very likely the favourite buttons): the popup
  watch below.

What the watch does (`src/popup.c`, wired in `src/main.c`):

- The compositor tells the renderer about every surface (every window) on the screen. The watch follows each
  one that is not a renderer's own, the HMI's own page, or a camera surface (those have `yield_surfaces`).
- The surfaces that exist when the renderer starts are the scene. One that is visible then (the HMI's page,
  the background) is not a popup until it has hidden once.
- A surface that turns visible later, or a new surface that appears, with a size, over the app area, is a
  popup while it is up.
- A popup that stays up longer than `popup_max_ms` (20 s) is taken for a screen of its own and stops counting,
  so nothing can keep the apps hidden for good.

Settings (in `p96-renderd.conf`, or `-s key=value`):

| Key | Values | What |
|---|---|---|
| `popup_watch` | `off`, `log`, `yield` | `log` writes `popup: surface 0x... (process) up at x,y wxh` to the journal; `yield` also hides the layer apps while a popup is up. Built-in: `off`; `p96-renderd.conf`: `log` |
| `popup_max_ms` | ms, 0 = no limit | longer up than this: not a popup |
| `popup_ignore` | surface ids | never taken for a popup |
| `layer_base` | a multiple of 0x10000 | our layer ids; surfaces are `layer_base + 0x100` |

**What it cannot do:** a popup that the HMI draws inside its own page (one surface for the whole HMI) is not a
surface of its own, so no renderer can see it come and go. Which popups are which is only known from the car:
run with `popup_watch = log`, open each popup, and read `journalctl -u p96-renderd | grep popup`. Popups that
show up there can be handled with `yield`; the rest need in-page drawing (embed).

## Build

Needs Docker. The head unit is x86-64 with glibc 2.27, so the build runs in Ubuntu 18.04:

```sh
cd renderer
docker build --platform linux/amd64 -t p96-renderd-build docker
docker run --rm --platform linux/amd64 -u $(id -u):$(id -g) -v $PWD:/src p96-renderd-build make
docker run --rm --platform linux/amd64 -u $(id -u):$(id -g) -v $PWD:/src p96-renderd-build make check-target
# build/p96-renderd, build/mgu-inputgate.so, build/ivi-probe
make test      # all unit tests in Ubuntu 24.04 with Mesa's software GPU, the popup watch included
```

`make test` runs upstream's tests (protocol dialects, touch, sockets, video, ramps, the foreground gate, the
JS client, the page-template script, embed buffers against a mock HMI) and ours (`test/test_popup.c`: the
popup rules and the settings; `test/test_gate_watch.js`: the gate's retry, its read on availability and the
covered report, on a mock SOME/IP; `test/test_gate_iface.js`: where the gate finds the HMI's interface; in
`test/test_touch.c`, a slow nft and an nft that leaves no table). Upstream's byte-for-byte replay against the original renderers needs their
sources in `test/reference/`, which are not here, so it is skipped.

## Draw without a car

A recorded app session can be drawn on a PC, exactly as the GPU would draw it:

```sh
docker run --rm -u $(id -u):$(id -g) -v $PWD:/w -w /w -e LIBGL_ALWAYS_SOFTWARE=1 -e EGL_PLATFORM=surfaceless \
    mgu-render-test build/host/mgu-render --replay session.bin --out frame.pam [--raw frames.rgba]
```

`test/sessions/` has recorded sessions to try (`zcat` them first).

## Files

| | |
|---|---|
| `src/` | the renderer (C, GLES2). `popup.c` and `popup.h` are ours; `main.c` and `config.c` carry our changes |
| `p96-renderd.conf` | our settings (only what differs from `mgu-render.conf`, which lists every key) |
| `js/` | the foreground gate, the page template maker and the JS client, as upstream |
| `systemd/`, `inputgate/`, `protocol/`, `tools/`, `docker/` | as upstream |
| `README.upstream.md`, `README.mgu-render.md`, `PROTOCOL.md`, `CHANGELOG.upstream*.md` | upstream's documentation, kept for reference |

## Licence

This folder is GPL-3.0. Upstream's renderer is GPL-3.0-or-later (`LICENSE`), Copyright (C) 2026 Robert
Nisipeanu and IterioDev; the parts it took from idrive7-apps' first renderer are also MIT
(`LICENSE.mgu-renderd`, Copyright (c) 2026 cauliflowermossgrape); the Wayland ivi protocol files are MIT
(DENSO, BMW Car IT, notice in each file); the controller gate's vsomeip headers are MPL-2.0. Our changes and
our files are GPL-3.0-only with the terms in the repository's NOTICE. Their notices stay in every file.
