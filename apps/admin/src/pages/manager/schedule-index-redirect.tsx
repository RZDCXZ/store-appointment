import { Navigate, useLocation } from "react-router-dom";

export function ScheduleIndexRedirect(): React.JSX.Element {
  const location = useLocation();

  return <Navigate to={`published${location.search}`} replace />;
}
