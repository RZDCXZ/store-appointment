import { HealthStatus, PageHeading, ProtectedLandingStatus } from "../../page-components";

export function ManagerWorkbenchPage(): React.JSX.Element {
  return (
    <main className="page-shell">
      <PageHeading
        copy={{
          eyebrow: "MG-01 · 店长",
          title: "今日工作台",
          description: "风险、状态与员工日时间线",
        }}
        badge="店长权限"
      />
      <ProtectedLandingStatus path="/backoffice/manager/workbench" />
      <HealthStatus />
      <section className="welcome-panel">
        <div>
          <p className="eyebrow">后台演示账号与角色路由</p>
          <h2>店长工作区已经安全就位。</h2>
          <p>当前导航均为独立 URL；预约、排班与经营事实会由后续纵向工单接入。</p>
        </div>
        <div className="hero-image" role="img" aria-label="晨光中的柴犬" />
      </section>
    </main>
  );
}
