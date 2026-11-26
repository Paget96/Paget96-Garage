# Health

Part of [Paget96 Garage](../../README.md) by Danijel Markov (Paget96), id `p96_health`.


One look at the whole car: what the control units have stored, how the 12 V battery really is, what service
is due, whether a tyre is losing air, the fluids, and one score from 0 to 100 that sums it up. Every fault scan
is kept, so you see when a fault came and went. Save a report before you clear faults, and show the whole thing
to your mechanic as a QR code that any phone camera reads.

Health shows only what your car reports: a page, card, chart line, setting or button appears once your car
answers it (found the first time, remembered for that car). A car without tyre pressure sensors has no Tyres page,
and only the service items the car itself can reset get a Reset. The screenshots use demo data, which shows everything.

![Health working](../../docs/media/p96_health/demo.gif)

| Page | Screenshot |
|---|---|
| Overview: the score and six checks | ![](../../docs/media/p96_health/overview.png) |
| Faults by unit: fault memory | ![](../../docs/media/p96_health/faults.png) |
| Faults: info memory | ![](../../docs/media/p96_health/faults-info.png) |
| Faults: permanent emission faults | ![](../../docs/media/p96_health/faults-permanent.png) |
| Faults: one unit | ![](../../docs/media/p96_health/faults-unit.png) |
| Faults: details and freeze frame | ![](../../docs/media/p96_health/fault-details.png) |
| Faults: history (every scan kept) | ![](../../docs/media/p96_health/faults-history.png) |
| Faults: readiness (engine light and emission monitors) | ![](../../docs/media/p96_health/faults-readiness.png) |
| Clear faults: the confirmation (the engine unit not ticked) | ![](../../docs/media/p96_health/clear.png) |
| Clear faults: the engine unit ticked, with its warning | ![](../../docs/media/p96_health/clear-engine.png) |
| Clear faults: what came back | ![](../../docs/media/p96_health/cleared.png) |
| Battery: resting voltage, start dip, charge, 14 nights | ![](../../docs/media/p96_health/battery.png) |
| Service: the car's items, our intervals, your parts | ![](../../docs/media/p96_health/service.png) |
| Service: add a part | ![](../../docs/media/p96_health/service-add.png) |
| Service: reset one of the car's items | ![](../../docs/media/p96_health/service-reset.png) |
| Tyres: pressures and the 4 week trend | ![](../../docs/media/p96_health/tyres.png) |
| Fluids: levels and warm-up | ![](../../docs/media/p96_health/fluids.png) |
| Engine: a bar per cylinder (misfires, rough running, ignition), knock, camshafts, lambda, rail | ![](../../docs/media/p96_health/engine.png) |
| History: score over 12 weeks, what changed | ![](../../docs/media/p96_health/history.png) |
| Share: the report as a QR code | ![](../../docs/media/p96_health/share.png) |
| A reminder when something is due | ![](../../docs/media/p96_health/reminder.png) |
| Info popup (every card has an (i)) | ![](../../docs/media/p96_health/popup.png) |
| How to use | ![](../../docs/media/p96_health/help.png) |
| Settings | ![](../../docs/media/p96_health/settings.png) |

Every card's info popup is in [../../docs/media/p96_health/popups/](../../docs/media/p96_health/popups/).

**What it reads from the car.** From the car's own broadcasts: engine speed, oil and coolant temperature, the
12 V charge the battery sensor reports, the speed (Health counts the km it sees), the tyre pressures, the
service list the cluster shows, and the Check Control messages. Over the head unit's diagnostic link, only while
Health's screen is shown: the fault memory and info memory of every unit, the engine's permanent emission faults,
a fault's freeze frame when you open it, and from the engine unit the 12 V voltage, the oil level and the km on the
oil and spark plugs. While the Faults page is shown, the engine unit's OBD readiness (service 01, PID 01 and, when the
car answers it, PID 41 for this drive): the engine light and each emission monitor the car has, ready or not. Nothing is read in the background over the diagnostic link.

