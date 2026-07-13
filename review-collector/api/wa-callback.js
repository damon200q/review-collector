// api/wa-callback.js —— 接线员(整个产品的灵魂)
// Meta 把顾客的一举一动(点了哪个按钮、回了什么话)都推到这里,由它分流:
//   😊 满意   → 感谢 + 送上 Google 好评链接
//   😐/😞    → 道歉 + 追问原因;顾客的回复原文转发给老板
//   "停止"   → 写进退订名单,永不再发

import { db } from "../lib/db.js";
import { sendText } from "../lib/wa.js";

const RATING_MAP = { RATE_GOOD: 5, RATE_OK: 3, RATE_BAD: 1 };

export default async function handler(req, res) {
  // ---- Meta 首次绑定 webhook 时的"对暗号"握手 ----
  if (req.method === "GET") {
    if (req.query["hub.verify_token"] === process.env.WA_VERIFY_TOKEN)
      return res.status(200).send(req.query["hub.challenge"]);
    return res.status(403).send("verify failed");
  }

  // ---- 正式消息:先秒回 200(Meta 等不了太久),再慢慢处理 ----
  res.status(200).json({ ok: true });

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return; // 状态回执之类的,不用管
    const from = msg.from; // 顾客手机号
    const phoneNumberId = value.metadata.phone_number_id;

    // 找到这位顾客最近一条"活着的"评价请求
    const { data: reqRow } = await db.from("review_requests")
      .select("id, status, merchants(name, place_id, contact_phone)")
      .eq("customer_phone", from)
      .in("status", ["sent", "intercepted"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    // ============ 情况一:顾客点了按钮 ============
    // 模板快捷按钮回来是 type=button;普通交互按钮回来是 type=interactive
    const payload = msg.type === "button" ? msg.button?.payload
                  : msg.type === "interactive" ? msg.interactive?.button_reply?.id
                  : null;

    if (payload && RATING_MAP[payload] && reqRow) {
      const rating = RATING_MAP[payload];
      const m = reqRow.merchants;

      if (rating >= 4) {
        // 😊 → 感谢 + Google 好评深链,状态记为已导流
        const link = `https://search.google.com/local/writereview?placeid=${m.place_id}`;
        await sendText({ phoneNumberId, to: from,
          body: `太开心了!🙏 如果方便的话,花 30 秒在 Google 上分享一下,对我们小生意帮助真的很大:\n${link}` });
        await db.from("review_requests").update({
          status: "routed_google", rating, responded_at: new Date().toISOString(),
        }).eq("id", reqRow.id);
      } else {
        // 😐/😞 → 道歉 + 追问,状态记为已拦截,等顾客打字
        await sendText({ phoneNumberId, to: from,
          body: `真的很抱歉没让您满意 🙏 方便告诉我们是哪方面吗?老板会亲自看每一条反馈。` });
        await db.from("review_requests").update({
          status: "intercepted", rating, responded_at: new Date().toISOString(),
        }).eq("id", reqRow.id);
      }
      return;
    }

    // ============ 情况二:顾客打字了 ============
    if (msg.type === "text") {
      const text = (msg.text?.body ?? "").trim();

      // "停止/STOP" → 退订名单
      if (/^(stop|停止|unsubscribe)$/i.test(text)) {
        await db.from("opt_outs").upsert({ customer_phone: from });
        await sendText({ phoneNumberId, to: from, body: "好的,不会再打扰您了 🙏" });
        return;
      }

      // 被拦截的差评顾客在解释原因 → 存档 + 转发老板
      if (reqRow?.status === "intercepted") {
        await db.from("review_requests").update({ feedback_text: text }).eq("id", reqRow.id);
        await sendText({ phoneNumberId, to: from,
          body: "收到,谢谢您愿意告诉我们 🙏 我们一定改进,期待下次让您满意。" });
        // 给老板的即时告警(注意:老板需要先给这个业务号发过一次消息,打开 24h 窗口;
        // 正式版建议再建一个"差评告警"Utility模板,就没有窗口限制了)
        try {
          await sendText({ phoneNumberId, to: reqRow.merchants.contact_phone.replace(/[\s+()-]/g, ""),
            body: `⚠️ 差评拦截\n顾客 ${from} 反馈:\n"${text}"` });
        } catch { /* 窗口没开,后台仪表盘里也能看到,不算丢 */ }
      }
    }
  } catch (e) {
    console.error("callback处理出错:", e.message);
  }
}
