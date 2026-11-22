const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { IDBFactory } = require('fake-indexeddb');

// Exercise the shipped single-file app without changing its runtime packaging.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/init\(\);\s*$/, '');

class Emitter {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(cb);
  }
  removeEventListener(type, cb) { this.listeners.get(type)?.delete(cb); }
  emit(type, event = {}) {
    return Promise.all(Array.from(this.listeners.get(type) || [], cb => cb({ target: this, ...event })));
  }
  count(type) { return this.listeners.get(type)?.size || 0; }
}

function fixture({ delay = cb => cb() } = {}) {
  let seconds = 0;
  let wall = Date.UTC(2026, 9, 10, 10);
  const elements = new Map();
  const labels = [];
  const downloads = [];
  const alerts = [];
  const timers = [];
  const classes = () => ({ add() {}, remove() {}, toggle() {} });
  const context2d = () => new Proxy({}, {
    get(obj, key) {
      if (key in obj) return obj[key];
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (key === 'fillText') return text => labels.push(text);
      return () => {};
    },
  });
  function element(id) {
    if (!elements.has(id)) {
      const el = Object.assign(new Emitter(), {
        textContent: '', innerHTML: '', disabled: false, dataset: {}, style: {}, classList: classes(),
        value: id === 'selGroup' ? '6' : 'Test session', parentElement: {},
        querySelector() { return element(id + ':child'); }, querySelectorAll() { return []; },
        click() { downloads.push(this.download); return this.emit('click'); },
        getBoundingClientRect() { return { width: 800, height: 300 }; },
        getContext() { return this.ctx ||= context2d(); },
        toDataURL() { return 'data:image/png;base64,'; },
      });
      elements.set(id, el);
    }
    return elements.get(id);
  }
  const blobs = [];
  const sandbox = vm.createContext({
    Uint8Array, DataView, Number, Math, Promise, Intl, Blob,
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [wall])); }
      static now() { return wall; }
    },
    console: { log() {}, error() {} },
    indexedDB: new IDBFactory(), performance: { now: () => seconds * 1000 },
    document: { getElementById: element, createElement: element, body: { classList: classes() } },
    window: { devicePixelRatio: 1 }, navigator: {},
    ResizeObserver: class { observe() {} },
    setTimeout: delay,
    setInterval: cb => { timers.push(cb); return timers.length; }, clearInterval() {},
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    alert: text => alerts.push(text),
  });
  vm.runInContext(script + `\nglobalThis.api = {
    parsePackets, makeCmd, BleClient, Chart, Logger, min, max, inferProtocol,
    state, onMeasurement, onGroupData, onStatus, updateMetrics, exportSessionCsv, startDemo, decimate, firstIndex
  };`, sandbox);
  const api = sandbox.api;
  api.state.chart = new api.Chart(element('chart'));
  return {
    ...api, sandbox, element, labels, downloads, alerts, blobs, timers,
    setTime(s, ms = Date.UTC(2026, 9, 10, 10) + s * 1000) { seconds = s; wall = ms; },
    async click(id) { await element(id).emit('click'); },
  };
}

const point = t => ({ t, v: 5, a: 1, wh: 2, ah: 1, dp: 0.6, dn: 0.6, temp: 25 });

test('valid notification frames survive every split position', () => {
  const f = fixture();
  const frame = f.makeCmd(0x07, [0x88, 0x13, 0xe8, 0x03]);
  for (let split = 1; split < frame.length; split++) {
    const client = new f.BleClient();
    const readings = [];
    client.onMeasurement = m => readings.push(m);
    client._onData(new DataView(frame.slice(0, split).buffer));
    assert.equal(readings.length, 0);
    client._onData(new DataView(frame.slice(split).buffer));
    assert.equal(readings.length, 1, `split ${split}`);
    assert.equal(readings[0].vbus, 5);
    assert.equal(readings[0].ibus, 1);
    assert.equal(client._rxBuf.length, 0);
  }
});

test('parser rejects a corrupt frame and recovers the next valid frame', () => {
  const f = fixture();
  const valid = f.makeCmd(0x07, [0x88, 0x13, 0xe8, 0x03]);
  const corrupt = valid.slice(); corrupt[corrupt.length - 1] ^= 0xff;
  const result = f.parsePackets(new Uint8Array([0, 1, ...corrupt, ...valid, ...valid]));
  assert.equal(result.packets.length, 2);
});

test('notification DataViews respect their byte range', () => {
  const f = fixture();
  const frame = f.makeCmd(0x07, [0x88, 0x13, 0xe8, 0x03]);
  const backing = new Uint8Array([...frame, ...frame, ...frame]);
  const client = new f.BleClient(); let count = 0;
  client.onMeasurement = () => count++;
  client._onData(new DataView(backing.buffer, frame.length, frame.length));
  assert.equal(count, 1);
});

