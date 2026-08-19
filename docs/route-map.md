# 设计稿页面 → 实际路由

这里登记 `DESIGN_PRD.md` 中全部 45 个逻辑页面。每个入口都能直接打开；Web 由 Vite history fallback 恢复应用入口，小程序由 `app.json` 注册，页面再按 URL 参数、当前会话和服务端事实恢复内容。组件内部状态、弹窗名和原型视图名不充当路由。

## 逐页设计验收矩阵

验收以各端 README、交互原型、选定视觉基线和 `DESIGN_PRD.md` 为同一组依据。“静态”表示逐页核对实际页面模块的结构、文案、状态与导航；“自动”表示页面／路由测试覆盖；“运行”表示在 Chrome 或微信开发者工具中实际走查。视觉基线定义全端布局、品牌与层级，不要求把原型中为集中演示而使用的组件内切页照搬到真实实现。

| ID    | 逐页核对重点                                           | 结果与证据       |
| ----- | ------------------------------------------------------ | ---------------- |
| MP-01 | 品牌栏、门店摘要、主 CTA、最近预约、三项主要服务与承诺 | 通过：静态＋运行 |
| MP-02 | 三项主要服务、三项增项、价格／时长范围与详情返回       | 通过：静态＋自动 |
| MP-03 | 宠物照片、物种、体重、体型、护理标签与未来预约提示     | 通过：静态＋运行 |
| MP-04 | 分组表单、即时体型、照片、字段错误与归档危险区         | 通过：静态＋运行 |
| MP-05 | 版本摘要、必要字段、同意动作与原任务返回               | 通过：静态＋自动 |
| MP-06 | 轻量步骤标题、宠物选择、未来预约提示与单一主操作       | 通过：静态＋自动 |
| MP-07 | 服务卡、真实规格、增项兼容性及价格／时长摘要           | 通过：静态＋自动 |
| MP-08 | 指定员工／最快可约并列、技能与分配规则说明             | 通过：静态＋自动 |
| MP-09 | 14 日日期条、不可用原因、时段选择与旧选择保留          | 通过：静态＋自动 |
| MP-10 | 宠物／服务／员工／时间复核、隐私状态与防重复提交       | 通过：静态＋自动 |
| MP-11 | 已确认语义、确定员工、后续行动与预约详情入口           | 通过：静态＋自动 |
| MP-12 | 原选择保留、冲突解释、相近建议与一键替换               | 通过：静态＋自动 |
| MP-13 | 未来／历史分段、宠物、时间与非颜色状态表达             | 通过：静态＋运行 |
| MP-14 | 当前事实、六位核销码、截止说明及可用行动               | 通过：静态＋运行 |
| MP-15 | 原安排持续可见、改期／取消后果与确认                   | 通过：静态＋运行 |
| MP-16 | 模拟消息边界、消息状态及预约互跳                       | 通过：静态＋自动 |
| MP-17 | 演示顾客、宠物／隐私／数据权利入口                     | 通过：静态＋自动 |
| MP-18 | 导出、未来预约阻断、匿名保留说明与二次确认             | 通过：静态＋自动 |
| ST-01 | 品牌登录、演示账号、错误／过期状态与目标回跳           | 通过：静态＋运行 |
| ST-02 | 本人今日时间线、行动优先级、空态／错误态与 390px 密度  | 通过：静态＋运行 |
| ST-03 | 本人数据边界、宠物与服务事实、脱敏电话和行动入口       | 通过：静态＋运行 |
| ST-04 | 六位码输入、窗口提示、字段错误、幂等结果和无横向滚动   | 通过：静态＋运行 |
| ST-05 | 迟到后果、核销／爽约分支与危险操作确认                 | 通过：静态＋自动 |
| ST-06 | 结构化护理记录、必填反馈、完成确认与刷新后只读事实     | 通过：静态＋运行 |
| ST-07 | 终止原因、容量释放后果、危险确认与终态                 | 通过：静态＋运行 |
| ST-08 | 脱敏默认值、主动揭示、用途说明与审计反馈               | 通过：静态＋运行 |
| ST-09 | 原记录只读、追加说明、作者／时间与不可覆盖语义         | 通过：静态＋运行 |
| MG-01 | 风险优先工作台、指标摘要、员工时间线与主次行动         | 通过：静态＋运行 |
| MG-02 | 按员工日历、日期导航、状态图例与保留旧数据重试         | 通过：静态＋运行 |
| MG-03 | URL 筛选、结果密度、空态、分页／详情入口               | 通过：静态＋运行 |
| MG-04 | 完整预约事实、历史、通知、审计与状态相关行动           | 通过：静态＋运行 |
| MG-05 | 新旧顾客代录、字段错误、冲突建议与禁止强制占用         | 通过：静态＋运行 |
| MG-06 | 原安排、候选时段、原因、通知后果与原子失败             | 通过：静态＋运行 |
| MG-07 | 前后值对照、服务重算、容量预检与原子纠正               | 通过：静态＋运行 |
| MG-08 | 周模板、14 天草稿、日期例外、发布预览与未保存状态      | 通过：静态＋自动 |
| MG-09 | 已发布班次、休息、例外来源、日期恢复与权限             | 通过：静态＋自动 |
| MG-10 | 员工停班／临时闭店、影响预览、原因和提交反馈           | 通过：静态＋自动 |
| MG-11 | 受影响预约逐笔进度、联系动作、刷新恢复与完成门禁       | 通过：静态＋运行 |
| MG-12 | 三项主要服务／三项增项、规格、技能、停用与引用阻断     | 通过：静态＋自动 |
| MG-13 | 员工账号、技能矩阵、键盘编辑、停用阻断与登录验证       | 通过：静态＋运行 |
| MG-14 | 顾客／宠物层级、敏感字段边界、搜索与当前筛选导出       | 通过：静态＋运行 |
| MG-15 | 失败优先队列、尝试详情、自动／人工重试和模拟边界       | 通过：静态＋运行 |
| MG-16 | URL 筛选、只读安全事实、脱敏、分页与禁止改写           | 通过：静态＋运行 |
| MG-17 | 7／30／90 日指标、精确公式、趋势文字、非实收说明与导出 | 通过：静态＋运行 |
| MG-18 | 演示边界、上海时间、推进、二步重置及旧会话后果         | 通过：静态＋运行 |

