// lib/wa.js —— 发信员:封装 WhatsApp Cloud API 的两种发送
// ① sendTemplate:发"已审核模板"(主动开口必须用这个)
// ② sendText:发普通文字(只能在顾客回过话的 24 小时窗口内用)

const GRAPH = "https://graph.facebook.com/v23.0";

async function post(phoneNumberId, payload) {
  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("WA发送失败: " + JSON.stringify(data));
  return data; // data.messages[0].id 就是回执 ID
}

// 发评价邀请模板(模板 B:😊/😐/😞 三个快捷按钮,按钮在 Meta 后台建模板时就定义好了)
export function sendReviewTemplate({ phoneNumberId, to, templateName, lang, customerName, merchantName }) {
  return post(phoneNumberId, {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,                 // 例:review_invite_v1
      language: { code: lang },           // "zh_CN" 或 "en"
      components: [
        { type: "body", parameters: [
          { type: "text", text: customerName || "there" },
          { type: "text", text: merchantName },
        ]},
        // 三个按钮的回传暗号(payload),顾客点了哪个,webhook 就收到哪个暗号
        { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "RATE_GOOD" }] },
        { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: "RATE_OK" }] },
        { type: "button", sub_type: "quick_reply", index: "2", parameters: [{ type: "payload", payload: "RATE_BAD" }] },
      ],
    },
  });
}

// 24 小时窗口内的普通文字回复(感谢语 / 追问 / 给老板转发)
export function sendText({ phoneNumberId, to, body }) {
  return post(phoneNumberId, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body, preview_url: true },
  });
}
