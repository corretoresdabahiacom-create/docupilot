import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { useMe } from './lib/queries';
import { AuthPage } from './pages/AuthPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { takePendingInvite } from './lib/team';

// Páginas carregadas sob demanda: a tela de login não baixa PDF.js, editor etc.
const ComparePage = lazy(() =>
  import('./pages/ComparePage').then((m) => ({ default: m.ComparePage })),
);
const CreatePage = lazy(() =>
  import('./pages/CreatePage').then((m) => ({ default: m.CreatePage })),
);
const EditorPage = lazy(() =>
  import('./pages/EditorPage').then((m) => ({ default: m.EditorPage })),
);
const ExecutionPage = lazy(() =>
  import('./pages/ExecutionPage').then((m) => ({ default: m.ExecutionPage })),
);
const NotificationsPage = lazy(() =>
  import('./pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })),
);
const WorkflowsPage = lazy(() =>
  import('./pages/WorkflowsPage').then((m) => ({ default: m.WorkflowsPage })),
);
const DocumentPage = lazy(() =>
  import('./pages/DocumentPage').then((m) => ({ default: m.DocumentPage })),
);
const FillFormPage = lazy(() =>
  import('./pages/FillFormPage').then((m) => ({ default: m.FillFormPage })),
);
const InvitePage = lazy(() =>
  import('./pages/InvitePage').then((m) => ({ default: m.InvitePage })),
);
const ProfilesPage = lazy(() =>
  import('./pages/ProfilesPage').then((m) => ({ default: m.ProfilesPage })),
);
const TeamPage = lazy(() => import('./pages/TeamPage').then((m) => ({ default: m.TeamPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const ReportPage = lazy(() =>
  import('./pages/ReportPage').then((m) => ({ default: m.ReportPage })),
);

export function App() {
  const { t } = useTranslation();
  const me = useMe();
  const signedIn = Boolean(me.data);

  if (me.isPending) return <Layout signedIn={false}>{null}</Layout>;

  return (
    <Layout signedIn={signedIn}>
      <Suspense fallback={<p className="text-sm text-[var(--muted)]">{t('common.loading')}</p>}>
        <Routes>
          <Route
            path="/login"
            element={signedIn ? <Navigate to="/" replace /> : <AuthPage mode="login" />}
          />
          <Route
            path="/register"
            element={signedIn ? <Navigate to="/" replace /> : <AuthPage mode="register" />}
          />
          <Route
            path="/"
            element={
              signedIn ? (
                // Convite aberto antes do login: volta para ele logo após entrar.
                (() => {
                  const pending = takePendingInvite();
                  return pending ? (
                    <Navigate to={`/convite/${encodeURIComponent(pending)}`} replace />
                  ) : (
                    <DocumentsPage />
                  );
                })()
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route path="/convite/:token" element={<InvitePage signedIn={signedIn} />} />
          <Route
            path="/team"
            element={signedIn ? <TeamPage /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/documents/:documentId"
            element={signedIn ? <DocumentPage /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/documents/:documentId/fill"
            element={signedIn ? <FillFormPage /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/profiles"
            element={signedIn ? <ProfilesPage /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/compare"
            element={signedIn ? <ComparePage /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/create"
            element={signedIn ? <CreatePage /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/create/:id"
            element={signedIn ? <EditorPage /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/workflows"
            element={signedIn ? <WorkflowsPage /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/workflows/executions/:eid"
            element={signedIn ? <ExecutionPage /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/notifications"
            element={signedIn ? <NotificationsPage /> : <Navigate to="/login" replace />}
          />
          <Route path="/report" element={<ReportPage />} />
          <Route
            path="/admin"
            element={
              signedIn && me.data?.user.isPlatformAdmin ? (
                <AdminPage />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
