/* SPDX-License-Identifier: GPL-3.0-only */
/* Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage, p96-renderd. See NOTICE. */
/* Popup watch (popup.h): which watched surface counts as a popup up now. No wayland here. */
#include "popup.h"

#include <string.h>

#define SETTLE_US 1500000ull

void popup_init(struct popup *p, int mode, uint64_t max_us, const int area[4], const uint32_t *ignore, int n_ignore,
                uint64_t now_us) {
    memset(p, 0, sizeof *p);
    p->mode = mode;
    p->max_us = max_us;
    p->settle_us = SETTLE_US;
    p->t0 = now_us;
    memcpy(p->area, area, sizeof p->area);
    if (n_ignore > POPUP_MAX_IGNORE) n_ignore = POPUP_MAX_IGNORE;
    for (int i = 0; i < n_ignore; i++) p->ignore[i] = ignore[i];
    p->n_ignore = n_ignore;
}

int popup_slot(const struct popup *p, uint32_t id) {
    for (int i = 0; i < POPUP_MAX; i++) if (p->s[i].used && p->s[i].id == id) return i;
    return -1;
}

int popup_track(struct popup *p, uint32_t id, uint64_t now_us) {
    if (p->mode == POPUP_OFF) return -1;
    for (int i = 0; i < p->n_ignore; i++) if (p->ignore[i] == id) return -1;
    if (popup_slot(p, id) >= 0) return -1;
    for (int i = 0; i < POPUP_MAX; i++) {
        if (p->s[i].used) continue;
        struct popup_surface *s = &p->s[i];
        memset(s, 0, sizeof *s);
        s->used = 1;
        s->id = id;
        s->seen_us = now_us;
        s->scene = now_us - p->t0 < p->settle_us;
        return i;
    }
    return -1;
}

void popup_visibility(struct popup *p, int slot, int visible, uint64_t now_us) {
    if (slot < 0 || slot >= POPUP_MAX || !p->s[slot].used) return;
    struct popup_surface *s = &p->s[slot];
    visible = visible != 0;
    /* a scene surface's first state: visible then is the scene, not a popup */
    if (s->scene && now_us - s->seen_us < p->settle_us && !s->visible && !s->since_us && visible) {
        s->visible = 1;
        s->baseline = 1;
        return;
    }
    if (visible == s->visible) return;
    s->visible = visible;
    if (visible) s->since_us = now_us;
    else { s->since_us = 0; s->baseline = 0; }
}

void popup_size(struct popup *p, int slot, int w, int h) {
    if (slot < 0 || slot >= POPUP_MAX || !p->s[slot].used) return;
    p->s[slot].w = w;
    p->s[slot].h = h;
}

void popup_dst(struct popup *p, int slot, int x, int y, int w, int h) {
    if (slot < 0 || slot >= POPUP_MAX || !p->s[slot].used) return;
    struct popup_surface *s = &p->s[slot];
    s->dst[0] = x; s->dst[1] = y; s->dst[2] = w; s->dst[3] = h;
    s->have_dst = 1;
}

void popup_gone(struct popup *p, int slot) {
    if (slot < 0 || slot >= POPUP_MAX) return;
    memset(&p->s[slot], 0, sizeof p->s[slot]);
}

static int overlaps(const int a[4], const int b[4]) {
    if (a[2] <= 0 || a[3] <= 0) return 1;            /* no area known: anywhere counts */
    return b[0] < a[0] + a[2] && a[0] < b[0] + b[2] && b[1] < a[1] + a[3] && a[1] < b[1] + b[3];
}

static int counts(const struct popup *p, const struct popup_surface *s, uint64_t now_us) {
    if (!s->used || !s->visible || s->baseline || !s->since_us) return 0;
    if (s->w <= 0 || s->h <= 0) return 0;              /* a visible 0x0 surface shows nothing */
    if (s->have_dst && (s->dst[2] <= 0 || s->dst[3] <= 0 || !overlaps(p->area, s->dst))) return 0;
    if (p->max_us && now_us - s->since_us > p->max_us) return 0;
    return 1;
}

int popup_update(struct popup *p, uint64_t now_us) {
    int any = 0;
    uint32_t id = 0;
    for (int i = 0; i < POPUP_MAX; i++) {
        struct popup_surface *s = &p->s[i];
        s->counted = counts(p, s, now_us);
        if (s->counted && !any) { any = 1; id = s->id; }
    }
    int changed = any != p->active || (any && id != p->active_id);
    p->active = any;
    p->active_id = any ? id : 0;
    return changed;
}
