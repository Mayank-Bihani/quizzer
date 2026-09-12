import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { AdminShell, StudentShell } from "./components/Shells";
import { LoadingCard } from "./components/ui";
import {
  AdminForbiddenPage,
  AdminHomePage,
  BankPage,
  ImportPage,
  PassagePage,
  QuestionEditorPage,
  QuizBuilderPage,
  ReportPage,
  ReportsIndexPage,
  SchedulePage,
  UsersPage,
} from "./features/admin/AdminPages";
import { RunPage } from "./features/student/RunPage";
import {
  DidNotTakePage,
  FinishPage,
  HistoryPage,
  HoldingPage,
  HomePage,
  JoinPage,
  LobbyPage,
  NotFoundPage,
  ProfilePage,
  QuizDetailPage,
  QuizResultsPage,
  ReviewPage,
  WeeklyBoardPage,
} from "./features/student/StudentPages";
import { SignInPage } from "./features/student/SignInPage";

function Protected() {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <main className="center-page">
        <LoadingCard />
      </main>
    );
  if (!user) return <Navigate to="/signin" replace />;
  return <Outlet />;
}

function StudentLayout() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <StudentShell user={user}>
      <Outlet />
    </StudentShell>
  );
}

function AdminLayout() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === "student")
    return (
      <StudentShell user={user}>
        <AdminForbiddenPage />
      </StudentShell>
    );
  return (
    <AdminShell user={user}>
      <Outlet />
    </AdminShell>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignInPage />} />
      <Route element={<Protected />}>
        <Route path="/play/:quizId" element={<RunPage />} />
        <Route element={<StudentLayout />}>
          <Route index element={<HomePage />} />
          <Route path="join" element={<JoinPage />} />
          <Route path="lobby/:code" element={<LobbyPage />} />
          <Route path="quiz/:quizId" element={<QuizDetailPage />} />
          <Route path="quiz/:quizId/finish" element={<FinishPage />} />
          <Route path="quiz/:quizId/holding" element={<HoldingPage />} />
          <Route path="quiz/:quizId/results" element={<QuizResultsPage />} />
          <Route path="quiz/:quizId/review" element={<ReviewPage />} />
          <Route
            path="quiz/:quizId/did-not-take"
            element={<DidNotTakePage />}
          />
          <Route path="history" element={<HistoryPage />} />
          <Route path="boards/weekly" element={<WeeklyBoardPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<AdminHomePage />} />
          <Route path="bank" element={<BankPage />} />
          <Route
            path="bank/questions/:questionId"
            element={<QuestionEditorPage />}
          />
          <Route path="bank/passages" element={<PassagePage />} />
          <Route path="bank/passages/:passageId" element={<PassagePage />} />
          <Route path="import/:step" element={<ImportPage />} />
          <Route path="quizzes/new/:step" element={<QuizBuilderPage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="reports" element={<ReportsIndexPage />} />
          <Route path="quizzes/:quizId/report" element={<ReportPage />} />
          <Route path="users" element={<UsersPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
