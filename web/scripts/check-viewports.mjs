import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../dist/", import.meta.url);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 4179;
const DEBUG_PORT = 9231;
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const question = {
  id: "q1",
  type: "quant",
  topic: "Algebra",
  subtopic: null,
  difficulty: "medium",
  format: "mcq",
  passageId: null,
  groupPosition: null,
  bodyMd: "If $x=2$, find $x^2$.",
  imageUrl: null,
  optionA: "2",
  optionB: "3",
  optionC: "4",
  optionD: "5",
  correctOption: "C",
  numericAnswer: null,
  numericTolerance: null,
  explanationMd: "$2^2=4$.",
  source: "Fixture",
  passage: null,
};
const unit = {
  unitPosition: 1,
  unitCount: 1,
  questionCount: 1,
  kind: "standalone",
  timeLimitSec: 60,
  passage: null,
  questions: [
    {
      position: 1,
      subPosition: 1,
      format: "mcq",
      bodyMd: question.bodyMd,
      imageUrl: null,
      options: ["2", "3", "4", "5"],
    },
  ],
  startedAt: Date.now(),
  deadlineAt: Date.now() + 60_000,
  submitByAt: Date.now() + 65_000,
};
const quizMeta = {
  quizId: "run-active",
  quizNumber: 27,
  title: "Quant Sprint",
  type: "quant",
  questionCount: 1,
  unitCount: 1,
  endsAt: Date.now() + 300_000,
  windowSec: 90,
  startedAt: Date.now(),
  deadlineAt: Date.now() + 90_000,
};
const quiz = {
  id: "open-1",
  quizNumber: 27,
  templateId: null,
  title: "Quant Sprint",
  type: "quant",
  questionCount: 1,
  difficultyMix: { medium: 1 },
  scheduledAt: Date.now(),
  lobbyOpensAt: Date.now() - 300_000,
  endsAt: Date.now() + 300_000,
  status: "open",
  roomCode: "QNT-1000",
  seatCap: 100,
  unitCount: 1,
  units: [
    {
      unitPosition: 1,
      kind: "standalone",
      passageId: null,
      questionPositions: [1],
      timeLimitSec: 60,
    },
  ],
  timingPolicy: { standalone: 60 },
  joinWindowSec: 300,
  slackSec: 30,
  windowSec: 90,
  marksCorrect: 3,
  marksWrong: -1,
  createdAt: Date.now() - 3_600_000,
  openedAt: Date.now() - 300_000,
  endedAt: null,
  boardComputedAt: null,
};
const endedQuiz = {
  ...quiz,
  id: "finished",
  status: "ended",
  roomCode: "QNT-9999",
  endedAt: Date.now() - 60_000,
  boardComputedAt: Date.now() - 60_000,
};
const draftQuiz = {
  ...quiz,
  id: "draft-1",
  quizNumber: null,
  status: "draft",
  roomCode: null,
  openedAt: null,
};
const page = (items) => ({ items, total: items.length, limit: 50, offset: 0 });

function json(response, statusCode = 200) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(response),
  };
}

