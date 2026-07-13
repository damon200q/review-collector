// api/trigger.js —— 前台接单员
// 商家系统(或你后台的手动按钮)打这个接口 = "有位客人刚消费完,给他排一条评价邀请"
// POST /api/trigger   header: x-api-key: 商家的钥匙
// body: { "customer_phone": "60123456789", "customer_name": "Mr Tan" }

import { db } from "../lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // 1) 验钥匙:这把钥匙是谁家的?
  const apiKey = req.headers["x-api-key"];
  const { data: merchant } = await db.from("merchants")
    .select("id, name").eq("api_key", apiKey).single();
  if (!merchant) return res.status(401).json({ error: "钥匙不对" });

  const { customer_phone, customer_name } = req.body ?? {};
  if (!customer_phone) return res.status(400).json({ error: "缺 customer_phone" });
  const phone = String(customer_phone).replace(/[\s+()-]/g, ""); // 统一成纯数字国际格式

  // 2) 查退订名单:人家说过别再发了,就绝不发
  const { data: optedOut } = await db.from("opt_outs")
    .select("customer_phone").eq("customer_phone", phone).maybeSingle();
  if (optedOut) return res.status(200).json({ skipped: "opt_out" });

  // 3) 查重:30 天内发过就不再发(防骚扰 = 防风控)
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data: recent } = await db.from("review_requests")
    .select("id").eq("merchant_id", merchant.id)
    .eq("customer_phone", phone).gte("created_at", cutoff).limit(1);
  if (recent?.length) return res.status(200).json({ skipped: "sent_within_30d" });

  // 4) 算发送时间:随机延迟 30-90 分钟,且只落在当地 10:00-21:00
  const delayMin = 30 + Math.floor(Math.random() * 61);
  let when = new Date(Date.now() + delayMin * 60000);
  const hourKL = (when.getUTCHours() + 8) % 24;          // 马来西亚/新加坡 = UTC+8
  if (hourKL >= 21) when = nextDayAt(when, 10);          // 太晚 → 明早 10 点
  if (hourKL < 10)  when = sameDayAt(when, 10);          // 太早 → 今早 10 点

  // 5) 入队,等邮差(cron)来取
  const { data: row, error } = await db.from("review_requests").insert({
    merchant_id: merchant.id,
    customer_phone: phone,
    customer_name,
    status: "queued",
    scheduled_at: when.toISOString(),
  }).select("id, scheduled_at").single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ queued: row });
}

function sameDayAt(d, hourKL) {
  const x = new Date(d); x.setUTCHours(hourKL - 8, Math.floor(Math.random() * 30), 0, 0); return x;
}
function nextDayAt(d, hourKL) {
  const x = new Date(d); x.setUTCDate(x.getUTCDate() + 1); return sameDayAt(x, hourKL);
}
