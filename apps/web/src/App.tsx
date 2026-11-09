import { Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { useMe } from './lib/queries';
import { AuthPage } from './pages/AuthPage';
import { DocumentsPage } from './pages/DocumentsPage';

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
        <Route path="/" element={signedIn ? <DocumentsPage /> : <Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
