const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const EXAMS_FILE = path.join(DATA_DIR, 'exams.json');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(EXAMS_FILE)) fs.writeFileSync(EXAMS_FILE, JSON.stringify({ exams: {} }, null, 2));
  if (!fs.existsSync(SUBMISSIONS_FILE)) fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify({ submissions: {} }, null, 2));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

ensureDataFiles();

function scoreQuestion(correctArr, answerArr) {
  // Returns score in [0, 0.2, 0.6, 1]
  if (!Array.isArray(correctArr) || !Array.isArray(answerArr)) return 0;
  let correctCount = 0;
  for (let i = 0; i < 4; i++) {
    const expected = !!correctArr[i];
    const given = answerArr[i];
    if (given === expected) correctCount++;
  }
  switch (correctCount) {
    case 4: return 1;
    case 3: return 0.6;
    case 2: return 0.2;
    default: return 0;
  }
}

function scoreSubmission(exam, submission) {
  const partScores = [0, 0];
  const perQuestion = [];

  for (let p = 0; p < 2; p++) {
    const part = exam.parts?.[p];
    const answers = submission.parts?.[p] || [];
    if (!part) continue;
    for (let q = 0; q < (part.questions?.length || 0); q++) {
      const question = part.questions[q];
      const ans = answers[q] || [];
      const score = scoreQuestion(question.correct, ans);
      partScores[p] += score;
      perQuestion.push(score);
    }
  }
  const total = partScores[0] + partScores[1];
  return { total, parts: partScores, perQuestion };
}

function computeStats(exam, submissions) {
  const participants = Object.values(submissions || {});
  const rankings = participants
    .map(s => ({ ...s, score: scoreSubmission(exam, s) }))
    .map(s => ({ studentId: s.student.id, name: s.student.name, total: s.score.total, parts: s.score.parts, submittedAt: s.submittedAt }))
    .sort((a, b) => b.total - a.total);

  const totalParticipants = rankings.length;
  const averageTotal = totalParticipants ? rankings.reduce((sum, r) => sum + r.total, 0) / totalParticipants : 0;
  const partAverages = [0, 0];
  if (totalParticipants) {
    partAverages[0] = rankings.reduce((sum, r) => sum + (r.parts?.[0] || 0), 0) / totalParticipants;
    partAverages[1] = rankings.reduce((sum, r) => sum + (r.parts?.[1] || 0), 0) / totalParticipants;
  }

  // Per-question average across all students; assume 50 per part
  const perQuestionTotals = new Array(100).fill(0);
  const perQuestionCounts = new Array(100).fill(0);
  participants.forEach(s => {
    const sc = scoreSubmission(exam, s);
    sc.perQuestion.forEach((score, idx) => {
      perQuestionTotals[idx] += score;
      perQuestionCounts[idx] += 1;
    });
  });
  const perQuestionAvg = perQuestionTotals.map((sum, i) => perQuestionCounts[i] ? sum / perQuestionCounts[i] : 0).slice(0, (exam.parts?.[0]?.questions?.length || 0) + (exam.parts?.[1]?.questions?.length || 0));

  // Score distribution bins (e.g., 0-10,10-20,... up to max 100) given total max 100
  // Max score equals number of questions; each question max 1.
  const maxScore = (exam.parts?.[0]?.questions?.length || 0) + (exam.parts?.[1]?.questions?.length || 0);
  const binSize = Math.max(5, Math.ceil(maxScore / 10));
  const bins = [];
  for (let start = 0; start < maxScore + binSize; start += binSize) {
    const end = Math.min(maxScore, start + binSize);
    bins.push({ start, end, label: `${start}-${end}`, count: 0 });
    if (end === maxScore) break;
  }
  rankings.forEach(r => {
    const idx = bins.findIndex(b => r.total >= b.start && r.total < b.end || (b.end === maxScore && r.total === maxScore));
    if (idx >= 0) bins[idx].count++;
  });

  return {
    rankings,
    stats: {
      totalParticipants,
      averageTotal,
      partAverages,
      scoreDistribution: bins,
      perQuestionAvg
    }
  };
}

function nowISO() { return new Date().toISOString(); }

// Exams CRUD
app.post('/api/exams', (req, res) => {
  const { id, title, startTimeISO, durationMinutes } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  const db = readJson(EXAMS_FILE);
  if (db.exams[id]) return res.status(400).json({ error: 'Exam already exists' });
  db.exams[id] = { id, title, startTimeISO, durationMinutes, parts: [{ name: 'Part A', questions: [] }, { name: 'Part B', questions: [] }] };
  writeJson(EXAMS_FILE, db);
  res.json(db.exams[id]);
});

app.get('/api/exams/:id', (req, res) => {
  const id = req.params.id;
  const db = readJson(EXAMS_FILE);
  const exam = db.exams[id];
  if (!exam) return res.status(404).json({ error: 'Not found' });
  res.json(exam);
});