test('all four tabs draw 144,000 retained readings without argument overflow', () => {
  const f = fixture(); f.setTime(14400);
  const chart = f.state.chart;
  chart.data = Array.from({ length: 144000 }, (_, i) => point(i / 10));
  for (const tab of ['va', 'capacity', 'dpdn', 'temp']) {
    chart.setTab(tab);
    assert.doesNotThrow(() => chart.draw(), tab);
  }
  assert.equal(f.max(Array.from({ length: 144000 }, (_, i) => i)), 143999);
  assert.equal(f.min(Array.from({ length: 144000 }, (_, i) => -i)), -143999);
});

test('frozen charts retain their endpoint and honor fixed and auto windows', () => {
  const f = fixture(); const chart = f.state.chart;
  let drawnWindow;
  const drawFrame = chart._drawSharedFrame.bind(chart);
  chart._drawSharedFrame = (...args) => { drawnWindow = args[7]; drawFrame(...args); };
  chart.data = [point(0), point(7200)];
  f.setTime(7200); chart.setMode('fixed', 60); chart.freeze();
  f.setTime(10800); chart.draw();
  assert.equal(chart.frozenAt, 7200);
  assert.equal(drawnWindow, 60);
  chart.setMode('fixed', 300); chart.draw();
  assert.equal(drawnWindow, 300);
  chart.setMode('auto'); chart.draw();
  assert.equal(drawnWindow, 7200);
  chart.unfreeze(); chart.draw();
  assert.equal(drawnWindow, 10800);
});

test('freezing at time zero and repeated freeze calls retain the same endpoint', () => {
  const f = fixture(); const chart = f.state.chart;
  chart.freeze(); f.setTime(100); chart.freeze(); chart.draw();
  assert.equal(chart.frozenAt, 0);
  assert.equal(chart.drawnRange.endWall, Date.UTC(2026, 9, 10, 10));
});

test('PNG labels match the frozen displayed range, including later window changes', async () => {
  const f = fixture(); const chart = f.state.chart;
  chart.data = [point(0), point(7200)];
  f.setTime(7200); chart.setMode('fixed', 60); chart.freeze();
  f.setTime(10800); await f.click('btnExportPng');
  assert.equal(f.labels.at(-1), '2026-10-10 11:59:00 UTC  →  2026-10-10 12:00:00 UTC');
  chart.setMode('auto'); await f.click('btnExportPng');
  assert.equal(f.labels.at(-1), '2026-10-10 10:00:00 UTC  →  2026-10-10 12:00:00 UTC');
  assert.equal(f.downloads.length, 2);
});

test('only electrical samples affect statistics, including zero current', () => {
  const f = fixture();
  f.onMeasurement({ vbus: 5, ibus: 1, power: 5 });
  for (let i = 0; i < 10; i++) {
    f.onMeasurement({ temp: 25 });
    f.onMeasurement({ dp: 0.6, dn: 0.6 });
    f.onGroupData({ group: 6, wh: 1, ah: 1 });
    f.updateMetrics();
  }
  f.onMeasurement({ vbus: 5, ibus: 3, power: 15 });
  assert.equal(f.state.stats.pN, 2);
  assert.equal(f.state.stats.pSum / f.state.stats.pN, 10);
  f.onMeasurement({ vbus: 5, ibus: 0, power: 0 });
  assert.equal(f.state.stats.pN, 3);
  assert.equal(f.state.stats.iMin, 0);
  assert.equal(f.state.stats.iMax, 3);
  assert.equal(f.state.stats.pMax, 15);
  assert.equal(f.element('mPowerAvg').textContent, '6.67W');
});

test('demo measurements still update statistics', () => {
  const f = fixture(); f.startDemo(); f.timers[0](); f.timers[0]();
  assert.equal(f.state.stats.pN, 2);
  assert.ok(f.state.stats.pSum > 0);
});

test('D+/D− heuristics never assert a PD/PPS contract or DCP from idle lines', () => {
  const f = fixture();
  for (const [dp, dn] of [[0, 0], [0.5, 2], [2.5, 0.5]]) assert.equal(f.inferProtocol(dp, dn), '—');
  assert.equal(f.inferProtocol(0.6, 0.6), 'QC 2.0');
});

