// api/cron-send.js —— 定时出门的邮差
// 每 5 分钟被 cron 叫醒一次:把"到点该发"的信取出来,挨个投递
// 安全:请求头必须带 Authorization: Bearer <CRON_SECRET>,防止别人乱敲这个门

import { db } from "../lib/db.js";
import { sendReviewTemplate } from "../lib/wa.js";

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "不是自己人" });

  // 取出到点的信,一次最多 20 封(细水长流,别一口气轰炸)
  const now = new Date().toISOString();
  const { data: jobs } = await db.from("review_requests")
    .select("id, customer_phone, customer_name, merchants(id, name, wa_phone_number_id)")
    .eq("status", "queued").lte("scheduled_at", now).limit(20);

  const results = [];
  for (const job of jobs ?? []) {
    try {
      const resp = await sendReviewTemplate({
        phoneNumberId: job.merchants.wa_phone_number_id,
        to: job.customer_phone,
        templateName: process.env.WA_TEMPLATE_NAME,   // 例:review_invite_v1
        lang: process.env.WA_TEMPLATE_LANG || "zh_CN",
        customerName: job.customer_name,
        merchantName: job.merchants.name,
      });
      await db.from("review_requests").update({
        status: "sent",
        wa_message_id: resp.messages?.[0]?.id ?? null,
      }).eq("id", job.id);
      results.push({ id: job.id, ok: true });
    } catch (e) {
      await db.from("review_requests").update({ status: "failed" }).eq("id", job.id);
      results.push({ id: job.id, ok: false, err: e.message });
    }
  }

  // 顺手把超过 24 小时没人理的标记为过期(第一版绝不追发)
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  await db.from("review_requests").update({ status: "expired" })
    .eq("status", "sent").lte("scheduled_at", dayAgo);

  return res.status(200).json({ processed: results.length, results });
}