**What it writes, and only these two.** Both only when you tap and confirm, with the engine off and the ignition on,
never by themselves:

- **Clear faults** empties the fault memory of the units you tick (UDS 14 FF FF FF to each of them, never to all
  units at once), the way a workshop tester does. Every unit with a fault is ticked for you except the engine unit
  (DME): it needs its own tick, also with "All but the engine". Clearing it also sets the OBD readiness monitors
  (catalyst, oxygen sensors, misfire, fuel system and the others) back to not ready and erases its freeze frames;
  they come back only after a drive cycle, so an emissions test can fail until then. The dialog says so as soon as
  the engine unit is ticked. The learned adaptations (fuel trims, throttle, knock) are a separate function and
  should not be cleared by this (not yet checked on a car). Health saves the full report first. Info memory and
  permanent emission faults stay. Afterwards it scans again and shows which faults came back at once: their cause
  is still there; after an engine unit clear it says the readiness was reset and opens Faults, Readiness on a tap.
  History notes the clear and each monitor that is ready again.
- **Reset a service item** (oil, front or rear brakes, brake fluid, vehicle check) in the instrument cluster, the
  workshop's own CBS reset, and only when the cluster itself says the item may be reset now. Afterwards the item is
  read again.

**Limits.**

- The 12 V resting voltage has no broadcast signal, so Health reads it the first time you open it after the car
  slept for 3 hours or more, with the engine off. A night you do not open Health has no reading.
- The dip at start is measured only when you start the engine with Health open.
- Fault texts: the car keeps none and BMW's text tables are not ours to share, so a fault Health has no words for
  shows its code and unit: look it up by both.
- Coolant and washer fluid have only a low warning in the car, no level.
- Readiness is read only, and never lowers the score: not ready after a clear is normal. It is read only while the
  Faults page is shown, so History notes a monitor ready again when Health next sees it, not the moment it finished.
- Air filter, gearbox oil and coolant are counted from when you mark them done on the Service page.
- Health cannot put up a notification on the screen: reminders show on its home-screen widget and once when you
  open the app.
- Tested on the PC preview with demo data only. ID7 head units only for now.

**Works with.** Every BMW with the MGU Store on an iDrive 7 head unit. The Engine page has one bar for each of the car's
cylinders, as many as its engine unit lists (3, 4, 6 or 8); a V8's two banks side by side, bank 2's ignition from its
second engine unit. Petrol: misfires, rough running, ignition angle, knock control, the camshafts, lambda and the rail
pressure. Diesel: rough running and the rail pressure on its own scale (up to about 2 700 bar), glow plugs, fuel
filter and AdBlue among the service parts, no spark plug interval, the diesel readiness monitors. Electric: no
Engine page and no engine items in Service. Settings, Demo car shows each layout.

| Car | Screenshot |
|---|---|
| V8: misfires per cylinder, bank 1 and bank 2 | ![](../../docs/media/cars/health-engine-s63-v8.png) |
| Six cylinders: rough running | ![](../../docs/media/cars/health-engine-b58.png) |
| Diesel: rough running and the rail pressure | ![](../../docs/media/cars/health-engine-b57-diesel.png) |

**Settings.** The Display block (the same in every Paget96 Garage app): Renderer, Frame rate (60 fps by default),
Follow ambient lighting, Demo data, and while the demo runs Demo car (B48, B58, S58, S63 V8, B57 diesel, PHEV or EV). Then Health's own: Nightly battery check (on or off), Battery warning at (the
resting voltage that counts as low, 12.4 V by default), Tyre warning at (how much lower than the other three a tyre
may be, 0.1 bar), Units, Our intervals (strict or as the car), and the interval of each of our items (engine oil,
spark plugs, air filter, gearbox oil, coolant), which you can also change by tapping the item on the Service page.