test('live CSV includes the first partial bucket without stopping recording', async () => {
  const f = fixture(); const logger = f.state.logger;
  await logger.init();
  const id = await logger.startSession('Live export', 6);
  f.state.recording = true;
  f.onMeasurement({ vbus: 5, ibus: 1, power: 5 });
  const session = (await logger.listSessions())[0];
  await f.exportSessionCsv(session);
  assert.equal(f.alerts.length, 0);
  assert.equal(logger.sessionId, id);
  assert.equal(f.state.recording, true);
  assert.equal((await logger.getSamples(id)).length, 1);
  assert.match(await f.blobs[0].text(), /,6,5,5,5,1,1,1,5,5,5,/);
  f.setTime(2); f.onMeasurement({ vbus: 5, ibus: 2, power: 10 });
  await f.exportSessionCsv(session);
  const samples = await logger.getSamples(id);
  assert.equal(samples.reduce((n, sample) => n + sample.n, 0), 2);
  await logger.stopSession();
  assert.equal((await logger.getSamples(id)).length, 2);
});

test('historical CSV export does not flush another active session', async () => {
  const f = fixture(); const logger = f.state.logger;
  await logger.init();
  const oldId = await logger.startSession('Old', 6);
  logger.ingest({ t: 0, wall: 0, v: 5, a: 1 }); await logger.stopSession();
  const oldSession = (await logger.listSessions()).find(s => s.id === oldId);
  const newId = await logger.startSession('New', 6);
  logger.ingest({ t: 1, wall: 1000, v: 5, a: 2 });
  await f.exportSessionCsv(oldSession);
  assert.equal((await logger.getSamples(newId)).length, 0);
  await logger.stopSession();
  assert.equal((await logger.getSamples(newId)).length, 1);
});

function bleDevice(f, fail) {
  const notify = Object.assign(new Emitter(), {
    async startNotifications() { if (fail === 'notifications') throw new Error('Notifications failed'); },
    async stopNotifications() {},
  });
  const write = { async writeValueWithoutResponse() { if (fail === 'write') throw new Error('Write failed'); } };
  const device = new Emitter();
  device.gatt = {
    connected: false,
    async connect() { this.connected = true; return this; },
    async getPrimaryService(uuid) {
      if (fail === 'service') throw new Error('Service discovery failed');
      return { async getCharacteristic() { return uuid.includes('ffe0') ? notify : write; } };
    },
    disconnect() { this.connected = false; device.emit('gattserverdisconnected'); },
  };
  f.sandbox.navigator.bluetooth = { async requestDevice() { return device; } };
  return { device, notify };
}

for (const stage of ['service', 'notifications', 'write']) {
  test(`failed ${stage} setup closes GATT, clears listeners and permits retry`, async () => {
    const f = fixture();
    f.element('btnDisconnect').disabled = true;
    f.element('btnStream').disabled = true;
    const broken = bleDevice(f, stage);
    await f.click('btnConnect');
    assert.equal(broken.device.gatt.connected, false);
    assert.equal(broken.device.count('gattserverdisconnected'), 0);
    assert.equal(broken.notify.count('characteristicvaluechanged'), 0);
    assert.equal(f.state.connected, false);
    assert.equal(f.state.connecting, false);
    assert.equal(f.state.client.charWrite, null);
    assert.equal(f.element('btnConnect').disabled, false);
    assert.equal(f.element('btnDisconnect').disabled, true);
    assert.equal(f.element('btnStream').disabled, true);
    const working = bleDevice(f);
    await f.click('btnConnect');
    assert.equal(f.state.streaming, true);
    assert.equal(working.device.gatt.connected, true);
    await f.click('btnDisconnect');
    assert.equal(working.device.gatt.connected, false);
    assert.equal(working.notify.count('characteristicvaluechanged'), 0);
  });
}

test('reconnecting the same characteristic does not duplicate measurements', async () => {
  const f = fixture(); const { device, notify } = bleDevice(f);
  await f.click('btnConnect'); await f.click('btnDisconnect'); await f.click('btnConnect');
  assert.equal(notify.count('characteristicvaluechanged'), 1);
  assert.equal(device.count('gattserverdisconnected'), 1);
  const frame = f.makeCmd(0x07, [0x88, 0x13, 0xe8, 0x03]);
  notify.value = new DataView(frame.buffer);
  await notify.emit('characteristicvaluechanged');
  assert.equal(f.state.stats.pN, 1);
  await f.click('btnDisconnect');
});

