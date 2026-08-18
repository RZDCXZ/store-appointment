import { Navigate } from "react-router-dom";

export function ManagerAppointmentsPage(): React.JSX.Element {
  return <Navigate to="/manager/appointments/list" replace />;
}
