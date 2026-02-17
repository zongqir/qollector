import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

console.log('[Perf:i18n] START at', performance.now().toFixed(1), 'ms');

// 检测系统语言
function detectSystemLanguage() {
  // 获取浏览器/系统语言
  const systemLang = navigator.language || navigator.userLanguage;
  console.log('[Perf:i18n] System language detected:', systemLang);

  // 如果是中文（简体、繁体、香港等），统一使用简体中文
  if (systemLang.startsWith('zh')) {
    return 'zh-CN';
  }

  // 默认英文
  return 'en-US';
}

// 从 localStorage 获取保存的语言设置
// 如果没有保存过，使用系统语言检测
const savedLanguage = localStorage.getItem('language');
const initialLanguage = savedLanguage || detectSystemLanguage();

// 如果是首次启动（没有保存的语言），保存检测到的语言
if (!savedLanguage) {
  localStorage.setItem('language', initialLanguage);
  console.log('[Perf:i18n] First launch detected, language set to:', initialLanguage);
} else {
  console.log('[Perf:i18n] Using saved language:', savedLanguage);
}

console.log('[Perf:i18n] i18n initializing with language:', initialLanguage);
console.log('[Perf:i18n] Available translations:', { zhCN, enUS });

i18n
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': { translation: zhCN },
      'en-US': { translation: enUS },
    },
    lng: initialLanguage,
    fallbackLng: 'en-US',
    interpolation: {
      escapeValue: false,
    },
  });

console.log('[Perf:i18n] COMPLETE at', performance.now().toFixed(1), 'ms');

export default i18n;