app.put('/api/exams/:id', (req, res) => {
  const id = req.params.id;
  const db = readJson(EXAMS_FILE);
  const exam = db.exams[id];
  if (!exam) return res.status(404).json({ error: 'Not found' });
  const { title, startTimeISO, durationMinutes } = req.body;
  if (title !== undefined) exam.title = title;
  if (startTimeISO !== undefined) exam.startTimeISO = startTimeISO;
  if (durationMinutes !== undefined) exam.durationMinutes = durationMinutes;
  writeJson(EXAMS_FILE, db);
  res.json(exam);
});

// Import questions
app.post('/api/exams/:id/questions/import', (req, res) => {
  const id = req.params.id;
  const db = readJson(EXAMS_FILE);
  const exam = db.exams[id];
  if (!exam) return res.status(404).json({ error: 'Not found' });
  const payload = req.body;
  if (!payload || !Array.isArray(payload.parts) || payload.parts.length !== 2) {
    return res.status(400).json({ error: 'Invalid payload. Expect parts[2].' });
  }
  for (let i = 0; i < 2; i++) {
    const part = payload.parts[i];
    if (!Array.isArray(part.questions) || part.questions.length !== 50) {
      return res.status(400).json({ error: `Part ${i+1} must have exactly 50 questions.` });
    }
    for (let q of part.questions) {
      if (!q || !Array.isArray(q.statements) || q.statements.length !== 4) {
        return res.status(400).json({ error: 'Each question must have 4 statements.' });
      }
      if (!Array.isArray(q.correct) || q.correct.length !== 4) {
        return res.status(400).json({ error: 'Each question must have 4 correct booleans.' });
      }
    }
  }
  exam.parts = payload.parts;
  writeJson(EXAMS_FILE, db);
  res.json(exam);
});

// Student view (enforces schedule)
app.get('/api/exams/:id/for-student', (req, res) => {
  const id = req.params.id;
  const db = readJson(EXAMS_FILE);
  const exam = db.exams[id];
  if (!exam) return res.status(404).json({ error: 'Not found' });
  const start = new Date(exam.startTimeISO).getTime();
  const durationMs = (Number(exam.durationMinutes) || 0) * 60 * 1000;
  const end = start + durationMs;
  const now = Date.now();
  const window = { start: new Date(start).toISOString(), end: new Date(end).toISOString(), open: now >= start && now < end, secondsRemaining: Math.max(0, Math.floor((end - now) / 1000)), serverNow: now };
  res.json({ exam: { id: exam.id, title: exam.title, parts: exam.parts }, window });
});

// Submit answers (only allowed if within time window). One submission per student id kept; latest overrides.
app.post('/api/exams/:id/submissions', (req, res) => {
  const id = req.params.id;
  const dbExams = readJson(EXAMS_FILE);
  const exam = dbExams.exams[id];
  if (!exam) return res.status(404).json({ error: 'Not found' });

  const start = new Date(exam.startTimeISO).getTime();
  const durationMs = (Number(exam.durationMinutes) || 0) * 60 * 1000;
  const end = start + durationMs;
  const now = Date.now();
  if (!(now >= start && now <= end)) return res.status(400).json({ error: 'Submission not within allowed window' });

  const { student, parts } = req.body;
  if (!student || !student.id) return res.status(400).json({ error: 'student.id required' });

  // Basic validation: ensure answers shape
  const safeParts = [0,1].map(p => {
    const part = exam.parts?.[p];
    const ansPart = (parts?.[p]) || [];
    const out = [];
    for (let q = 0; q < (part?.questions?.length || 0); q++) {
      const qAns = Array.isArray(ansPart[q]) ? ansPart[q].slice(0,4) : [null,null,null,null];
      out[q] = [0,1,2,3].map(i => typeof qAns[i] === 'boolean' ? qAns[i] : null);
    }
    return out;
  });

  const dbSubs = readJson(SUBMISSIONS_FILE);
  if (!dbSubs.submissions[id]) dbSubs.submissions[id] = {};
  dbSubs.submissions[id][student.id] = {
    student,
    parts: safeParts,
    submittedAt: nowISO()
  };
  writeJson(SUBMISSIONS_FILE, dbSubs);

  const score = scoreSubmission(exam, { parts: safeParts });
  res.json({ ok: true, score });
});

// Results
app.get('/api/exams/:id/results', (req, res) => {
  const id = req.params.id;
  const dbExams = readJson(EXAMS_FILE);
  const dbSubs = readJson(SUBMISSIONS_FILE);
  const exam = dbExams.exams[id];
  if (!exam) return res.status(404).json({ error: 'Not found' });
  const subs = dbSubs.submissions[id] || {};
  const out = computeStats(exam, subs);
  res.json(out);
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