test('disconnect during initialization cannot revive a stale stream', async () => {
  const delays = [];
  const f = fixture({ delay: cb => delays.push(cb) });
  const { device } = bleDevice(f);
  const connecting = f.click('btnConnect');
  await new Promise(setImmediate);
  assert.equal(delays.length, 1);
  assert.equal(f.element('btnConnect').disabled, true);
  await f.click('btnConnect');
  assert.equal(delays.length, 1, 'a second connect attempt must not start');
  device.gatt.disconnect();
  delays[0]();
  await connecting;
  assert.equal(f.state.connected, false);
  assert.equal(f.state.streaming, false);
  assert.equal(f.state.client.charWrite, null);
  assert.equal(f.element('btnConnect').disabled, false);
});

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test('time-axis labels state the exact offset instead of flooring to whole minutes', () => {
  const f = fixture(); const chart = f.state.chart;
  const ticks = win => Array.from({ length: 7 }, (_, i) => chart.fmtTime(win - win * i / 6));
  assert.deepEqual(ticks(60), ['-1m', '-50s', '-40s', '-30s', '-20s', '-10s', 'now']);
  assert.deepEqual(ticks(300), ['-5m', '-4m10s', '-3m20s', '-2m30s', '-1m40s', '-50s', 'now']);
  assert.deepEqual(ticks(14400), ['-4h', '-3h20m', '-2h40m', '-2h', '-1h20m', '-40m', 'now']);
  assert.equal(chart.fmtTime(3599.7), '-1h');
});

test('long histories are reduced per pixel column without losing extremes', () => {
  const f = fixture();
  const data = Array.from({ length: 144000 }, (_, i) => ({ ...point(i / 10), v: 5, a: 1 }));
  data[70001].v = 20; data[70002].a = 0; data[5].temp = NaN;
  const out = f.decimate(data, 0, data.length, 0, 14400, 700, ['v', 'a']);
  assert.ok(out.length <= 700 * 6, `kept ${out.length}`);
  assert.equal(f.max(out.map(d => d.v)), 20);
  assert.equal(f.min(out.map(d => d.a)), 0);
  assert.equal(out[0], data[0]);
  assert.equal(out.at(-1), data.at(-1));
  assert.ok(out.every((d, i) => !i || d.t > out[i - 1].t), 'time order preserved');
  const few = f.decimate(data, 10, 500, 1, 49, 700, ['v', 'a']);
  assert.equal(few.length, 490, 'short ranges are passed through untouched');
  assert.equal(f.firstIndex(data, 1, false), 10);
  assert.equal(f.firstIndex(data, 1, true), 11);
  assert.equal(f.firstIndex(data, -1, false), 0);
  assert.equal(f.firstIndex(data, 1e9, true), data.length);
});

test('a visible range is drawn from only the readings inside it', () => {
  const f = fixture(); const chart = f.state.chart;
  chart.data = [point(0), { ...point(100), v: 40 }, point(7190), point(7200)];
  f.setTime(7200); chart.setMode('fixed', 60); chart.draw();
  assert.ok(f.labels.includes('10.0V'), 'axis scaled to the in-window 5 V, not the 40 V outside it');
  assert.ok(!f.labels.includes('50.0V'));
});

for (const how of ['Disconnect button', 'unexpected link drop']) {
  test(`${how} while recording closes the session and leaves Record disabled`, async () => {
    const f = fixture(); const logger = f.state.logger;
    await logger.init();
    const { device } = bleDevice(f);
    await f.click('btnConnect');
    await f.click('btnRecord');
    assert.equal(f.state.recording, true);
    f.onMeasurement({ vbus: 5, ibus: 1, power: 5 });
    if (how === 'Disconnect button') await f.click('btnDisconnect'); else device.gatt.disconnect();
    await settle();
    assert.equal(f.state.recording, false);
    assert.equal(logger.sessionId, null);
    assert.equal(f.element('btnRecord').disabled, true, 'nothing to record from once offline');
    assert.equal(f.element('btnStopRecord').disabled, true);
    const sessions = await logger.listSessions();
    assert.equal(sessions.length, 1);
    assert.equal(typeof sessions[0].endedAt, 'number');
    assert.equal((await logger.getSamples(sessions[0].id)).length, 1);
  });
}

test('stopping a recording while the stream is paused does not offer Record', async () => {
  const f = fixture(); await f.state.logger.init(); bleDevice(f);
  await f.click('btnConnect'); await f.click('btnRecord');
  await f.click('btnStream');
  assert.equal(f.state.streaming, false);
  await f.click('btnStopRecord');
  assert.equal(f.element('btnRecord').disabled, true);
  await f.click('btnStream');
  assert.equal(f.element('btnRecord').disabled, false);
  await f.click('btnDisconnect');
});