## 顾客小程序

| 设计稿 ID | 设计稿页面         | 实际路由或页面路径                                                                           | 页面模块                                                                                                           | 状态   | 直接访问与恢复验证                                    |
| --------- | ------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------- |
| MP-01     | 首页               | `pages/home/index`                                                                           | `apps/mini-program/miniprogram/pages/home/`                                                                        | 已完成 | `app.json` 登记；重新编译读取顾客会话、门店和服务事实 |
| MP-02     | 服务列表与详情     | `pages/services/index`<br>`pages/service-detail/index?id=:serviceId`                         | `apps/mini-program/miniprogram/pages/services/`<br>`apps/mini-program/miniprogram/pages/service-detail/`           | 已完成 | 服务 ID 直达；刷新重新读取目录                        |
| MP-03     | 宠物列表           | `pages/pets/index`                                                                           | `apps/mini-program/miniprogram/pages/pets/`                                                                        | 已完成 | 当前顾客会话直达；重新读取在用与归档宠物              |
| MP-04     | 新建／编辑宠物     | `pages/pet-form/index`<br>`pages/pet-form/index?id=:petId`                                   | `apps/mini-program/miniprogram/pages/pet-form/`                                                                    | 已完成 | 新建与宠物 ID 编辑入口独立；编辑时重新读取归属事实    |
| MP-05     | 隐私同意           | `pages/privacy-consent/index?returnTo=:path`                                                 | `apps/mini-program/miniprogram/pages/privacy-consent/`                                                             | 已完成 | 版本与返回路径持久恢复                                |
| MP-06     | 预约：选择宠物     | `pages/booking-pet/index`                                                                    | `apps/mini-program/miniprogram/pages/booking-pet/`                                                                 | 已完成 | 直达隐私门禁；从持久草稿恢复                          |
| MP-07     | 预约：服务与增项   | `pages/booking-service/index`                                                                | `apps/mini-program/miniprogram/pages/booking-service/`                                                             | 已完成 | 缺失宠物回退；目录事实与草稿恢复                      |
| MP-08     | 预约：员工偏好     | `pages/booking-staff/index`                                                                  | `apps/mini-program/miniprogram/pages/booking-staff/`                                                               | 已完成 | 缺失服务回退；指定员工／最快可约恢复                  |
| MP-09     | 预约：日期与时段   | `pages/booking-time/index`                                                                   | `apps/mini-program/miniprogram/pages/booking-time/`                                                                | 已完成 | 直达后重新查询 14 日真实时段并恢复草稿                |
| MP-10     | 确认预约           | `pages/booking-confirm/index`                                                                | `apps/mini-program/miniprogram/pages/booking-confirm/`                                                             | 已完成 | 持久草稿直达；提交前复核服务端事实                    |
| MP-11     | 预约成功           | `pages/booking-success/index?id=:bookingId`                                                  | `apps/mini-program/miniprogram/pages/booking-success/`                                                             | 已完成 | 按预约 ID 重新读取已确认快照                          |
| MP-12     | 时段冲突与建议     | `pages/booking-conflict/index`                                                               | `apps/mini-program/miniprogram/pages/booking-conflict/`                                                            | 已完成 | 持久化冲突上下文、原选择和建议时段                    |
| MP-13     | 预约记录           | `pages/appointments/index`                                                                   | `apps/mini-program/miniprogram/pages/appointments/`                                                                | 已完成 | Tab 直达；重新读取未来／历史预约                      |
| MP-14     | 预约详情与核销码   | `pages/booking-detail/index?id=:bookingId`                                                   | `apps/mini-program/miniprogram/pages/booking-detail/`                                                              | 已完成 | 按预约 ID 与当前顾客重新读取事实                      |
| MP-15     | 改期与取消         | `pages/booking-reschedule/index?id=:bookingId`<br>`pages/booking-cancel/index?id=:bookingId` | `apps/mini-program/miniprogram/pages/booking-reschedule/`<br>`apps/mini-program/miniprogram/pages/booking-cancel/` | 已完成 | 两个独立入口均按预约 ID 恢复原安排与终态              |
| MP-16     | 消息               | `pages/messages/index`                                                                       | `apps/mini-program/miniprogram/pages/messages/`                                                                    | 已完成 | Tab 直达；消息按当前顾客从 API 恢复                   |
| MP-17     | 我的               | `pages/profile/index`                                                                        | `apps/mini-program/miniprogram/pages/profile/`                                                                     | 已完成 | Tab 直达；顾客身份从本地会话恢复                      |
| MP-18     | 数据导出与资料删除 | `pages/data-rights/index`                                                                    | `apps/mini-program/miniprogram/pages/data-rights/`                                                                 | 已完成 | 当前会话直达；重新读取阻断预约与保留规则              |

