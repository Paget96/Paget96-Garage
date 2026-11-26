/* SPDX-License-Identifier: GPL-3.0-only */
/* Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage, p96-renderd. See NOTICE. */
/*
 * Popup watch: layer apps step back while a popup surface of another program is up.
 *
 * The HMI and other programs (Android Auto, notifications, volume, very likely: unsure) show popups as compositor
 * surfaces of their own. The renderer is told about every surface on the compositor (ivi_controller's surface
 * event) and, for the ones it watches, about their visibility, size and place. The surfaces that exist when the
 * watch starts are the scene: one that is visible then (the HMI's page, the background, the cluster's) is not a
 * popup until it has hidden once. A surface that turns visible later, or a new surface that appears visible,
 * with a size, over the app area, is taken for a popup: while one is
 * up, layer apps are hidden (mode yield) or only logged (mode log). A popup that stays up longer than max_us is
 * taken for a screen of its own (an app, a projection) and stops counting until it hides again, so nothing can
 * keep the apps hidden for good. Pure logic, no wayland: test/test_popup.c.
 */
#ifndef P96_POPUP_H
#define P96_POPUP_H
#include <stdint.h>

#define POPUP_MAX 96
#define POPUP_MAX_IGNORE 16

enum { POPUP_OFF = 0, POPUP_LOG = 1, POPUP_YIELD = 2 };

struct popup_surface {
    uint32_t id;
    int used;
    int visible, w, h;
    int dst[4], have_dst;
    int scene;             /* there when the watch started */
    int baseline;          /* a scene surface visible at the start: not a popup until it hides */
    uint64_t seen_us;      /* when the watch started */
    uint64_t since_us;     /* when it last turned visible (0: not up) */
    int counted;           /* counted at the last popup_update */
};

struct popup {
    int mode;
    uint64_t max_us;       /* longer up than this: not a popup */
    uint64_t settle_us;    /* the scene: surfaces reported this soon after the start, and their first state */
    uint64_t t0;           /* the watch's start */
    int area[4];           /* the app area on the screen: a surface must overlap it */
    uint32_t ignore[POPUP_MAX_IGNORE];
    int n_ignore;
    struct popup_surface s[POPUP_MAX];
    int active;            /* a popup counts now */
    uint32_t active_id;
};

void popup_init(struct popup *p, int mode, uint64_t max_us, const int area[4], const uint32_t *ignore, int n_ignore,
                uint64_t now_us);
/* a surface to watch: its slot, or -1 (ignored, already watched, or full) */
int popup_track(struct popup *p, uint32_t id, uint64_t now_us);
int popup_slot(const struct popup *p, uint32_t id);
void popup_visibility(struct popup *p, int slot, int visible, uint64_t now_us);
void popup_size(struct popup *p, int slot, int w, int h);
void popup_dst(struct popup *p, int slot, int x, int y, int w, int h);
void popup_gone(struct popup *p, int slot);
/* re-evaluate at now: 1 when "a popup is up" changed; p->active and p->active_id say what is */
int popup_update(struct popup *p, uint64_t now_us);

#endif
