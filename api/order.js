/**
 * Order API for Solstice Store.
 *
 * DISCORD_WEBHOOK_URL must be configured as a Vercel environment variable.
 *
 * Important: `orders` is only an in-memory cache. Vercel serverless instances
 * may restart or be different between requests, so this is not permanent
 * storage. Replace the Map with a database adapter before relying on it in
 * production. No public endpoint in this file can change an order status.
 */

const orders = globalThis.__SOLSTICE_ORDERS || (globalThis.__SOLSTICE_ORDERS = new Map());

const STATUS = Object.freeze({
  PAYMENT: "MENUNGGU PEMBAYARAN",
  VERIFY: "MENUNGGU VERIFIKASI",
  PROCESSING: "SEDANG DIPROSES",
  COMPLETE: "SELESAI",
});

const PRODUCTS = Object.freeze({
  "50 Robux": 8000,
  "100 Robux": 16000,
  "200 Robux": 32000,
  "300 Robux": 48000,
  "500 Robux": 65000,
  "1.000 Robux": 130000,
  "1.500 Robux": 240000,
  "2.000 Robux": 320000,
  "3.000 Robux": 480000,
  "4.000 Robux": 640000,
  "5.000 Robux": 800000,
  "6.000 Robux": 960000,
  "7.000 Robux": 1120000,
  "8.000 Robux": 1280000,
  "9.000 Robux": 1440000,
  "10.000 Robux": 1600000,
});

function sendJson(res, statusCode, payload) {
  res.status(statusCode);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.json(payload);
}

function bodyOf(req) {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  return null;
}

function validOrderId(value) {
  return typeof value === "string" && /^SOL-[A-Z0-9]{6,32}$/.test(value);
}

function publicOrder(order) {
  return {
    orderId: order.orderId,
    username: order.username,
    product: order.product,
    amount: order.amount,
    paymentMethod: order.paymentMethod,
    status: order.status,
    createdAt: order.createdAt,
  };
}

async function notifyDiscord(order) {
  const response = await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: "Order Baru",
        color: 3447003,
        fields: [
          { name: "Order ID", value: order.orderId, inline: true },
          { name: "Username", value: order.username, inline: true },
          { name: "Produk", value: order.product, inline: false },
          { name: "Nominal", value: order.amount.toLocaleString("id-ID"), inline: true },
          { name: "Metode Pembayaran", value: order.paymentMethod, inline: true },
          { name: "Status", value: order.status, inline: false },
        ],
        timestamp: new Date().toISOString(),
      }],
    }),
  });
  if (!response.ok) throw new Error("Discord webhook rejected the order");
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const rawId = Array.isArray(req.query?.orderId) ? req.query.orderId[0] : req.query?.orderId;
    if (!validOrderId(rawId)) {
      return sendJson(res, 400, { ok: false, message: "Order ID tidak valid." });
    }
    const order = orders.get(rawId);
    if (!order) return sendJson(res, 404, { ok: false, message: "Order tidak ditemukan." });
    return sendJson(res, 200, { ok: true, order: publicOrder(order) });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { ok: false, message: "Method tidak diizinkan." });
  }

  if (!process.env.DISCORD_WEBHOOK_URL) {
    return sendJson(res, 500, { ok: false, message: "DISCORD_WEBHOOK_URL belum dikonfigurasi." });
  }

  let input;
  try { input = bodyOf(req); } catch (_error) {
    return sendJson(res, 400, { ok: false, message: "Request body harus berupa JSON yang valid." });
  }
  if (!input) return sendJson(res, 400, { ok: false, message: "Request body harus berupa object JSON." });

  const { orderId, username, product, amount, paymentMethod } = input;
  const numericAmount = typeof amount === "number" ? amount : Number(amount);
  if (!validOrderId(orderId)) return sendJson(res, 400, { ok: false, message: "Order ID tidak valid." });
  if (typeof username !== "string" || !/^[A-Za-z0-9_]{3,30}$/.test(username)) {
    return sendJson(res, 400, { ok: false, message: "Username Roblox tidak valid." });
  }
  if (typeof product !== "string" || !Object.prototype.hasOwnProperty.call(PRODUCTS, product)) {
    return sendJson(res, 400, { ok: false, message: "Produk tidak valid." });
  }
  if (PRODUCTS[product] !== numericAmount || !Number.isSafeInteger(numericAmount)) {
    return sendJson(res, 400, { ok: false, message: "Nominal produk tidak valid." });
  }
  if (paymentMethod !== "SeaBank") {
    return sendJson(res, 400, { ok: false, message: "Metode pembayaran tidak valid." });
  }
  if (orders.has(orderId)) return sendJson(res, 409, { ok: false, message: "Order ID sudah digunakan." });

  // Status is assigned on the server. Any status supplied by the client is ignored.
  const order = { orderId, username, product, amount: numericAmount, paymentMethod, status: STATUS.VERIFY, createdAt: new Date().toISOString() };
  try {
    await notifyDiscord(order);
  } catch (_error) {
    return sendJson(res, 502, { ok: false, message: "Order gagal dikirim ke Discord." });
  }
  orders.set(orderId, order);
  return sendJson(res, 201, { ok: true, order: publicOrder(order) });
}

// STATUS is intentionally not exported as an HTTP mutation route. A protected
// admin/server process must update orders.get(id).status after adding durable DB storage.
export { STATUS, PRODUCTS };
