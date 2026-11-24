import { lazy } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "../layouts/AppShell";
import { HomePage } from "../pages/HomePage";
import { AboutPage } from "../pages/AboutPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { AgentPage } from "../pages/AgentPage/AgentPage";
import { DocumentsPage } from "../pages/DocumentsPage/DocumentsPage";
import { SettingsPage } from "../pages/SettingsPage/SettingsPage";
import { AuthProvider } from "../auth/AuthProvider";
import { ChatHistoryProvider } from "../chat/ChatHistoryProvider";

import BrowserToolsLayout from "../browser-tools/BrowserToolsLayout";
import ToolCatalog from "../browser-tools/components/ToolCatalog";
import ToolNotFound from "../browser-tools/components/ToolNotFound";
import ToolRouteError from "../browser-tools/components/ToolRouteError";
import PublisherWorkspace from "../browser-tools/publisher/PublisherWorkspace";

const CodeFormatter = lazy(
  () => import("../browser-tools/tools/CodeFormatter"),
);
const HtmlToMarkdown = lazy(
  () => import("../browser-tools/tools/HtmlToMarkdown"),
);
const PdfGenerator = lazy(() => import("../browser-tools/tools/PdfGenerator"));
const ImageConverter = lazy(
  () => import("../browser-tools/tools/ImageConverter"),
);
const DataConverter = lazy(
  () => import("../browser-tools/tools/DataConverter"),
);
const CryptoHasher = lazy(() => import("../browser-tools/tools/CryptoHasher"));
const ThemeDesigner = lazy(
  () => import("../browser-tools/tools/ThemeDesigner"),
);
const PublisherLanding = lazy(
  () => import("../browser-tools/publisher/PublisherLanding"),
);
const PublicationDesigner = lazy(
  () => import("../browser-tools/tools/PublicationDesigner"),
);

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/about", element: <AboutPage /> },
      { path: "/agent", element: <AgentPage /> },
      { path: "/agent/:sessionId", element: <AgentPage /> },
      { path: "/documents", element: <DocumentsPage /> },
      { path: "/admin/dashboard/settings", element: <SettingsPage /> },
      {
        path: "/browser-tools",
        element: <BrowserToolsLayout />,
        errorElement: <ToolRouteError />,
        children: [
          { index: true, element: <ToolCatalog /> },
          { path: "formatter", element: <CodeFormatter /> },
          { path: "html-to-md", element: <HtmlToMarkdown /> },
          { path: "pdf-generator", element: <PdfGenerator /> },
          { path: "image-converter", element: <ImageConverter /> },
          { path: "data-converter", element: <DataConverter /> },
          { path: "crypto-hasher", element: <CryptoHasher /> },
          { path: "theme-designer", element: <ThemeDesigner /> },
          {
            path: "publication-designer",
            element: <PublisherWorkspace />,
            children: [
              { index: true, element: <PublisherLanding /> },
              { path: "editor", element: <PublicationDesigner /> },
            ],
          },
          { path: "*", element: <ToolNotFound /> },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

export function AppRouter() {
  return <AuthProvider><ChatHistoryProvider><RouterProvider router={router} /></ChatHistoryProvider></AuthProvider>;
}
