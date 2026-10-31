import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Spin } from 'antd';
import { AuthProvider, useAuth } from './auth';
import LoginPage from './pages/LoginPage';
import QuestionsPage from './pages/QuestionsPage';
import PapersPage from './pages/PapersPage';
import ExamPage from './pages/ExamPage';
import ReviewPage from './pages/ReviewPage';
import MyAttemptsPage from './pages/MyAttemptsPage';
import StatsPage from './pages/StatsPage';
import UsersPage from './pages/UsersPage';
import SettingsPage from './pages/SettingsPage';
import ProfilePage from './pages/ProfilePage';
import AppLayout from './components/AppLayout';

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ padding: 100, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/papers" replace />} />
            <Route path="papers" element={<PapersPage />} />
            <Route path="questions" element={<QuestionsPage />} />
            <Route path="attempts" element={<MyAttemptsPage />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="exam/:attemptId" element={<ExamPage />} />
            <Route path="review/:attemptId" element={<ReviewPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
