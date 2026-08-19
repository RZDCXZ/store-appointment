# 茸光宠物洗护预约与排班系统

“茸光宠物洗护”是一个公开源码、仅承诺本地运行的单门店作品集案例。正式应用由三部分组成：原生 TypeScript 微信小程序、React/Vite 响应式后台，以及 NestJS/Fastify REST API。PostgreSQL 是唯一的 Docker 服务，Node 应用在宿主机保留热更新。

当前本地产品已实现顾客预约全流程、员工到店与服务履约、店长预约／排班／顾客／服务／通知／审计／经营管理，以及确定性演示时钟和数据重置。45 个设计稿页面与实际入口见 [`docs/route-map.md`](docs/route-map.md)，最终集成、视觉、自动化和设备验收记录见 [`docs/product-verification.md`](docs/product-verification.md)。真实微信登录、订阅消息、支付和生产运维不在本地演示能力内。

## 环境要求

- Node.js 24 LTS
- Corepack（Node.js 自带）与 pnpm 11.10
- Docker Desktop 或兼容的 Docker Engine + Compose
- 微信开发者工具与使用者自己的测试 AppID

## 两步本地运行

首次克隆后安装依赖：

```bash
corepack enable
corepack pnpm install
```

如需覆盖本地默认值，可复制 `.env.example` 为 `.env`。不要提交 `.env`。

### 1. 启动数据库、API 与后台

```bash
corepack pnpm demo:up
```

这个命令会依次：

1. 启动 `postgres:18.4-bookworm`；
2. 等待 PostgreSQL 健康检查，最多 30 秒；
3. 执行尚未应用的显式 SQL migration；
4. 重置并写入基础演示种子；
5. 并行启动 API 与后台热更新服务。

启动后可访问：

- 后台登录：<http://localhost:5173/login>
- API 健康检查：<http://localhost:3000/health>
- OpenAPI：<http://localhost:3000/docs>

`demo:up` 固定上海演示时间为 2026-08-13 10:50，并在三端持续显示演示边界。店长可从 `/manager/system/demo` 推进 15 分钟或在输入确认短语后重置；重置会恢复固定种子、撤销旧会话并清理本地宠物上传。

### 后台演示账号

所有后台账号使用统一演示密码 `Rongguang2026!`：

| 身份 | 姓名 | 账号       |
| ---- | ---- | ---------- |
| 店长 | 沈青 | `manager`  |
| 员工 | 林夏 | `linxia`   |
| 员工 | 陈嘉 | `chenjia`  |
| 员工 | 周宁 | `zhouning` |
| 员工 | 赵航 | `zhaohang` |

密码公开只为本地作品集演示；数据库保存带独立盐的 `scrypt` 哈希，不保存明文。登录后 API 签发不透明的 HttpOnly、SameSite=Lax Cookie 会话；所有写请求必须来自 `ADMIN_ORIGIN`。店长落地页为 `/manager/workbench`，员工落地页为 `/staff/today`。未登录直达受保护 URL 时，登录成功后会恢复原目标；角色不匹配会显示明确无权限结果。

启动失败会返回非零退出码，并提示检查 Docker、端口与环境配置；PostgreSQL 细节可用 `docker compose logs postgres` 查看。停止前台 Node 服务后，数据库仍保留；需要停止数据库时运行 `docker compose down`。

### 2. 导入原生微信小程序

复制占位配置并填写自己的测试 AppID：

```bash
cp apps/mini-program/project.config.example.json apps/mini-program/project.config.json
```

将 `apps/mini-program/project.config.json` 中的 `appid` 替换为自己的测试 AppID，然后在微信开发者工具中导入 `apps/mini-program`。开发期可以在开发者工具中关闭域名校验。

`project.config.json`、`project.private.config.json`、AppSecret 和其他私有微信配置均被 Git 忽略。AppSecret 绝不能进入小程序客户端。

真机不能通过手机自己的 `localhost` 访问电脑 API。手机与电脑需连接同一局域网，并把 API 地址改为电脑的局域网 IP，例如 `http://192.168.1.20:3000`。

### 小程序演示顾客

“我的”页面提供三位服务端预置顾客：许岚（正常预约）、程墨（已有未来预约）和陆遥（取消或爽约历史）。这只是本地演示身份切换，不是微信真实登录。

选择顾客时，小程序调用 `POST /miniapp/demo-sessions`，API 默认签发 30 分钟有效的不透明 Bearer token；数据库只保存 token 摘要。后续 `GET /miniapp/me` 从 token 得到顾客身份，不读取客户端声明的顾客 ID 或角色。会话与当前页面会在重新编译或重新打开后恢复；会话失效时，重新选择身份后可返回之前的 tab 或带宠物 ID 的编辑页。

### 宠物档案与隐私同意

“我的”页面可直接进入 `pages/pets/index` 与 `pages/privacy-consent/index`。新建宠物使用 `pages/pet-form/index`，编辑使用 `pages/pet-form/index?id=<petId>`；刷新编辑页会按 ID 重新读取当前顾客自己的档案。服务端执行宠物归属、输入校验、未来预约归档阻断和隐私版本门禁，客户端提交的顾客 ID 不会改变身份。

