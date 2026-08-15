import { RoleRouteReadyPage } from "../../page-components";

export function ManagerCustomersPage(): React.JSX.Element {
  return (
    <RoleRouteReadyPage
      copy={{
        eyebrow: "店长 · 顾客",
        title: "顾客",
        description: "顾客和宠物档案将在后续业务工单接入。",
      }}
    />
  );
}
