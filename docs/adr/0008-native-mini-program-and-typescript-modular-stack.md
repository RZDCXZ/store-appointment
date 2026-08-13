# 采用原生小程序与 TypeScript 模块化单仓库

仓库使用 pnpm workspace 与 Turborepo，包含原生 TypeScript 微信小程序、React/Vite 响应式后台和基于 NestJS/Fastify 的 REST/OpenAPI 服务端。服务端是按预约、排班、顾客、通知、身份和经营等业务能力隔离的模块化单体，共享一个 PostgreSQL，以支持改期、审计与通知任务的本地事务。项目没有 H5 或多小程序平台需求，因此不引入 Taro 等跨端编译层；小程序只与其他应用共享纯 TypeScript 契约和领域值，不复用 Web 组件。Node 应用运行在宿主机以保留热更新，Docker Compose 只提供 PostgreSQL。
