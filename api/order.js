/**
 * Solstice Store order API backed by Supabase Postgres via its REST API.
 *
 * Required Vercel environment variables:
 * SUPABASE_URL=https://<project>.supabase.co
 * SUPABASE_SERVICE_ROLE_KEY=<server-only service role key>
 * DISCORD_WEBHOOK_URL=<Discord webhook>
 * ADMIN_API_KEY=<long random admin secret>
 *
 * Never expose SUPABASE_SERVICE_ROLE_KEY or ADMIN_API_KEY to the browser.
 */

const STATUS = Object.freeze({
  PAYMENT: "MENUNGGU PEMBAYARAN",
  VERIFY: "MENUNGGU VERIFIKASI",
  PROCESSING: "SEDANG DIPROSES",
  COMPLETE: "SELESAI",
});
const STATUS_VALUES = new Set(Object.values(STATUS));
const TRANSITIONS = new Map([
  [STATUS.VERIFY, STATUS.PROCESSING],
  [STATUS.PROCESSING, STATUS.COMPLETE],
]);
const PRODUCTS = Object.freeze({
  "50 Robux": 8000, "100 Robux": 16000, "200 Robux": 32000, "300 Robux": 48000,
  "500 Robux": 65000, "1.000 Robux": 130000, "1.500 Robux": 240000,
  "2.000 Robux": 320000, "3.000 Robux": 480000, "4.000 Robux": 640000,
  "5.000 Robux": 800000, "6.000 Robux": 960000, "7.000 Robux": 1120000,
  "8.000 Robux": 1280000, "9.000 Robux": 1440000, "10.000 Robux": 1600000,
});

function sendJson(res, code, payload) {
  res.status(code).setHeader("Content-Type", "application/json; charset=utf-8");
  return res.json(payload);
}
function bodyOf(req) {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  return null;
}
function validOrderId(value) { return typeof value === "string" && /^SOL-[A-Z0-9]{6,32}$/.test(value); }
function publicOrder(row) {
  return { orderId: row.order_id, username: row.username, product: row.product, amount: row.amount, paymentMethod: row.payment_method, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}
function configured() { return process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY; }
function supabaseHeaders(extra = {}) { return { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...extra }; }
async function dbRequest(path, options = {}) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { ...options, headers: supabaseHeaders(options.headers) });
  const text = await response.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (_error) { data = { message: text }; }
  if (!response.ok) { const error = new Error(data?.message || "Database request failed"); error.status = response.status; throw error; }
  return data;
}
function adminAuthorized(req) {
  const configuredKey = process.env.ADMIN_API_KEY;
  const auth = req.headers?.authorization || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : req.headers?.["x-admin-key"];
  return Boolean(configuredKey && supplied && supplied === configuredKey);
}
async function notifyDiscord(order, title = "Order Baru") {
  if (!process.env.DISCORD_WEBHOOK_URL) throw new Error("DISCORD_WEBHOOK_URL missing");
  const response = await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [{ title, color: order.status === STATUS.COMPLETE ? 5763719 : 3447003, fields: [
      { name: "Order ID", value: order.orderId, inline: true },
      { name: "Username", value: order.username, inline: true },
      { name: "Produk", value: order.product, inline: false },
      { name: "Nominal", value: order.amount.toLocaleString("id-ID"), inline: true },
      { name: "Metode Pembayaran", value: order.paymentMethod, inline: true },
      { name: "Status", value: order.status, inline: false },
    ], timestamp: new Date().toISOString() }] }),
  });
  if (!response.ok) throw new Error("Discord webhook rejected the order");
}