function apiResponse(requestUrl) {
  const url = new URL(requestUrl, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  if (path === "/api/auth/me")
    return json({
      id: "user-1",
      name: "Priya Menon",
      role: "superadmin",
      pictureUrl: null,
    });
  if (path === "/api/quizzes/open")
    return json({
      quizzes: [
        {
          id: "open-1",
          quizNumber: 27,
          title: "Quant Sprint",
          type: "quant",
          roomCode: "QNT-1000",
          scheduledAt: quiz.scheduledAt,
          endsAt: quiz.endsAt,
        },
      ],
    });
  if (path === "/api/students/me/history")
    return json({
      ...page([
        {
          quizId: "finished",
          quizNumber: 26,
          title: "Previous Sprint",
          type: "quant",
          scheduledAt: Date.now() - 86_400_000,
          totalScore: 3,
          rank: 1,
          participantCount: 2,
        },
      ]),
      limit: Number(url.searchParams.get("limit") ?? 50),
      offset: Number(url.searchParams.get("offset") ?? 0),
    });
  if (path === "/api/boards/weekly")
    return json({
      ...page([
        {
          rank: 1,
          userId: "user-1",
          name: "Priya Menon",
          totalScore: 12,
          quizzesTaken: 4,
        },
      ]),
      weekStart: "2026-09-07",
      type: url.searchParams.get("type") ?? "overall",
    });
  if (path === "/api/bank/questions") return json(page([question]));
  if (path === "/api/bank/questions/q1") return json(question);
  if (path === "/api/bank/passages")
    return json({
      passages: [
        {
          id: "p1",
          type: "verbal",
          topic: "Reading",
          title: "A short passage",
          bodyMd: "Shared text with $x$.",
          imageUrl: null,
          source: null,
          usedInQuizId: null,
        },
      ],
    });
  if (path === "/api/admin/quizzes")
    return json(
      page(
        url.searchParams.get("status") === "ended"
          ? [endedQuiz]
          : [quiz, endedQuiz, draftQuiz],
      ),
    );
  if (path === "/api/admin/users")
    return json({
      users: [
        {
          id: "user-1",
          name: "Priya Menon",
          role: "superadmin",
          pictureUrl: null,
          email: "priya@example.test",
          createdAt: Date.now() - 86_400_000,
        },
        {
          id: "user-2",
          name: "Ananya Krishnamurthy",
          role: "student",
          pictureUrl: null,
          email: "ananya@example.test",
          createdAt: Date.now() - 43_200_000,
        },
      ],
    });
  if (path === "/api/play/run-active/current")
    return json({
      meta: quizMeta,
      state: { status: "active", serverNow: Date.now(), unit },
    });
  if (path === "/api/play/finished/current")
    return json({
      meta: { ...quizMeta, quizId: "finished" },
      state: {
        status: "finished",
        serverNow: Date.now(),
        totalScore: 3,
        answeredCount: 1,
      },
    });
  if (path === "/api/play/finished/status")
    return json({
      totalScore: 3,
      answeredCount: 1,
      finishedCount: 2,
      participantCount: 2,
      estimatedUnlockAt: Date.now() + 60_000,
    });
  if (path === "/api/quizzes/finished/leaderboard")
    return json({
      participantCount: 2,
      boardComputedAt: Date.now() - 60_000,
      truncated: false,
      rows: [
        {
          rank: 1,
          userId: "user-1",
          name: "Priya Menon",
          score: 3,
          isOwnRow: true,
        },
        {
          rank: 2,
          userId: "user-2",
          name: "Ananya Krishnamurthy",
          score: 0,
          isOwnRow: false,
        },
      ],
    });
  if (path === "/api/quizzes/finished/review")
    return json({
      rows: [
        {
          position: 1,
          unitPosition: 1,
          subPosition: 1,
          outcome: "correct",
          question: {
            bodyMd: question.bodyMd,
            imageUrl: null,
            format: "mcq",
            optionA: "2",
            optionB: "3",
            optionC: "4",
            optionD: "5",
            correctOption: "C",
            numericAnswer: null,
            numericTolerance: null,
            explanationMd: question.explanationMd,
            passage: null,
          },
          yourAnswer: {
            chosenOption: "C",
            numericValue: null,
            isCorrect: true,
            marks: 3,
          },
          distribution: {
            participantCount: 2,
            optionCounts: { A: 0, B: 0, C: 1, D: 0 },
            notAnsweredCount: 1,
          },
        },
      ],
      units: [
        {
          unitPosition: 1,
          closeReason: "completed",
          elapsedMs: 20_000,
          roomAvgElapsedMs: 25_000,
        },
      ],
    });
  if (path === "/api/admin/quizzes/finished/report")
    return json({
      quizId: "finished",
      participants: page([
        {
          userId: "user-1",
          name: "Priya Menon",
          seatNo: 1,
          totalScore: 3,
          correctCount: 1,
          wrongCount: 0,
          skippedCount: 0,
          unansweredCount: 0,
          totalTimeMs: 20_000,
          rank: 1,
        },
      ]),
      questions: [
        {
          position: 1,
          unitPosition: 1,
          subPosition: 1,
          questionId: "q1",
          correctCount: 1,
          wrongCount: 0,
          skippedCount: 0,
          unansweredCount: 1,
        },
      ],
      units: [
        {
          unitPosition: 1,
          completedCount: 1,
          timedOutCount: 0,
          avgElapsedMs: 20_000,
        },
      ],
    });
  return json({ message: `No viewport fixture for ${path}` }, 404);
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

const server = createServer(async (request, response) => {
  try {
    if (request.url?.startsWith("/api/")) {
      const result = apiResponse(request.url);
      response.writeHead(result.statusCode, result.headers);
      response.end(result.body);
      return;
    }
    const pathname = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`)
      .pathname;
    const relative =
      pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const candidate = new URL(normalize(relative), ROOT);
    if (!candidate.href.startsWith(ROOT.href)) throw new Error("Unsafe path");
    const info = await stat(candidate);
    if (!info.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "content-type":
        mime[extname(candidate.pathname)] ?? "application/octet-stream",
    });
    response.end(await readFile(candidate));
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
const profile = await mkdtemp(join(tmpdir(), "quizzer-chrome-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-gpu",
    "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  let version;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      version = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then(
        (response) => response.json(),
      );
      break;
    } catch {
      await wait(250);
    }
  }
  if (!version) throw new Error("Chrome DevTools endpoint did not start.");
  const target = await fetch(
    `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(`http://127.0.0.1:${PORT}/`)}`,
    { method: "PUT" },
  ).then((response) => response.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const exceptions = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown")
      exceptions.push(message.params.exceptionDetails.text);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error
        ? reject(new Error(message.error.message))
        : resolve(message.result);
    }
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  await call("Runtime.enable");
  await call("Page.enable");
  const routes = [
    "/",
    "/join",
    "/lobby/QNT-1000",
    "/quiz/open-1",
    "/play/run-active",
    "/quiz/finished/finish",
    "/quiz/finished/holding",
    "/quiz/finished/results",
    "/quiz/finished/review",
    "/quiz/finished/did-not-take",
    "/history",
    "/boards/weekly",
    "/profile",
    "/admin",
    "/admin/bank",
    "/admin/bank/questions/q1",
    "/admin/bank/passages",
    "/admin/bank/passages/p1",
    "/admin/import/upload",
    "/admin/quizzes/new/define",
    "/admin/schedule",
    "/admin/reports",
    "/admin/quizzes/finished/report",
    "/admin/users",
    "/missing",
  ];
  const studentRoutes = new Set(
    routes.filter(
      (route) => !route.startsWith("/admin") && route !== "/missing",
    ),
  );
  const widths = [390, 820, 1440];
  const failures = [];
  for (const width of widths) {
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height: width === 390 ? 844 : 1000,
      deviceScaleFactor: 1,
      mobile: width === 390,
      screenOrientation: { type: "portraitPrimary", angle: 0 },
    });
    for (const route of routes) {
      exceptions.length = 0;
      await call("Page.navigate", {
        url: `http://127.0.0.1:${PORT}/#${route}`,
      });
      await wait(450);
      const evaluated = await call("Runtime.evaluate", {
        expression: `JSON.stringify({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,bodyWidth:document.body.scrollWidth,root:document.querySelector('#root')?.textContent?.slice(0,80),smallTargets:[...document.querySelectorAll('a[href],button:not([disabled]),input:not([type=hidden]),select,textarea,summary')].filter((element)=>{const style=getComputedStyle(element);const rect=element.getBoundingClientRect();return !element.classList.contains('sr-only')&&style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0&&(rect.width<43.5||rect.height<43.5)}).map((element)=>({tag:element.tagName,text:(element.getAttribute('aria-label')||element.textContent||element.getAttribute('name')||'').trim().slice(0,40),width:Math.round(element.getBoundingClientRect().width),height:Math.round(element.getBoundingClientRect().height)}))})`,
        returnByValue: true,
      });
      const metrics = JSON.parse(evaluated.result.value);
      const undersizedStudentTargets =
        width === 390 &&
        studentRoutes.has(route) &&
        metrics.smallTargets.length > 0;
      if (
        metrics.scrollWidth !== metrics.clientWidth ||
        metrics.bodyWidth > metrics.clientWidth ||
        !metrics.root ||
        exceptions.length ||
        undersizedStudentTargets
      )
        failures.push({ width, route, metrics, exceptions: [...exceptions] });
    }
  }
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1180,
    height: 820,
    deviceScaleFactor: 1,
    mobile: false,
    screenOrientation: { type: "landscapePrimary", angle: 90 },
  });
  await call("Page.navigate", {
    url: `http://127.0.0.1:${PORT}/#/play/run-active`,
  });
  await wait(450);
  const landscape = await call("Runtime.evaluate", {
    expression:
      "JSON.stringify({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth})",
    returnByValue: true,
  });
  const landscapeMetrics = JSON.parse(landscape.result.value);
  if (landscapeMetrics.scrollWidth !== landscapeMetrics.clientWidth)
    failures.push({
      width: 1180,
      route: "/play/run-active",
      metrics: landscapeMetrics,
    });
  socket.close();
  if (failures.length)
    throw new Error(`Viewport failures:\n${JSON.stringify(failures, null, 2)}`);
  console.log(
    `Viewport check passed: ${routes.length * widths.length + 1} route/width renders with no document overflow or runtime exception; visible phone student targets are at least 44px.`,
  );
} finally {
  chrome.kill("SIGTERM");
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