test('a failed stream start is reported and can be retried', async () => {
  const f = fixture(); bleDevice(f);
  await f.click('btnConnect'); await f.click('btnStream');
  assert.equal(f.state.streaming, false);
  const write = f.state.client.charWrite; const send = write.writeValueWithoutResponse;
  write.writeValueWithoutResponse = async () => { throw new Error('GATT busy'); };
  await f.click('btnStream');
  assert.equal(f.state.streaming, false);
  assert.equal(f.element('statusText').textContent, 'GATT busy');
  assert.equal(f.element('btnStream').disabled, false);
  write.writeValueWithoutResponse = send;
  await f.click('btnStream');
  assert.equal(f.state.streaming, true);
  assert.equal(f.element('statusText').textContent, 'Streaming');
  await f.click('btnDisconnect');
});

test('a second click while the stream is starting does not start it twice', async () => {
  const delays = [];
  const f = fixture({ delay: cb => delays.push(cb) }); bleDevice(f);
  const connecting = f.click('btnConnect');
  await new Promise(setImmediate); delays.shift()(); await connecting;
  await f.click('btnStream');
  const first = f.click('btnStream');
  await new Promise(setImmediate);
  await f.click('btnStream');
  assert.equal(delays.length, 1);
  delays.shift()(); await first;
  assert.equal(f.state.streaming, true);
  await f.click('btnDisconnect');
});

test('a failed group command is reported without dropping the live state', async () => {
  const f = fixture(); bleDevice(f);
  await f.click('btnConnect');
  f.state.client.charWrite.writeValueWithoutResponse = async () => { throw new Error('GATT busy'); };
  await f.click('btnClearGroup');
  assert.equal(f.element('statusText').textContent, 'Clear group 6 failed: GATT busy');
  assert.equal(f.element('connPill').dataset.state, 'streaming');
  await f.click('btnDisconnect');
});

test('stopping twice, or starting a new session mid-stop, leaves sessions intact', async () => {
  const f = fixture(); const logger = f.state.logger;
  await logger.init();
  const first = await logger.startSession('First', 6);
  logger.ingest({ t: 0, wall: 0, v: 5, a: 1 });
  const stopping = Promise.all([logger.stopSession(), logger.stopSession()]);
  const second = await logger.startSession('Second', 6);
  await stopping;
  assert.equal(logger.sessionId, second, 'the finished stop must not detach the new session');
  logger.ingest({ t: 1, wall: 1000, v: 5, a: 2 });
  await logger.stopSession();
  assert.equal((await logger.getSamples(first)).length, 1);
  assert.equal((await logger.getSamples(second)).length, 1);
  assert.ok((await logger.listSessions()).every(s => typeof s.endedAt === 'number'));
});

test('sessions left open by a closed tab are ended at their last sample', async () => {
  const f = fixture(); const logger = f.state.logger;
  await logger.init();
  const withData = await logger.startSession('Interrupted', 6);
  const started = Date.UTC(2026, 9, 10, 10);
  logger.ingest({ t: 0, wall: started + 5000, v: 5, a: 1 }); logger.ingest({ t: 1, wall: started + 9000, v: 5, a: 1 });
  await logger._flush();
  logger.sessionId = null; // the tab went away without stopSession()
  const empty = await logger.startSession('Never sampled', 6);
  logger.sessionId = null;
  const live = await logger.startSession('Recording now', 6);
  await logger.closeOrphanedSessions();
  const byId = new Map((await logger.listSessions()).map(s => [s.id, s]));
  assert.equal(byId.get(withData).endedAt, started + 9000);
  assert.equal(byId.get(empty).endedAt, byId.get(empty).startedAt);
  assert.equal(byId.get(live).endedAt, null);
});

test('device info and legend show real zeros and trailing digits', () => {
  const f = fixture();
  f.onStatus('info', { model: 58, fw: 1.1, sn: 54181, groupMax: 10, groupCur: 2 });
  assert.equal(f.element('diFw').textContent, '1.10');
  f.state.streaming = true;
  f.onMeasurement({ vbus: 5, ibus: 0, power: 0 });
  assert.equal(f.element('legendA').textContent, '0.000A');
  f.state.streaming = false;
  f.state.last.ibus = 0; f.state.last.vbus = 0; f.updateMetrics();
  assert.equal(f.element('legendA').textContent, '—');
});

test('PNG export paints a backdrop before the transparent chart', async () => {
  const f = fixture(); const calls = [];
  const ctx = { fillRect: () => calls.push('fill'), drawImage: () => calls.push('image'), fillText() {} };
  f.sandbox.document.createElement = tag => tag === 'canvas' ? { getContext: () => ctx, toDataURL: () => '' } : f.element(tag);
  await f.click('btnExportPng');
  assert.deepEqual(calls.slice(0, 2), ['fill', 'image']);
});
