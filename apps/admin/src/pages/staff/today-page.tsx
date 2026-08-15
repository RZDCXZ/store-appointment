import { useOutletContext } from "react-router-dom";

import type { BackofficeOutletContext } from "../../backoffice-layout";
import { PageHeading, ProtectedLandingStatus } from "../../page-components";

export function StaffTodayPage(): React.JSX.Element {
  const { account } = useOutletContext<BackofficeOutletContext>();

  return (
    <main className="page-shell staff-page">
      <PageHeading
        copy={{
          eyebrow: "ST-02 · 员工",
          title: "我的今日工作",
          description: `${account.displayName} · 今日行动与本人预约`,
        }}
        badge="本人范围"
      />
      <ProtectedLandingStatus path={`/backoffice/staff/${account.id}/today`} />
      <section className="staff-welcome">
        <p className="eyebrow">下一位宠物</p>
        <h2>今日预约将在后续履约工单接入</h2>
        <p>当前页面已经由服务端限制为 {account.displayName} 本人范围。</p>
      </section>
    </main>
  );
}
