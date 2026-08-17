import { Navigate } from "react-router-dom";
import { getShanghaiLocalDate } from "@rongguang/contracts";

export function ManagerAppointmentsPage(): React.JSX.Element {
  const date = getShanghaiLocalDate(import.meta.env.VITE_DEMO_NOW ?? new Date());
  return <Navigate to={`/manager/appointments/calendar?date=${date}`} replace />;
}
