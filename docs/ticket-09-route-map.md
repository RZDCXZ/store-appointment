# Ticket 09 页面映射

| 设计稿页面       | 实际路由                                    | 页面模块                                                   | 直接访问验证                                             |
| ---------------- | ------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| MG-01 今日工作台 | `/manager/workbench`                        | `apps/admin/src/pages/manager/workbench-page.tsx`          | API/SSE、Playwright 刷新与 Vite history fallback         |
| MG-02 按员工日历 | `/manager/appointments/calendar?date=:date` | `apps/admin/src/pages/manager/calendar-page.tsx`           | 四员工事实、角色边界、Playwright 刷新与 history fallback |
| 预约详情入口     | `/manager/appointments/:bookingId`          | `apps/admin/src/pages/manager/appointment-detail-page.tsx` | 事实 API、Playwright 直达刷新与 history fallback         |

`/manager/appointments` 保留查询参数并重定向到日历页。以上三个页面均已验证直接访问、浏览器刷新恢复和角色边界。
