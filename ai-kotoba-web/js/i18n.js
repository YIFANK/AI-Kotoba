const MESSAGES = {
  'zh-CN': {
    'logo.subtitle': '日语情景会话学习',
    'nav.practice': '练习', 'nav.tutor': 'AI 语音 Tutor', 'nav.pronunciation': '发音诊断',
    'nav.reading': '阅读', 'nav.history': '历史', 'nav.favorites': '收藏',
    'nav.vocab': '生词本', 'nav.cards': '闪卡复习', 'nav.settings': '设置',
    'common.back': '返回', 'common.save': '保存', 'common.saved': '已保存',
    'practice.title': '练习', 'practice.subtitle': '输入一个场景，AI 会先生成地道的日语，再使用你的解释语言翻译。',
    'practice.topic': '场景主题', 'practice.placeholder': '例如：在拉面店点餐', 'practice.generate': '✨ 生成会话',
    'settings.title': '设置', 'settings.subtitle': '配置学习者语言、AI 服务与数据管理',
    'profile.title': '学习者与语言', 'profile.ui': '界面语言', 'profile.native': '你的母语',
    'profile.explanation': '解释与翻译语言', 'profile.target': '目标语言',
    'profile.targetFixed': '日语（当前课程目标）', 'profile.save': '保存语言档案',
    'profile.other': '其他语言…', 'profile.custom': '输入语言名称',
    'profile.hint': '从下拉栏选择语言；如果列表中没有，可选择“其他语言”。AI Tutor、翻译、复盘和发音反馈都会使用该档案。',
    'profile.saved': '语言档案已保存',
  },
  en: {
    'logo.subtitle': 'Scenario-based Japanese learning',
    'nav.practice': 'Practice', 'nav.tutor': 'AI Voice Tutor', 'nav.pronunciation': 'Pronunciation',
    'nav.reading': 'Reading', 'nav.history': 'History', 'nav.favorites': 'Favorites',
    'nav.vocab': 'Vocabulary', 'nav.cards': 'Flashcards', 'nav.settings': 'Settings',
    'common.back': 'Back', 'common.save': 'Save', 'common.saved': 'Saved',
    'practice.title': 'Practice', 'practice.subtitle': 'Describe a scenario. AI writes natural Japanese first, then translates it into your explanation language.',
    'practice.topic': 'Scenario', 'practice.placeholder': 'Example: Ordering at a ramen shop', 'practice.generate': '✨ Generate dialogue',
    'settings.title': 'Settings', 'settings.subtitle': 'Configure learner languages, AI services, and data',
    'profile.title': 'Learner & languages', 'profile.ui': 'Interface language', 'profile.native': 'Your native language',
    'profile.explanation': 'Explanation & translation language', 'profile.target': 'Target language',
    'profile.targetFixed': 'Japanese (current course target)', 'profile.save': 'Save language profile',
    'profile.other': 'Other language…', 'profile.custom': 'Enter language name',
    'profile.hint': 'Choose from the list, or select “Other language” when needed. Tutor, translations, reviews, and pronunciation feedback all use this profile.',
    'profile.saved': 'Language profile saved',
  },
};

let activeLanguage = 'zh-CN';

export function setLanguage(language) {
  activeLanguage = language === 'en' ? 'en' : 'zh-CN';
  document.documentElement.lang = activeLanguage;
  document.title = activeLanguage === 'en'
    ? 'AI-Kotoba · Japanese Language Tutor'
    : 'AI-Kotoba · 言葉 — AI 日语情景会话学习';
}

export function getLanguage() { return activeLanguage; }
export function isEnglish() { return activeLanguage === 'en'; }

export function t(key, variables = {}) {
  let value = MESSAGES[activeLanguage]?.[key] ?? MESSAGES['zh-CN'][key] ?? key;
  for (const [name, replacement] of Object.entries(variables)) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}

export function applyStaticTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = t(element.dataset.i18n);
  });
}
