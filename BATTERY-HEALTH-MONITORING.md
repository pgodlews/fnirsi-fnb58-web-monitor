# Lithium-Ion Battery Health Monitoring Guide

Using the FNB58 BLE Monitor for preventative maintenance of Li-ion powered
devices — phones, power banks, laptops, tools, e-bikes and similar.

---

## 1. What this tool actually measures

The FNB58 sits **inline on a USB cable**. It does **not** probe the battery cell
directly — it measures the power crossing the USB connection:

| Signal | Tab | What it tells you |
|--------|-----|-------------------|
| Bus voltage (V) | V / A | Supply rail level / PD profile in use |
| Bus current (A) | V / A | Charge or discharge rate |
| Accumulated Ah / Wh | Capacity | Total charge / energy moved this cycle |
| D+ / D- (V) | D+ / D− | Fast-charge protocol negotiation lines |
| Temperature (°C) | Temp | **The FNB58 meter's own internal temperature** |

Because you are watching the **device's charge controller** at work, you infer
battery health from *how the controller behaves*, not from raw cell voltage.

> **Important — what the Temp tab is NOT.** The temperature comes from a sensor
> *inside the FNB58 meter*. It is **not** the temperature of the battery or the
> charged device. Treat it as ambient/meter context only — see Section 3.7.

> **Charging** = meter between charger and device. Current flows **into** the device.
> **Discharging** = meter between a power bank (or device acting as source) and a load.
> Current flows **out** of the battery.

---

## 2. The healthy reference: CC-CV charging

A healthy Li-ion charge cycle follows **Constant-Current / Constant-Voltage**:

```
 Current │ ▔▔▔▔▔▔▔▔▔▔▔▔▔╲
         │   CC phase    ╲___ taper
         │                   ╲▁▁▁▁▁▁  ← CV phase
         └──────────────────────────── time

 Voltage │              ╱▔▔▔▔▔▔▔▔▔▔▔
         │   rising    ╱  held flat
         │ ▁▁▁▁▁▁▁▁▁▁▁╱
         └──────────────────────────── time
```

- **CC phase** — current sits on a flat plateau; voltage climbs steadily.
- **Knee** — controller hits the per-cell voltage limit (~4.2 V/cell).
- **CV phase** — voltage flat, current decays in a smooth exponential tail.
- **Termination** — current falls to roughly C/10–C/20, then near zero.

**On the V/A tab this looks like:** a flat-topped current trace with a clean
exponential decay tail, and a voltage trace that rises then goes flat.
**On the Capacity tab:** Ah/Wh rises fast and linearly during CC, then bends
over and flattens as CV tapers — an "ankle"-shaped curve.

This shape — recorded once on a known-good device — is your **baseline**.

---

## 3. Charging patterns to watch for

### 3.1 Shortened CC phase / premature taper
```
 Current │ ▔▔▔▔╲___          ← taper starts much earlier than baseline
         │      ╲▁▁▁▁▁▁▁▁
         └────────────────── time
```
The pack reaches its voltage limit early because usable capacity has fallen.
**Meaning:** capacity fade / cell aging. **Action:** compare total Ah at full
charge against baseline (Section 6).

### 3.2 Reduced total Ah at full charge
Capacity tab endpoint is noticeably lower than the baseline session for the
same start-of-charge state. This is the **single clearest aging signal**.
Li-ion is generally considered end-of-life at **≈80 % of original capacity**.

### 3.3 Erratic / oscillating current
```
 Current │ ╱╲  ╱╲╱╲   ╱╲      ← jagged, no stable plateau
         │╱  ╲╱    ╲╱╲╱  ╲
         └────────────────── time
```
**Meaning:** poor cable/connector contact, a failing charge controller, or a
charger that can't hold its output. **Action:** swap cable and charger first;
if it persists with known-good gear, suspect the device.

### 3.4 No taper — current never drops
Current stays on the plateau far past the expected charge time.
**Meaning:** termination logic not engaging — possible controller fault.
**Action:** stop the charge and investigate. Do not leave unattended.

### 3.5 Voltage sag or instability during charge
The voltage trace dips or wanders instead of holding its PD level.
**Meaning:** weak charger, undersized cable, or high contact resistance.
A cable that sags badly also slows charging and generates heat.

### 3.6 Wrong / downgraded protocol (D+/D- tab)
The protocol label is a **D+/D- estimate** for some legacy charging schemes.
USB-C PD and PPS negotiate on CC, so their negotiation cannot be identified
from this tab. Idle data lines show unknown (`—`) and do not imply a charger
or cable fault. For legacy charging schemes, watch for:
- D+/D- **jumping around** → repeated renegotiation, usually a marginal cable.
- An unexpected estimate → compare with known-good gear and the meter's own
  protocol display before drawing conclusions about a mismatch.

### 3.7 The Temp tab — meter temperature, read with caution
The Temp tab shows the **FNB58's own internal temperature**, not the battery's.
A USB power meter has no contact with the cell, so it cannot tell you whether
the pack is overheating. What the meter's temperature *does* reflect:

- **Ambient temperature** — the environment the test is running in. Useful
  context: a charge done at 10 °C and one done at 35 °C are not comparable.
- **Self-heating from sustained current** — I²R losses in the meter's own shunt
  and connectors warm it up; a high, steady current shows as a gentle rise.
