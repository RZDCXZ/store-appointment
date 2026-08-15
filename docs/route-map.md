# 设计稿页面 → 实际路由

每个产品页面在实现时登记一行。`实际路由或页面路径` 必须是可直接打开并在刷新、重新编译或重新打开后恢复的入口；组件内部状态、弹窗名称和原型视图名称不能充当路由。

| 设计稿 ID | 设计稿页面     | 端         | 实际路由或页面路径      | 页面模块                                             | 状态   | 直接访问验证                         |
| --------- | -------------- | ---------- | ----------------------- | ---------------------------------------------------- | ------ | ------------------------------------ |
| ST-01     | 后台登录       | Web 后台   | `/login`                | `apps/admin/src/login-page.tsx`                      | 已完成 | Vite history fallback + 登录路由测试 |
| ST-02     | 员工今日工作   | Web 后台   | `/staff/today`          | `apps/admin/src/pages/staff/today-page.tsx`          | 骨架   | Vite history fallback + 角色路由测试 |
| —         | 员工本人预约   | Web 后台   | `/staff/appointments`   | `apps/admin/src/pages/staff/appointments-page.tsx`   | 骨架   | 会话回跳测试 + Vite history fallback |
| MG-01     | 店长今日工作台 | Web 后台   | `/manager/workbench`    | `apps/admin/src/pages/manager/workbench-page.tsx`    | 骨架   | Vite history fallback + 角色路由测试 |
| —         | 店长预约入口   | Web 后台   | `/manager/appointments` | `apps/admin/src/pages/manager/appointments-page.tsx` | 骨架   | Vite history fallback + 独立路由测试 |
| —         | 店长排班入口   | Web 后台   | `/manager/schedule`     | `apps/admin/src/pages/manager/schedule-page.tsx`     | 骨架   | Vite history fallback + 独立路由测试 |
| —         | 店长服务入口   | Web 后台   | `/manager/services`     | `apps/admin/src/pages/manager/services-page.tsx`     | 骨架   | Vite history fallback + 独立路由测试 |
| —         | 店长顾客入口   | Web 后台   | `/manager/customers`    | `apps/admin/src/pages/manager/customers-page.tsx`    | 骨架   | Vite history fallback + 独立路由测试 |
| —         | 店长经营入口   | Web 后台   | `/manager/business`     | `apps/admin/src/pages/manager/business-page.tsx`     | 骨架   | Vite history fallback + 独立路由测试 |
| —         | 店长系统入口   | Web 后台   | `/manager/system`       | `apps/admin/src/pages/manager/system-page.tsx`       | 骨架   | Vite history fallback + 独立路由测试 |
| MP-01     | 顾客首页       | 微信小程序 | `pages/home/index`      | `apps/mini-program/miniprogram/pages/home/`          | 骨架   | `app.json` 登记 + 项目契约测试       |

状态使用以下词汇：

- `骨架`：真实路由已存在，只显示当前工单允许的壳层或工程状态。
- `实现中`：页面业务正在开发，不作为完整验收结果。
- `已完成`：对应工单功能、直接访问和恢复行为均已验证。
