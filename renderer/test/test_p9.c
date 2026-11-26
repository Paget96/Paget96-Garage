/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage, p96-renderd. See NOTICE.
 *
 * p96-renderd's own drawing (gfx.c) on Mesa's surfaceless EGL:
 *   - glyph texture pages are given back with the apps that used them (F44): apps with big fonts come and go
 *     many times, and text still draws;
 *   - OP_P9_POLY: a see-through polyline is not darker where its segments meet, and its joins are round;
 *   - OP_P9_RCLIP: what follows is clipped to a rounded rect until OP_NOCLIP.
 *   EGL_PLATFORM=surfaceless build/host/test_p9
 */
#include <EGL/egl.h>
#include <GLES2/gl2.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "gfx.h"
#include "proto.h"

static int fails;
#define CHECK(cond, what) do { if (cond) printf("ok   %s\n", what); else { printf("FAIL %s\n", what); fails++; } } while (0)
#define S 64

static uint32_t fw(float f) { uint32_t u; memcpy(&u, &f, 4); return u; }
/* the pixel at device x, y (y down) of the last draw: r g b a */
static void px(int x, int y, uint8_t out[4]) { glReadPixels(x, S - 1 - y, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, out); }
static void draw(gfx_client *c, const uint32_t *ops, size_t n) { gfx_xf xf = { 1, 0, 0 }; gfx_draw(c, &xf, S, S, ops, n, GFX_CLEAR); }

