import "tailwindcss"

export default 
` 
    <div class = "NavigationPageContainer w-full h-full overflow-hidden">
        <div class = "TopFunctionContainer w-full h-1/12 flex items-center justify-between">
            <div class="ReturnBtnContainer w-1/12 h-auto">
                <i class="bi bi-house houseBtn"></i>
            </div>
            <div class="NavBarContainer w-11/12 h-auto flex flex-row items-center justify-end-safe px-5">
                <nav class="NavBar w-auto h-auto flex items-center justify-around text-md ">
                <a data-i18n="MenuBar.about" id="#about" class="navigation about px-2" href="/about">About</a>
                <a data-i18n="MenuBar.gallery" id="#gallery" class="navigation gallery px-2" href="/gallery">Gallery</a>
                <a data-i18n="MenuBar.contact" id="#contact" class="navigation contact px-2" href="/contact">Contact</a>
                </nav>
                <div class="LanguageSwitcherContainer w-auto h-auto flex flex-row items-center transition-all ease-in-out 10s text-xs font-semibold">
                <div class="VietBtn lang flex items-center justify-around mx-2 border-2 border-gray-200 rounded-lg text-gray-200">
                    <button href="/" onclick="changeLanguage('vi')">VI</button>
                </div>
                <div class="EnBtn lang hidden mx-2 border-2 border-gray-400 hover:border-orange-400 rounded-lg text-gray-300">
                    <button href="/" onclick="changeLanguage('en')">EN</button>
                </div>
                </div>
            </div>
        </div>
        <div class= "BottomFunctionContainer w-full h-11/12 flex flex-col">
        </div>
    </div>
`