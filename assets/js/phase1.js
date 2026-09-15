(function () {
  "use strict";

  const TOTAL_WORDS = 19466;
  const LEVEL_WEIGHT = { "必备": 0.12, CET4: 0.28, CET6: 0.46, "考研": 0.58, IELTS: 0.68, TOEFL: 0.74, Oxford: 0.50, Collins: 0.55, GRE: 0.90 };

  class VocabularyAssessment {
    constructor(words, previousProfile = null) {
      this.bank = this.prepare(words);
      this.responses = [];
      this.fullAssessment = !previousProfile?.assessment_completed_at;
      this.minQuestions = this.fullAssessment ? 28 : 8;
      this.maxQuestions = this.fullAssessment ? 42 : 14;
      this.lower = previousProfile?.assessment_lower ?? 0;
      this.upper = previousProfile?.assessment_upper ?? TOTAL_WORDS;
      this.estimate = previousProfile?.vocabulary_size || Math.round(TOTAL_WORDS * 0.5);
      this.used = new Set();
    }

    prepare(words) {
      const list = (Array.isArray(words) ? words : []).slice(0, TOTAL_WORDS);
      return list.map((word, index) => {
        const tags = Array.isArray(word.tags) ? word.tags : [word.level].filter(Boolean);
        const levelScore = Math.max(...tags.map((tag) => LEVEL_WEIGHT[tag] ?? 0.5));
        const frequencyRank = Number(word.frequencyRank || word.frequency_rank || index + 1);
        const frequencyScore = Math.min(1, Math.max(0, frequencyRank / Math.max(1, list.length)));
        return { ...word, assessmentDifficulty: Math.round(TOTAL_WORDS * (levelScore * 0.72 + frequencyScore * 0.28)) };
      }).sort((a, b) => a.assessmentDifficulty - b.assessmentDifficulty);
    }

    next() {
      if (this.finished()) return null;
      const target = this.responses.length === 0 ? Math.round(TOTAL_WORDS * 0.5) : Math.round((this.lower + this.upper) / 2);
      const windowSize = Math.max(180, Math.round((this.upper - this.lower) * 0.12));
      let candidates = this.bank.filter((w) => !this.used.has(w.id || w.word) && Math.abs(w.assessmentDifficulty - target) <= windowSize);
      if (!candidates.length) candidates = this.bank.filter((w) => !this.used.has(w.id || w.word));
      candidates.sort((a, b) => Math.abs(a.assessmentDifficulty - target) - Math.abs(b.assessmentDifficulty - target));
      const pool = candidates.slice(0, Math.min(12, candidates.length));
      const word = pool[Math.floor(Math.random() * pool.length)] || null;
      if (word) this.used.add(word.id || word.word);
      return word;
    }

    answer(word, correct, confidence = 1) {
      const difficulty = Number(word.assessmentDifficulty || this.estimate);
      const weight = Math.min(1, Math.max(0.35, Number(confidence)));
      if (correct) this.lower = Math.max(this.lower, Math.round(difficulty * weight + this.lower * (1 - weight)));
      else this.upper = Math.min(this.upper, Math.round(difficulty * weight + this.upper * (1 - weight)));
      if (this.lower > this.upper) [this.lower, this.upper] = [this.upper, this.lower];
      this.estimate = Math.round((this.lower + this.upper) / 2);
      this.responses.push({ wordId: word.id || word.word, difficulty, correct: Boolean(correct), confidence: weight });
      return this.result();
    }

    finished() {
      if (this.responses.length >= this.maxQuestions) return true;
      return this.responses.length >= this.minQuestions && (this.upper - this.lower) <= Math.max(700, Math.round(this.estimate * 0.12));
    }

    result() {
      return {
        vocabularySize: Math.min(TOTAL_WORDS, Math.max(0, this.estimate)),
        lower: Math.min(TOTAL_WORDS, Math.max(0, this.lower)),
        upper: Math.min(TOTAL_WORDS, Math.max(0, this.upper)),
        answered: this.responses.length,
        completed: this.finished(),
        fullAssessment: this.fullAssessment,
        responses: this.responses.slice(),
      };
    }
  }

  function adjustEstimateFromLearning(assessment, records) {
    const values = Object.values(records || {});
    if (!values.length) return assessment;
    const mastered = values.filter((r) => Number(r.mastery || 0) >= 70).length;
    const accuracy = values.reduce((sum, r) => sum + Number(r.reps || 0), 0) > 0
      ? values.reduce((sum, r) => sum + Math.max(0, Number(r.reps || 0) - Number(r.mistakes || 0)), 0) / values.reduce((sum, r) => sum + Number(r.reps || 0), 0)
      : 0.5;
    const delta = Math.round(Math.min(900, mastered * 1.5) * (accuracy - 0.45));
    return { ...assessment, vocabularySize: Math.min(TOTAL_WORDS, Math.max(0, assessment.vocabularySize + delta)), learningAdjustment: delta };
  }

  async function ai(action, input) {
    const response = await fetch("/api/ai", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, input }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "AI request failed");
    return data;
  }

  async function describeAbility(result) {
    return ai("describe_ability", { vocabularySize: result.vocabularySize, interval: [result.lower, result.upper], answered: result.answered });
  }

  async function loadAssessmentProfile() {
    const response = await fetch("/api/assessment", { credentials: "include" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Assessment profile load failed");
    return data.profile;
  }

  async function saveAssessment(result, ability = null) {
    const response = await fetch("/api/assessment", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result, abilityLevel: ability?.level, abilityDescription: ability?.description }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Assessment result save failed");
    return data.profile;
  }

  window.LearnHubPhase1 = {
    TOTAL_WORDS,
    VocabularyAssessment,
    adjustEstimateFromLearning,
    describeAbility,
    loadAssessmentProfile,
    saveAssessment,
    grade: (input) => ai("grade", input),
    correct: (input) => ai("correct", input),
    generate: (input) => ai("generate", input),
    createAssessment: (previousProfile) => new VocabularyAssessment(window.LEARNHUB_WORDS || [], previousProfile),
  };
})();