宠物照片只接受 JPEG/PNG，最大 512 KiB，保存在被 Git 忽略的 `.data/uploads/pets/`。这是单机作品集演示存储，不是生产对象存储；`db:reset` 会清理上传并恢复种子状态。上传失败时小程序保留表单和待重试文件。

### 创建已确认预约

顾客按宠物、服务与增项、员工偏好、日期与时段完成草稿后，通过 `pages/booking-confirm/index` 复核服务端当前事实。`POST /miniapp/bookings` 要求顾客作用域的幂等键，并在同一 PostgreSQL 事务内重新校验当前隐私同意、宠物状态、服务组合、员工技能、已发布排班与冲突；成功后立即返回已确认预约和具体员工。`pages/booking-success/index?id=<bookingId>` 只凭预约身份调用 `GET /miniapp/bookings/:bookingId` 恢复快照，不依赖上一页内存状态。

预约保存宠物体重与体型、主要服务与增项、价格、时长、原计划和实际占用快照。PostgreSQL 的员工实际占用与宠物服务区间排除约束是并发冲突的最终防线。六位核销码只在响应中出现，数据库保存带服务端密钥的 HMAC 摘要；确认通知 outbox、预约事实、审计事实和幂等结果与预约在同一事务写入。

## 数据库命令边界

应用启动不会自动同步 schema。migration、种子和重置是三个显式命令：

```bash
corepack pnpm db:migrate
corepack pnpm db:seed
corepack pnpm db:reset
```

- `db:migrate`：按文件名顺序执行 `apps/api/database/migrations/` 中未应用的 SQL，并校验已应用文件未被篡改。
- `db:seed`：幂等写入当前阶段的基础演示元数据。
- `db:reset`：清空当前演示数据边界后重新 seed；不会隐式变更 schema。

数据库数据、环境文件、本地上传和 `uploads/` 目录不会进入仓库。

## 工程命令

```bash
corepack pnpm format       # 统一格式化
corepack pnpm format:check # 只检查格式
corepack pnpm lint         # ESLint
corepack pnpm typecheck    # TypeScript
corepack pnpm test         # 所有自动化测试
corepack pnpm build        # 三端生产构建/项目结构校验
corepack pnpm check        # 与 CI 一致的完整基础门禁
```

普通 Linux CI 不运行微信开发者工具；它会验证小程序 TypeScript、真实页面登记和项目结构。开发者工具黄金流程与真机检查留在本地执行。

管理端 Playwright 是独立的真实浏览器门禁：

```bash
corepack pnpm --filter @rongguang/admin test:e2e
```

GitHub Actions 会在 PostgreSQL 18.4 上先运行 `check`，再安装 Chrome 并运行完整 Playwright 套件。`check` 内的小程序测试包含 `miniprogram-simulate` + jsdom 组件渲染；API 测试包含空库连续三次重置和 20 请求并发争抢。

## 目录

```text
apps/
  admin/         React 19 + Vite 8 后台
  api/           NestJS 11 + Fastify 5 API 与显式 migration
  mini-program/  原生 TypeScript 微信小程序
packages/
  contracts/     纯 TypeScript 跨端 API 契约
product-ui/      设计稿与交互原型，只作为实现依据
```

小程序不复用 Web 组件。页面实现必须先登记真实路由，格式和当前映射见 [`docs/route-map.md`](docs/route-map.md)。

门店首页可进入 `pages/services/index` 浏览三个主要服务与三个增项；主要服务卡可直接打开 `pages/service-detail/index?id=<serviceId>`。目录价格由 `GET /miniapp/storefront` 返回，金额单位为人民币分，小程序只负责格式化展示，不包含支付或到店议价。

## 本地演示边界

- 当前壳层明确标识本地演示；不假装已接入真实微信身份或订阅消息。
- Docker Compose 只运行 PostgreSQL；API 与后台始终在宿主机运行。
- `DEMO_NOW` 是确定性演示时钟入口；`demo:up` 会把它安全传给后台，并在上海业务时区持续标识当前演示时间。
- 所有真实环境、私有 AppID、AppSecret、数据库数据和上传文件都必须留在被忽略的本地配置中。
- 模拟通知不会调用微信、短信或邮件；CSV／JSON 导出只生成本地响应，不上传第三方。
- 宠物照片只保存在 `.data/uploads/pets/`；没有对象存储、CDN、病毒扫描或生产备份。
- 仓库内品牌宠物与员工照片来自产品原型阶段的生成式栅格素材；原型设备边框和键盘素材不随小程序发布。公开发布前仍需重新核验素材与模板许可。

## 文档索引

- 产品与领域事实：[`CONTEXT.md`](CONTEXT.md)
- 页面、状态与视觉语义：[`DESIGN_PRD.md`](DESIGN_PRD.md)
- 设计稿页面到真实入口：[`docs/route-map.md`](docs/route-map.md)
- 集成、设计、测试与设备验收：[`docs/product-verification.md`](docs/product-verification.md)
- 架构决策：[`docs/adr/`](docs/adr/)
- 运行时 HTTP 契约：启动 API 后打开 `/docs`；共享 TypeScript 契约位于 `packages/contracts`