## 员工后台

| 设计稿 ID | 设计稿页面     | 实际路由                                        | 页面模块                                                 | 状态   | 直接访问与恢复验证                       |
| --------- | -------------- | ----------------------------------------------- | -------------------------------------------------------- | ------ | ---------------------------------------- |
| ST-01     | 登录           | `/login`                                        | `apps/admin/src/login-page.tsx`                          | 已完成 | 登录路由与目标回跳测试                   |
| ST-02     | 我的今日预约   | `/staff/today`                                  | `apps/admin/src/pages/staff/today-page.tsx`              | 已完成 | 当前员工与演示日期从 API 恢复；390px E2E |
| ST-03     | 本人预约详情   | `/staff/appointments/:bookingId`                | `apps/admin/src/pages/staff/appointment-detail-page.tsx` | 已完成 | 预约 ID、分配权限与刷新恢复测试          |
| ST-04     | 正常核销       | `/staff/appointments/:bookingId/check-in`       | `apps/admin/src/pages/staff/check-in-page.tsx`           | 已完成 | 独立路由、窗口、幂等提交与移动端宽度测试 |
| ST-05     | 迟到处理       | `/staff/appointments/:bookingId/late`           | `apps/admin/src/pages/staff/late-page.tsx`               | 已完成 | 独立路由、危险操作确认与结果恢复测试     |
| ST-06     | 完成服务       | `/staff/appointments/:bookingId/complete`       | `apps/admin/src/pages/staff/complete-page.tsx`           | 已完成 | 独立路由、结构化记录与刷新恢复 E2E       |
| ST-07     | 服务终止       | `/staff/appointments/:bookingId/terminate`      | `apps/admin/src/pages/staff/terminate-page.tsx`          | 已完成 | 独立路由、必填原因与终态恢复 E2E         |
| ST-08     | 完整手机号揭示 | `/staff/appointments/:bookingId/phone`          | `apps/admin/src/pages/staff/phone-reveal-page.tsx`       | 已完成 | 独立路由、角色边界、主动确认与审计测试   |
| ST-09     | 追加更正说明   | `/staff/appointments/:bookingId/service-record` | `apps/admin/src/pages/staff/service-record-page.tsx`     | 已完成 | 原记录只读；追加作者、时间与刷新恢复 E2E |

