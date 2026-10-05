import { Navigate, useSearchParams } from 'react-router-dom';

export default function OnboardingPage() {
  const [searchParams] = useSearchParams();
  const params = new URLSearchParams(searchParams);
  params.set('section', 'setup');
  return <Navigate to={`/consultant/profile?${params.toString()}`} replace />;
}
