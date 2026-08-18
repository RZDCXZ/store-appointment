import { NavLink } from "react-router-dom";

export function ScheduleNavigation(): React.JSX.Element {
  return (
    <nav className="schedule-section-nav" aria-label="排班管理页面">
      <NavLink to="/manager/schedule/planning">排班模板与草稿</NavLink>
      <NavLink to="/manager/schedule/published">已发布排班与日期例外</NavLink>
      <NavLink to="/manager/schedule/capacity-changes/new">容量变化</NavLink>
    </nav>
  );
}
