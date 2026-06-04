import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { HashRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { RecentProjectsProvider } from "@/contexts/RecentProjectsContext";
import { ModelProvider } from "@/contexts/ModelContext";
import { VersionControlProvider } from "@/contexts/VersionControlContext";
import { CloudSyncProvider } from "@/contexts/CloudSyncContext";
import { GalleryProvider } from "@/contexts/GalleryContext";
import { PresenceProvider, PresenceProviderNoop } from "@/contexts/PresenceContext";
import { features } from "@/lib/features";
import { DiagnosticsModal } from "@/components/DiagnosticsModal";
import Index from "./pages/Index";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Checkout = lazy(() => import("./pages/Checkout"));
const Settings = lazy(() => import("./pages/Settings"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();
const ActivePresenceProvider = features.team ? PresenceProvider : PresenceProviderNoop;

const App = () => {
  return (
  <ThemeProvider attribute="class" defaultTheme="system" storageKey="0studio-theme">
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <RecentProjectsProvider>
        <HashRouter>
          <ActivePresenceProvider>
            <VersionControlProvider>
              <CloudSyncProvider>
              <GalleryProvider>
              <ModelProvider>
                <TooltipProvider>
                  <Toaster />
                  <Sonner />
                  <DiagnosticsModal />
                  <Suspense fallback={null}>
                  <Routes>
                    <Route path="/" element={<Index />} />
                    {features.payments ? (
                      <>
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/checkout" element={<Checkout />} />
                      </>
                    ) : (
                      <>
                        <Route path="/dashboard" element={<Index />} />
                        <Route path="/checkout" element={<Index />} />
                      </>
                    )}
                    <Route path="/settings" element={<Settings />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                  </Suspense>
                </TooltipProvider>
              </ModelProvider>
              </GalleryProvider>
              </CloudSyncProvider>
            </VersionControlProvider>
          </ActivePresenceProvider>
        </HashRouter>
      </RecentProjectsProvider>
    </AuthProvider>
  </QueryClientProvider>
  </ThemeProvider>
  );
};

export default App;
