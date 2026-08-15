import { RoleRouteReadyPage } from "../../page-components";

export function ManagerSchedulePage(): React.JSX.Element {
  return (
    <RoleRouteReadyPage
      copy={{
        eyebrow: "店长 · 排班",
        title: "排班",
        description: "排班模板、已发布排班和容量变化将在后续业务工单接入。",
      }}
    />
  );
}
