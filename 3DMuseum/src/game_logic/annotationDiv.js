export default class AnnotationDiv{

    constructor(text, id, onAnnotationClick){

        this.__id = id

        this.annotationDiv = document.createElement('div');
        this.annotationDiv.className = 'annotation';
        this.annotationDiv.textContent = `${text}`;
        this.title;
        this.vietnamese_description;
        this.english_description;

        this.expandedDiv = document.createElement('div');
        this.expandedDiv.className = 'expanded-annotation';

        const uploadBtn = document.createElement("button")
        uploadBtn.textContent = "Upload";
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
    setAnnotationDetails(title, vietnamese_description, english_description){
        this.title = title;
        this.vietnamese_description = vietnamese_description;
        this.english_description = english_description;
        const systemLanguage = localStorage.getItem("language")
        let descriptionToShow
        if (systemLanguage === 'vi'){
            descriptionToShow = vietnamese_description
        }else{
            descriptionToShow = english_description
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
