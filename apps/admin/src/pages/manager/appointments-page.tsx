import { RoleRouteReadyPage } from "../../page-components";

export function ManagerAppointmentsPage(): React.JSX.Element {
  return (
    <RoleRouteReadyPage
      copy={{
        eyebrow: "店长 · 预约",
        title: "预约",
        description: "预约日历、列表和详情将在后续业务工单接入。",
      }}
    />
  );
}
