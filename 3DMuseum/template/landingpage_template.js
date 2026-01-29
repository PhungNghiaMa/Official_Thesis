// Landing Page Template
import "tailwindcss"
export default 
`<div id="landing_page" class="LandingPageContainer w-full overflow-hidden top-0">
      <div class="LandingPageWrapContainer w-full h-auto flex flex-row-reverse overlfow-hidden">
        <div class="FirstCol w-9/12 h-full flex flex-col">
          <div class="SubMuseumNameContainer overflow-hidden w-full h-4/12 flex items-center justify-center">
            <div class="SubMuseumName overflow-hidden w-full h-full flex flex-col flex-wrap items-end justify-end px-20">
              <div>
                <h1 data-i18n = "LandingPage.Vietnam" class="Vietnam text-9xl font-bold text-amber-500"></h1>
              </div>
              <div class="w-full flex justify-end items-center py-5">
                <h1 data-i18n = "LandingPage.Traditional_art" class="Traditional_art text-4xl font-bold text-yellow-300"></h1>
              </div>
            </div>
          </div>
          <div class="LandingPageFunctionContainer w-full h-8/12">
            <div class="InitBtnContainer w-full h-full">
              <div id="InitButton" class="InitBtn w-full h-fit overflow-hidden flex justify-end-safe pt-16">
                <button type="button" id="init_button" class="button h-auto overflow-hidden flex items-center justify-center">
                    <div class="wrap">
                      <p data-i18n="LandingPage.InitBtn">
                        <span>✧</span>
                        <span>✦</span>
                      </p>
                    </div>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="SecondCol w-3/12 h-full">
          <div class="ContentWrapperContainer w-full h-screen flex flex-col items-start justify-center gap-2 mx-5 box-border overflow-y-hidden">
            <div id="Graph_1_Container" class="Graph_1_Container w-full max-h-1/2 px-8 py-8 bg-white/1 backdrop-blur-xs rounded-2xl border border-white/1 overflow-auto">
              <h1 data-i18n="LandingPage.Des1" class="Description_1 text-small font-medium font-stretch-75% italic text-orange-50 drop-shadow-md"></h1>
            </div>

          <div id="Graph_2_Container" class="Graph_2_Container w-full max-h-1/2 px-8 py-8 mx-auto flex flex-wrap-reverse items-end justify-center bg-black/5 backdrop-blur-xs rounded-2xl border border-white/1 overflow-auto">
            <h1 data-i18n="LandingPage.Des2" class="Description_2 text-start text-small font-medium font-stretch-75% italic whitespace-pre-wrap text-orange-50 drop-shadow-md"></h1>
          </div>

          </div>
        </div>
      </div>
    </div>
`;