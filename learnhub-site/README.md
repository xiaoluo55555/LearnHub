# LearnHub · Cloudflare Pages 全栈版

本目录是 LearnHub 的可上线版本：页面继续保留离线能力，同时使用 **Cloudflare Pages Functions** 提供后端 API，再由 API 访问 Supabase。浏览器不再直接读取 Supabase 密钥。

## 架构

```text
浏览器
  ├─ 本地 localStorage（离线学习）
  └─ /api/auth、/api/data（同源 Pages Functions）
          └─ Supabase Auth + Postgres
```

这样项目不再是纯静态页面：`functions/` 中的服务端代码会在 Cloudflare 边缘运行。Supabase 的 `service_role` 只存在于 Cloudflare Secret，不会发送给浏览器。

## 目录

- `index.html`：LearnHub 主界面
- `functions/api/auth/*`：注册、登录、退出
- `functions/api/data.js`：当前用户学习数据的读取与保存
- `functions/api/health.js`：健康检查接口
- `functions/api/config.js`：运行状态接口
- `supabase-schema.sql`：Supabase 表和 RLS 初始化
- `wrangler.toml`：Cloudflare Pages 配置
- `_headers`：安全响应头与 CSP

## 1. Supabase 初始化

1. 创建 Supabase Free 项目。
2. 在 SQL Editor 执行 `supabase-schema.sql`。
3. 在 Authentication → Providers 中启用 Email。
4. 在 Authentication → URL Configuration 中加入你的 Cloudflare Pages 地址，例如：
   - `https://learnhub.pages.dev`
   - `https://learnhub.pages.dev/`

本版本的注册和登录由 Pages Functions 代理调用 Supabase Auth，因此前端不需要填写项目 URL 或 anon key。

## 2. Cloudflare Pages 创建项目

### Git 集成（推荐）

1. 将 `learnhub-site` 目录作为 GitHub 仓库根目录。
2. Cloudflare Dashboard → Workers & Pages → Create application → Pages → Connect to Git。
3. Framework preset 选择 **None**。
4. Build command 留空；Build output directory 填 `.`。
5. 保存并部署。

### Wrangler CLI

```powershell
npm install -g wrangler
wrangler login
cd learnhub-site
wrangler pages project create learnhub
wrangler pages deploy . --project-name learnhub
```

## 3. 设置 Secret（必须）

在项目目录执行：

```powershell
wrangler pages secret put SUPABASE_URL --project-name learnhub
wrangler pages secret put SUPABASE_ANON_KEY --project-name learnhub
wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name learnhub
```

按提示粘贴 Supabase Project URL、anon/public key、service_role key。最后一个只保存在 Cloudflare 服务端，**不要写入 `index.html` 或提交到 GitHub**。

也可以在 Cloudflare Dashboard → Pages → Settings → Environment variables 中分别添加 Production 和 Preview 环境变量。

## 4. 验证清单

部署后访问：

- `/api/health`：应返回 `ok: true`
- `/api/config`：应显示 `authEnabled: true`、`syncEnabled: true`
- 首页右上角点击“登录同步”注册账户
- 完成学习后等待约 1–2 秒，状态显示“云端已同步”
- 另一台设备使用同一账户登录，学习记录应恢复

## 数据与容错

- 未登录：完全离线可用。
- 登录后：本地写入立即完成，云端使用防抖上传。
- 首次登录：合并本地与云端数据，不清空已有记录。
- 账号退出：只清除服务端会话，本地学习记录继续保留。
- Supabase 暂时不可用：页面仍可学习，数据留在本地并可用 JSON 导出。

## 免费额度说明

Cloudflare Pages、Pages Functions、Supabase Free 都有免费额度和使用限制；上线初期适合个人学习和小规模公开测试。流量或用户量增长后，再评估 D1、KV、Durable Objects 或付费数据库方案。
