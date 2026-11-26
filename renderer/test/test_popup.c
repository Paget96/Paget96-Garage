/* SPDX-License-Identifier: GPL-3.0-only */
/* Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage, p96-renderd. See NOTICE. */
/* The popup watch (src/popup.c): which surfaces count as a popup, as the compositor would report them. */
#include <stdio.h>
#include <string.h>

#include "config.h"
#include "popup.h"

static int fails, checks;
#define CHECK(cond, ...) do { checks++; if (!(cond)) { fails++; printf("FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

#define MS 1000ull
static const int AREA[4] = { 108, 82, 1790, 638 };

/* a surface reported with its state, as the compositor sends it after ivi_controller_surface_create */
static int surface(struct popup *p, uint32_t id, int visible, int w, int h, int x, int y, uint64_t t) {
    int k = popup_track(p, id, t);
    if (k < 0) return k;
    popup_visibility(p, k, visible, t);
    popup_dst(p, k, x, y, w, h);
    popup_size(p, k, w, h);
    return k;
}

int main(void) {
    struct popup p;
    uint32_t ign[] = { 0x4d520100 };

    /* the scene at the start: the HMI's page and a background are visible, not popups */
    popup_init(&p, POPUP_YIELD, 20000 * MS, AREA, ign, 1, 0);
    int hmi = surface(&p, 100, 1, 1920, 720, 0, 0, 10 * MS);
    surface(&p, 101, 1, 1920, 720, 0, 0, 20 * MS);
    int later = surface(&p, 300, 0, 600, 120, 660, 500, 30 * MS);
    popup_update(&p, 2000 * MS);
    CHECK(!p.active, "scene surfaces visible at the start are not popups");
    CHECK(hmi >= 0, "the HMI's surface is watched");

    /* ignored ids are never watched */
    CHECK(popup_track(&p, 0x4d520100, 2000 * MS) < 0, "an ignored id is not watched");
    CHECK(popup_track(&p, 100, 2000 * MS) < 0, "a watched id is not watched twice");

    /* a scene surface hidden at the start that turns visible later is a popup */
    popup_visibility(&p, later, 1, 3000 * MS);
    CHECK(popup_update(&p, 3000 * MS) == 1, "a change is reported");
    CHECK(p.active && p.active_id == 300, "a surface that turned visible is a popup (id %#x)", p.active_id);
    CHECK(popup_update(&p, 3100 * MS) == 0, "no change, nothing reported");
    popup_visibility(&p, later, 0, 4000 * MS);
    CHECK(popup_update(&p, 4000 * MS) == 1 && !p.active, "it hid: no popup");

    /* a new surface that appears visible, after the start, is a popup at once */
    int toast = surface(&p, 400, 1, 800, 100, 560, 600, 5000 * MS);
    popup_update(&p, 5000 * MS);
    CHECK(p.active && p.active_id == 400, "a new visible surface is a popup");
    popup_gone(&p, toast);
    popup_update(&p, 5100 * MS);
    CHECK(!p.active, "a destroyed surface is no popup");

    /* a visible 0x0 surface shows nothing */
    int empty = surface(&p, 401, 1, 0, 0, 0, 0, 6000 * MS);
    popup_update(&p, 6000 * MS);
    CHECK(!p.active, "a visible 0x0 surface is no popup");
    popup_size(&p, empty, 400, 80);
    popup_dst(&p, empty, 700, 300, 400, 80);
    popup_update(&p, 6100 * MS);
    CHECK(p.active, "the same surface with a size is one");
    popup_visibility(&p, empty, 0, 6200 * MS);
    popup_update(&p, 6200 * MS);

    /* outside the app area (another screen's corner, the back column) does not count */
    surface(&p, 402, 1, 80, 600, 0, 82, 7000 * MS);
    popup_update(&p, 7000 * MS);
    CHECK(!p.active, "a surface outside the app area is no popup");

    /* up for longer than max: a screen of its own, not a popup; hiding and showing again counts again */
    int aa = surface(&p, 500, 1, 1920, 720, 0, 0, 8000 * MS);
    popup_update(&p, 8000 * MS);
    CHECK(p.active && p.active_id == 500, "a big new surface counts at first");
    popup_update(&p, 8000 * MS + 20001 * MS);
    CHECK(!p.active, "after max it stops counting");
    popup_visibility(&p, aa, 0, 30000 * MS);
    popup_visibility(&p, aa, 1, 31000 * MS);
    popup_update(&p, 31000 * MS);
    CHECK(p.active, "shown again: counts again");
    popup_visibility(&p, aa, 0, 32000 * MS);
    popup_update(&p, 32000 * MS);

    /* a scene surface visible at the start counts once it has hidden and come back */
    popup_visibility(&p, hmi, 0, 33000 * MS);
    popup_visibility(&p, hmi, 1, 33100 * MS);
    popup_update(&p, 33100 * MS);
    CHECK(p.active && p.active_id == 100, "a scene surface that came back counts");
    popup_visibility(&p, hmi, 0, 33200 * MS);
    popup_update(&p, 33200 * MS);

    /* off: nothing is watched */
    struct popup off;
    popup_init(&off, POPUP_OFF, 0, AREA, NULL, 0, 0);
    CHECK(popup_track(&off, 7, 5000 * MS) < 0, "off watches nothing");

    /* full: the table refuses more than POPUP_MAX surfaces */
    struct popup full;
    popup_init(&full, POPUP_LOG, 0, AREA, NULL, 0, 0);
    int n = 0;
    for (uint32_t i = 0; i < POPUP_MAX + 10; i++) n += popup_track(&full, 1000 + i, 0) >= 0;
    CHECK(n == POPUP_MAX, "at most %d surfaces watched (%d)", POPUP_MAX, n);

    /* the settings */
    struct cfg c;
    cfg_defaults(&c);
    CHECK(c.popup_watch == 0 && c.layer_base == 0, "built-in: popup watch off, upstream ivi ids");
    CHECK(cfg_set_pair(&c, "popup_watch = log") == 0 && c.popup_watch == POPUP_LOG, "popup_watch = log");
    CHECK(cfg_set_pair(&c, "popup_watch=yield") == 0 && c.popup_watch == POPUP_YIELD, "popup_watch = yield");
    CHECK(cfg_set_pair(&c, "popup_watch = maybe") != 0, "popup_watch refuses other words");
    CHECK(cfg_set_pair(&c, "popup_max_ms = 5000") == 0 && c.popup_max_ms == 5000, "popup_max_ms");
    CHECK(cfg_set_pair(&c, "popup_ignore = 0x64, 0x65,102") == 0 && c.n_popup_ignore == 3 && c.popup_ignore[2] == 102,
          "popup_ignore");
    CHECK(cfg_set_pair(&c, "layer_base = 0x50390000") == 0 && c.layer_base == 0x50390000u, "layer_base");
    CHECK(cfg_set_pair(&c, "layer_base = 0x50390001") != 0, "layer_base refuses a base that is not a multiple of 0x10000");
    CHECK(cfg_load(&c, "p96-renderd.conf") == 0, "p96-renderd.conf loads");
    CHECK(c.popup_watch == POPUP_LOG && c.layer_base == 0x50390000u && !c.shared_path[0] && !c.bridge_path[0] && !c.embed,
          "p96-renderd.conf: log only, our ids, no community or display-bridge socket, no embed yet");
    CHECK(!strcmp(c.socket_path, "/run/p96-renderd/render.sock") && c.touch_port == 30574 && !strcmp(c.touch_table, "p96_render"),
          "p96-renderd.conf: our socket and touch divert");

    printf("test_popup: %d checks, %s\n", checks, fails ? "FAILED" : "all passed");
    return fails != 0;
}
