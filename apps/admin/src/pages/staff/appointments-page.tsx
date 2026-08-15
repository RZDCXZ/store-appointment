import { useOutletContext } from "react-router-dom";

import type { BackofficeOutletContext } from "../../backoffice-layout";
import { PageHeading } from "../../page-components";

export function StaffAppointmentsPage(): React.JSX.Element {
  const { account } = useOutletContext<BackofficeOutletContext>();

  return (
    <main className="page-shell staff-page">
      <PageHeading
        copy={{
          eyebrow: "员工 · 本人范围",
          title: "我的预约",
          description: `${account.displayName} 的预约与履约记录`,
        }}
        badge="本人范围"
      />
      <section className="placeholder-panel">
        <span className="placeholder-panel__number">ST</span>
        <div>
          <h2>本人预约路由已就绪</h2>
          <p>预约数据将在后续工单接入，其他员工的资源仍由 API 拒绝访问。</p>
        </div>
      </section>
    </main>
  );
}
