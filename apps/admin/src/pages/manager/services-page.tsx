import { RoleRouteReadyPage } from "../../page-components";

export function ManagerServicesPage(): React.JSX.Element {
  return (
    <RoleRouteReadyPage
      copy={{
        eyebrow: "店长 · 服务",
        title: "服务",
        description: "宠物洗护服务、规格、增项和员工技能将在后续业务工单接入。",
      }}
    />
  );
}