- **A resistive joint at the meter itself** — if the meter runs unusually hot
  for a modest current, suspect a dirty or loose connector *on the meter*, not
  the battery.

For genuine battery thermal monitoring you need a sensor **on the pack** (an IR
thermometer or a thermocouple) — the FNB58 cannot provide that. Use the Temp
tab to normalise comparisons (test at similar ambient) and to catch a bad
connection at the meter, nothing more.

---

## 4. Discharging patterns to watch for

(Device acting as a power source — e.g. a power bank driving a load.)

### 4.1 Voltage sag under load
```
 Voltage │▔▔▔╲              ← bigger drop when load is applied
         │    ╲▁▁▁▁▁▁▁▁▁
         └────────────────── time
```
Compare the loaded voltage to the no-load voltage. A **larger sag than baseline**
for the same current = **higher internal resistance** = an aging pack.

### 4.2 Declining deliverable Ah / Wh
Run the pack down under a fixed load and read the Capacity tab endpoint.
A steady month-over-month decline is capacity fade.

### 4.3 Premature voltage collapse
Voltage holds, then drops off a cliff well before the expected runtime.
**Meaning:** a weak or imbalanced cell hitting its floor early.

### 4.4 Note on temperature during discharge
The Temp tab still only reports the **meter's** temperature, not the pack's
(see Section 3.7). To judge whether a pack runs hot under load — a real sign of
high internal resistance — measure the pack directly with an IR thermometer.
The meter's reading is only useful here as ambient context.

---

## 5. How to read each tab for maintenance

| Tab | Charging use | Discharging use |
|-----|--------------|-----------------|
| **V / A** | CC plateau width, taper shape, voltage knee | Voltage sag, current stability |
| **Capacity** | Total Ah/Wh delivered to full — capacity-fade trend | Total Ah/Wh extracted before cutoff |
| **D+ / D−** | Legacy protocol estimate and data-line stability; cannot identify PD/PPS | (usually flat — less relevant) |
| **Temp** | Meter temperature only — use to confirm similar ambient between tests | Same — ambient context, not pack heat |

Use the **PNG export** to snapshot each tab — the screenshot now stamps the
start→end time, so dated images can be filed against a device.

---

## 6. A preventative-maintenance workflow

1. **Baseline (device new / known-good).**
   Charge from a consistent low state to full. Record the session
   (name it e.g. `PowerBank-A baseline`). Export the CSV and a PNG of each tab.
   Note: total Ah/Wh at full, charge duration, ambient temperature, taper shape.

2. **Standardise the test.** Always re-test with the *same* charger, *same*
   cable, and as close to the *same* start state as practical. Only then are
   sessions comparable.

3. **Re-test periodically** — monthly for heavily used packs, quarterly
   otherwise. Record under the same name + date.

4. **Compare the trend**, not a single reading:
   - Total Ah at full charge — falling toward 80 % of baseline → degraded.
   - Charge duration — lengthening → aging or higher resistance.
   - CV taper — starting earlier / steeper → reduced usable capacity.
   - Voltage sag under load — growing → rising internal resistance.

5. **Act on thresholds:**

| Indicator | Healthy | Watch | Replace / investigate |
|-----------|---------|-------|-----------------------|
| Full-charge capacity vs baseline | >90 % | 80–90 % | <80 % |
| Voltage sag under rated load | <3 % | 3–5 % | >5 % |
| Charge duration vs baseline | ≈baseline | +10–25 % | >+25 % |
| D+/D- (legacy charging only) | stable, expected | occasional changes | repeated changes with known-good gear; confirm on meter |

The Temp tab is deliberately absent from this table — it reports the meter's
own temperature and is not a battery-health threshold. Use it only to confirm
that two sessions were run at a comparable ambient temperature.

---

## 7. Working with the CSV

Each row is one aggregation bucket. Relevant columns for battery analysis:

- `v_avg / v_min / v_max` — bus voltage; spread shows ripple/sag.
- `a_avg / a_min / a_max` — current; the plateau and taper live here.
- `w_avg` — power.
- `ah_end / wh_end` — **cumulative** capacity at the end of the bucket. The last
  row's value is the total for the cycle. Plot `ah_end` vs time for the
  capacity curve; subtract baseline endpoint to quantify fade.
- `temp_avg / temp_min / temp_max` — the **meter's** temperature, not the
  battery's (blank if no temp packets). Use only as ambient context.
- `start_local / end_local` — wall-clock start/end of the bucket in the
  browser's local timezone (`YYYY-MM-DD HH:MM:SS`). The CSV header records the
  timezone name and session start time. Blank for sessions recorded before this
  column existed.
- `t0 / t1` — seconds since the page loaded; useful as relative offsets within
  a session. For absolute time use `start_local` / `end_local`.

---

## 8. Limitations to keep in mind

- The meter sees the **USB bus**, not the cell — you are inferring health from
  charge-controller behaviour, which is one step removed from the chemistry.
- Multi-cell packs (laptops, e-bikes) are read at the pack terminals; a single
  weak cell can hide behind a healthy-looking pack average.
- Comparisons are only meaningful when the **charger, cable and start state**
  are held constant between sessions.
- The Temp tab is the **meter's internal temperature**, not the battery's. The
  FNB58 cannot sense pack temperature — use a separate IR thermometer or
  thermocouple for that.
- The live buffer holds up to 24 h; for longer studies rely on the CSV exports.
