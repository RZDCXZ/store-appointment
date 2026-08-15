import { RoleRouteReadyPage } from "../../page-components";

export function ManagerSystemPage(): React.JSX.Element {
  return (
    <RoleRouteReadyPage
      copy={{
        eyebrow: "店长 · 系统",
        title: "系统",
        description: "通知、审计和演示设置将在后续业务工单接入。",
      }}
    />
  );
}
