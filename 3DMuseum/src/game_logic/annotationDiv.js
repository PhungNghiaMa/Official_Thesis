// This class represents an annotation div in the 3D museum application. It creates a div element with annotation details and handles click events.
// It also provides methods to set and retrieve annotation information.
// To be more specific, this class create an annotation div so that when the user hover on this div, it will show the information about the artwork such as title, description in Vietnamese and English.
// Or when the user click on the div, it will trigger the onAnnotationClick callback function passed in the constructor.
export default class AnnotationDiv{

    constructor(text, id, onAnnotationClick){

        this.__id = id

        this.annotationDiv = document.createElement('div');
        this.annotationDiv.className = 'annotation';
        this.annotationDiv.textContent = `${text}`;
        this.title;
        this.vietnamese_description;
        this.english_description;
        this.vietnamese_audio;
        this.english_audio;

        this.expandedDiv = document.createElement('div');
        this.expandedDiv.className = 'expanded-annotation';
        this.expandedDiv.style.overflow = 'auto';
        this.title;

        const uploadBtn = document.createElement("button")

        uploadBtn.textContent = "Select action";
        uploadBtn.classList.add("btn")
        uploadBtn.addEventListener("click", (event) => {
            this.onAnnotationClick({event: null, id: this.__id})
        })

        const container = document.createElement("div")
        container.style.width = "100%"
        container.style.height = "100%"
        container.style.display = "flex"
        container.style.alignItems = "center"
        container.style.justifyContent = "center"

        container.appendChild(uploadBtn)

        this.expandedDiv.appendChild(container)

        this.annotationDiv.appendChild(this.expandedDiv);

        this.onAnnotationClick = onAnnotationClick;

        this.annotationDiv.addEventListener("click", this.clickEvent.bind(this))

        this.setAnnotationDetails = this.setAnnotationDetails.bind(this)
    
    }

    clickEvent(event){
        if (!this.expandedDiv.contains(event.target)){
            this.onAnnotationClick({event: event, id: this.__id})
        }
    }

    // SET INFROMATION DISPLAY WHEN HOVER THE PICTURE
    setAnnotationDetails(title, vietnamese_description, english_description , vietnamese_audio , english_audio){
        this.title = title;
        this.vietnamese_description = vietnamese_description;
        this.english_description = english_description;
        this.vietnamese_audio = vietnamese_audio;
        this.english_audio = english_audio;
        const systemLanguage = localStorage.getItem("language")
        let descriptionToShow , audioToPlay
        if (systemLanguage === 'vi'){
            descriptionToShow = vietnamese_description;
            audioToPlay = vietnamese_audio;
        }else{
            descriptionToShow = english_description;
            audioToPlay = english_audio;
        }
        this.expandedDiv.innerHTML = `
                <p class="art-title">${title}</p>
                <p class="art-description EnglishDescription">${descriptionToShow}</p>
        `
    }

    getElement(){
        return this.annotationDiv;
    }

    getId(){
        return this.__id;
    }

    getTitle(){
        return this.title;
    }

    getVietDes(){
        return this.vietnamese_description;
    }

    getEngDes(){
        return this.english_description;
    }

}   
