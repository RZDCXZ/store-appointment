# 茸光宠物洗护预约与排班系统

“茸光宠物洗护”是一个公开源码、仅承诺本地运行的单门店作品集案例。正式应用由三部分组成：原生 TypeScript 微信小程序、React/Vite 响应式后台，以及 NestJS/Fastify REST API。PostgreSQL 是唯一的 Docker 服务，Node 应用在宿主机保留热更新。

当前完成 ticket 01 的可启动骨架与 ticket 02 的后台演示账号、Cookie 会话及角色路由，不包含预约业务。真实微信登录、订阅消息、支付和生产运维不在本地演示能力内。

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

## 本地演示边界

- 当前壳层明确标识本地演示；不假装已接入真实微信身份或订阅消息。
- Docker Compose 只运行 PostgreSQL；API 与后台始终在宿主机运行。
- `DEMO_NOW` 是确定性演示时钟入口；`demo:up` 会把它安全传给后台，并在上海业务时区持续标识当前演示时间。
- 所有真实环境、私有 AppID、AppSecret、数据库数据和上传文件都必须留在被忽略的本地配置中。
