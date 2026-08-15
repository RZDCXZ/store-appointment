import { RoleRouteReadyPage } from "../../page-components";

export function ManagerBusinessPage(): React.JSX.Element {
  return (
    <RoleRouteReadyPage
      copy={{
        eyebrow: "店长 · 经营",
        title: "经营",
        description: "经营事实和周期对比将在后续业务工单接入。",
      }}
    />
  );
}
