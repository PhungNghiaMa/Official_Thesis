import "tailwindcss"
export default 
`<div id="landing_page" class="LandingPageContainer w-full overflow-hidden top-0">
      <div class="LandingPageWrapContainer w-full h-auto flex flex-row-reverse overlfow-hidden">
        <div class="FirstCol w-9/12 h-full flex flex-col">
          <div class="SubMuseumNameContainer overflow-hidden w-full h-4/12 flex items-center justify-center">
            <div class="SubMuseumName overflow-hidden w-full h-full flex flex-col flex-wrap items-end justify-end px-20">
              <div>
                <h1 data-i18n = "Homepage.Vietnam" class="Vietnam text-9xl font-bold text-amber-500"></h1>
              </div>
              <div class="w-full flex justify-end items-center py-5">
                <h1 data-i18n = "Homepage.Traditional_art" class="Traditional_art text-4xl font-bold text-yellow-300"></h1>
              </div>
            </div>
          </div>
          <div class="LandingPageFunctionContainer w-full h-8/12">
            <div class="StartBtnContainer w-full h-full">
              <div class="StartBtn w-full h-fit overflow-hidden flex items-start justify-end pt-16">
                <button type="button" id="start_button" class="button h-auto overflow-hidden flex items-center justify-center">
                    <div class="wrap">
                      <p data-i18n="Homepage.StartBtn">
                        <span>✧</span>
                        <span>✦</span>
                        Start
                      </p>
                    </div>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="SecondCol w-3/12 h-full">
          <div class="ContentWrapperContainer w-full h-screen flex flex-col items-start justify-center">
            <div class="Graph_1_Container w-full max-h-1/2 px-6 py-5">
              <h1 data-i18n= "Homepage.Des1" class="Description_1 text-sm font-normal italic text-blue-100"></h1>
            </div>
            <div class="Graph_2_Container w-full max-h-1/2 px-6 py-2 mx-auto flex flex-wrap-reverse items-end justify-center">
              <h1 data-i18n = "Homepage.Des2" class="Description_2 text-start text-sm font-normal italic whitespace-pre-wrap text-blue-100"></h1>
            </div>
          </div>
        </div>
      </div>
    </div>
`;