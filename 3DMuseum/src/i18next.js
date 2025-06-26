
import i18next from 'i18next';
import HttpApi from 'i18next-http-backend';

// This is the function that will be called to initialize i18next
export const initI18next = async() => {
  return i18next
    .use(HttpApi) // Use the http backend plugin
    .init({
      lng: 'vi', // The default language
      fallbackLng: 'en', // Fallback language if a translation is missing
      debug: true, // Shows console logs for debugging
      backend: {
        loadPath: '/locales/{{lng}}.json', // Path to the translation files
      },
      interpolation: {
        escapeValue: false, // React already does escaping
      },
    });
};

// This function updates the content of all elements with a data-i18n attribute
export const updateContent = async() => {
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.innerHTML = i18next.t(key);
  });
};

// This function changes the language and updates the content
export const changeLanguage = async(lng) => {
  i18next.changeLanguage(lng, (err, t) => {
    if (err) return console.error('something went wrong loading', err);
    updateContent(); // Re-render the content with the new language
  });
};