import { Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { useMe } from './lib/queries';
import { AuthPage } from './pages/AuthPage';
import { ComparePage } from './pages/ComparePage';
import { CreatePage } from './pages/CreatePage';
import { EditorPage } from './pages/EditorPage';
import { ExecutionPage } from './pages/ExecutionPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { DocumentPage } from './pages/DocumentPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { FillFormPage } from './pages/FillFormPage';
import { InvitePage } from './pages/InvitePage';
import { ProfilesPage } from './pages/ProfilesPage';
import { TeamPage } from './pages/TeamPage';
import { takePendingInvite } from './lib/team';

export function App() {
  const me = useMe();
  const signedIn = Boolean(me.data);

  if (me.isPending) return <Layout signedIn={false}>{null}</Layout>;

  return (
    <Layout signedIn={signedIn}>
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
        <Route path="/team" element={signedIn ? <TeamPage /> : <Navigate to="/login" replace />} />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
