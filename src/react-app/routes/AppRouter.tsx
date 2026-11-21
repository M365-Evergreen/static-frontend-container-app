import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from '../layouts/AppShell';
import { HomePage } from '../pages/HomePage';
import { AboutPage } from '../pages/AboutPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { AgentPage } from '../pages/AgentPage/AgentPage';

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/agent" element={<AgentPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}