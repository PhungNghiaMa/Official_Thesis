import i18next from 'i18next';
import HttpApi from 'i18next-http-backend';

// Set initial language preference. Use 'vi' as default if not set.
// This function will be called to initialize i18next
export const initI18next = async() => {
    return i18next
        .use(HttpApi)
        .init({
            // Use the language preference from localStorage/default for initialization
            lng: 'vi', 
            fallbackLng: 'en',
            debug: true,
            ns: ['LandingPage'],
            defaultNS: 'LandingPage',
            supportedLngs: ['en', 'vi'],
            interpolation: {
                escapeValue: false,
            },
            backend: {
                loadPath: '/locales/{{lng}}/{{ns}}.json',
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
    // Call UI update after content is rendered
    updateUI(); 
};

// Update the language button text based on the CURRENT active language
const updateUI = () => {
    const languageBtn = document.getElementById('LangToggleBtn');
    const selectedLang = i18next.language;

    if (!languageBtn){
        console.error("Cannot find LangToggleBtn in DOM !");
        return;
    }
    // Update UI 
    if (selectedLang === 'vi'){
        languageBtn.innerHTML = 'VI';
    }else if (selectedLang === 'en'){
        languageBtn.innerHTML = 'EN';
    }
    
};

// This function changes the language and updates the content and UI
export const changeLanguage = async() => {
    // 1. Determine the target language based on the CURRENT language
    const currentLang = i18next.language;
    const targetLang = currentLang === 'vi' ? 'en' : 'vi';

    // 2. Switch the language
    i18next.changeLanguage(targetLang, (err) => {
        if (err) return console.error('something went wrong loading', err);
        
        // 3. Save the NEW language to localStorage
          localStorage.setItem('language', targetLang); 
        
        // 4. Update the page content and UI (which uses i18next.language now)
        updateContent();
    });
};