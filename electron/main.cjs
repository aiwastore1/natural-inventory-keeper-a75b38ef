/**
 * Electron main process: loads the offline POS app and provides
 * Master/Client LAN sync over WebSocket (8080) + UDP discovery (41234).
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const dgram = require("dgram");

const WS_PORT = 8080;
const UDP_PORT = 41234;

let win = null;
let server = null;
let udp = null;
let clientSocket = null;
const sockets = new Set();
const peers = new Map();
let role = "offline";
let deviceName = "POS";

/* ---------------- minimal RFC6455 server (no dependencies) ---------------- */

function acceptKey(key) {
  return crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
}

function encodeFrame(text) {
  const payload = Buffer.from(text);
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function encodeMaskedFrame(text) {
  const payload = Buffer.from(text);
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i] ^ mask[i % 4];
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
  else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  }
  return Buffer.concat([header, mask, masked]);
}

function decodeFrames(buffer, onText) {
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const second = buffer[offset + 1];
    const masked = Boolean(second & 0x80);
    let len = second & 0x7f;
    let cursor = offset + 2;
    if (len === 126) {
      len = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (len === 127) {
      len = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    let mask = null;
    if (masked) {
      mask = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }
    if (cursor + len > buffer.length) break;
    const data = Buffer.from(buffer.subarray(cursor, cursor + len));
    if (mask) for (let i = 0; i < data.length; i += 1) data[i] ^= mask[i % 4];
    if (data.length) onText(data.toString("utf8"));
    offset = cursor + len;
  }
  return buffer.subarray(offset);
}

function pushStatus() {
  win?.webContents.send("sync:status", { role, connected: role !== "offline", peers: [...peers.values()] });
}

function relay(text, from) {
  for (const socket of sockets) if (socket !== from) socket.write(encodeFrame(text));
  win?.webContents.send("sync:message", safeParse(text));
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { kind: "raw", text };
  }
}

function startMaster() {
  stopSync();
  server = http.createServer((req, res) => res.end("POS sync master"));
  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    sockets.add(socket);
    peers.set(socket.remoteAddress, { address: socket.remoteAddress, name: socket.remoteAddress });
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = decodeFrames(Buffer.concat([buffer, chunk]), (text) => relay(text, socket));
    });
    const drop = () => {
      sockets.delete(socket);
      peers.delete(socket.remoteAddress);
      pushStatus();
    };
    socket.on("close", drop);
    socket.on("error", drop);
    pushStatus();
  });
  server.listen(WS_PORT);

  udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
  udp.on("message", (msg, rinfo) => {
    const payload = safeParse(msg.toString());
    if (payload.kind === "discover") {
      const reply = Buffer.from(JSON.stringify({ kind: "master", name: deviceName, port: WS_PORT }));
      udp.send(reply, rinfo.port, rinfo.address);
    }
  });
  udp.bind(UDP_PORT, () => udp.setBroadcast(true));
  role = "master";
  pushStatus();
  return { role, port: WS_PORT };
}

function startClient(host) {
  stopSync();
  const key = crypto.randomBytes(16).toString("base64");
  const req = http.request({ host: host || "127.0.0.1", port: WS_PORT, headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Key": key, "Sec-WebSocket-Version": 13 } });
  req.end();
  req.on("upgrade", (res, socket) => {
    clientSocket = socket;
    peers.set(host, { address: host, name: "master" });
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = decodeFrames(Buffer.concat([buffer, chunk]), (text) => win?.webContents.send("sync:message", safeParse(text)));
    });
    socket.on("close", () => {
      clientSocket = null;
      peers.delete(host);
      pushStatus();
    });
    role = "client";
    pushStatus();
  });
  req.on("error", () => {
    role = "offline";
    pushStatus();
  });
  return { role: "client", host };
}

function stopSync() {
  sockets.forEach((s) => s.destroy());
  sockets.clear();
  peers.clear();
  clientSocket?.destroy();
  clientSocket = null;
  server?.close();
  server = null;
  try {
    udp?.close();
  } catch {
    /* already closed */
  }
  udp = null;
  role = "offline";
  pushStatus();
  return { role };
}

function discover() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const found = [];
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(Buffer.from(JSON.stringify({ kind: "discover", name: deviceName })), UDP_PORT, "255.255.255.255");
    });
    socket.on("message", (msg, rinfo) => {
      const payload = safeParse(msg.toString());
      if (payload.kind === "master") found.push({ address: rinfo.address, name: payload.name });
    });
    setTimeout(() => {
      socket.close();
      found.forEach((p) => peers.set(p.address, p));
      pushStatus();
      resolve(found);
    }, 1200);
  });
}

/* ------------------------------- app window ------------------------------ */

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#0f172a",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, "..", "public", "pos", "index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("sync:start", (_e, opts = {}) => {
    deviceName = opts.name || deviceName;
    return opts.role === "client" ? startClient(opts.host) : startMaster();
  });
  ipcMain.handle("sync:stop", () => stopSync());
  ipcMain.handle("sync:discover", () => discover());
  ipcMain.handle("sync:status", () => ({ role, connected: role !== "offline", peers: [...peers.values()] }));
  ipcMain.on("sync:send", (_e, message) => {
    const text = JSON.stringify(message);
    if (role === "master") sockets.forEach((s) => s.write(encodeFrame(text)));
    else if (clientSocket) clientSocket.write(encodeMaskedFrame(text));
  });
  createWindow();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopSync();
  if (process.platform !== "darwin") app.quit();
});
