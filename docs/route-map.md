# 设计稿页面 → 实际路由

每个产品页面在实现时登记一行。`实际路由或页面路径` 必须是可直接打开并在刷新、重新编译或重新打开后恢复的入口；组件内部状态、弹窗名称和原型视图名称不能充当路由。

| 设计稿 ID | 设计稿页面       | 端         | 实际路由或页面路径                             | 页面模块                                                   | 状态   | 直接访问验证                                              |
| --------- | ---------------- | ---------- | ---------------------------------------------- | ---------------------------------------------------------- | ------ | --------------------------------------------------------- |
| ST-01     | 后台登录         | Web 后台   | `/login`                                       | `apps/admin/src/login-page.tsx`                            | 已完成 | Vite history fallback + 登录路由测试                      |
| ST-02     | 员工今日工作     | Web 后台   | `/staff/today`                                 | `apps/admin/src/pages/staff/today-page.tsx`                | 骨架   | Vite history fallback + 角色路由测试                      |
| —         | 员工本人预约     | Web 后台   | `/staff/appointments`                          | `apps/admin/src/pages/staff/appointments-page.tsx`         | 骨架   | 会话回跳测试 + Vite history fallback                      |
| ST-03     | 员工预约详情     | Web 后台   | `/staff/appointments/:bookingId`               | `apps/admin/src/pages/staff/appointment-detail-page.tsx`   | 已完成 | 分配权限、独立路由测试 + Vite history fallback            |
| ST-04     | 到店核销         | Web 后台   | `/staff/appointments/:bookingId/check-in`      | `apps/admin/src/pages/staff/check-in-page.tsx`             | 已完成 | 直达、提交、结果恢复测试 + Vite history fallback          |
| ST-05     | 迟到与爽约处理   | Web 后台   | `/staff/appointments/:bookingId/late`          | `apps/admin/src/pages/staff/late-page.tsx`                 | 已完成 | 直达、危险操作确认、结果恢复测试 + Vite history fallback  |
| MG-01     | 店长今日工作台   | Web 后台   | `/manager/workbench`                           | `apps/admin/src/pages/manager/workbench-page.tsx`          | 骨架   | Vite history fallback + 角色路由测试                      |
| —         | 店长预约入口     | Web 后台   | `/manager/appointments`                        | `apps/admin/src/pages/manager/appointments-page.tsx`       | 骨架   | Vite history fallback + 独立路由测试                      |
| —         | 店长排班入口     | Web 后台   | `/manager/schedule`                            | `apps/admin/src/pages/manager/schedule-index-redirect.tsx` | 已完成 | 保留查询参数并重定向到 MG-08 模板与草稿工作区             |
| MG-08     | 排班模板与草稿   | Web 后台   | `/manager/schedule/planning`                   | `apps/admin/src/pages/manager/schedule-planning-page.tsx`  | 已完成 | 周模板、14 天草稿、逐日例外、发布确认与预约影响提示       |
| MG-09     | 已发布排班       | Web 后台   | `/manager/schedule/published?date=:date`       | `apps/admin/src/pages/manager/schedule-page.tsx`           | 已完成 | 指定日期直达、刷新恢复、角色边界与 history fallback 测试  |
| MG-12     | 服务目录管理     | Web 后台   | `/manager/services`                            | `apps/admin/src/pages/manager/services-page.tsx`           | 已完成 | 目录读取、角色边界、直接路由刷新与恢复状态测试            |
| MG-13     | 员工账号与技能   | Web 后台   | `/manager/services/staff`                      | `apps/admin/src/pages/manager/staff-page.tsx`              | 已完成 | 技能矩阵键盘操作、错误提示、角色边界与浏览器刷新测试      |
| —         | 店长顾客入口     | Web 后台   | `/manager/customers`                           | `apps/admin/src/pages/manager/customers-page.tsx`          | 骨架   | Vite history fallback + 独立路由测试                      |
| —         | 店长经营入口     | Web 后台   | `/manager/business`                            | `apps/admin/src/pages/manager/business-page.tsx`           | 骨架   | Vite history fallback + 独立路由测试                      |
| —         | 店长系统入口     | Web 后台   | `/manager/system`                              | `apps/admin/src/pages/manager/system-page.tsx`             | 骨架   | Vite history fallback + 独立路由测试                      |
| MP-01     | 顾客首页         | 微信小程序 | `pages/home/index`                             | `apps/mini-program/miniprogram/pages/home/`                | 已完成 | 项目契约测试 + 开发者工具实机加载                         |
| MP-02     | 服务列表         | 微信小程序 | `pages/services/index`                         | `apps/mini-program/miniprogram/pages/services/`            | 已完成 | 页面登记 + 开发者工具直接打开                             |
| MP-02     | 服务详情         | 微信小程序 | `pages/service-detail/index?id=:serviceId`     | `apps/mini-program/miniprogram/pages/service-detail/`      | 已完成 | 首页跳转 + 详情刷新恢复（2026-08-15）                     |
| MP-03     | 宠物列表         | 微信小程序 | `pages/pets/index`                             | `apps/mini-program/miniprogram/pages/pets/`                | 已完成 | 生命周期／直达门禁测试 + 开发者工具载入（2026-08-17）     |
| MP-04     | 新建宠物         | 微信小程序 | `pages/pet-form/index`                         | `apps/mini-program/miniprogram/pages/pet-form/`            | 已完成 | 新建路径／页面生命周期测试 + 开发者工具载入（2026-08-17） |
| MP-04     | 编辑宠物         | 微信小程序 | `pages/pet-form/index?id=:petId`               | `apps/mini-program/miniprogram/pages/pet-form/`            | 已完成 | 查询参数传入初始化 + 重新拉取档案测试（2026-08-17）       |
| MP-05     | 隐私同意         | 微信小程序 | `pages/privacy-consent/index`                  | `apps/mini-program/miniprogram/pages/privacy-consent/`     | 已完成 | 页面生命周期／返回路径恢复 + 开发者工具载入（2026-08-17） |
| MP-06     | 预约选择宠物     | 微信小程序 | `pages/booking-pet/index`                      | `apps/mini-program/miniprogram/pages/booking-pet/`         | 已完成 | 独立页面登记、直达隐私门禁、前进栈与草稿恢复测试          |
| MP-07     | 服务与增项       | 微信小程序 | `pages/booking-service/index`                  | `apps/mini-program/miniprogram/pages/booking-service/`     | 已完成 | 缺失宠物恢复、实时组合计算、前进／返回与刷新草稿测试      |
| MP-08     | 员工偏好         | 微信小程序 | `pages/booking-staff/index`                    | `apps/mini-program/miniprogram/pages/booking-staff/`       | 已完成 | 缺失服务恢复、指定员工／最快可约与前进栈测试              |
| MP-09     | 日期与时段       | 微信小程序 | `pages/booking-time/index`                     | `apps/mini-program/miniprogram/pages/booking-time/`        | 已完成 | 14 日真实时段、直达恢复、过期日期与刷新草稿测试           |
| MP-10     | 确认预约         | 微信小程序 | `pages/booking-confirm/index`                  | `apps/mini-program/miniprogram/pages/booking-confirm/`     | 已完成 | 持久草稿直达、服务端事实复核、提交冲突恢复测试            |
| MP-11     | 预约成功         | 微信小程序 | `pages/booking-success/index?id=:bookingId`    | `apps/mini-program/miniprogram/pages/booking-success/`     | 已完成 | 按预约身份直达与刷新，重新读取服务端预约快照              |
| MP-12     | 时段冲突与建议   | 微信小程序 | `pages/booking-conflict/index`                 | `apps/mini-program/miniprogram/pages/booking-conflict/`    | 已完成 | 持久草稿与冲突上下文直达、刷新、无建议恢复和交互测试      |
| MP-13     | 预约记录         | 微信小程序 | `pages/appointments/index`                     | `apps/mini-program/miniprogram/pages/appointments/`        | 已完成 | 未来／历史、刷新恢复、生命周期与开发者工具原生验证        |
| MP-14     | 预约详情与核销码 | 微信小程序 | `pages/booking-detail/index?id=:bookingId`     | `apps/mini-program/miniprogram/pages/booking-detail/`      | 已完成 | 预约身份直达、刷新重拉、顾客权限测试与开发者工具原生验证  |
| MP-15     | 顾客改期         | 微信小程序 | `pages/booking-reschedule/index?id=:bookingId` | `apps/mini-program/miniprogram/pages/booking-reschedule/`  | 已完成 | 预约身份直达、刷新重拉、返回保留原预约与冲突选择恢复测试  |
| MP-15     | 顾客取消         | 微信小程序 | `pages/booking-cancel/index?id=:bookingId`     | `apps/mini-program/miniprogram/pages/booking-cancel/`      | 已完成 | 预约身份直达、刷新重拉、返回保留原预约与终态恢复测试      |
| MP-16     | 消息             | 微信小程序 | `pages/messages/index`                         | `apps/mini-program/miniprogram/pages/messages/`            | 已完成 | 消息事实、预约跳转、刷新恢复、权限与开发者工具原生验证    |
| MP-17     | 我的             | 微信小程序 | `pages/profile/index`                          | `apps/mini-program/miniprogram/pages/profile/`             | 已完成 | `app.json` tab 登记 + 会话恢复                            |

状态使用以下词汇：

- `骨架`：真实路由已存在，只显示当前工单允许的壳层或工程状态。
- `实现中`：页面业务正在开发，不作为完整验收结果。
- `已完成`：对应工单功能、直接访问和恢复行为均已验证。
