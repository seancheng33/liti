import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Spin } from 'antd';
import { AuthProvider, useAuth } from './auth';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import HelpPage from './pages/HelpPage';
import QuestionsPage from './pages/QuestionsPage';
import CategoriesPage from './pages/CategoriesPage';
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
          {/* 公开页面：首页未登录也能看统计与已发布试卷预览 */}
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/help" element={<HelpPage />} />

          {/* 需要登录的站内页面：统一套 AppLayout（无 path 的布局路由） */}
          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route path="/papers" element={<PapersPage />} />
            <Route path="/questions" element={<QuestionsPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/attempts" element={<MyAttemptsPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/exam/:attemptId" element={<ExamPage />} />
            <Route path="/review/:attemptId" element={<ReviewPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