export default async function handler(req, res) {
  if (!configured()) return sendJson(res, 500, { ok: false, message: "SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi." });

  if (req.method === "GET") {
    const id = Array.isArray(req.query?.orderId) ? req.query.orderId[0] : req.query?.orderId;
    if (!validOrderId(id)) return sendJson(res, 400, { ok: false, message: "Order ID tidak valid." });
    try {
      const rows = await dbRequest(`orders?order_id=eq.${encodeURIComponent(id)}&select=*`);
      if (!rows?.length) return sendJson(res, 404, { ok: false, message: "Order tidak ditemukan." });
      return sendJson(res, 200, { ok: true, order: publicOrder(rows[0]) });
    } catch (_error) { return sendJson(res, 502, { ok: false, message: "Gagal membaca status order." }); }
  }

  if (req.method === "PATCH") {
    if (!process.env.ADMIN_API_KEY || !adminAuthorized(req)) return sendJson(res, 401, { ok: false, message: "Akses admin tidak sah." });
    let input; try { input = bodyOf(req); } catch (_error) { return sendJson(res, 400, { ok: false, message: "Request body harus berupa JSON yang valid." }); }
    const { orderId, status } = input || {};
    if (!validOrderId(orderId) || !STATUS_VALUES.has(status)) return sendJson(res, 400, { ok: false, message: "Order ID atau status tidak valid." });
    try {
      const currentRows = await dbRequest(`orders?order_id=eq.${encodeURIComponent(orderId)}&select=*`);
      if (!currentRows?.length) return sendJson(res, 404, { ok: false, message: "Order tidak ditemukan." });
      const current = currentRows[0];
      if (TRANSITIONS.get(current.status) !== status) return sendJson(res, 409, { ok: false, message: "Perubahan status tidak mengikuti alur yang diizinkan." });
      const updatedRows = await dbRequest(`orders?order_id=eq.${encodeURIComponent(orderId)}&status=eq.${encodeURIComponent(current.status)}&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status, updated_at: new Date().toISOString() }) });
      if (!updatedRows?.length) return sendJson(res, 409, { ok: false, message: "Order berubah oleh admin lain. Coba lagi." });
      const updated = publicOrder(updatedRows[0]);
      try { await notifyDiscord(updated, "Pembaruan Status Order"); } catch (_error) { return sendJson(res, 502, { ok: false, message: "Status tersimpan, tetapi notifikasi Discord gagal." }); }
      return sendJson(res, 200, { ok: true, order: updated });
    } catch (_error) { return sendJson(res, 502, { ok: false, message: "Gagal memperbarui status order." }); }
  }

  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST, PATCH"); return sendJson(res, 405, { ok: false, message: "Method tidak diizinkan." }); }
  if (!process.env.DISCORD_WEBHOOK_URL) return sendJson(res, 500, { ok: false, message: "DISCORD_WEBHOOK_URL belum dikonfigurasi." });
  let input; try { input = bodyOf(req); } catch (_error) { return sendJson(res, 400, { ok: false, message: "Request body harus berupa JSON yang valid." }); }
  const { orderId, username, product, amount, paymentMethod } = input || {};
  const numericAmount = typeof amount === "number" ? amount : Number(amount);
  if (!validOrderId(orderId)) return sendJson(res, 400, { ok: false, message: "Order ID tidak valid." });
  if (typeof username !== "string" || !/^[A-Za-z0-9_]{3,30}$/.test(username)) return sendJson(res, 400, { ok: false, message: "Username Roblox tidak valid." });
  if (typeof product !== "string" || PRODUCTS[product] === undefined) return sendJson(res, 400, { ok: false, message: "Produk tidak valid." });
  if (PRODUCTS[product] !== numericAmount || !Number.isSafeInteger(numericAmount)) return sendJson(res, 400, { ok: false, message: "Nominal produk tidak valid." });
  if (paymentMethod !== "SeaBank") return sendJson(res, 400, { ok: false, message: "Metode pembayaran tidak valid." });
  const now = new Date().toISOString();
  const row = { order_id: orderId, username, product, amount: numericAmount, payment_method: paymentMethod, status: STATUS.VERIFY, created_at: now, updated_at: now };
  try {
    const inserted = await dbRequest("orders", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
    if (!inserted?.length) return sendJson(res, 502, { ok: false, message: "Order gagal disimpan." });
    const order = publicOrder(inserted[0]);
    try { await notifyDiscord(order); } catch (_error) { await dbRequest(`orders?order_id=eq.${encodeURIComponent(orderId)}`, { method: "DELETE" }).catch(() => {}); return sendJson(res, 502, { ok: false, message: "Order gagal dikirim ke Discord." }); }
    return sendJson(res, 201, { ok: true, order });
  } catch (error) { return sendJson(res, error.status === 409 ? 409 : 502, { ok: false, message: error.status === 409 ? "Order ID sudah digunakan." : "Gagal menyimpan order." }); }
}

export { STATUS, PRODUCTS };