int main(void) {
    EGLDisplay d = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    EGLint ca[] = { EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT, EGL_RED_SIZE, 8, EGL_ALPHA_SIZE, 8, EGL_NONE }, n;
    EGLint xa[] = { EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE }, pa[] = { EGL_WIDTH, S, EGL_HEIGHT, S, EGL_NONE };
    EGLConfig cfg;
    if (!eglInitialize(d, NULL, NULL) || !eglChooseConfig(d, ca, &cfg, 1, &n) || n < 1) { puts("FAIL no EGL"); return 1; }
    eglBindAPI(EGL_OPENGL_ES_API);
    EGLContext ctx = eglCreateContext(d, cfg, EGL_NO_CONTEXT, xa);
    EGLSurface pb = eglCreatePbufferSurface(d, cfg, pa);
    if (!eglMakeCurrent(d, pb, pb, ctx) || gfx_init() < 0) { puts("FAIL no GL context"); return 1; }
    uint8_t p[4];

    /* ---- F44: glyph pages given back. Each app brings 6 atlases of 1024 x 4000 (a whole page column each, as big
       CJK fonts do); 64 MiB of pages hold 16 of them, so without freeing the third app would be refused. ---- */
    {
        size_t big = 1024 * 4000;
        uint8_t *alpha = malloc(big);
        memset(alpha, 255, big);
        int refused = 0;
        for (int round = 0; round < 40; round++) {
            gfx_client a; memset(&a, 0, sizeof a); a.name = "big";
            for (uint32_t id = 1; id <= 6; id++) refused += gfx_atlas(&a, 1000u * (uint32_t)round + id, 1024, 4000, alpha) != 0;
            if (round == 39) {
                /* one glyph of the last atlas, 16 x 16 px of full coverage at 8,8, in white */
                uint32_t ops[] = { OP_GLYPHS, 39006, 0xffffffffu, 1, fw(8), fw(8), fw(16), fw(16), fw(0), fw(0), fw(16), fw(16) };
                draw(&a, ops, sizeof ops / 4);
                px(16, 16, p);
                CHECK(p[3] > 250 && p[0] > 250, "text still draws after 40 apps with big fonts came and went");
            }
            gfx_client_free(&a);
        }
        CHECK(!refused, "no atlas refused in 40 rounds of 6 big ones (their pages are given back)");
        CHECK(gfx_glyph_pages() == 0, "no glyph page left once every app has gone");
        gfx_client a, b; memset(&a, 0, sizeof a); memset(&b, 0, sizeof b); a.name = "a"; b.name = "b";
        gfx_atlas(&a, 7, 64, 64, alpha); gfx_atlas(&b, 7, 64, 64, alpha);
        CHECK(gfx_glyph_pages() == 1 && a.atlas[0].slot == b.atlas[0].slot, "the same atlas in two apps is shared");
        gfx_client_free(&a);
        uint32_t ops[] = { OP_GLYPHS, 7, 0xffffffffu, 1, fw(8), fw(8), fw(16), fw(16), fw(0), fw(0), fw(16), fw(16) };
        draw(&b, ops, sizeof ops / 4);
        px(16, 16, p);
        CHECK(gfx_glyph_pages() == 1 && p[3] > 250, "one app leaving keeps the atlas the other still draws with");
        gfx_client_free(&b);
        CHECK(gfx_glyph_pages() == 0, "the last one leaving frees it");
        free(alpha);
    }

    gfx_client c; memset(&c, 0, sizeof c); c.name = "p9";

    /* ---- OP_P9_POLY: a see-through V, width 10, half white (alpha 0x80) ---- */
    {
        const uint32_t col = 0xffffff80u;
        uint32_t ops[] = { OP_P9_POLY, fw(10), col, 3, fw(8), fw(8), fw(32), fw(40), fw(56), fw(8) };
        draw(&c, ops, sizeof ops / 4);
        px(32, 40, p);
        uint8_t join = p[3];
        px(20, 24, p);
        uint8_t mid = p[3];
        CHECK(mid >= 0x7c && mid <= 0x84, "a segment's middle has the line's own alpha");
        CHECK(join >= 0x7c && join <= 0x84, "the join is not darker (one segment owns each pixel)");
        /* the same V as two upstream LINEs, for comparison: their overlap at the join is darker */
        uint32_t two[] = { OP_LINE, fw(8), fw(8), fw(32), fw(40), fw(10), col, OP_LINE, fw(32), fw(40), fw(56), fw(8), fw(10), col };
        draw(&c, two, sizeof two / 4);
        px(32, 40, p);
        CHECK(p[3] > join + 0x20, "(two upstream lines are darker where they meet)");
        /* round join: the point beyond the corner, inside the half width, is covered */
        draw(&c, ops, sizeof ops / 4);
        px(32, 44, p);
        CHECK(p[3] > 0x70, "the join is round: covered 4 px past the corner");
        px(32, 47, p);
        CHECK(p[3] < 0x10, "and not past its half width");
        /* an opaque polyline over many tiny segments draws (points closer than a quarter width merged) */
        uint32_t many[4 + 2 * 200] = { OP_P9_POLY, fw(6), 0xff0000ffu, 200 };
        for (int i = 0; i < 200; i++) { many[4 + i * 2] = fw(4 + i * 0.28f); many[5 + i * 2] = fw(32); }
        draw(&c, many, 4 + 2 * 200);
        px(30, 32, p);
        CHECK(p[0] > 250 && p[3] > 250, "200 points 0.28 px apart draw a solid line");
        uint32_t one[] = { OP_P9_POLY, fw(8), 0xff0000ffu, 1, fw(32), fw(32) };
        draw(&c, one, sizeof one / 4);
        px(32, 32, p);
        CHECK(p[3] > 250, "a single point is a dot");
    }

    /* ---- OP_P9_RCLIP ---- */
    {
        uint32_t ops[] = { OP_P9_RCLIP, fw(0), fw(0), fw(64), fw(64), fw(20), OP_RECT, fw(0), fw(0), fw(64), fw(64), 0xff0000ffu };
        draw(&c, ops, sizeof ops / 4);
        px(32, 32, p);
        CHECK(p[3] > 250, "inside the rounded clip: drawn");
        px(1, 1, p);
        CHECK(p[3] < 5, "the clip's corner is round: the rect's corner is not drawn");
        px(32, 1, p);
        CHECK(p[3] > 250, "the clip's straight edge: drawn");
        uint32_t after[] = { OP_P9_RCLIP, fw(0), fw(0), fw(64), fw(64), fw(20), OP_NOCLIP, OP_RECT, fw(0), fw(0), fw(64), fw(64), 0xff0000ffu };
        draw(&c, after, sizeof after / 4);
        px(1, 1, p);
        CHECK(p[3] > 250, "OP_NOCLIP ends it");
        uint32_t next[] = { OP_RECT, fw(0), fw(0), fw(64), fw(64), 0xff0000ffu };
        draw(&c, ops, sizeof ops / 4);
        draw(&c, next, sizeof next / 4);
        px(1, 1, p);
        CHECK(p[3] > 250, "a new frame starts without the last frame's clip");
    }
    gfx_client_free(&c);
    printf("%s\n", fails ? "FAILURES" : "p9: all ok");
    return fails != 0;
}
