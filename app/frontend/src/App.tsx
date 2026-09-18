import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import { AuthProvider } from './contexts/AuthContext';
import HomePage from './pages/HomePage';
import ChatDetailPage from './pages/ChatDetailPage';
import ResourcesPage from './pages/ResourcesPage';
import ProjectsPage from './pages/ProjectsPage';
import AuthCallback from './pages/AuthCallback';
import AuthError from './pages/AuthError';

const queryClient = new QueryClient();

const AppRoutes = () => (
  <Routes>
    <Route element={<AppLayout />}>
      <Route path="/" element={<HomePage />} />
      <Route path="/chat/:conversationId" element={<ChatDetailPage />} />
      <Route path="/resources" element={<ResourcesPage />} />
      <Route path="/projects" element={<ProjectsPage />} />
    </Route>
    <Route path="/auth/callback" element={<AuthCallback />} />
    <Route path="/auth/error" element={<AuthError />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
export { AppRoutes };