辅助入口 `/staff/appointments` 是员工本人预约列表，不替代任何设计稿页面。

## 店长后台

| 设计稿 ID | 设计稿页面           | 实际路由                                                                                                 | 页面模块                                                                                                                                                           | 状态   | 直接访问与恢复验证                         |
| --------- | -------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------ |
| MG-01     | 今日工作台           | `/manager/workbench`                                                                                     | `apps/admin/src/pages/manager/workbench-page.tsx`                                                                                                                  | 已完成 | 风险、状态摘要和员工时间线 API 恢复；E2E   |
| MG-02     | 按员工日历           | `/manager/appointments/calendar?date=:date`                                                              | `apps/admin/src/pages/manager/calendar-page.tsx`                                                                                                                   | 已完成 | 日期查询参数直达；保留旧数据的重试与 E2E   |
| MG-03     | 预约列表与筛选       | `/manager/appointments/list?date=:date&status=:status&staffId=:staffId&q=:query`                         | `apps/admin/src/pages/manager/appointment-list-page.tsx`                                                                                                           | 已完成 | URL 筛选条件与服务端列表恢复 E2E           |
| MG-04     | 预约详情             | `/manager/appointments/:bookingId`                                                                       | `apps/admin/src/pages/manager/appointment-detail-page.tsx`                                                                                                         | 已完成 | 预约 ID 直达；行动按当前状态恢复           |
| MG-05     | 代客预约             | `/manager/appointments/proxy`                                                                            | `apps/admin/src/pages/manager/proxy-booking-page.tsx`                                                                                                              | 已完成 | 独立表单路由；字段错误、冲突与幂等 E2E     |
| MG-06     | 店长改期             | `/manager/appointments/:bookingId/reschedule`                                                            | `apps/admin/src/pages/manager/reschedule-booking-page.tsx`                                                                                                         | 已完成 | 原安排持续可见；原子失败与刷新恢复 E2E     |
| MG-07     | 预约内容纠正         | `/manager/appointments/:bookingId/correction`                                                            | `apps/admin/src/pages/manager/content-correction-page.tsx`                                                                                                         | 已完成 | 前后对比、重算技能／容量与 E2E             |
| MG-08     | 排班模板与 14 天草稿 | `/manager/schedule/planning`                                                                             | `apps/admin/src/pages/manager/schedule-planning-page.tsx`                                                                                                          | 已完成 | 草稿、例外和发布预览从 API 恢复            |
| MG-09     | 已发布排班与日期例外 | `/manager/schedule/published?date=:date`                                                                 | `apps/admin/src/pages/manager/schedule-page.tsx`                                                                                                                   | 已完成 | 日期直达、角色边界与 history fallback 测试 |
| MG-10     | 停班／临时闭店创建   | `/manager/schedule/capacity-changes/new`                                                                 | `apps/admin/src/pages/manager/capacity-change-page.tsx`                                                                                                            | 已完成 | 独立入口、影响预览和权限测试               |
| MG-11     | 受影响预约处理       | `/manager/schedule/capacity-changes/:kind/:changeId`                                                     | `apps/admin/src/pages/manager/capacity-change-resolution-page.tsx`                                                                                                 | 已完成 | 逐笔进度、刷新恢复和完整处理 E2E           |
| MG-12     | 服务目录             | `/manager/services`                                                                                      | `apps/admin/src/pages/manager/services-page.tsx`                                                                                                                   | 已完成 | 目录读取、停用语义、角色边界与直达测试     |
| MG-13     | 员工与技能           | `/manager/services/staff`                                                                                | `apps/admin/src/pages/manager/staff-page.tsx`                                                                                                                      | 已完成 | 技能矩阵、键盘操作、错误与直达 E2E         |
| MG-14     | 顾客与宠物档案       | `/manager/customers`<br>`/manager/customers/:customerId`<br>`/manager/customers/:customerId/pets/:petId` | `apps/admin/src/pages/manager/customers-page.tsx`<br>`apps/admin/src/pages/manager/customer-detail-page.tsx`<br>`apps/admin/src/pages/manager/pet-detail-page.tsx` | 已完成 | 搜索、层级身份直达、敏感信息边界与导出 E2E |
| MG-15     | 通知任务             | `/manager/system/notifications`<br>`/manager/system/notifications/:notificationId`                       | `apps/admin/src/pages/manager/notification-list-page.tsx`<br>`apps/admin/src/pages/manager/notification-detail-page.tsx`                                           | 已完成 | 列表、尝试详情、自动／人工重试与刷新 E2E   |
| MG-16     | 审计记录             | `/manager/system/audit?action=:action&actor=:actor&subject=:subject`                                     | `apps/admin/src/pages/manager/audit-log-page.tsx`                                                                                                                  | 已完成 | URL 筛选、只读事实、脱敏与分页 E2E         |
| MG-17     | 经营看板             | `/manager/business?period=:period`                                                                       | `apps/admin/src/pages/manager/business-page.tsx`                                                                                                                   | 已完成 | 7／30／90 日周期直达、导出与权限 E2E       |
| MG-18     | 演示时间与数据重置   | `/manager/system/demo`                                                                                   | `apps/admin/src/pages/manager/demo-control-page.tsx`                                                                                                               | 已完成 | 演示开关、二次确认、推进时间与重置 E2E     |

辅助入口 `/manager/appointments` 汇总日历与列表入口，`/manager/schedule` 保留查询参数并重定向到 MG-08；它们不替代设计稿页面。

## 自动门禁

- `scripts/product-integration.test.mjs` 强制覆盖 MP-01…18、ST-01…09、MG-01…18，并确保所有 `app.json` 页面均已登记。
- `apps/admin/src/history-fallback.test.ts` 对 Web 逻辑页面代表性实例连续请求两次，验证直接访问和刷新都返回应用入口。
- 页面级 Vitest 与 Playwright 再验证 URL 参数、会话、权限和服务端事实恢复，不能只依赖上一组件的内存状态。
