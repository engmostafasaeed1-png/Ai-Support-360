import { Navigate } from 'react-router-dom';

/**
 * The permissions table that used to be here was saved but never checked anywhere in the app.
 * What a person can do is decided by their role (client, consultant, admin, super admin) in the database;
 * roles are changed in User Management.
 */
export default function RolesPermissionsSection() {
  return <Navigate to="/admin/console/users" replace />;
}
