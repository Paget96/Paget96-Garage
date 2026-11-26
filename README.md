# Paget96 Garage

<!-- hero GIF: docs/media/hero.gif (960 px wide, under 3 MB), added with the first app -->

Paget96 Garage is a set of apps for the BMW iDrive 7 head unit (MGU), made by Paget96. They run on
a rooted head unit next to BMW's own apps, read what the car already reports, and show it in one
modern look: dark glass cards, orange accents, live numbers. Every app in this repository is
installed and updated from the MGU Store.

> **Status:** the repository is being set up. The first apps are coming; nothing is installable yet.

## Contents

- [Install](#install)
- [The apps](#the-apps)
- [Building](#building)
- [Contributing](#contributing)
- [Credits](#credits)
- [Disclaimer](#disclaimer)
- [License](#license)

## Install

### From the MGU Store (recommended)

The Store builds each app on the head unit straight from this repository.

1. Open the MGU Store on the head unit.
2. Settings, **Add source**, then type `Paget96/garage`.
3. Pick an app from the list and install it.

Updates arrive in the Store like any other source's. Garage apps draw through the GPU renderer from
[idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) (a default Store source); the
Store installs it with the first app that needs it.

### Manual

For development only: build a package on a PC (see [Building](#building)) and install the
`dist/<id>@<version>.tgz` with the MGU Store's stick or deploy tool, as its
[publishing guide](https://github.com/robertnisipeanu/mgu-store/blob/main/docs/PUBLISHING.md)
describes.

## The apps

| | App | What it does |
|---|---|---|
| | *coming* | The first apps are being moved into Garage. |

<!--
One row per app, in this form:
| <img src="apps/<id>/icon.png" width="48"> | [<Name>](#<id>) | one line |

Then one section per app, in this form (and the same text in apps/<id>/README.md):

<a id="<id>"></a>
### <Name>

What it is for, in two or three sentences.

![<Name> working](docs/media/<id>/demo.gif)

| Page | Screenshot |
|---|---|
| <page> | ![](docs/media/<id>/<page>.png) |

**What it reads from the car:** the signals, in plain words.
**Limits:** what it cannot do.
**Settings:** each setting and what it changes.

tools/check_docs.py fails the build when an app has no section, no GIF or no screenshot.
-->

## Building

You need Python 3 and Node.js (the head unit runs Node 8.16.2 and Python 3.12; code stays Node 8
compatible). BMW's oap-sdk is not in this repository and never will be: the MGU Store takes it
from the head unit. For a local build, put your own copy in `oap-sdk/` (ignored by git).

```
python tools/build.py <app id>      # dist/<id>@<version>.tgz
python tools/check_docs.py          # every app documented, icons in spec, no em dashes
node tools/ui_demo.js               # the Garage UI reference page, docs/design/ui-demo.png
python tools/make_icon.py clock apps/<id>/icon.png
```

How the pieces fit:

- `upstream-kit/` is a pinned copy of the kit from
  [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) (the commit is in
  [NOTICE](NOTICE)). It is vendored, not a submodule, because the MGU Store does not fetch
  submodules. Refresh it with `python tools/sync_upstream_kit.py <idrive7-apps checkout> [<commit>]`.
- `tools/build.py` stages a tree upstream's build understands and runs it.
- `lib/ui.js` is the Garage look on top of the kit ([docs/DESIGN.md](docs/DESIGN.md)).
- `mgu-repo.json` tells the MGU Store how to build each app.
- Icons follow one template ([docs/ICONS.md](docs/ICONS.md)).

## Contributing

Issues and pull requests are welcome. Anything that is useful beyond Garage (a fix in the kit, a
new signal) goes to [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) as a pull
request first, and comes here with the next kit sync. App ids start with `p96_`. Text never uses
an em dash or an en dash.

## Credits

- The app kit (runtime, GPU renderer, build tools) is
  [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) by cauliflowermossgrape and
  contributors, MIT licensed. See [NOTICE](NOTICE).
- Installation and updates: [MGU Store](https://github.com/robertnisipeanu/mgu-store) by
  robertnisipeanu.

## Disclaimer

These apps run on a rooted head unit. Rooting and installing third-party software is at your own
risk and may affect your warranty. The apps only read data the car already reports, except where
an app's own section names a write. Do not use them in a way that distracts you while driving.
Paget96 Garage is not affiliated with, endorsed by or connected to BMW AG. BMW and iDrive are
trademarks of BMW AG.

## License

[MIT](LICENSE). The vendored kit keeps its own MIT notice ([NOTICE](NOTICE)).
