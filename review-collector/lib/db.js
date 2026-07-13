// lib/db.js —— 数据库水管:所有 API 文件都从这里拿 Supabase 连接
import { createClient } from "@supabase/supabase-js";

// 注意用 service_role key(服务端专用,权限大,绝不能出现在前端代码里)
export const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
